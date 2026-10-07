# honor-cic: Rams scorecard

Scores apply to the audited presentation, not to the quality or size of the codebase. Scale: 0 severe failure, 1 substantial gap, 2 usable with a limited gap, 3 meets the principle's rubric. Representative failures are not averaged away.

1. Good design is innovative. Score: 2/3.
   Evidence: [P1](01-evidence.md#p1-innovative), reusable catalog and independent training scenario.
   Justification: It improves the existing battle-viewer pattern through reusable scenarios and context; no evidence supports a novel pattern absent from five or more peers.

2. Good design makes a product useful. Score: 1/3.
   Evidence: [P2](01-evidence.md#p2-useful), functional replay but poor default hull inspection and battle-wide detours in Ship.
   Justification: The primary inspection task requires unnecessary work around framing and irrelevant controls, despite working navigation.

3. Good design is aesthetic. Score: 0/3.
   Evidence: [P3](01-evidence.md#p3-aesthetic), envelope-dominated Ship, purple background, rectangular-looking halos, and merged fleet/salvo shapes.
   Justification: Active visual noise overwhelms the intended console system; this is more than one minor inconsistency.

4. Good design makes a product understandable. Score: 1/3.
   Evidence: [P4](01-evidence.md#p4-understandable), Actual/Perceived explanations, ambiguous top-level Density scope, and literal Markdown in Notes.
   Justification: Multiple controls require explanatory context and a core information surface remains poorly formatted.

5. Good design is unobtrusive. Score: 0/3.
   Evidence: [P5](01-evidence.md#p5-unobtrusive), measured desktop/mobile chrome and subjects occluded by shared panels.
   Justification: Chrome dominates the content, particularly in Ship, instead of serving as the plot's bezel.

6. Good design is honest. Score: 2/3.
   Evidence: [P6](01-evidence.md#p6-honest), provenance and non-canon labels work; catalog introductory copy slightly overgeneralizes its contents.
   Justification: One limited scope inflation prevents a 3, while no deceptive flow or multiple inflated claims were found.

7. Good design is long-lasting. Score: 3/3.
   Evidence: [P7](01-evidence.md#p7-long-lasting), content-specific naval console vocabulary and documented type/color purposes.
   Justification: The visual language has no identified dated trend marker; rendering defects are not evidence of a year-specific fashion.

8. Good design is thorough down to the last detail. Score: 2/3.
   Evidence: [P8](01-evidence.md#p8-thorough), all six state categories exist, with a rough loaded-success presentation.
   Justification: The successful loaded state is rough, but there is no evidence that four or more states are absent or default-browser; poor aesthetics must not be scored as missing states.

9. Good design is environmentally friendly. Score: 1/3.
   Evidence: [P9](01-evidence.md#p9-environmentally-friendly), 907,174 decoded JS bytes for battle and continuous rendering of unchanged paused frames.
   Justification: The captured bundle falls in the 500KB-2MB bracket and idle rendering remains active despite motion controls.

10. Good design is as little design as possible. Score: 1/3.
    Evidence: [P10](01-evidence.md#p10-as-little-design-as-possible), five battle-wide groups can leave default Ship inspection without losing that task.
    Justification: Several removable context groups remain; legitimate keyboard equivalents are not counted as gratuitous duplication.

**Total: 13/30.**

REFINE requires at least 20/30 and no zero. This score mechanically selects REDESIGN. It does not select NEW DESIGN: working product and brand decisions exist.

The unmeasured first-time-user, complete contrast, and source-complexity metrics are disclosed in the evidence rather than assigned invented values.
