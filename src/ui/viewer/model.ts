import { formatLabelled, type SourceValue } from '../../core/evidence';
import {
  lacCountAt, logUntil, shipStatusAt, STATUS_TEXT, ShipStatus, SUBSYSTEM_TEXT, SUBSYSTEMS, subsystemsAt, unitPresent,
  type Frame, type LogEntry, type Replay,
} from '../../core/replay';
import type { ScenarioPack } from '../../core/schema';
import type { TechRegistry } from '../../core/tech';
import { fmtCount } from '../../core/units';
import type { ShipDemo } from '../../render/scales/ship-view';
import type { LayerId, ScaleId } from '../../render/scales/types';
import { logLine } from '../format';

export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 15, 30, 60, 120, 240] as const;
export const DENSITIES = [1, 2, 4, 8, 16] as const;
export type Speed = number | 'auto';

export const DEFAULT_LAYERS: Record<LayerId, boolean> = {
  celestial: true, truth: true, commander: false, engagement: true, protection: false, comms: true, damage: true,
};

export interface ViewerState {
  t: number;
  playing: boolean;
  speed: Speed;
  scale: ScaleId;
  camera: 'director' | 'free';
  /** Free camera keeps moving with the selected fleet or the current engagement. */
  follow: boolean;
  theater: string;
  layers: Record<LayerId, boolean>;
  perceived: { enabled: boolean; side: string };
  density: number;
  selectedShip: number | null;
  selectedClass: string | null;
  logSide: string;
  demo: ShipDemo;
  demoProgress: number;
  reducedMotion: boolean;
  drawer: 'none' | 'forces' | 'log';
  menu: 'none' | 'layers' | 'view' | 'density' | 'shots';
}

export function initialState(pack: ScenarioPack, reducedMotion: boolean): ViewerState {
  const hasShots = pack.meta.shots.length > 0;
  return {
    t: 0, playing: false, speed: 'auto', scale: hasShots ? pack.meta.shots[0].scale : 'engagement', camera: hasShots ? 'director' : 'free', follow: true,
    theater: hasShots ? pack.meta.shots[0].theater : pack.meta.theaters[0].id, layers: { ...DEFAULT_LAYERS },
    perceived: { enabled: false, side: pack.meta.sides[0].id }, density: 4, selectedShip: null, selectedClass: null,
    logSide: 'all', demo: 'none', demoProgress: 0, reducedMotion, drawer: 'none', menu: 'none',
  };
}

export interface EventIndex { times: Float64Array }

export function eventIndex(r: Replay): EventIndex {
  const ts: number[] = [];
  for (const p of r.packets) ts.push(p.tLaunch, p.tArrive);
  for (const b of r.beams) ts.push(b.t);
  for (const e of r.log) ts.push(e.t);
  return { times: Float64Array.from(ts.sort((a, b) => a - b)) };
}

/** Seconds from t to the next event; an event in the last 3 s counts as now, so flashes play slowly. */
function gapToEvent(ix: EventIndex, t: number): number {
  let lo = 0;
  let hi = ix.times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ix.times[mid] < t - 3) lo = mid + 1;
    else hi = mid;
  }
  return lo < ix.times.length ? Math.max(0, ix.times[lo] - t) : Infinity;
}

/** Auto pacing (Site A's cinematic rhythm, driven by the replay's own events). */
export function autoSpeed(ix: EventIndex, t: number): number {
  const gap = gapToEvent(ix, t);
  if (gap <= 2) return 2;
  if (gap <= 15) return 4;
  if (gap <= 60) return 15;
  if (gap <= 300) return 60;
  return 240;
}

export function advance(s: ViewerState, dtWall: number, ix: EventIndex, duration: number): { t: number; playing: boolean } {
  if (!s.playing) return { t: s.t, playing: false };
  const rate = s.speed === 'auto' ? autoSpeed(ix, s.t) : s.speed;
  const t = Math.min(duration, s.t + Math.min(dtWall, 0.25) * rate);
  return { t, playing: t < duration };
}

export interface PhaseMark { id: string; label: string; t: number }

export function phaseMarks(pack: ScenarioPack, r: Replay): PhaseMark[] {
  return pack.meta.phases
    .map((p) => ({ id: p.id, label: p.label, t: r.resolvedTimes[`phase:${p.id}`] ?? 0 }))
    .sort((a, b) => a.t - b.t);
}

export const nextPhase = (marks: PhaseMark[], t: number): number | null => marks.find((m) => m.t > t + 0.5)?.t ?? null;

/** Timeline ticks in percent; a label closer than `minGap` (share of the timeline) to the last shown label is hidden. */
export function tickLabels(marks: PhaseMark[], duration: number, minGap = 0.07): Array<PhaseMark & { left: number; showLabel: boolean }> {
  let lastShown = -Infinity;
  return marks.map((m) => {
    const frac = duration > 0 ? m.t / duration : 0;
    const showLabel = frac - lastShown >= minGap;
    if (showLabel) lastShown = frac;
    return { ...m, left: frac * 100, showLabel };
  });
}

/** Pressing "previous" just after a phase starts goes to the one before it, like a media player. */
export function prevPhase(marks: PhaseMark[], t: number): number {
  let out = 0;
  for (const m of marks) if (m.t < t - 1) out = m.t;
  return out;
}

