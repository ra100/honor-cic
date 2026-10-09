import type { Replay } from '../core/replay';
import type { Issue } from '../core/validate';
import type { SolveMessage } from '../core/worker/protocol';

export class SolveFailure extends Error {
  constructor(message: string, readonly issues: Issue[]) {
    super(message);
  }
}

export function solveInWorker(id: string, onProgress: (phase: string, fraction: number) => void, signal?: AbortSignal): Promise<{ replay: Replay; issues: Issue[] }> {
  if (signal?.aborted) return Promise.reject(new DOMException('Replay computation cancelled.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./solve.worker.ts', import.meta.url), { type: 'module' });
    const stop = () => {
      signal?.removeEventListener('abort', abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };
    const abort = () => {
      stop();
      reject(new DOMException('Replay computation cancelled.', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (e: MessageEvent<SolveMessage>) => {
      const m = e.data;
      if (m.type === 'progress') return onProgress(m.phase, m.fraction);
      stop();
      if (m.type === 'done') resolve({ replay: m.replay, issues: m.issues });
      else reject(new SolveFailure(m.message, m.issues));
    };
    worker.onerror = (e) => {
      stop();
      reject(new SolveFailure(e.message || 'The solver worker crashed.', []));
    };
    worker.onmessageerror = () => {
      stop();
      reject(new SolveFailure('The solver result could not be read.', []));
    };
    try {
      worker.postMessage({ type: 'solve', id });
    } catch (error: unknown) {
      stop();
      reject(error);
    }
  });
}
