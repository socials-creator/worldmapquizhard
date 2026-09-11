# Where in the World 🌐

A modern, pinch-zoomable geography game: you're given a country name and you tap it on the map. Built as static HTML/CSS/JS — no build step, no backend, deploys straight to GitHub Pages.

---

## V11 changes (landscape iOS fixes + landscape UX overhaul)

**Fixed: taps completely non-functional in landscape on iPhone (webapp).**

Two separate bugs combined to break tap detection when rotating to landscape:

1. **Coordinate space mismatch.** Tap hit-testing was done in client-space pixel coordinates (`event.clientX / clientY`). In landscape on iOS, the browser adds safe-area insets (for the notch and home bar), and the SVG's position relative to the viewport shifts. The hit-layer path data is in SVG user-unit space, but the pointer coordinates weren't being converted into that same space — so every tap was offset and missed the intended country. **Fix:** all pointer coordinates are now converted from client space to SVG user-unit space via `svgElement.getScreenCTM().inverse()` before any distance or hit comparison.

2. **Projection not refit after rotation.** The d3 `geoNaturalEarth1` projection is fitted to the SVG's pixel dimensions once on first draw. When the device rotates, the SVG frame changes shape, but the country paths still encoded the old portrait-orientation coordinates. **Fix:** `handleResize()` now calls `projection.fitSize()` and redraws all path data after every resize/orientation change (with a 150ms delay to let iOS finish its reflow). It also resets the d3-zoom transform to `zoomIdentity` so a previously-panned state doesn't carry stale coordinates into the new orientation.

**New: landscape sidebar.**

In landscape a persistent left sidebar replaces the portrait control row and history strip (which disappear). The sidebar contains: New Game button, the current country prompt, Found/Missed/Remaining stats, and Last 10 games — everything needed to play without any overlay. A collapse toggle (⊞) in the topbar hides the sidebar and gives the map the full width.

**Other fixes:**
- `pointerleave` now cancels a pending tap (prevents ghost taps when pointer exits the SVG).
- Toast position adjusted for landscape (no prompt card competing for space at top).
- History list rendered in both portrait and landscape elements, kept in sync.
- Stats synced to both portrait and landscape elements via `syncStats()` / `syncPrompt()`.

---

## V10 changes

Country colors now shift each time you start a new game. The neighbor-coloring rule is still respected.

## V9 changes

Fixed long country names being cut off in the question box (e.g. "Democratic Republic of the Congo").

## V8 changes

- Fixed: countries not tappable on touch (d3-zoom's `preventDefault` on touchstart suppressed synthetic `click` events). Replaced with `pointerdown`/`pointerup` tap detector.
- Fixed: false "Map data failed to load" message when `localStorage` was blocked. Storage errors now degrade gracefully.
- Reordered map drawing so tap layer is always set up before the disputed-region overlay.

## V6 changes

Fixed critical bug where `countries-10m.json` (not published in the CDN package) caused a silent map-load failure. Reverted to 50m dataset. Implemented ~197-country filter properly (territories excluded and colored as their parent country).

---

## Features

- **New game** always visible — a round runs until you've placed every country or reach **5 misses**.
- **Landscape sidebar** on mobile — stats, skip, new game, and history visible at all times without overlays.
- **Last 10 games** always visible (portrait strip / landscape sidebar), and **highest score ever** in the ☰ drawer — saved in `localStorage`. If blocked, the game still plays fully (just no cross-session persistence).
- **No two neighboring countries share a color** — computed from border adjacency at load time, re-rolled each new game.
- **Disputed regions** (Aksai Chin, Pakistan-administered Kashmir etc.) drawn with India's color, excluded from quiz.
- **Pinch-to-zoom and drag-to-pan**, up to 40×. Invisible wider tap margin for thin/small countries.
- **Miss or skip** → map pans and zooms to the correct country, pulsing its border.
- Warm editorial style (Fraunces serif + Inter body).

---

## Territories and dependencies

Quiz targets ~197 sovereign countries (193 UN members + Vatican, Palestine, Kosovo, Taiwan). Territories are filtered via `EXCLUDE_FROM_QUIZ` and colored as their parent country via `DEPENDENCY_PARENT`.

---

## The disputed Kashmir region

Jammu & Kashmir, Ladakh, Aksai Chin, Shaksgam Valley, and Pakistan-administered Kashmir are displayed with India's fill color and clear borders. Simplified reference lines for gameplay, not a legal boundary. Excluded from the quiz.

---

## Files

```
index.html    structure
style.css     styling (portrait + landscape layouts)
script.js     map rendering + game logic + coordinate conversion
README.md     this file
```

Map data loads from a public CDN (`world-atlas@2`, Natural Earth 50m).

---

## Run locally

```bash
cd geo-game
python3 -m http.server 8000
# open http://localhost:8000
```

## Publish on GitHub Pages

1. Create a new GitHub repo.
2. Add the four files to the repo root.
3. Push to `main`.
4. In repo Settings → Pages → Source: Deploy from branch `main` / `/ (root)`.
5. Live URL: `https://<username>.github.io/<repo>/`

---

## Customizing

| What | Where |
|---|---|
| Country dataset | `WORLD_URL` in `script.js` |
| Max misses | `MAX_MISTAKES` |
| Continent jump frequency | `SAME_CONTINENT_PROBABILITY` (0–1) |
| Tap tolerance | `TAP_MAX_MOVE_PX` / `TAP_MAX_DURATION_MS` |
| Color palette | `PALETTE` array |
| Disputed outlines | `DISPUTED_REGIONS` constant |
| Fonts / colors | `:root` variables in `style.css` |
| Landscape sidebar width | `--ls-sidebar-width` CSS variable |

---

## A note on borders

Uses Natural Earth via `world-atlas` — neutral reference boundaries, not any single country's official claims. Disputed areas use simplified hand-drawn approximations for gameplay.