export interface StatusCount { status: ShipStatus; n: number; text: string }
export interface ForceUnitRow {
  idx: number; name: string; kind: 'fleet' | 'lac'; presence: 'present' | 'arriving' | 'departed';
  total: number; counts: StatusCount[]; lacText: string | null; firstShip: number | null;
}
export interface ForceSide { id: string; name: string; ally: boolean; units: ForceUnitRow[] }

/** The side whose commander the UI speaks for; null means ground truth (Actual). */
export const knownSide = (s: Pick<ViewerState, 'perceived'>): string | null => (s.perceived.enabled ? s.perceived.side : null);

/** A selection the commander could not know about (another side's ship) is dropped in the perceived picture. */
export function perceivedSelection(r: Replay, s: Pick<ViewerState, 'perceived' | 'selectedShip'>): number | null {
  const side = knownSide(s);
  if (side === null || s.selectedShip === null) return s.selectedShip;
  return r.ships[s.selectedShip]?.side === side ? s.selectedShip : null;
}

/** Log filter: in the perceived picture only the commander's own side's entries, never neutral narrative. */
export const logVisible = (e: LogEntry, side: string, only: string | null = null): boolean =>
  only !== null ? e.side === only : side === 'all' || e.side === side || e.side === null;

export function forcesModel(r: Replay, frame: Frame, only: string | null = null): ForceSide[] {
  return r.sides.filter((side) => only === null || side.id === only).map((side) => ({
    id: side.id, name: side.name, ally: side.id === r.sides[0].id,
    units: r.units.filter((u) => u.side === side.id).map((u): ForceUnitRow => {
      const presence = unitPresent(u, frame.t) ? 'present' : frame.t < u.tAppear ? 'arriving' : 'departed';
      if (u.kind === 'lac') {
        const initial = u.lacCount[0]?.count ?? 0;
        return {
          idx: u.idx, name: u.name, kind: 'lac', presence, total: initial, counts: [],
          lacText: `${fmtCount(lacCountAt(u, frame.t))} of ${fmtCount(initial)} LACs`, firstShip: null,
        };
      }
      const tally = new Map<ShipStatus, number>();
      for (const i of u.shipIdx) {
        const st = frame.shipStatus[i] as ShipStatus;
        if (st !== ShipStatus.Absent) tally.set(st, (tally.get(st) ?? 0) + 1);
      }
      const counts = [...tally].sort((a, b) => a[0] - b[0]).map(([status, n]) => ({ status, n, text: `${fmtCount(n)} ${STATUS_TEXT[status]}` }));
      return { idx: u.idx, name: u.name, kind: 'fleet', presence, total: u.shipIdx.length, counts, lacText: null, firstShip: u.shipIdx[0] ?? null };
    }),
  }));
}

export function sourceText(pack: ScenarioPack, v: { source_id: string; locator?: string; uncertainty?: string }): string {
  const title = pack.meta.sources.find((s) => s.id === v.source_id)?.title ?? v.source_id;
  return `${title}${v.locator ? `, ${v.locator}` : ''}${v.uncertainty ? `. ${v.uncertainty}` : ''}`;
}

export interface Figure { label: string; value: string; source: string }
export interface InspectorModel {
  name: string; nameNote: string; classId: string; className: string; side: string; status: string;
  subsystems: Array<{ label: string; ok: boolean; text: string }>; hits: number; equipment: string[]; figures: Figure[];
}

export function inspectorModel(pack: ScenarioPack, tech: TechRegistry, r: Replay, ship: number, t: number): InspectorModel {
  const s = r.ships[ship];
  const cls = tech.classes[s.classId];
  const sub = subsystemsAt(s, t);
  const fig = (label: string, v: SourceValue<number>): Figure => ({ label, value: formatLabelled(v), source: sourceText(pack, v) });
  return {
    name: s.name,
    nameNote: s.nameEvidence === 'S' ? 'Designation assigned for this replay [S]' : `Name [${s.nameEvidence}]`,
    classId: s.classId,
    className: cls?.name ?? s.classId,
    side: r.sides.find((x) => x.id === s.side)?.name ?? s.side,
    status: STATUS_TEXT[shipStatusAt(r, s, t)],
    subsystems: SUBSYSTEMS.map((k) => ({
      label: SUBSYSTEM_TEXT[k], ok: sub[k] > 0, text: sub[k] >= 1 ? 'intact' : sub[k] > 0 ? `${Math.round(sub[k] * 100)}%` : 'lost',
    })),
    hits: s.hitCount,
    equipment: s.equipment,
    figures: cls
      ? [
          fig('Length', cls.length), fig('Mass', cls.mass), fig('Maximum acceleration', cls.accel_max),
          fig('Broadside tubes', cls.broadside.missile), fig('Broadside grasers', cls.broadside.graser),
          fig('Hyper cycle', cls.hyper_cycle),
        ]
      : [],
  };
}

export interface LogRow { t: number; side: string | null; text: string; entry: LogEntry }

/** The last `limit` entries up to t, optionally for one side (entries without a side always show). */
export function logModel(r: Replay, t: number, side: string, limit = 300, only: string | null = null): LogRow[] {
  const rows = logUntil(r, t).filter((e) => logVisible(e, side, only));
  return rows.slice(-limit).map((e) => ({ t: e.t, side: e.side, text: logLine(e), entry: e }));
}
