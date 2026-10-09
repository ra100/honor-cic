# DESIGN.md: honor-cic

**Status: approved presentation redesign.** The owner chose Site A (`https://battle-of-manticore.muddy-glade-edee.workers.dev`) as the visual reference: "from visual point of view, I like the A (the ship formations and selecting density of missiles too), the cinematic feel of A is nice". Palette, typography and console gestures come from that reference. The approved redesign recomposes the workspaces rather than copying its shared HUD.

The approved solid-panel default is retained; blur is limited to the native-dialog scrim.

## Identity

The app is a combat information center (CIC) console replaying a fleet action. The 3D plot is the product, and the HUD is the console bezel around it. Site A's stylesheet puts it this way: "the HUD hugs the edges like a CIC console bezel".

The personality is cinematic, precise and sober. The spectacle comes from the battle itself: drive flashes, laserhead bursts and wedge signatures. UI chrome never adds spectacle of its own.

## Design Read and dials

Reading this as: a cinematic tactical replay and inspection viewer for Honorverse readers and naval-tactics enthusiasts, in a sober CIC-console HUD language. Dials: ENERGY 3 / RHYTHM 2 / MOTION 3.

- **ENERGY 3:** the scene speaks loudly, through bloom, fusion flashes and the director camera. The HUD stays quiet, so the plot is the single focal point on every screen.
- **RHYTHM 2:** the console panels are consistent, with deliberate breaks. The scale tabs (System, Engagement, Ship) recompose the whole screen, and the catalog is a different composition from the viewer.
- **MOTION 3:** the camera is choreographed, with director shots, slow orbits and push-ins, because motion is the content of a replay. HUD motion is limited to state transitions. Nothing loops while idle, and `prefers-reduced-motion` turns the director's orbit and push-in moves into cuts (Site A has this media query).

## Theme

The app ships a single dark theme, by design: Site A's stylesheet says "Single dark look by design".

Reason (R-21): the content is lit objects in the deep-space void. Bloom and fusion flashes only read as energy against black. No light theme ships, so there is no toggle.

## Palette (Site A tokens)

Colour is a data channel. Each hue has exactly one meaning and is never used as decoration (R-29: a clear design system).

Contrast was measured with `antislop-contrast-check` against the void `#020208`. The "Worst case" column measures against a HUD panel at 0.92 opacity sitting over a white bloom flash, which blends to `#181d27`.

| Token | Value | Meaning | On void | Worst case |
|---|---|---|---|---|
| `--void` | `#020208` | page and plot background | n/a | n/a |
| `--ink` | `#d6e6f3` | primary text | 16.23 | 13.24 |
| `--ink-dim` | `#8199b0` | secondary text | 7.01 | 5.72 |
| `--ink-faint` | `#4f6378` | hairlines and large text only (fails 4.5:1) | 3.34 | not for text |
| `--hair` | `rgba(110,175,255,0.16)` | panel borders (decorative, not a control edge) | n/a | n/a |
| `--hair-hi` | `rgba(120,190,255,0.34)` | corner brackets (identity motif) | n/a | n/a |
| `--allied` | `#00ff66` | Manticoran Alliance side in the Manticore pack | 15.27 | n/a |
| `--hostile` | `#ff0033` | Republic of Haven side glyphs | 5.22 | n/a |
| `--hostile-ink` | `#ff4d6a` | hostile-side small text | 6.43 | 5.24 |
| `--wedge` | `#00d2ff` | **the one accent**: focus ring, selection, playhead | 11.49 | 9.38 |
| `--amber` | `#ffb300` | missile pods and tractor links | 11.53 | n/a |
| `--violet` | `#8a2be2` | FTL telemetry lines, non-text only (3.47 fails text) | 3.47 | n/a |
| `--violet-ink` | `#b98cff` | FTL telemetry text | 8.14 | 6.64 |
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

The approved default (R-10, glassmorphism dose cap):
- HUD panels are solid `rgba(4, 9, 20, 0.92)` with no blur. Secondary text measures 5.72:1 over a white flash (`#181d27` blended background), compared with the reference's insufficient 0.72-opacity panel.
- Blur stays only on the scrim behind modal dialogs.
- Projected labels use their own 0.96-opacity backing so bright plot regions cannot erase normal text. Hostile label text measures 5.77:1 on that worst-case backing; cyan controls and focus measure 11.06:1 on `#040914`.

## Layout

**Viewer** (approved scale-specific composition):
- The plot is full-bleed.
- Shared header: catalog, full battle title, scale tabs, clock and one Controls entry. Reason: navigation stays legible without turning the bezel into the focal point.
- **System:** compact system/theater context, navigation tools and replay transport. Reason: strategic context needs room for the system, not a permanent fleet roster.
- **Engagement:** contextual forces/log/inspector, theater, density, shots and replay transport. Context panels are closed by default and mutually exclusive at every width. Reason: the tactical plot is the working surface, not the gap between sidebars.
- **Ship:** a dedicated class workspace with hull/envelope framing, class chooser, three demos and evidence-backed figures. No default forces, log, theater, density, shots or replay transport. Replay is explicitly available from Controls. Reason: hull inspection has different tasks from watching a fleet action.
- Camera mode, Follow, Reset view, Fullscreen, Notes and Help live in Controls. Layers has one action; Actual/Perceived and motion live in View.
- Current visible chrome supplies CSS-pixel plot insets to every view and projected-label update. Reason: camera framing and labels must use the unobstructed working area.

