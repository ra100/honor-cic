import type { TimeRef, TimelineEvent } from '../schema';

export interface Anchors { arrival: Map<string, number>; lastArrival: Map<string, number> }

export class UnresolvedArrivalError extends Error {
  constructor(readonly ref: string) {
    super(`Time depends on the solved arrival of "${ref}"`);
  }
}

export class TimeResolver {
  private readonly byId: Map<string, TimelineEvent>;

  constructor(private readonly events: TimelineEvent[], private readonly anchors: Anchors | null = null) {
    this.byId = new Map(events.map((e) => [e.id, e]));
  }

  withAnchors(anchors: Anchors): TimeResolver {
    return new TimeResolver(this.events, anchors);
  }

  resolve(ref: TimeRef, seen: ReadonlySet<string> = new Set()): number {
    if (typeof ref === 'number') return ref;
    const ev = this.byId.get(ref.ref);
    if (!ev) throw new Error(`Unknown time reference "${ref.ref}"`);
    if (seen.has(ref.ref)) throw new Error(`Circular time reference through "${ref.ref}"`);
    const next = new Set(seen).add(ref.ref);
    if (ref.anchor !== 't' && ev.type !== 'fire_plan') throw new Error(`"${ref.ref}" is not a fire plan; anchor "${ref.anchor}" needs one`);
    if (ref.anchor === 't' || ref.anchor === 'launch') return this.resolve(ev.t, next) + ref.offset_s;
    const solved = (ref.anchor === 'arrival' ? this.anchors?.arrival : this.anchors?.lastArrival)?.get(ref.ref);
    if (solved === undefined) throw new UnresolvedArrivalError(ref.ref);
    return solved + ref.offset_s;
  }

  tryResolve(ref: TimeRef): number | null {
    try {
      return this.resolve(ref);
    } catch (e) {
      if (e instanceof UnresolvedArrivalError) return null;
      throw e;
    }
  }
}
