# DESIGN.md: honor-cic

**Status: direction transcribed, owner to confirm.** The owner chose Site A (`https://battle-of-manticore.muddy-glade-edee.workers.dev`) as the visual reference: "from visual point of view, I like the A (the ship formations and selecting density of missiles too), the cinematic feel of A is nice". Everything below comes from Site A's own stylesheet and behaviour, as archived in `files/siteA/app.inline.css` and `app.inline.pretty.js` of the planning session. The agent only formatted it.

Items marked **Owner decision** conflict with an antislop rule. Until the owner answers, the rule applies and the default is listed next to the item.

## Identity

The app is a combat information center (CIC) console replaying a fleet action. The 3D plot is the product, and the HUD is the console bezel around it. Site A's stylesheet puts it this way: "the HUD hugs the edges like a CIC console bezel".

The personality is cinematic, precise and sober. The spectacle comes from the battle itself: drive flashes, laserhead bursts and wedge signatures. UI chrome never adds spectacle of its own.

## Design Read and dials

Reading this as: a cinematic tactical replay viewer for Honorverse readers and naval-tactics enthusiasts, in a CIC-console HUD language transcribed from Site A. Dials: ENERGY 3 / RHYTHM 2 / MOTION 3.

- **ENERGY 3:** the scene speaks loudly, through bloom, fusion flashes and the director camera. The HUD stays quiet, so the plot is the single focal point on every screen.
- **RHYTHM 2:** the console panels are consistent, with deliberate breaks. The scale tabs (System, Engagement, Ship) recompose the whole screen, and the catalog is a different composition from the viewer.
- **MOTION 3:** the camera is choreographed, with director shots, slow orbits and push-ins, because motion is the content of a replay. HUD motion is limited to state transitions. Nothing loops while idle, and `prefers-reduced-motion` turns the director's orbit and push-in moves into cuts (Site A has this media query).

## Theme

The app ships a single dark theme, by design: Site A's stylesheet says "Single dark look by design".

Reason (R-21): the content is lit objects in the deep-space void. Bloom and fusion flashes only read as energy against black. No light theme ships, so there is no toggle.

## Palette (Site A tokens)

Colour is a data channel. Each hue has exactly one meaning and is never used as decoration (R-29: a clear design system).

Contrast was measured with `antislop-contrast-check` against the void `#020208`. The "Worst case" column measures against an HUD panel at 0.90 opacity sitting over a white bloom flash, which blends to `#1d222c`.

| Token | Value | Meaning | On void | Worst case |
|---|---|---|---|---|
| `--void` | `#020208` | page and plot background | n/a | n/a |
| `--ink` | `#d6e6f3` | primary text | 16.23 | 6.55 at 0.72 opacity |
| `--ink-dim` | `#8199b0` | secondary text | 7.01 | 5.40 |
| `--ink-faint` | `#4f6378` | hairlines and large text only (fails 4.5:1) | 3.34 | not for text |
| `--hair` | `rgba(110,175,255,0.16)` | panel borders (decorative, not a control edge) | n/a | n/a |
| `--hair-hi` | `rgba(120,190,255,0.34)` | corner brackets (identity motif) | n/a | n/a |
| `--allied` | `#00ff66` | Manticoran Alliance side in the Manticore pack | 15.27 | n/a |
| `--hostile` | `#ff0033` | Republic of Haven side glyphs | 5.22 | n/a |
| `--hostile-ink` | `#ff4d6a` | hostile-side small text | 6.43 | 4.95 |
| `--wedge` | `#00d2ff` | **the one accent**: focus ring, selection, playhead | 11.49 | 8.85 |
| `--amber` | `#ffb300` | missile pods and tractor links | 11.53 | n/a |
| `--violet` | `#8a2be2` | FTL telemetry lines, non-text only (3.47 fails text) | 3.47 | n/a |
| `--violet-ink` | `#b98cff` | FTL telemetry text | 8.14 | 6.27 |
| `--flash` | `#ffe7ad` | fusion flashes, star labels | 17.03 | n/a |

Rules:
- Side colours come from each scenario's `meta.json`. The Manticore pack uses `--allied` and `--hostile`, and every other pack must pick colours that pass 4.5:1 on the void.
- Status is never shown by colour alone: every status pip also carries a text or shape difference (R-25, antislop-human).

## Typography (Site A fonts, Google Fonts with system fallbacks)

| Role | Face | Weights | Why |
|---|---|---|---|
| Display | Chakra Petch | 500, 600 | Squared console letterforms for fleet names, panel titles and plot labels; it is the CIC voice |
| Body | IBM Plex Sans Condensed | 400, 500, 600 | Condensed width fits dense HUD panels without truncation |
| Data | IBM Plex Mono | 400, 500 | Tabular figures keep clocks, ranges and counts aligned while they change every frame; monospace serves alignment, not a terminal look |

