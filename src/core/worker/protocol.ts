import type { Replay } from '../replay';
import type { ScenarioPack } from '../schema';
import { solve } from '../solver/solve';
import { TECH } from '../tech';
import { hasErrors, validateReplay, validateStatic, type Issue } from '../validate';

export type SolveRequest = { type: 'solve'; id: string };
export type SolveMessage =
  | { type: 'progress'; phase: string; fraction: number }
  | { type: 'done'; replay: Replay; issues: Issue[] }
  | { type: 'failed'; issues: Issue[]; message: string };

export function handleSolve(pack: ScenarioPack | null, id: string, post: (m: SolveMessage) => void): void {
  if (!pack) {
    post({ type: 'failed', issues: [], message: `Scenario "${id}" was not found or does not parse.` });
    return;
  }
  const staticIssues = validateStatic(pack, TECH);
  if (hasErrors(staticIssues)) {
    post({ type: 'failed', issues: staticIssues, message: 'The scenario pack failed validation.' });
    return;
  }
  try {
    const replay = solve(pack, TECH, (phase, fraction) => post({ type: 'progress', phase, fraction }));
    const issues = [...staticIssues, ...validateReplay(pack, TECH, replay)];
    if (hasErrors(issues)) post({ type: 'failed', issues, message: 'The solved replay failed validation.' });
    else post({ type: 'done', replay, issues });
  } catch (e) {
    post({ type: 'failed', issues: staticIssues, message: e instanceof Error ? e.message : String(e) });
  }
}
