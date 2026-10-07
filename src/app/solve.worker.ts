import { handleSolve, type SolveMessage, type SolveRequest } from '../core/worker/protocol';
import { getPack } from '../registry';

const scope = self as unknown as { postMessage(m: SolveMessage): void; onmessage: ((e: MessageEvent<SolveRequest>) => void) | null };
scope.onmessage = (e) => handleSolve(getPack(e.data.id), e.data.id, (m) => scope.postMessage(m));
