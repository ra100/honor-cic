import { describe, expect, it } from 'vitest';
import { handleSolve, type SolveMessage } from '../../src/core/worker/protocol';
import { miniPack } from '../fixtures/mini-pack';

describe('worker protocol', () => {
  it('reports progress and then the replay with its issues', () => {
    const msgs: SolveMessage[] = [];
    handleSolve(miniPack(), 'mini', (m) => msgs.push(m));
    expect(msgs.some((m) => m.type === 'progress')).toBe(true);
    const last = msgs.at(-1)!;
    expect(last.type).toBe('done');
    if (last.type === 'done') expect(last.replay.scenarioId).toBe('mini');
  });
  it('fails cleanly for a missing or invalid pack', () => {
    const msgs: SolveMessage[] = [];
    handleSolve(null, 'nope', (m) => msgs.push(m));
    expect(msgs).toEqual([{ type: 'failed', issues: [], message: 'Scenario "nope" was not found or does not parse.' }]);
  });
  it('refuses to solve a pack with static errors', () => {
    const msgs: SolveMessage[] = [];
    handleSolve(miniPack((r) => { r.meta.year_pd = 1919; }), 'mini', (m) => msgs.push(m));
    expect(msgs.at(-1)?.type).toBe('failed');
  });
});
