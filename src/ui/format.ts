import type { LogEntry } from '../core/replay';
import { fmtDuration } from '../core/units';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function fmtPdDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]} PD` : iso;
}

/** Battle clock relative to T0, the first launch. */
export const fmtClock = (t: number): string => `T${t < 0 ? '-' : '+'}${fmtDuration(Math.abs(t))}`;

/** CIC log line (DESIGN.md Copy): "11:54  Second Fleet: salvo 3 launched, 65,500 missiles [W]". */
export const logLine = (e: LogEntry): string => `${fmtDuration(e.t)}  ${e.text} [${e.evidence}]`;
