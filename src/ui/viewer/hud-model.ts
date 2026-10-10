import { createFrame, DrivePhase, lacCountAt, packetAliveAt, packetPhaseAt, sampleFrame, ShipStatus, unitPresent, type Frame, type Replay } from '../../core/replay';
import type { OutcomeEvent, ScenarioPack } from '../../core/schema';
import { exclusionsAt, indexBodies, type SphereExclusion } from '../../core/solver/orbits';
import { fmtCount, LM_KM } from '../../core/units';
import { dist, type Vec3 } from '../../core/vec';
import type { DirectorShot } from '../../render/director';
import type { PhaseMark, Speed } from './model';

/** Site A tallies (A report §4.9), from the replay only. */
export interface Tallies {
  inSpace: number;
  inSpaceBySide: Array<{ id: string; ally: boolean; n: number }>;
  launched: number;
  detonated: number;
  stopped: number;
  lost: { ally: number; hostile: number };
}

export function tallies(r: Replay, frame: Frame): Tallies {
  const ally = r.sides[0]?.id;
  const bySide = new Map<string, number>(r.sides.map((s) => [s.id, 0]));
  let inSpace = 0, launched = 0, detonated = 0, stopped = 0;
  r.packets.forEach((p, i) => {
    if (p.tLaunch > frame.t) return;
    const n = p.launched.attack + p.launched.ew;
    launched += n;
    const alive = frame.packetAlive[i];
    if (frame.packetPhase[i] !== DrivePhase.Gone) {
      inSpace += alive;
      bySide.set(p.side, (bySide.get(p.side) ?? 0) + alive);
      stopped += n - alive;
    } else {
      const atArrival = packetAliveAt(p, p.tArrive - 1e-6);
      const reached = frame.t >= p.tArrive ? atArrival.attack + atArrival.ew : 0;
      detonated += reached;
      stopped += n - reached;
    }
  });
  const lost = { ally: 0, hostile: 0 };
  r.ships.forEach((s, i) => {
    if (frame.shipStatus[i] !== ShipStatus.Destroyed) return;
    if (s.side === ally) lost.ally++;
    else lost.hostile++;
  });
  return {
    inSpace, launched, detonated, stopped: Math.max(0, stopped), lost,
    inSpaceBySide: r.sides.map((s) => ({ id: s.id, ally: s.id === ally, n: bySide.get(s.id) ?? 0 })),
  };
}

export interface ForceBar { label: string; total: number; ok: number; crippled: number }
export interface ForceUnit {
  idx: number; id: string; name: string; ally: boolean; commander: string | null; dormant: boolean;
  limit: string | null; bars: ForceBar[]; lacText: string | null; firstShip: number | null; theater: string;
}

const ROLE_LABEL = { wall: 'Wall', carrier: 'CLAC', screen: 'Screen', lac: 'LAC' } as const;

/** "Inside limit" / "Outside limit" against the nearest star's hyper limit, as Site A's Forces panel shows. */
export function limitText(pack: ScenarioPack, p: Vec3, t: number): string | null {
  const limits = exclusionsAt(indexBodies(pack.bodies), t).filter((e): e is SphereExclusion => e.kind === 'hyper-limit');
  if (!limits.length) return null;
  const nearest = limits.reduce((a, b) => (dist(p, a.center) - a.radius < dist(p, b.center) - b.radius ? a : b));
  return dist(p, nearest.center) < nearest.radius ? 'Inside limit' : 'Outside limit';
}

