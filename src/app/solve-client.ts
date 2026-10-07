import type { Replay } from '../core/replay';
import type { Issue } from '../core/validate';
import type { SolveMessage } from '../core/worker/protocol';

export class SolveFailure extends Error {
  constructor(message: string, readonly issues: Issue[]) {
    super(message);
  }
}

export function solveInWorker(id: string, onProgress: (phase: string, fraction: number) => void): Promise<{ replay: Replay; issues: Issue[] }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./solve.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<SolveMessage>) => {
      const m = e.data;
      if (m.type === 'progress') return onProgress(m.phase, m.fraction);
      worker.terminate();
      if (m.type === 'done') resolve({ replay: m.replay, issues: m.issues });
      else reject(new SolveFailure(m.message, m.issues));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new SolveFailure(e.message || 'The solver worker crashed.', []));
    };
    worker.postMessage({ type: 'solve', id });
  });
}
