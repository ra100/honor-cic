import type { ScenarioPack } from '../schema';
import { fmtCount } from '../units';
import type { UnitRuntime, LogEntry } from './runtime';
import type { TimeResolver } from './timeref';
import { splitEven } from './packets';

const VIA: Record<string, string> = { hyper: 'translates in from hyper', junction: 'arrives through the Junction', launch: 'launches' };
const DEPART: Record<string, string> = { hyper: 'translates out into hyper', junction: 'leaves through the Junction', recovered: 'is recovered aboard its carriers' };

/** CIC log lines for scripted events; combat lines come from the defense and beam resolvers. */
export function narrativeLog(pack: ScenarioPack, times: TimeResolver, units: UnitRuntime[]): LogEntry[] {
  const unit = (id: string) => units.find((u) => u.id === id);
  const out: LogEntry[] = [];
  for (const def of pack.units) {
    const u = unit(def.id);
    if (u && Number.isFinite(u.tAppear) && def.present.from_via) {
      out.push({ t: u.tAppear, side: u.side, kind: 'transit', text: `${u.name} ${VIA[def.present.from_via]}`, evidence: def.evidence, source_id: def.source_id });
    }
    if (u && Number.isFinite(u.tDepart) && def.present.until_via) {
      out.push({ t: u.tDepart, side: u.side, kind: 'transit', text: `${u.name} ${DEPART[def.present.until_via]}`, evidence: def.evidence, source_id: def.source_id });
    }
  }
  for (const ev of pack.events) {
    const t = times.resolve(ev.t);
    const base = { evidence: ev.evidence, source_id: ev.source_id, ref: ev.id };
    switch (ev.type) {
      case 'fire_plan': {
        const from = unit(ev.from);
        const to = unit(ev.to);
        const attackEw = splitEven(ev.totals.attack + ev.totals.ew, ev.salvos);
        const ctl = splitEven(ev.totals.controller, ev.salvos);
        for (let k = 0; k < ev.salvos; k++) {
          const extra = ctl[k] ? ` plus ${fmtCount(ctl[k])} Apollo controllers` : '';
          const salvo = ev.salvos > 1 ? `salvo ${k + 1} of ${ev.salvos}` : 'salvo';
          out.push({ t: t + k * ev.interval_s, side: from?.side ?? null, kind: 'launch', text: `${from?.name} launches ${salvo} at ${to?.name}: ${fmtCount(attackEw[k])} missiles${extra}`, ...base });
        }
        break;
      }
      case 'maneuver':
        out.push({ t, side: unit(ev.unit)?.side ?? null, kind: 'maneuver', text: `${unit(ev.unit)?.name} accelerates at ${ev.accel.value} ${ev.accel.unit}`, ...base });
        break;
      case 'roll':
        out.push({ t, side: unit(ev.unit)?.side ?? null, kind: 'maneuver', text: ev.axis === 'up'
          ? `${unit(ev.unit)?.name} turns ${Math.abs(ev.angle_deg)}° to ${ev.angle_deg > 0 ? 'port' : 'starboard'}`
          : `${unit(ev.unit)?.name} rolls ${ev.angle_deg}°`, ...base });
        break;
      case 'signal':
        out.push({ t, side: ev.unit ? unit(ev.unit)?.side ?? null : null, kind: 'signal', text: `${ev.actor} ${ev.text}`, ...base });
        break;
      case 'surrender':
        out.push({ t, side: unit(ev.unit)?.side ?? null, kind: 'surrender', text: `${unit(ev.unit)?.name} surrenders`, ...base });
        break;
      case 'note':
        out.push({ t, side: ev.side, kind: 'note', text: ev.text, ...base });
        break;
      case 'outcome': {
        const c = ev.counts;
        const parts = Object.entries(c).filter(([, n]) => n > 0).map(([k, n]) => `${fmtCount(n)} ${k.replace('_', ' ')}`);
        if (unit(ev.unit)?.kind === 'fleet') out.push({ t, side: unit(ev.unit)?.side ?? null, kind: 'loss', text: `${unit(ev.unit)?.name}: ${parts.join(', ')}`, ...base });
        break;
      }
      default:
        break;
    }
  }
  return out;
}