/** Site A Forces rows: per role, operational/degraded fill plus crippled (mission kill) in amber. */
export function forceUnits(pack: ScenarioPack, r: Replay, frame: Frame, only: string | null = null): ForceUnit[] {
  const ally = r.sides[0]?.id;
  return r.units.filter((u) => only === null || u.side === only).map((u) => {
    const def = pack.units.find((d) => d.id === u.id);
    const commander = def?.commander.value ?? null;
    const present = unitPresent(u, frame.t);
    const pos: Vec3 = [frame.unitPos[u.idx * 3], frame.unitPos[u.idx * 3 + 1], frame.unitPos[u.idx * 3 + 2]];
    const base = {
      idx: u.idx, id: u.id, name: u.name, ally: u.side === ally, commander, dormant: !present,
      limit: present ? limitText(pack, pos, frame.t) : frame.t < u.tAppear ? 'Not yet in system' : 'Departed',
      firstShip: u.shipIdx[0] ?? null, theater: u.theater,
    };
    if (u.kind === 'lac') {
      const initial = u.lacCount[0]?.count ?? 0;
      const now = lacCountAt(u, frame.t);
      return { ...base, bars: [{ label: 'LAC', total: initial, ok: now, crippled: 0 }], lacText: `${fmtCount(now)}/${fmtCount(initial)}` };
    }
    const bars = new Map<string, ForceBar>();
    for (const i of u.shipIdx) {
      const s = r.ships[i];
      const label = ROLE_LABEL[s.role] ?? s.role;
      const bar = bars.get(label) ?? { label, total: 0, ok: 0, crippled: 0 };
      bar.total++;
      const st = frame.shipStatus[i] as ShipStatus;
      if (st === ShipStatus.Operational || st === ShipStatus.Degraded || st === ShipStatus.Absent) bar.ok++;
      else if (st === ShipStatus.MissionKill) bar.crippled++;
      bars.set(label, bar);
    }
    const order = ['Wall', 'CLAC', 'Screen', 'LAC'];
    return { ...base, bars: [...bars.values()].sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label)), lacText: null };
  });
}

/** Scrubber segments: each phase runs to the next mark (Site A §7.7). */
export function phaseSpans(marks: PhaseMark[], duration: number): Array<{ label: string; left: number; width: number; t: number }> {
  const sorted = [...marks].sort((a, b) => a.t - b.t);
  return sorted.map((m, i) => {
    const end = i + 1 < sorted.length ? sorted[i + 1].t : duration;
    return { label: m.label, t: m.t, left: (m.t / duration) * 100, width: (Math.max(0, end - m.t) / duration) * 100 };
  }).filter((s) => s.width > 0);
}

