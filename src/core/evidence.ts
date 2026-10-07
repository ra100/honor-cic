import { baseFactor, type Unit } from './units';

/** P primary (novel/author), W wiki/reference, D derived calculation, S speculative reconstruction (MTS §1.1). */
export type EvidenceLabel = 'P' | 'W' | 'D' | 'S';
export type VerificationStatus = 'verified' | 'unverified' | 'conflict';

export interface SourceValue<T> {
  value: T | null;
  unit: Unit;
  evidence: EvidenceLabel;
  source_id: string;
  locator?: string;
  era?: string;
  uncertainty?: string;
  status?: VerificationStatus;
}

type Extra<T> = Partial<Pick<SourceValue<T>, 'locator' | 'era' | 'uncertainty' | 'status'>>;

export function sv<T>(value: T | null, unit: Unit, evidence: EvidenceLabel, source_id: string, extra: Extra<T> = {}): SourceValue<T> {
  return { value, unit, evidence, source_id, ...extra };
}

export function known<T>(v: SourceValue<T> | null | undefined): v is SourceValue<T> & { value: T } {
  return v !== null && v !== undefined && v.value !== null && v.value !== undefined;
}

export class MissingValueError extends Error {
  constructor(readonly ctx: string) {
    super(`Missing required value: ${ctx}`);
  }
}

export function need<T>(v: SourceValue<T> | null | undefined, ctx: string): T {
  if (!known(v)) throw new MissingValueError(ctx);
  return v.value;
}

export function baseValue(v: SourceValue<number> | null | undefined): number | null {
  if (!known(v)) return null;
  const f = baseFactor(v.unit);
  if (f === null) throw new Error(`Unit ${v.unit} has no numeric base conversion`);
  return v.value * f;
}

export function needBase(v: SourceValue<number> | null | undefined, ctx: string): number {
  const x = baseValue(v);
  if (x === null) throw new MissingValueError(ctx);
  return x;
}

export const EVIDENCE_TEXT: Record<EvidenceLabel, string> = {
  P: 'Primary: novel or author statement',
  W: 'Wiki or reference work',
  D: 'Derived by calculation from sourced inputs',
  S: 'Speculative: reconstruction or provisional value',
};

const NO_UNIT_SUFFIX: Unit[] = ['count', 'text', 'ratio', 'PD-date'];

export function formatSourceValue(
  v: SourceValue<number | string> | null | undefined,
  fmt: (n: number) => string = (n) => n.toLocaleString('en-US'),
): string {
  if (!known(v)) return 'unknown';
  const body =
    typeof v.value === 'number'
      ? `${fmt(v.value)}${NO_UNIT_SUFFIX.includes(v.unit) ? '' : ` ${v.unit}`}`
      : String(v.value);
  return v.evidence === 'S' ? `${body} (speculative)` : body;
}

/** The form every number takes in the UI (DESIGN.md Copy): "25 [W]", "64 (speculative) [S]" or "unknown". */
export function formatLabelled(
  v: SourceValue<number | string> | null | undefined,
  fmt?: (n: number) => string,
): string {
  return known(v) ? `${formatSourceValue(v, fmt)} [${v.evidence}]` : 'unknown';
}

/** Share of canon-grade labels (P or W), 0..1. Drives the catalog evidence meter. */
export function evidenceScore(labels: EvidenceLabel[]): number {
  if (labels.length === 0) return 0;
  return labels.filter((l) => l === 'P' || l === 'W').length / labels.length;
}