- Plot labels use uppercase with 0.06em tracking. This is the naval chart annotation convention, used on the plot only and never on page headings (R-06).
- Sizes are in `rem`. The body base is 14px equivalent, and HUD labels are no smaller than 11px equivalent. Everything must reflow at 200% zoom.

## Shape, elevation, glow

- Radius: none. Site A has no `border-radius` anywhere, and square corners are part of the console bezel (R-11).
- Shadow: none on panels. Elevation is shown by the corner brackets and the border hairline (R-12).
- Glow: Site A uses `box-shadow: 0 0 8px/10px var(--wedge)` on two elements only, the active transport control and the playhead. Keep it on exactly those two (R-13).
- Bloom in the 3D scene is content, not UI glow: it encodes energy (drive flashes, laserheads, wedges). Its threshold stays high enough that HUD text never sits on a blown-out area without a panel behind it.

## Identity motif

There are two repeated gestures, both from Site A:
1. **Corner brackets** on every panel: 9px L-brackets at the top-left and bottom-right, in `--hair-hi`.
2. **Leader-tick labels** on the plot: a 6px horizontal tick before every projected label.

## Panels

**Owner decision (R-10, glassmorphism dose cap).** Site A puts `backdrop-filter: blur(6px)` on every HUD panel: forces, CIC log, transport and clock. antislop caps blur at 1 or 2 elements.

The default until the owner answers:
- HUD panels are solid `rgba(4, 9, 20, 0.92)` with no blur. At 0.92 opacity, secondary text keeps 5.4:1 even over a white flash; Site A's 0.72 drops it to 2.83:1.
- Blur stays only on the scrim behind modal dialogs.

Keep Site A's blur everywhere, or drop it?

## Layout

**Viewer** (Site A's composition, plus Site B's scale tabs):
- The plot is full-bleed.
- Top edge: the scale tabs (System, Engagement, Ship), the battle clock, and the camera controls (Director or Free, reset, fullscreen).
- Left edge: the forces panel.
- Right edge: the CIC log.
- Bottom edge: the transport (play, speed, phase steps) above the timeline scrubber.

Reflow states are placed where the content breaks; Site A breaks at 1100, 860 and 520px:

| Width | State |
|---|---|
| ≥ 1100px | All four HUD edges are visible at once. |
| 860–1099px | Forces and the CIC log become drawers over the plot. Only one is open at a time, and each is opened by a labelled button in the top bar. |
| 520–859px | The top bar compacts the scale tabs into a segmented control. The drawers become full-height sheets. |
| < 520px | A bottom bar with labelled buttons (Forces, Log, Layers, Info) sits above the transport. Sheets slide up from the bottom, and the timeline spans the full width. Nothing sits under the bottom bar: the plot reserves its height. |

- Touch targets are at least 44×44px whenever `(pointer: coarse)`. Desktop controls may draw at 32px, but their hit area still reaches 44px.
- Every hover tooltip, including evidence sources, also opens on tap and on keyboard focus.

**Catalog:** Site A has no catalog, so this composition follows the HUD language and is not taken from a reference.
- Battles are shown as a list of records in a single column of panels with corner brackets.
- Each record shows: title, date (with its evidence label), place, the sides in their colours, an evidence-quality meter, and the action "Open replay".
- The records are deliberately identical in structure because the job of the page is scanning and comparing battles (R-14 reason).

## States (R-27)

- **Catalog, empty:** "No battles yet. Add a scenario pack under `scenarios/`, see README: Adding a scenario."
- **Catalog, invalid pack:** the card stays, marked "Pack failed validation", with the first three errors and "Fix the pack files, then reload".
- **Viewer, loading:** "Computing replay: <phase>" with a determinate progress bar from the worker.
- **Viewer, error:** "This replay could not be computed" with the validator errors, and a "Back to catalog" link.
- **Viewer, WebGL unavailable:** "This viewer needs WebGL. Turn on hardware acceleration or try another browser." The CIC log and the forces panel still work without the plot.
- **Perceived view, no contacts yet:** "No contacts: light from <side>'s targets has not arrived yet".

## Copy

- The voice is terse and naval, matching the CIC log. For example: `00:07:12  Second Fleet: salvo 3 launched, 65,500 missiles [W]`.
- There are no em dashes in UI text (R-02).
- CTAs are specific: "Open replay", "Back to catalog", "Show sources". Do not use "Explore" or "Learn more" (R-15).
- Every number shown carries its evidence label, P, W, D or S. Unknown values read "unknown", and S values read "(speculative)" (R-17, R-38).
- Assets (R-23): there is no logo; the wordmark is "honor-cic" set in Chakra Petch. There are no portraits of admirals or crews.
