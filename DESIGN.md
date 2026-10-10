# DESIGN.md: honor-cic

**Status: owner direction, 2026-10-10.** The owner rejected the quiet "CIC bezel" redesign: "make it all closer to original implementations, remove all those antislop for accessibility and so. This should be looking pretty, functional, can explore." The two original visualizers are the reference. Anything below that conflicts with them loses.

- Site A: https://battle-of-manticore.muddy-glade-edee.workers.dev. Visual reference: cinematic grade, star, hyper globe, resonance cone, range rings, missile streaks, HUD.
- Site B: https://battle-of-manticore.ra100x.chatgpt.site. Structure reference: System / Engagement / Ship detail tabs, per-view context tools, the ship detail wedge and demos, planet spheres and fleet callouts.

The study notes with line-level recipes for both live outside the repo, in the session that ported them. The rules below are the ones the code depends on.

## Look

- **One grade for the whole plot** (Site A). A camera-locked star sky, then the view, then bloom on HDR targets (strength 0.45, radius 0.4, threshold 1.1, high-pass clamped at 6), then one grade pass: exposure, ACES, gamma 2.2, a light vignette and dither. Only genuinely hot pixels (star cores, blasts, terminal missile heads, beams) bloom. Views choose a profile in `src/render/grade.ts`; the ship detail view uses a technical profile closer to Site B's lit metal.
- **Furniture is light on black.** Orbits, hyper-limit globes, range rings, spokes and the resonance cone are additive, dim and drawn crisply. Nothing opaque covers the starfield.
- **Fixed dark theme.** Lit energy in deep space is the content.

## Colour

| Token | Value | Meaning |
|---|---|---|
| `--void` | `#020208` | page background (the GL clear is `#000003`) |
| `--ink` / `--ink-dim` / `--ink-faint` | `#d6e6f3` / `#8199b0` / `#4f6378` | HUD text tiers |
| `--allied` | `#00ff66` | allied ships, allied log entries |
| `--hostile` / `--hostile-ink` | `#ff0033` / `#ff4d6a` | hostile ships / hostile text |
| `--wedge` | `#00d2ff` | wedges, focus, selection, active tab, playhead |
| `--amber` | `#ffb300` | phase, pods, shot captions, crippled |
| `--violet` / `--violet-ink` | `#8a2be2` / `#b98cff` | Apollo telemetry, the Junction and its resonance zone |
| `--flash` | `#ffe7ad` | stars, laserheads, fusion flashes |
| `--b-cyan` | `#5ae0f3` | Site B's ship detail accents and active context tools |

## Type

Chakra Petch (`--f-display`) for names, eyebrows, buttons and labels; IBM Plex Sans Condensed (`--f-body`) for body text, subtitles and the log; IBM Plex Mono (`--f-mono`) for clocks, tallies, numbers, ring and limit labels and Site B callouts.

## HUD (Site A overlay plus Site B tools)

- **Top bar**: identity (catalog link, eyebrow, title, theater line, Site B scale tabs) | big clock with phase name and speed chip | tallies (missiles in space by side, stopped by defenses, laserheads detonated, ships lost).
- **Left**: Forces, per fleet: commander, inside or outside the hyper limit, role bars (operational fill, crippled in amber), counts.
- **Right**: inspector card for the selected ship above the CIC log (newest first, side-coloured, click to seek). In Ship detail the right column is Site B's object panel.
- **Bottom left**, stacked in one column that grows upward so nothing overlaps: a one-line readout (missile sampling, ship demo status), Site B's context tools for the current view (system presets; Follow and Reset; ship class, Belly-up roll, Pods, Transit sails, Fire / defense demo) and the shot caption (amber in Director, cyan in the free camera). Plot labels keep clear of these boxes.
- **Bottom right**: Site A's scale bar, snapped to 1, 2 or 5 of a decade in metres, km, million km or light-minutes.
- **End of the replay**: Site A's after-action debrief with each force's losses, launch totals and the peak missiles in space, offering Free look or Replay.
- **Bottom**: transport: play, back 30 s, phase steps, the phase-segmented scrubber with salvo ticks, speed, Director, Shots, Layers (layers, missile density, Actual or Perceived, commander, theater, reduce motion), Key (legend, keys, evidence labels, notes and sources), fullscreen.
- **Panels** are Site A glass (72 % with 6 px blur), 1 px hairline, 9 px corner brackets top-left and bottom-right. Buttons are Site A's 32 px uppercase `.tb`; Site B's rounded context buttons are kept for the view tools.
- Under 860 px, the title block folds into the top bar, the tallies form one row, and Forces, the log and (in Ship detail) the class data become sheets behind toggles; the caption drops its description. Under 520 px the scrubber gets its own row.

## Plot labels

Site A labels: display-font uppercase name, condensed subtitle, a 6 px leader tick, double black text shadow, priority sort and overlap culling. Ring and limit labels are quiet mono. Site B callouts: mono text at a fixed pixel offset from the anchor, joined by a 0.7 px leader line in the label colour.

## Views

- **System**: Site A's star, hyper globe, orbits, Junction and resonance-zone cone, two-line labels; Site B's shaded planets, stations, fleet callouts and camera presets.
- **Engagement**: Site A's range rings centred on my fleet, fleet rings, velocity vectors, hyper-limit arc and missile streaks. Fleets keep their 3D formations from every viewing angle (never re-laid to face the camera), drawn larger about their true centres when zoomed out. Missiles leave the ships that fire them and come down on ships of the target fleet, so salvos read as fired from the wall.
- **Ship detail**: honor-cic's class hulls with Site B's schematic wedge (double stress bands, sidewalls), Keyhole, pod rails and tethers, transit sails, grid floor, callouts and four demos.

## Honesty

Every number shown comes from the pack or the replay. Reconstructions carry their evidence label ([P], [W], [D], [S]); schematic geometry is captioned as schematic. Copy avoids em dashes and marketing phrases (`tests/ui/copy.test.ts`).
