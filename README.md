# Where in the World 🌐

A modern, pinch-zoomable geography game with two modes: **Countries** (tap the named country) and **Islands** (tap the real-world location of a named island, from Australia down to tiny Pacific atolls). Built as static HTML/CSS/JS — no build step, no backend, deploys straight to GitHub Pages.

---

## V12 changes (Islands mode + dark ocean)

**New: Islands mode.**

A mode toggle (Countries / Islands) sits next to New Game in both the portrait control row and the landscape sidebar. Islands mode quizzes ~55 islands worldwide — from giants like Australia and Greenland down to Pacific atolls like Nauru, Funafuti, and Pitcairn.

Islands aren't separate tappable shapes in the underlying `world-atlas` country topology (most are fused into a bigger country polygon, or don't exist at all at 50m resolution), so this mode works differently under the hood:

- Each island is stored as a point (`lon`/`lat`) plus a size `tier` in the `ISLANDS` array in `script.js`.
- A tap is scored by real-world distance (haversine, in km) from the click to the target's coordinate, not by which country shape was under the finger. Tolerance radius scales with tier — generous for Australia, tight for a coral atoll.
- Misses and skips reveal the answer with a **slower, held zoom-in animation** (`ISLAND_REVEAL_ZOOM_MS` / `ISLAND_REVEAL_HOLD_MS`, ~1.5s ease + ~2.8s hold — noticeably slower than the Countries reveal) onto a pulsing point marker, so there's real time to register where it actually was before the next round.
- Islands mode keeps its own high score and Last 10 history (`geoGame.*.islands.v1` in `localStorage`), separate from Countries, since the two quizzes have different totals and aren't comparable.
- Switching modes mid-round ends the current round without saving it (it wasn't finished) — press New Game again to start the new mode.

**Changed: ocean background.**

The map background (previously a light teal gradient) is now a solid dark `#1C1C1C`, reusing the `--darkmode` CSS variable that already existed in `:root`.

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

- **Two game modes** — Countries (tap the named country's shape) and **Islands** (tap the named island's real-world location, from Australia down to tiny Pacific atolls). Toggle lives next to New Game.
- **New game** always visible — a round runs until you've placed every country/island or reach **5 misses**.
- **Landscape sidebar** on mobile — stats, skip, new game, mode toggle, and history visible at all times without overlays.
- **Last 10 games** always visible (portrait strip / landscape sidebar), and **highest score ever** in the ☰ drawer — saved in `localStorage`, tracked separately per mode. If blocked, the game still plays fully (just no cross-session persistence).
- **No two neighboring countries share a color** — computed from border adjacency at load time, re-rolled each new game.
- **Disputed regions** (Aksai Chin, Pakistan-administered Kashmir etc.) drawn with India's color, excluded from quiz.
- **Pinch-to-zoom and drag-to-pan**, up to 4000×. Invisible wider tap margin for thin/small countries.
- **Miss or skip (Countries)** → map pans and zooms to the correct country, pulsing its border.
- **Miss or skip (Islands)** → a slower, held zoom-in onto a pulsing point marker at the real location — see V12 notes above.
- Dark ocean (`#1C1C1C`) with a warm editorial style on the UI chrome (Fraunces serif + Inter body).

---

## Territories and dependencies

Quiz targets ~197 sovereign countries (193 UN members + Vatican, Palestine, Kosovo, Taiwan). Territories are filtered via `EXCLUDE_FROM_QUIZ` and colored as their parent country via `DEPENDENCY_PARENT`. (Islands mode is unaffected by this list — it has its own separate `ISLANDS` dataset.)

---

## The disputed Kashmir region

Jammu & Kashmir, Ladakh, Aksai Chin, Shaksgam Valley, and Pakistan-administered Kashmir are displayed with India's fill color and clear borders. Simplified reference lines for gameplay, not a legal boundary. Excluded from the quiz.

---

## Files

```
index.html      structure
style.css       styling (portrait + landscape layouts)
script.js       map rendering + game logic + coordinate conversion
world.geojson   country boundaries + precomputed adjacency
README.md       this file
```

Map data loads from a bundled local file, `world.geojson` (Natural Earth 1:50m admin-0 countries, with India/Pakistan/China boundaries reflecting India's official claim — see "A note on borders" below). Country-adjacency data (used by the no-two-neighbors-share-a-color rule) is precomputed and stored in each feature's `properties.neighbors`.

---

## Run locally

```bash
cd geo-game
python3 -m http.server 8000
# open http://localhost:8000
```

## Publish on GitHub Pages

1. Create a new GitHub repo.
2. Add the five files to the repo root (including `world.geojson`).
3. Push to `main`.
4. In repo Settings → Pages → Source: Deploy from branch `main` / `/ (root)`.
5. Live URL: `https://<username>.github.io/<repo>/`

---

## Customizing

| What | Where |
|---|---|
| Country dataset | `WORLD_URL` in `script.js` (points to `world.geojson`) |
| Islands dataset (add/edit islands) | `ISLANDS` array in `script.js` |
| Island size tiers (tap tolerance + reveal zoom) | `ISLAND_TIERS` in `script.js` |
| Islands reveal animation speed/hold | `ISLAND_REVEAL_ZOOM_MS` / `ISLAND_REVEAL_HOLD_MS` |
| Max misses | `MAX_MISTAKES` |
| Continent/region jump frequency | `SAME_CONTINENT_PROBABILITY` (0–1) |
| Tap tolerance | `TAP_MAX_MOVE_PX` / `TAP_MAX_DURATION_MS` |
| Color palette | `PALETTE` array |
| Territories excluded from the quiz / colored as a parent country | `EXCLUDE_FROM_QUIZ` / `DEPENDENCY_PARENT` in `script.js` |
| Fonts / colors / ocean background | `:root` variables in `style.css` (ocean is `--darkmode`) |
| Landscape sidebar width | `--ls-sidebar-width` CSS variable |

---

## A note on borders

Uses a Natural Earth 1:50m base with a custom India/Pakistan/China boundary reflecting India's official claim (Jammu & Kashmir, Ladakh, Aksai Chin, and Pakistan-administered Kashmir are drawn as part of India; the small Siachen Glacier area is its own map feature, colored and excluded from the quiz the same way other India-adjacent territories are). Borders are simplified reference lines for gameplay, not a legal or political statement.

## V13 changes (new base map + India-claim boundary)

- Replaced the CDN-hosted `world-atlas` TopoJSON with a bundled `world.geojson` file, so the map no longer depends on a third-party CDN for country shapes.
- India, Pakistan, and China now use a boundary reflecting India's official claim, baked directly into the country geometry — this replaces the old `DISPUTED_REGIONS` hand-drawn overlay (Jammu & Kashmir/Ladakh/Aksai Chin/Shaksgam Valley/Pakistan-administered Kashmir), which has been removed since it's no longer needed and would have misaligned with the new base shapes.
- Siachen Glacier ships as its own small feature in the dataset; it's mapped to India via `DEPENDENCY_PARENT` (like Hong Kong→China or Puerto Rico→USA already were), so it always matches India's color and is excluded from the quiz — no special-case code needed.
- Country-adjacency (for the no-two-neighbors-share-a-color rule) is precomputed offline from the new geometry and shipped inside `world.geojson` as each feature's `properties.neighbors`, since the new file is plain GeoJSON rather than TopoJSON and doesn't carry shared-topology data. `topojson-client` is no longer loaded in `index.html`.
- A handful of territory names specific to this dataset (e.g. `Faeroe Is.`, `Cook Is.`, `Br. Indian Ocean Ter.`) were added to `EXCLUDE_FROM_QUIZ` / `DEPENDENCY_PARENT` so they behave the same as their long-form equivalents did before.
