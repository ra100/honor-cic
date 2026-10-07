# honor-cic: presentation redesign

**REDESIGN the presentation layer: the current app scores 13/30 and fails aesthetic and unobtrusive composition, while its replay, scenario, provenance, and tactical-view foundations should be preserved.**

The owner's criticism is supported by the comparison. A supplies the better cinematic hierarchy and differentiated battle storytelling; B supplies the clearer technical Ship workspace. The current app carries their features into a common HUD without achieving either presentation. Recoloring panels or adding more bloom would leave the structural failures intact.

This verdict is scoped to presentation across System, Engagement, Ship, and their responsive states. It does not recommend replacing the solver or reauthoring canon to imitate a reference.

## Highest-leverage moves

1. Principles #2, #5, #10: Recompose the HUD for System, Engagement, and Ship; keep the plot dominant and make camera framing and labels respect occupied HUD space. Evidence: [01-evidence.md#p5-unobtrusive](01-evidence.md#p5-unobtrusive).
2. Principles #2, #3, #4: Build a hull-focused Ship workspace with legible class silhouettes, mounts, pod lanes, and demos; show the true-scale defensive envelope separately and label any schematic enlargement. Evidence: [01-evidence.md#p3-aesthetic](01-evidence.md#p3-aesthetic).
3. Principles #3, #8: Isolate and correct the clear/background and bright-point bloom paths; preserve circular celestial discs and intentional square carrier symbols, with visual checks for halo contour and black level. Evidence: [01-evidence.md#p3-aesthetic](01-evidence.md#p3-aesthetic).
4. Principles #3, #4: Make walls, screens, carriers, and missile salvos distinguishable through class-aware formations, bounded symbol sizes, and density-aware trails without changing physical counts or trajectories. Evidence: [01-evidence.md#p2-useful](01-evidence.md#p2-useful).
5. Principles #2, #3, #9: Replace generic director drift with event-specific shot choreography; include reduced-motion behavior and suspend unchanged paused rendering. Evidence: [01-evidence.md#p9-environmentally-friendly](01-evidence.md#p9-environmentally-friendly).

## Preserve

- Deterministic replay, validation, worker/scenario separation, and the corrected LAC weapon ranges and recovery timeline.
- Actual/perceived filtering, provenance, explicit speculative/non-canon labels, and truthful physical quantities.
- System/Engagement/Ship navigation, density selection, free camera and Follow, theater selection, log filters, class demos, and accessible native dialogs.
- The established dark-space CIC identity, fonts, semantic colors, corner brackets, and leader-tick labels in `DESIGN.md`.
- Scenario-independent presentation. Training must remain a useful second-pack regression case.

## Discard

- One battle-wide HUD composition for all three scales. Source: `src/ui/viewer/hud.ts:110-120,163-168,208-212,299-311`.
- The assumption that fitting the full defensive envelope also produces useful hull inspection. Source: `src/render/scales/ship-view.ts:151-173,202-203`.
- Indistinguishable point masses and energy effects that obscure the structures they represent. Source: `src/render/scales/engagement-view.ts:181-290,319-406,433-442`.
- Generic camera motion as a substitute for launch, flight, impact, and aftermath storytelling. Source: `src/render/director.ts:83-115`.

## Cross-cutting acceptance work

Every move needs 44px effective touch targets, readable Notes, contrast against changing scene backgrounds, and keyboard/focus checks. Preserve the sampled no-horizontal-overflow behavior and add 200% zoom coverage. The panel-blur owner decision stays open; use the existing solid-panel default until resolved.

The star halo's exact filter cause is still unresolved. The background experiment is stronger evidence: hiding points did not change the purple field, while an explicit scene background restored the expected black level. Keep those findings separate in implementation.

The [planning handoff](04-handoff-prompt.md) is ready for a subsequent implementation plan. No redesign has been implemented by this audit.