Reflow states are placed where the content breaks; Site A breaks at 1100, 860 and 520px:

| Width | State |
|---|---|
| ≥ 1100px | Compact edge tools; Ship class workspace at left; optional battle context at right; battle transport at bottom. |
| 860–1099px | Tools and the class workspace reflow below the plot; battle context and menus remain optional side drawers. |
| 520–859px | Two-row header; theater/density/shots move into Controls; optional panels become bottom sheets; Ship controls use two columns where they fit. |
| < 520px | Compact header and scale tabs; bottom plot-tools row; vertically scrollable Ship workspace or contextual sheets; full-width timeline when transport is present. |

- Targets are at least 44×44 CSS px for every pointer type, with high-contrast focus. Header groups can wrap as text grows; sheets and class figures scroll rather than clip.
- Ship framing and demo groups stack until both have room to keep their button labels intact, then share a row.
- Scale tabs use roving Tab focus, Left/Right, Home and End. Escape closes a menu/panel and restores focus; Notes and Help use native dialogs.
- Evidence sources open on tap or keyboard activation, with their source also available in the button title.

**Catalog:** Site A has no catalog, so this composition follows the HUD language and is not taken from a reference.
- Battles are shown as a list of records in a single column of panels with corner brackets.
- Each record shows: title, date (with its evidence label), place, the sides in their colours, an evidence-quality meter, and the action "Open replay".
- The records are deliberately identical in structure because the job of the page is scanning and comparing battles (R-14 reason).

## States (R-27)

- **Catalog, empty:** "No battles yet. Add a scenario pack under `scenarios/`, see README: Adding a scenario."
- **Catalog, invalid pack:** the card stays, marked "Pack failed validation", with the first three errors and "Fix the pack files, then reload".
- **Viewer, lazy loading:** "Loading replay viewer", with an available route back to the catalog.
- **Viewer, solving:** "Computing replay: <phase>" with a determinate progress bar and an available route back to the catalog.
- **Viewer, error:** "This replay could not be computed" with the validator errors, and a "Back to catalog" link.
- **Viewer, WebGL unavailable:** "This viewer needs WebGL. Turn on hardware acceleration or try another browser." The CIC log and the forces panel still work without the plot.
- **Perceived view, no contacts yet:** "No contacts: light from <side>'s targets has not arrived yet".
- **Notes:** actual Markdown headings, lists, emphasis, code and HTTP(S) links are formatted through DOM nodes; raw HTML remains text.

## Rendering and motion

- Engagement default framing uses spatial bounds, not ship-count-weighted centres, so a larger fleet does not squeeze its opponent against the plot edge. Portrait starts align the widest fleet separation with the tall plot axis. Display-only formations preserve each fleet's true centre and ship identities, reserve directional space between neighboring fleets, and use the measured rectangle rather than squeezing glyphs into circular clearance.
- Compact Ship annotations keep identity, dimensions and active-demo labels clear of the physical hull. Class figures and sources retain both accelerations, every broadside/bow/stern mount category, pod capacity, LAC bays and band dimensions.
- A paused, settled scene has no scheduled render loop. Store changes, resize, composition changes and OrbitControls changes invalidate it. Playback, active Ship demos, damping and Director convergence continue scheduling until they stop.
- The WebGL drawing buffer is retained so compositor repaints and captures can reuse the settled plot without restarting the idle render loop.
- Device reduced-motion changes apply live until the user explicitly chooses a setting in View. "Use device setting" restores that link. Reduced-motion Director uses cuts; demos can be stepped with a position slider.
- Cinematic event pacing applies only to Director + Auto. Manual rates and Free + Auto retain their existing behavior.
- Battle navigation lazy-loads the viewer. Teardown cancels in-flight worker solving and disposes controls, observers and frame callbacks. Generation checks reject stale mounts, and failures remain visible.

## Copy

- The voice is terse and naval, matching the CIC log. For example: `00:07:12  Second Fleet: salvo 3 launched, 65,500 missiles [W]`.
- Catalog scope distinguishes canon reconstructions from the non-canon Training example rather than calling every pack a canon battle.
- There are no em dashes in UI text (R-02).
- CTAs are specific: "Open replay", "Back to catalog", "Show sources". Do not use "Explore" or "Learn more" (R-15).
- Every number shown carries its evidence label, P, W, D or S. Unknown values read "unknown", and S values read "(speculative)" (R-17, R-38).
- Assets (R-23): there is no logo; the wordmark is "honor-cic" set in Chakra Petch. There are no portraits of admirals or crews.
