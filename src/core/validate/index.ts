import type { ScenarioPack } from '../schema';
import type { TechRegistry } from '../tech';
import { STATIC_CHECKS } from './checks-static';
import type { Issue } from './types';
import type { Replay } from '../replay';
import { REPLAY_CHECKS } from './checks-replay';

export * from './types';

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.check}|${i.severity}|${i.message}|${i.path ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function validateStatic(pack: ScenarioPack, tech: TechRegistry): Issue[] {
  return dedupe(STATIC_CHECKS.flatMap((check) => check({ pack, tech })));
}

export const hasErrors = (issues: Issue[]): boolean => issues.some((i) => i.severity === 'error');

export function formatIssues(issues: Issue[]): string {
  return issues.map((i) => `${i.severity.padEnd(5)} [${i.check}] ${i.message}${i.path ? `  (${i.path})` : ''}`).join('\n');
}

export type { ReplayCtx, ReplayCheck } from './checks-replay';

export function validateReplay(pack: ScenarioPack, tech: TechRegistry, replay: Replay): Issue[] {
  return dedupe([...REPLAY_CHECKS.flatMap((check) => check({ pack, tech, replay })), ...replay.diagnostics]);
}
