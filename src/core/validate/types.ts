import type { ScenarioPack } from '../schema';
import type { TechRegistry } from '../tech';

export type CheckId =
  | 'units' | 'frames' | 'projection' | 'epoch' | 'weapons' | 'inventory' | 'guidance'
  | 'latency' | 'flight' | 'geometry' | 'escape' | 'era' | 'canon';
export type Severity = 'error' | 'warn' | 'info';

export interface Issue { check: CheckId; severity: Severity; message: string; path?: string }
export interface StaticCtx { pack: ScenarioPack; tech: TechRegistry }
export type StaticCheck = (ctx: StaticCtx) => Issue[];

export const issue = (check: CheckId, severity: Severity, message: string, path?: string): Issue =>
  path ? { check, severity, message, path } : { check, severity, message };
