import { afterEach, describe, expect, it, vi } from 'vitest';
import { SolveFailure, solveInWorker } from '../../src/app/solve-client';
import type { SolveMessage } from '../../src/core/worker/protocol';
import { solve } from '../../src/core/solver/solve';
import { miniPack } from '../fixtures/mini-pack';

class SolverWorker {
  static instances: SolverWorker[] = [];
  onmessage: ((event: MessageEvent<SolveMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { SolverWorker.instances.push(this); }
  message(message: SolveMessage) { this.onmessage?.({ data: message } as MessageEvent<SolveMessage>); }
}

afterEach(() => {
  vi.unstubAllGlobals();
  SolverWorker.instances = [];
});

describe('cancellable worker solve', () => {
  it('reports progress and terminates when a real replay arrives', async () => {
    vi.stubGlobal('Worker', SolverWorker);
    const progress = vi.fn();
    const pending = solveInWorker('mini', progress);
    const worker = SolverWorker.instances[0];
    worker.message({ type: 'progress', phase: 'flight', fraction: 0.5 });
    expect(progress).toHaveBeenCalledWith('flight', 0.5);
    const replay = solve(miniPack());
    worker.message({ type: 'done', replay, issues: [] });
    await expect(pending).resolves.toEqual({ replay, issues: [] });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
  });

  it('rejects without starting a worker if the route is already aborted', async () => {
    vi.stubGlobal('Worker', SolverWorker);
    const abort = new AbortController();
    abort.abort();
    await expect(solveInWorker('mini', vi.fn(), abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(SolverWorker.instances).toHaveLength(0);
  });

  it('terminates an in-flight worker and removes every stale callback on route teardown', async () => {
    vi.stubGlobal('Worker', SolverWorker);
    const abort = new AbortController();
    const progress = vi.fn();
    const pending = solveInWorker('mini', progress, abort.signal);
    const worker = SolverWorker.instances[0];
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
    worker.message({ type: 'progress', phase: 'stale', fraction: 1 });
    expect(progress).not.toHaveBeenCalled();
  });

  it('surfaces validation, worker crash and unreadable-result failures', async () => {
    vi.stubGlobal('Worker', SolverWorker);
    const invalid = solveInWorker('bad', vi.fn());
    SolverWorker.instances[0].message({ type: 'failed', message: 'Invalid pack', issues: [] });
    await expect(invalid).rejects.toBeInstanceOf(SolveFailure);
    const crash = solveInWorker('mini', vi.fn());
    SolverWorker.instances[1].onerror?.({ message: 'Worker crashed' } as ErrorEvent);
    await expect(crash).rejects.toThrow('Worker crashed');
    const unreadable = solveInWorker('mini', vi.fn());
    SolverWorker.instances[2].onmessageerror?.();
    await expect(unreadable).rejects.toThrow('The solver result could not be read.');
    expect(SolverWorker.instances.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
  });

  it('cleans up failed posting and preserves actual worker-construction errors', async () => {
    const postError = new Error('Worker request could not be posted');
    class UnpostableWorker extends SolverWorker {
      override postMessage = vi.fn(() => { throw postError; });
    }
    vi.stubGlobal('Worker', UnpostableWorker);
    await expect(solveInWorker('mini', vi.fn())).rejects.toBe(postError);
    expect(SolverWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(SolverWorker.instances[0].onmessage).toBeNull();
    const startError = new Error('Module worker unavailable');
    vi.stubGlobal('Worker', class { constructor() { throw startError; } });
    await expect(solveInWorker('mini', vi.fn())).rejects.toBe(startError);
  });
});