/** One tick per salvo launch, by side; Apollo-guided salvos are violet (Site A §7.7). */
export function salvoTicks(r: Replay): Array<{ left: number; cls: 's0' | 's1' | 'sa' }> {
  const ally = r.sides[0]?.id;
  const seen = new Set<string>();
  const out: Array<{ left: number; cls: 's0' | 's1' | 'sa' }> = [];
  for (const p of r.packets) {
    const key = `${p.salvoId}|${Math.round(p.tLaunch)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ left: (p.tLaunch / r.duration_s) * 100, cls: p.guidance === 'apollo' ? 'sa' : p.side === ally ? 's0' : 's1' });
  }
  return out;
}

/** Site A shot numbers: "sequence.shot", the sequence being the phase the shot starts in. */
export function shotNumbers(shots: DirectorShot[], marks: PhaseMark[]): Map<string, { no: string; sequence: string }> {
  const sorted = [...marks].sort((a, b) => a.t - b.t);
  const out = new Map<string, { no: string; sequence: string }>();
  const counts = new Map<number, number>();
  for (const shot of [...shots].sort((a, b) => a.t0 - b.t0)) {
    let seq = 0;
    sorted.forEach((m, i) => { if (m.t <= shot.t0 + 1e-6) seq = i; });
    const n = (counts.get(seq) ?? 0) + 1;
    counts.set(seq, n);
    out.set(shot.id, { no: `${seq + 1}.${n}`, sequence: sorted[seq]?.label ?? '' });
  }
  return out;
}

export function phaseAt(marks: PhaseMark[], t: number): PhaseMark | null {
  let current: PhaseMark | null = null;
  for (const m of [...marks].sort((a, b) => a.t - b.t)) if (m.t <= t + 1e-6) current = m;
  return current;
}

const rateText = (rate: number): string => `${Number(rate.toFixed(rate < 1 ? 2 : 1))}`;

/** Site A's clock chip: "×24", "slow ×0.35" or "paused". */
export function speedChip(playing: boolean, speed: Speed, rate: number): string {
  if (!playing) return 'paused';
  const r = speed === 'auto' ? rate : speed;
  return r < 1 ? `slow ×${rateText(r)}` : `×${rateText(r)}`;
}

/** "July 1921 PD" from the pack date. */
export function monthYear(pack: ScenarioPack): string | null {
  const iso = pack.meta.date?.value;
  const m = typeof iso === 'string' ? /^(\d{4})-(\d{2})/.exec(iso) : null;
  if (!m) return pack.meta.year_pd ? `${pack.meta.year_pd} PD` : null;
  const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(m[2]) - 1];
  return `${month} ${m[1]} PD`;
}

const SCALE_FMT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
const snap125 = (v: number): number => {
  const p = 10 ** Math.floor(Math.log10(v));
  return (v / p >= 5 ? 5 : v / p >= 2 ? 2 : 1) * p;
};

/** Site A's scale bar (JS:7569-7592): about 110 px of the focus plane, snapped to 1, 2 or 5 of a decade. */
export function scaleBar(kmPerPx: number): { widthPx: number; label: string } | null {
  if (!(kmPerPx > 0) || !Number.isFinite(kmPerPx)) return null;
  const km = kmPerPx * 110;
  let val: number;
  let label: string;
  if (km > LM_KM * 2) {
    const lm = snap125(km / LM_KM);
    val = lm * LM_KM;
    label = `${SCALE_FMT.format(lm)} light-minutes`;
  } else {
    val = snap125(km);
    label = val >= 1e6 ? `${SCALE_FMT.format(val / 1e6)} million km` : val < 1 ? `${SCALE_FMT.format(val * 1000)} m` : `${SCALE_FMT.format(val)} km`;
  }
  return { widthPx: Number((val / kmPerPx).toFixed(1)), label };
}

export interface DebriefRow {
  id: string; name: string; commander: string | null; ally: boolean; kind: 'fleet' | 'lac';
  /** Warships, or LACs for a LAC group. */
  strength: number; destroyed: number; crippled: number; captured: number; escaped: number;
}
export interface Debrief {
  rows: DebriefRow[];
  launched: Array<{ id: string; name: string; ally: boolean; n: number }>;
  peak: { n: number; t: number };
  detonated: number;
}

const inSpaceAt = (r: Replay, t: number): number => r.packets.reduce((n, p) => {
  if (packetPhaseAt(p, t) === DrivePhase.Gone) return n;
  const a = packetAliveAt(p, t);
  return n + a.attack + a.ew;
}, 0);

/** Site A's after-action summary (JS:7597-7634), from the final frame and the packet survivors. */
export function debrief(pack: ScenarioPack, r: Replay): Debrief {
  const end = sampleFrame(r, r.duration_s, createFrame(r));
  const ally = r.sides[0]?.id;
  const rows = r.units.map((u): DebriefRow => {
    const base = { id: u.id, name: u.name, commander: pack.units.find((d) => d.id === u.id)?.commander.value ?? null, ally: u.side === ally, kind: u.kind };
    if (u.kind === 'lac') {
      // LAC groups only shrink through canon outcomes, which tell destroyed from captured and abandoned.
      const outcomes = pack.events.filter((e): e is OutcomeEvent => e.type === 'outcome' && e.unit === u.id);
      const sum = (f: (c: OutcomeEvent['counts']) => number) => outcomes.reduce((a, e) => a + f(e.counts), 0);
      return { ...base, strength: u.lacCount[0]?.count ?? 0, destroyed: sum((c) => c.destroyed), crippled: 0, captured: sum((c) => c.captured + c.abandoned), escaped: 0 };
    }
    const count = (st: ShipStatus) => u.shipIdx.filter((i) => end.shipStatus[i] === st).length;
    return {
      ...base, strength: u.shipIdx.length,
      destroyed: count(ShipStatus.Destroyed), crippled: count(ShipStatus.MissionKill),
      captured: count(ShipStatus.Captured), escaped: count(ShipStatus.Escaped),
    };
  });
  const launched = r.sides.map((sd) => ({
    id: sd.id, name: sd.name, ally: sd.id === ally,
    n: r.packets.reduce((n, p) => (p.side === sd.id ? n + p.launched.attack + p.launched.ew : n), 0),
  }));
  // Survivors only fall after launch, so the peak sits at a launch instant.
  let peak = { n: 0, t: 0 };
  for (const t of [...new Set(r.packets.map((p) => p.tLaunch))].sort((a, b) => a - b)) {
    const n = inSpaceAt(r, t);
    if (n > peak.n) peak = { n, t };
  }
  return { rows, launched, peak, detonated: tallies(r, end).detonated };
}
