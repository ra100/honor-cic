# honor-cic design review: scope

Date: 2026-10-07.

## Request

Review the whole application against the original references. Pay particular attention to the UI's loss of the original visual character, simplified animation, the ship view, and square flare artifacts.

This is an audit and redesign handoff, not an implementation pass. The audit has not changed application source or scenario data. At the owner's separate request, the current branch was subsequently rebased onto the rewritten `main`.

## Audited product

- Local application: `/Users/svarba/Development/honviz`.
- Canonical published URL: `https://honor-cic.pages.dev/#/battle/manticore`. It returned `404 Deployment Not Found` during this review, so it is not the source of the current-app findings.
- Previously supplied deployment: `https://18207812.honor-cic.pages.dev/#/battle/manticore`. It was reachable, but is older than the reviewed checkout and lacks Follow.
- Current-app screenshots and interaction measurements came from a local production preview at `http://127.0.0.1:4173/`.
- Catalog, System, Engagement, and Ship views; director/free camera; playback, layers, selection, panels, perceived view, and narrow-screen layouts.
- Rendering of formations, missiles, wedges, ships, drive effects, impacts, and camera motion.

## References

- A: `https://battle-of-manticore.muddy-glade-edee.workers.dev`. The owner's visual reference: formations, missile-density control, and cinematic presentation.
- B: `https://battle-of-manticore.ra100x.chatgpt.site`. The owner's tactical and scale-navigation reference.
- `DESIGN.md`: the recorded CIC-console direction, with ENERGY 3 / RHYTHM 2 / MOTION 3.
- The approved viewer specification and previous reference captures, where needed to distinguish intended behavior from observed behavior.

## User and task

Honorverse readers and naval-tactics enthusiasts should be able to watch a battle cinematically, understand the engagement, and inspect its ships and weapons without losing tactical context.

The eventual battle catalog must reuse scenario-independent presentation and simulation. This review does not propose hard-coding the renderer around Manticore.

## Constraints

- Preserve the TypeScript, Three.js, Vite, scenario-pack, and deterministic replay foundations unless evidence identifies a presentation-specific limitation.
- Preserve tactical correctness, evidence attribution, scale navigation, and reduced-motion support.
- Retain the established dark-space palette and naval console identity; do not substitute a generic dashboard.
- Inspect live behavior as well as source. Mark unobserved conditions and inferred measurements explicitly.
- The audit reports defects honestly. A passing implementation or design-delivery claim is out of scope.

## Method

Independent source evidence for structure, visual implementation, copy/honesty, and weight/motion; direct browser comparison of the current application and both references; evidence-cited scoring against Dieter Rams' ten principles; one verdict and a self-contained implementation-plan handoff.

## Revision and evidence boundary

- Visual and runtime evidence was collected at `dc6bc61`.
- The rebased branch ends at `1beb300`, identical to the fetched `origin/main`. Its application source and scenario content are unchanged from the audited revision. The tracked differences are the project registry configuration and public-registry lockfile URLs.
- The five LAC/range/recovery/Follow feature commits have patch-equivalent counterparts in the rewritten history. They were not replayed a second time.
- Runtime byte counts describe the captured build, not a benchmark of the subsequent clean dependency installation. The rebuilt artifacts differ slightly in size; no new performance claim is inferred from that difference.
- Comparison screenshots are preserved in this directory's `assets/`. Additional captures and the raw `runtime-evidence.json` remain in the session's `files/design-review-2026-10-07/` evidence directory.
- Camera moments are compared by narrative event, not equal elapsed time. The references' scripts are shorter than this reconstruction.
- No physical-device, screen-reader, exhaustive contrast, or first-time-user study is claimed.
