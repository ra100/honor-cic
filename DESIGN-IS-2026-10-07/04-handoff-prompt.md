> **Superseded on 2026-10-10.** The owner rejected the quiet "CIC bezel" direction this audit recommends; the app now follows the two original visualizers as recorded in `DESIGN.md`. Kept as history; do not act on it.

```text
/make-plan Redesign honor-cic's presentation layer. Current design failed a Dieter Rams audit at 13/30, with critical gaps in usefulness (#2), aesthetics (#3), understandability (#4), and unobtrusive composition (#5).

Verdict paragraph:
> REDESIGN the presentation layer: the current app scores 13/30 and fails aesthetic and unobtrusive composition, while its replay, scenario, provenance, and tactical-view foundations should be preserved.

Why redesign and not refine: the total is below 20/30 and scale-independent composition and envelope-first inspection cannot be repaired by cosmetic restyling.

Primary user: Honorverse readers and naval-tactics enthusiasts.
Primary task: watch a battle cinematically, understand its engagement, and inspect ships and weapons without losing tactical context.
Product scope: replay and exploration in a reusable battle catalog, not commander gameplay.
Stack: TypeScript, Vite, Three.js, scenario packs, deterministic replay, and a solver worker.
References: A at https://battle-of-manticore.muddy-glade-edee.workers.dev for visual hierarchy, formations, density, and cinematic storytelling; B at https://battle-of-manticore.ra100x.chatgpt.site for tactical clarity and System/Engagement/Ship-detail scale composition. Neither reference is an unconditional source of canon values.
Deadline: none supplied.

Design direction to preserve:
- A sober CIC console. The full-bleed plot is the focal point; HUD chrome is its quiet bezel.
- ENERGY 3 / RHYTHM 2 / MOTION 3. Spectacle belongs to the battle, not animated UI decoration.
- Single dark-space theme with intended void #020208; cyan #00d2ff is the selection/focus accent.
- Chakra Petch display, IBM Plex Sans Condensed body, IBM Plex Mono numerical data.
- Square corners, console brackets, leader-tick plot labels, and colors with tactical meanings.
- Existing DESIGN.md has an unresolved all-panel-blur owner decision. Do not resolve it silently. The current default is solid panels and modal-scrim blur only.
- Any new ship art or decorative asset needs explicit direction or an honest schematic label. No invented logos, crew portraits, or photorealistic ships.

Preserve from current design:
- Deterministic replay and validated scenario/worker contracts. Sources: src/app/solve-client.ts:13-23; scenarios/manticore/meta.json:3-13; scenarios/training/meta.json:3-8.
- Corrected LAC attack ranges and recovery/departure behavior. Dogfight occurs at 30:53-30:57 and the graser pass at 31:08-31:10; camera pacing must not extend those physical events.
- Actual/perceived filtering and provenance. Sources: src/ui/viewer/model.ts:99-108,120-139,164-197; src/ui/viewer/panels.ts:11-21. Evidence controls are working inline disclosures, not broken dialogs.
- Scale navigation, density, theater and log controls, class demos, free camera and Follow. Sources: src/ui/viewer/hud.ts:68-81,131-178,208-212. Retain the behavior, not its current all-scale placement.
- The established tokens and identity. Sources: DESIGN.md, especially Identity/Theme/Typography/Identity motif; src/render/palette.ts:3-20.
- Manticore and the explicitly non-canon Training pack as independent presentation cases. Do not hard-code the new visual system around Manticore alone.

Discard:
- The unconditional shared battle HUD in Ship. src/ui/viewer/hud.ts:110-120,163-168,208-212,299-311. It causes usefulness, unobtrusive-composition, and restraint failures.
- Box-only hull presentation and fitting the entire defensive envelope as the default inspection frame. src/render/scales/ship-view.ts:151-173,202-203. It causes usefulness and aesthetic failures. Do not discard correct dimensions.
- Wide-shot overlapping point masses and bright patches that hide wall/screen/carrier/salvo structure. src/render/scales/engagement-view.ts:181-290,319-406,433-442. They cause aesthetic and understanding failures.
- Generic orbit/easing as the main cinematic vocabulary. src/render/director.ts:83-115. It undercommunicates short tactical events.

Top moves from the audit, verbatim:
1. Principles #2, #5, #10: Recompose the HUD for System, Engagement, and Ship; keep the plot dominant and make camera framing and labels respect occupied HUD space. Evidence: [01-evidence.md#p5-unobtrusive](01-evidence.md#p5-unobtrusive).
2. Principles #2, #3, #4: Build a hull-focused Ship workspace with legible class silhouettes, mounts, pod lanes, and demos; show the true-scale defensive envelope separately and label any schematic enlargement. Evidence: [01-evidence.md#p3-aesthetic](01-evidence.md#p3-aesthetic).
3. Principles #3, #8: Isolate and correct the clear/background and bright-point bloom paths; preserve circular celestial discs and intentional square carrier symbols, with visual checks for halo contour and black level. Evidence: [01-evidence.md#p3-aesthetic](01-evidence.md#p3-aesthetic).
4. Principles #3, #4: Make walls, screens, carriers, and missile salvos distinguishable through class-aware formations, bounded symbol sizes, and density-aware trails without changing physical counts or trajectories. Evidence: [01-evidence.md#p2-useful](01-evidence.md#p2-useful).
5. Principles #2, #3, #9: Replace generic director drift with event-specific shot choreography; include reduced-motion behavior and suspend unchanged paused rendering. Evidence: [01-evidence.md#p9-environmentally-friendly](01-evidence.md#p9-environmentally-friendly).

Evidence behind those anchors, included here so the prompt is self-contained:
- At 1440x900, the header occupied 1424x86px, forces 288x653.30px, right panels 352x653.30px, and footer 1424x128.70px. Some subjects were behind panels. At 375px, the header was 235.75px high and the footer 143.30px high.
- Ship uses a dark unlit BoxGeometry hull and class-sized defensive planes. Camera fit uses Math.max(hullLength,envelopeLength)*1.4, making the envelope dominant and the hull incidental. B presents a readable tapered hull, mounts, pod lanes, Keyhole markers, and focused controls, with schematic enlargement disclosed.
- System's intended/CSS void is #020208, but its captured dominant background was #161632. Hiding body/unit points did not change that. An explicit scene background #020208 restored #020208; explicit black restored #000000. Clear/background handling is implicated, but the exact transfer stage is not traced.
- The point shader already has a circular radial mask and alpha discard. Celestial bodies use circular shape 0; stations/carriers use intentional square shape 3. The engine already has RenderPass, UnrealBloomPass, OutputPass, and logarithmic-depth support. Reducing point emission to 8% with the mask unchanged removed the bright rectangular-looking halo and left a circular core. The precise bloom/filter contour cause remains unresolved.
- Formation and density data exist. Wide fleet glyphs and salvos still merge into round masses and luminous patches. Improve visual encoding without changing physical quantities. Density changes rendering only.
- Current LAC shot begins at 30:06, before the corrected close-range events. A offers more differentiated pod, missile-tracking, impact, and damage moments. Compare by narrative moment, not identical timestamps between scripts.
- Captured settled System/Engagement/Ship views changed zero pixels but rendered 88/79/78 times in about three seconds. Initial captured battle JS was 907174 raw/decoded bytes, including the worker; gzip payload was 239167 bytes. Catalog eagerly loaded the viewer entry. These were unthrottled SwiftShader lab measurements, not physical-device FPS, energy, or field TTI.
- Fresh reduced-motion preference suppressed director orbit; live media changes after mount did not in the sampled interval. Investigate explicit user overrides before assigning a cause. Returning to catalog disposed rendering correctly. Leaving during solve let the worker finish 315.7ms later without mounting a stale viewer.
- Sampled mobile targets were 32px; desktop fleet rows were 24px. Sampled layouts at 375/860/1100/1440 had no horizontal overflow. Two Layers entry points appeared at 375px.
- Notes inserts pack.notes as text and visibly shows Markdown markers. Native Help/Notes dialogs opened, closed on Escape, and returned focus. Evidence buttons reveal inline sources. Do not reintroduce disproved accessibility or dead-button claims.
- Replay, scale changes, all seven layer toggles, all five density choices, actual/perceived state, commander/log selection, class changes, and the three demos worked in sampled flows. Presentation failures are not evidence that those features are absent.
- P/W/D/S provenance and non-canon Training labels work. Keep honest unknowns and reconstructions; do not import inconsistent force counts, astronomical geometry, or timing from a reference to make the scene prettier.

Redesign principles in priority order:
1. Useful (#2): a battle opens into watchable context, while Ship immediately supports hull, weapon, and defense inspection.
2. Unobtrusive (#5): the plot remains dominant and subjects/labels stay clear of HUD occupancy at every scale.
3. Understandable (#4): class, formation, range, energy, and evidence distinctions are visible without guessing or falsifying scale.

Deliverables for the plan:
- Fresh information architecture derived from watch/understand/inspect tasks, not a restyled version of the current shell.
- Labeled low-fi System, Engagement, Ship, catalog, and narrow-screen flows, compared side by side with the current composition.
- Per phase: target files, exact behavioral/visual change, dependencies, and verification.
- A shared scenario-independent formation/effect/shot contract where needed; prefer existing helpers and avoid Manticore-specific renderer logic.
- Consolidated token and spacing decisions with one-line reasons, retaining the existing identity.
- Empty/loading/error/success/focus/disabled states, including no-contact perceived view and a useful WebGL-unavailable fallback.
- 44x44px effective targets, no horizontal overflow, readable Notes, dynamic-background contrast, keyboard/tab behavior, native-dialog focus, touch, and 200% zoom verification.
- Explicit true-scale versus schematic mode/labels for Ship. No silent dimension changes.
- Visual acceptance cases for black level and radial halos, wall/screen/carrier readability, density at 1:1 through 1:16, pod launch, missile tracking, impacts, LAC encounters, and hull/mount/demo inspection.
- Motion acceptance cases for ordinary, reduced, and live-changed preferences; paused views stop unnecessary rendering but active demos and camera input still update.
- Regression checks for deterministic replay, beam ranges, LAC recovery, actual/perceived filtering, density quantities, Follow, and Training reuse.
- Migration/cutover criteria: retain known control behaviors, retire the old shared composition after the visual/interaction criteria pass, and do not keep two permanent interfaces behind a flag.

Non-goals:
- Commander gameplay, new battles, canon reauthoring, replacing the solver, a new brand, or a light theme.
- Claiming field performance or universal accessibility from headless lab evidence.
- Automatically committing, pushing, or rewriting remote history.

Anti-patterns:
- Porting the old HUD under new styling.
- Raising bloom to compensate for weak geometry/composition.
- Silently changing physical dimensions, missile counts, or event duration.
- Treating all tactical colors as decoration or changing the unresolved blur policy.
- Generating ship assets without direction, or copying either reference's whole design.
- Treating the Preserve list as optional.
```
