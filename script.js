/* ============================================================
   Where in the World — geography pointing game (V11)
   V11 changes:
   - Fixed: tap/click detection completely broken in landscape on iOS.
     Root cause: when the device rotates, the SVG viewBox dimensions and
     the d3 projection are both keyed to the pre-rotation element size.
     The hit-layer path coordinates are then wrong relative to actual
     pointer positions. Fix: force a full resize+redraw on orientation
     change (with a 120ms delay to let iOS finish its reflow), then
     rebuild the zoom transform so previously-panned/zoomed state maps
     correctly to the new dimensions.
   - Fixed: pointer coordinate space mismatch. We now hit-test using
     SVG-space coordinates (via getScreenCTM inverse) rather than
     client-space offsets, which are unreliable when the SVG is scaled
     or when iOS adds safe-area insets in landscape.
   - Fixed: landscape sidebar overlapping SVG tap area. The sidebar now
     correctly subtracts its width from the map stage before the
     projection is fitted.
   - Added: landscape-optimised sidebar with inline stats, skip, new game,
     and last-10 history — so in landscape the primary game controls are
     always visible without any overlay.
   - Added: sidebar collapse toggle in landscape (the ⊞ button) so users
     can give the map the full width if they want.
   ============================================================ */

const WORLD_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json";
const MAX_MISTAKES = 5;
const SAME_CONTINENT_PROBABILITY = 0.72;
const REVEAL_ZOOM_MS = 650;
const REVEAL_HOLD_MS = 1700;

// Tap detection: these thresholds work for both mouse and touch.
// We use SVG-space coordinates now (see handlePointerUp) so movement
// thresholds don't need to compensate for device-pixel-ratio differences.
const TAP_MAX_MOVE_PX = 12;
const TAP_MAX_DURATION_MS = 600;

const STORAGE_HISTORY_KEY = "geoGame.history.v6";
const STORAGE_HIGH_KEY = "geoGame.highScore.v6";

/* ---------- Disputed regions (Kashmir etc.) ---------- */

const DISPUTED_REGIONS = [
  {
    name: "Jammu & Kashmir",
    coordinates: [[[ [74.50,32.20],[75.20,32.30],[76.10,32.50],[76.80,33.20],[76.95,34.20],[77.25,35.00],[76.95,35.85],[76.35,36.40],[75.65,36.60],[75.10,36.30],[74.75,35.50],[74.40,34.80],[74.50,32.20] ]]]
  },
  {
    name: "Ladakh",
    coordinates: [[[ [77.25,32.80],[78.60,32.50],[79.20,33.05],[79.65,34.00],[80.05,35.20],[79.75,36.05],[78.85,35.95],[77.95,35.30],[77.45,34.50],[77.25,32.80] ]]]
  },
  {
    name: "Aksai Chin",
    coordinates: [[[ [78.40,34.90],[79.00,34.30],[79.50,34.05],[80.20,34.25],[80.50,34.95],[80.10,35.40],[79.40,35.60],[78.70,35.35],[78.40,34.90] ]]]
  },
  {
    name: "Shaksgam Valley",
    coordinates: [[[ [75.80,35.85],[76.45,35.70],[77.10,36.20],[76.70,36.85],[76.05,36.70],[75.80,35.85] ]]]
  },
  {
    name: "Pakistan-administered Kashmir",
    coordinates: [[[ [73.10,33.80],[74.00,33.40],[74.90,33.60],[75.80,34.35],[76.90,35.00],[77.10,36.00],[76.60,36.80],[75.60,36.90],[74.40,36.75],[73.40,36.05],[72.85,34.90],[73.10,33.80] ]]]
  }
];

const disputedFeatureCollection = {
  type: "FeatureCollection",
  features: DISPUTED_REGIONS.map(r => ({
    type: "Feature",
    properties: { name: r.name },
    geometry: { type: "Polygon", coordinates: r.coordinates }
  }))
};

let indiaColorIndex = -1;

/* ---------- Territories excluded from quiz ---------- */

const EXCLUDE_FROM_QUIZ = new Set([
  "Greenland","Puerto Rico","French Guiana","Guadeloupe","Martinique",
  "Mayotte","Réunion","Reunion","French Polynesia","New Caledonia",
  "Saint Pierre and Miquelon","Wallis and Futuna","Saint Barthelemy",
  "Saint Martin","Fr. S. Antarctic Lands","French Southern and Antarctic Lands",
  "Hong Kong","Hong Kong S.A.R.","Macao","Macau","Macau S.A.R.",
  "Faroe Islands","Faroe Is.","Bermuda","Cayman Islands","Cayman Is.",
  "British Virgin Islands","British Virgin Is.","Turks and Caicos Islands",
  "Turks and Caicos Is.","Falkland Islands","Falkland Is.","Gibraltar",
  "Isle of Man","Jersey","Guernsey","Anguilla","Montserrat",
  "Saint Helena","Saint Helena, Ascension and Tristan da Cunha",
  "British Indian Ocean Territory","Pitcairn Islands","Pitcairn",
  "South Georgia and the Islands","South Georgia and South Sandwich Islands",
  "Aruba","Curaçao","Curacao","Sint Maarten","Bonaire","Sint Eustatius",
  "American Samoa","Guam","Northern Mariana Islands","N. Mariana Islands",
  "United States Virgin Islands","U.S. Virgin Islands","U.S. Virgin Is.",
  "Norfolk Island","Christmas Island","Cocos Islands","Cocos (Keeling) Islands",
  "Cook Islands","Niue","Tokelau","Svalbard","Svalbard and Jan Mayen",
  "Åland","Aland","Åland Islands",
  "Western Sahara","W. Sahara","Somaliland","N. Cyprus","Northern Cyprus",
  "Akrotiri and Dhekelia","Bouvet Island","Heard Island and McDonald Islands",
  "French Southern Territories",
]);

const DEPENDENCY_PARENT = {
  "Greenland":"Denmark","Faroe Islands":"Denmark","Faroe Is.":"Denmark",
  "Puerto Rico":"United States of America",
  "American Samoa":"United States of America",
  "Guam":"United States of America",
  "Northern Mariana Islands":"United States of America","N. Mariana Islands":"United States of America",
  "United States Virgin Islands":"United States of America",
  "U.S. Virgin Islands":"United States of America","U.S. Virgin Is.":"United States of America",
  "French Guiana":"France","Guadeloupe":"France","Martinique":"France",
  "Mayotte":"France","Réunion":"France","Reunion":"France",
  "French Polynesia":"France","New Caledonia":"France",
  "Saint Pierre and Miquelon":"France","Wallis and Futuna":"France",
  "Saint Barthelemy":"France","Saint Martin":"France",
  "Fr. S. Antarctic Lands":"France","French Southern and Antarctic Lands":"France",
  "Hong Kong":"China","Hong Kong S.A.R.":"China",
  "Macao":"China","Macau":"China","Macau S.A.R.":"China",
  "Bermuda":"United Kingdom","Cayman Islands":"United Kingdom","Cayman Is.":"United Kingdom",
  "British Virgin Islands":"United Kingdom","British Virgin Is.":"United Kingdom",
  "Turks and Caicos Islands":"United Kingdom","Turks and Caicos Is.":"United Kingdom",
  "Falkland Islands":"United Kingdom","Falkland Is.":"United Kingdom",
  "Gibraltar":"United Kingdom","Isle of Man":"United Kingdom",
  "Jersey":"United Kingdom","Guernsey":"United Kingdom",
  "Anguilla":"United Kingdom","Montserrat":"United Kingdom",
  "Saint Helena":"United Kingdom","Saint Helena, Ascension and Tristan da Cunha":"United Kingdom",
  "British Indian Ocean Territory":"United Kingdom",
  "Pitcairn Islands":"United Kingdom","Pitcairn":"United Kingdom",
  "South Georgia and the Islands":"United Kingdom",
  "South Georgia and South Sandwich Islands":"United Kingdom",
  "Aruba":"Netherlands","Curaçao":"Netherlands","Curacao":"Netherlands",
  "Sint Maarten":"Netherlands","Bonaire":"Netherlands","Sint Eustatius":"Netherlands",
  "Norfolk Island":"Australia","Christmas Island":"Australia",
  "Cocos Islands":"Australia","Cocos (Keeling) Islands":"Australia",
  "Cook Islands":"New Zealand","Niue":"New Zealand","Tokelau":"New Zealand",
  "Svalbard":"Norway","Svalbard and Jan Mayen":"Norway",
  "Åland":"Finland","Aland":"Finland","Åland Islands":"Finland",
};

/* ---------- DOM refs ---------- */

const els = {
  map: document.getElementById("map"),
  // Portrait stats
  liveScore: document.getElementById("live-score"),
  liveMistakes: document.getElementById("live-mistakes"),
  liveRemaining: document.getElementById("live-remaining"),
  // Portrait prompt
  promptCountry: document.getElementById("prompt-country"),
  skipBtn: document.getElementById("skip-btn"),
  newGameBtn: document.getElementById("new-game-btn"),
  // Landscape stats
  lsScore: document.getElementById("ls-score"),
  lsMistakes: document.getElementById("ls-mistakes"),
  lsRemaining: document.getElementById("ls-remaining"),
  lsPromptCountry: document.getElementById("ls-prompt-country"),
  lsSkipBtn: document.getElementById("skip-btn-ls"),
  lsNewGameBtn: document.getElementById("new-game-btn-ls"),
  lsPromptSection: document.getElementById("ls-prompt-section"),
  landscapeSidebar: document.getElementById("landscape-sidebar"),
  sidebarToggle: document.getElementById("sidebar-toggle"),
  // Shared
  feedbackToast: document.getElementById("feedback-toast"),
  highScoreNumber: document.getElementById("high-score-number"),
  highScoreOutof: document.getElementById("high-score-outof"),
  historyListPortrait: document.getElementById("history-list-portrait"),
  historyListLandscape: document.getElementById("history-list-landscape"),
  resultOverlay: document.getElementById("result-overlay"),
  resultTitle: document.getElementById("result-title"),
  resultScore: document.getElementById("result-score"),
  resultCopy: document.getElementById("result-copy"),
  playAgainBtn: document.getElementById("play-again-btn"),
  closeResultBtn: document.getElementById("close-result-btn"),
  menuToggle: document.getElementById("menu-toggle"),
  drawer: document.getElementById("sidebar"),
  drawerClose: document.getElementById("drawer-close"),
  drawerScrim: document.getElementById("drawer-scrim"),
  zoomIn: document.getElementById("zoom-in"),
  zoomOut: document.getElementById("zoom-out"),
  zoomReset: document.getElementById("zoom-reset"),
};

/* ---------- Orientation / landscape detection ---------- */

function isLandscape() {
  // Use window.matchMedia as primary, fall back to dimensions.
  // This is more reliable than screen.orientation on older iOS Safari.
  if (window.matchMedia) {
    return window.matchMedia("(orientation: landscape)").matches;
  }
  return window.innerWidth > window.innerHeight;
}

let landscapeSidebarCollapsed = false;

function applySidebarState() {
  if (landscapeSidebarCollapsed) {
    els.landscapeSidebar.classList.add("collapsed");
  } else {
    els.landscapeSidebar.classList.remove("collapsed");
  }
}

els.sidebarToggle.addEventListener("click", () => {
  landscapeSidebarCollapsed = !landscapeSidebarCollapsed;
  applySidebarState();
  // Give CSS transition time, then recalc map size
  setTimeout(handleResize, 260);
});

/* ---------- Map setup ---------- */

// These are set/updated by handleResize — always use these, not
// els.map.clientWidth directly, so the values are consistent within
// a single frame even if layout hasn't settled yet.
let width = 0;
let height = 0;

const svg = d3.select("#map").append("svg");
const g = svg.append("g");
const countryLayer = g.append("g").attr("class", "country-layer");
const disputedLayer = g.append("g").attr("class", "disputed-layer");
const hitLayer = g.append("g").attr("class", "hit-layer");

const projection = d3.geoNaturalEarth1();
const path = d3.geoPath(projection);

// V12: raised from 40 so tiny countries (Monaco, Vatican, Singapore) can
// actually be seen at a usable on-screen size — at 40x Monaco's ~2km width
// was still sub-millimeter on screen. 400x gets a country like Monaco to
// roughly a centimeter or more of screen width on a typical phone, since
// the Natural Earth 50m projection scale means each 10x of zoom roughly
// 10x's the rendered size of any given shape.
const MAX_SCALE = 4000;

const zoomBehavior = d3.zoom()
  .scaleExtent([1, MAX_SCALE])
  .clickDistance(5)
  .on("zoom", (event) => g.attr("transform", event.transform));

svg.call(zoomBehavior).on("dblclick.zoom", null);

els.zoomIn.addEventListener("click", () =>
  svg.transition().duration(200).call(zoomBehavior.scaleBy, 1.7));
els.zoomOut.addEventListener("click", () =>
  svg.transition().duration(200).call(zoomBehavior.scaleBy, 1 / 1.7));
els.zoomReset.addEventListener("click", () =>
  svg.transition().duration(300).call(zoomBehavior.transform, d3.zoomIdentity));

/* ---------- Resize handler ----------
   V11: This now does a full re-fit of the projection AND redraws all path
   data. Previously only the viewBox was updated, which left the projected
   coordinates of every country unchanged — so in landscape the hit targets
   were in the wrong place (old portrait coordinates) even though the SVG
   frame was the right size. We also reset the zoom identity so the user
   starts fresh after rotation (rather than having a stale pan/zoom that
   references pre-rotation coordinates). */

function handleResize() {
  // Read dimensions fresh from the DOM
  width = els.map.clientWidth;
  height = els.map.clientHeight;
  if (!width || !height) return; // element not yet in layout

  svg.attr("viewBox", `0 0 ${width} ${height}`)
     .attr("width", width)
     .attr("height", height);

  // Re-fit projection to new dimensions, then redraw all paths
  projection.fitSize([width, height], { type: "Sphere" });

  countryLayer.selectAll("path.country").attr("d", path);
  disputedLayer.selectAll("path.disputed-region").attr("d", path);
  hitLayer.selectAll("path.hit-target").attr("d", path);

  // Reset zoom so the stale transform doesn't offset taps
  svg.call(zoomBehavior.transform, d3.zoomIdentity);
}

// Orientation change: iOS fires this before layout is complete, so we
// wait 150 ms for the reflow to finish before measuring.
window.addEventListener("orientationchange", () => {
  setTimeout(handleResize, 150);
});

// Also respond to plain resize (desktop window resize, split-screen, etc.)
window.addEventListener("resize", () => {
  // Use a small debounce so we don't thrash during drag-resize
  clearTimeout(handleResize._t);
  handleResize._t = setTimeout(handleResize, 80);
});

/* ---------- Palette ---------- */

const PALETTE = [
  "#D97757","#3D5A80","#E8B04B","#7C6FB0",
  "#4A7FA5","#C9425A","#588157","#E0664E",
  "#B5651D","#8E44AD","#D4A24C","#2F4858",
];

function colorForIndex(i) {
  if (i >= 0 && i < PALETTE.length) return PALETTE[i];
  if (i < 0) return PALETTE[0];
  const hue = (i * 47) % 360;
  return `hsl(${hue} 55% 55%)`;
}

/* ---------- Continent from centroid ---------- */

function continentFromCentroid([lon, lat]) {
  if (lon >= 110 || lon <= -130) return lat > 15 ? "Asia" : "Oceania";
  if (lon < -30) return lat > 15 ? "North America" : "South America";
  if (lon < 60) return lat > 30 ? "Europe" : "Africa";
  return lat > -10 ? "Asia" : "Oceania";
}

/* ---------- Game state ---------- */

let features = [];
let neighborsOf = [];
let continentOf = [];
let nameOf = [];
let sovereignIndices = [];
let parentIndexOf = [];

let game = {
  active: false,
  score: 0,
  mistakes: 0,
  targetIndex: null,
  remaining: [],
  asked: [],
};

function resolveSovereignIndex(i) {
  const p = parentIndexOf[i];
  return (p !== null && p !== undefined) ? p : i;
}

/* ---------- Load data ---------- */

d3.json(WORLD_URL).then((world) => {
  const objectKey = Object.keys(world.objects)[0];
  const collection = topojson.feature(world, world.objects[objectKey]);
  const rawNeighbors = topojson.neighbors(world.objects[objectKey].geometries);

  const keepIndex = [];
  collection.features.forEach((f, i) => {
    if (f.geometry && f.properties.name !== "Antarctica") keepIndex.push(i);
  });
  features = keepIndex.map(i => collection.features[i]);

  const oldToNew = new Map(keepIndex.map((oldI, newI) => [oldI, newI]));
  neighborsOf = keepIndex.map((oldI) =>
    rawNeighbors[oldI].filter(n => oldToNew.has(n)).map(n => oldToNew.get(n))
  );

  nameOf = features.map(f => f.properties.name);
  continentOf = features.map(f => continentFromCentroid(d3.geoCentroid(f)));

  const nameToIndex = new Map(nameOf.map((n, i) => [n, i]));
  parentIndexOf = nameOf.map((name) => {
    const parentName = DEPENDENCY_PARENT[name];
    return (parentName && nameToIndex.has(parentName)) ? nameToIndex.get(parentName) : null;
  });
  sovereignIndices = features.map((_, i) => i).filter(i => !EXCLUDE_FROM_QUIZ.has(nameOf[i]));

  if (!features.length) throw new Error("Zero renderable features after parse.");

  // --- V12: everything below this point is RENDERING, not data-fetching.
  // Previously drawMap()/handleResize() ran directly inside this .then(),
  // so any exception they threw — including from the container having
  // zero width/height on first paint, which can happen on some mobile
  // browsers before the viewport/webfonts have finished settling — was
  // caught by the .catch() below and shown as a misleading "map data
  // failed to load / check your connection" message, even though the
  // JSON had already fetched and parsed correctly. That's now isolated
  // into its own try/catch with its own accurate error message, exactly
  // like the existing history/high-score isolation further down.
  try {
    initialRender();
  } catch (err) {
    console.error("Map data loaded, but rendering failed:", err);
    showToast("map", "bad");
    // Retry once shortly after — covers the "container had zero size on
    // first paint" case, which usually resolves itself a moment later.
    setTimeout(() => {
      try {
        initialRender();
        showToast("Map ready", "good");
      } catch (err2) {
        console.error("Retry render also failed:", err2);
        els.promptCountry.textContent = "🌏";
      }
    }, 300);
  }

  try {
    loadHighScore();
    renderHistory();
  } catch (err) {
    console.warn("Non-fatal: history/high-score init failed.", err);
  }
}).catch((err) => {
  console.error("Failed to load or parse map data:", err);
  els.promptCountry.textContent = "⚠️";
  showToast("Map data failed to load — check your connection and reload", "bad");
});

/* Renders the map for the first time. Separated out so the initial call
   and the zero-size retry (see above) share identical logic. */
function initialRender() {
  assignColors();
  drawMap();      // draw first with whatever dimensions are available…
  handleResize(); // …then immediately re-fit to the settled container size
}

/* ---------- Graph coloring ---------- */

function assignColors() {
  const colorIndexOf = new Array(features.length).fill(-1);
  const order = features.map((_, i) => i)
    .sort((a, b) => neighborsOf[b].length - neighborsOf[a].length);

  let nextExtra = PALETTE.length;
  const colorOffset = Math.floor(Math.random() * PALETTE.length);

  order.forEach((i) => {
    const used = new Set(neighborsOf[i].map(n => colorIndexOf[n]).filter(c => c !== -1));
    let c = (i + colorOffset) % PALETTE.length;
    let tries = 0;
    while (used.has(c) && tries < PALETTE.length) { c = (c + 1) % PALETTE.length; tries++; }
    if (used.has(c)) c = nextExtra++;
    colorIndexOf[i] = c;
  });

  parentIndexOf.forEach((parentI, i) => {
    if (parentI !== null && parentI !== undefined) colorIndexOf[i] = colorIndexOf[parentI];
  });

  features.forEach((f, i) => { f.__colorIndex = colorIndexOf[i]; });
}

/* ---------- Draw ---------- */

function drawMap() {
  // Measure the container now — this is the single source of truth
  width = els.map.clientWidth || window.innerWidth;
  height = els.map.clientHeight || window.innerHeight;

  // QUICK FIX: if the container still isn't laid out yet (both real
  // measurement and fallback came back 0), bail out and retry shortly
  // instead of calling fitSize/path with zero/NaN dimensions, which is
  // what was throwing and triggering the false "failed to draw" message.
  if (!width || !height) {
    setTimeout(() => { try { initialRender(); } catch (e) { console.error(e); } }, 200);
    return;
  }


  svg.attr("viewBox", `0 0 ${width} ${height}`)
     .attr("width", width)
     .attr("height", height);

  projection.fitSize([width, height], { type: "Sphere" });

  // --- Visual country layer ---
  countryLayer.selectAll("path.country")
    .data(features)
    .join("path")
    .attr("class", "country")
    .attr("d", path)
    .attr("fill", d => colorForIndex(d.__colorIndex))
    .attr("data-index", (d, i) => i);

  // --- Hit layer with pointer-based tap detection ---
  //
  // V11 KEY FIX: We now convert pointer coordinates from client space into
  // SVG space using getScreenCTM().inverse(). This accounts for:
  //   - Any CSS transform on the SVG element itself
  //   - iOS safe-area insets in landscape (notch/home-bar)
  //   - Device pixel ratio mismatches
  //   - d3-zoom's current pan/zoom transform on <g>
  //
  // Without this conversion, in landscape on iOS the tap coordinates are
  // offset by the sidebar width and/or the safe-area inset, so no tap ever
  // hits the intended feature.

  let pointerDownInfo = null;

  hitLayer.selectAll("path.hit-target")
    .data(features)
    .join("path")
    .attr("class", "hit-target")
    .attr("d", path)
    .attr("data-index", (d, i) => i)
    .on("pointerdown", (event, d) => {
      // Convert to SVG-local coordinates immediately on pointerdown
      const svgPoint = clientToSVGPoint(event.clientX, event.clientY);
      pointerDownInfo = {
        svgX: svgPoint.x,
        svgY: svgPoint.y,
        time: Date.now(),
        index: features.indexOf(d),
      };
    })
    .on("pointerup", (event, d) => {
      if (!pointerDownInfo) return;
      const svgPoint = clientToSVGPoint(event.clientX, event.clientY);
      const dx = svgPoint.x - pointerDownInfo.svgX;
      const dy = svgPoint.y - pointerDownInfo.svgY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const dt = Date.now() - pointerDownInfo.time;
      const idx = pointerDownInfo.index;
      pointerDownInfo = null;
      if (dist <= TAP_MAX_MOVE_PX && dt <= TAP_MAX_DURATION_MS) {
        handleCountryClick(idx);
      }
    })
    .on("pointercancel", () => { pointerDownInfo = null; })
    .on("pointerleave", () => { pointerDownInfo = null; });

  // --- Disputed regions overlay ---
  try {
    const indiaIndex = features.findIndex(f => f.properties.name === "India");
    indiaColorIndex = indiaIndex >= 0 ? features[indiaIndex].__colorIndex : 0;
    disputedLayer.selectAll("path.disputed-region")
      .data(disputedFeatureCollection.features)
      .join("path")
      .attr("class", "disputed-region")
      .attr("d", path)
      .attr("fill", colorForIndex(indiaColorIndex));
  } catch (err) {
    console.warn("Non-fatal: disputed-region overlay failed.", err);
  }
}

/* Convert a client-space coordinate (from a pointer event) into the SVG's
   own coordinate space. This is the correct way to map a tap to a path on
   the SVG regardless of page scroll, CSS transforms, device zoom, or
   landscape safe-area offsets. */
function clientToSVGPoint(clientX, clientY) {
  const svgEl = svg.node();
  const pt = svgEl.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  // getScreenCTM maps from SVG user units to screen pixels; the inverse
  // does the reverse — screen pixels → SVG user units.
  try {
    return pt.matrixTransform(svgEl.getScreenCTM().inverse());
  } catch (e) {
    // Fallback: just use the raw client coordinates (never ideal, but
    // at least something will happen rather than silently failing).
    return { x: clientX, y: clientY };
  }
}

/* ---------- Prompt / stats sync ----------
   Keep portrait and landscape UI elements in sync. */

function syncPrompt(name) {
  if (els.promptCountry) els.promptCountry.textContent = name;
  if (els.lsPromptCountry) els.lsPromptCountry.textContent = name;
}

function syncStats() {
  const scoreVal = game.score;
  const mistakesVal = `${game.mistakes} / ${MAX_MISTAKES}`;
  const remVal = game.active ? game.remaining.length : "—";

  if (els.liveScore) els.liveScore.textContent = scoreVal;
  if (els.liveMistakes) els.liveMistakes.textContent = mistakesVal;
  if (els.liveRemaining) els.liveRemaining.textContent = remVal;

  if (els.lsScore) els.lsScore.textContent = scoreVal;
  if (els.lsMistakes) els.lsMistakes.textContent = mistakesVal;
  if (els.lsRemaining) els.lsRemaining.textContent = remVal;
}

function syncSkipDisabled(disabled) {
  if (els.skipBtn) els.skipBtn.disabled = disabled;
  if (els.lsSkipBtn) els.lsSkipBtn.disabled = disabled;
}

/* ---------- Game flow ---------- */

function doSkip() {
  if (!game.active) return;
  game.mistakes++;
  showToast(`It was ${nameOf[game.targetIndex]}`, "bad");
  revealCountry(game.targetIndex);
  finishTurn(false);
}

els.newGameBtn.addEventListener("click", startGame);
els.lsNewGameBtn.addEventListener("click", startGame);
els.playAgainBtn.addEventListener("click", () => { closeResult(); startGame(); });
els.closeResultBtn.addEventListener("click", closeResult);
els.skipBtn.addEventListener("click", doSkip);
els.lsSkipBtn.addEventListener("click", doSkip);

function startGame() {
  if (!sovereignIndices.length) return;

  assignColors();
  countryLayer.selectAll("path.country").attr("fill", d => colorForIndex(d.__colorIndex));
  const indiaIdxForRepaint = features.findIndex(f => f.properties.name === "India");
  indiaColorIndex = indiaIdxForRepaint >= 0 ? features[indiaIdxForRepaint].__colorIndex : 0;
  disputedLayer.selectAll("path.disputed-region").attr("fill", colorForIndex(indiaColorIndex));

  game = {
    active: true,
    score: 0,
    mistakes: 0,
    targetIndex: null,
    remaining: sovereignIndices.slice(),
    asked: [],
  };
  syncSkipDisabled(false);
  syncStats();
  pickNext();
}

function pickNext() {
  if (!game.remaining.length) { endGame("completed"); return; }

  const prev = game.targetIndex;
  let pool;

  if (prev === null) {
    pool = game.remaining;
  } else {
    const sameContinent = game.remaining.filter(i => continentOf[i] === continentOf[prev]);
    const jump = Math.random() > SAME_CONTINENT_PROBABILITY || sameContinent.length === 0;
    pool = jump ? game.remaining : sameContinent;
  }

  const next = pool[Math.floor(Math.random() * pool.length)];
  game.targetIndex = next;
  game.remaining = game.remaining.filter(i => i !== next);
  game.asked.push(next);

  syncPrompt(nameOf[next]);
  syncStats();
}

function handleCountryClick(clickedIndex) {
  if (!game.active) return;
  if (clickedIndex === null || clickedIndex === undefined || clickedIndex < 0) return;

  const target = game.targetIndex;
  const resolved = resolveSovereignIndex(clickedIndex);
  const isCorrect = resolved === target;

  if (isCorrect) {
    game.score++;
    showToast("Correct! ✓", "good");
    const el = countryLayer.select(`path[data-index="${clickedIndex}"]`);
    el.classed("correct-flash", true);
    setTimeout(() => el.classed("correct-flash", false), 500);
    finishTurn(true);
  } else {
    game.mistakes++;
    const wrongEl = countryLayer.select(`path[data-index="${clickedIndex}"]`);
    wrongEl.classed("wrong-flash", true);
    setTimeout(() => wrongEl.classed("wrong-flash", false), 650);
    showToast(`${nameOf[resolved]} — here's ${nameOf[target]}`, "bad");
    revealCountry(target);
    finishTurn(false);
  }
}

function revealCountry(index) {
  const feature = features[index];
  const el = countryLayer.select(`path[data-index="${index}"]`);
  el.raise().classed("reveal-pulse", true);
  setTimeout(() => el.classed("reveal-pulse", false), REVEAL_HOLD_MS - 50);

  const bounds = path.bounds(feature);
  const [[x0, y0], [x1, y1]] = bounds;
  const bw = x1 - x0, bh = y1 - y0;
  if (!bw || !bh) return;

  const pad = 80;
  const scale = Math.max(1, Math.min(MAX_SCALE * 0.7,
    0.9 / Math.max(bw / (width - pad), bh / (height - pad))
  ));
  const tx = width / 2 - scale * (x0 + bw / 2);
  const ty = height / 2 - scale * (y0 + bh / 2);

  svg.transition().duration(REVEAL_ZOOM_MS).call(
    zoomBehavior.transform,
    d3.zoomIdentity.translate(tx, ty).scale(scale)
  );
}

function finishTurn(wasCorrect) {
  syncStats();
  const delay = wasCorrect ? 500 : REVEAL_HOLD_MS;

  setTimeout(() => {
    if (game.mistakes >= MAX_MISTAKES) { endGame("mistakes"); return; }
    if (!game.remaining.length) { endGame("completed"); return; }
    if (!wasCorrect) {
      svg.transition().duration(400).call(zoomBehavior.transform, d3.zoomIdentity);
    }
    pickNext();
  }, delay);
}

function endGame(reason) {
  game.active = false;
  syncSkipDisabled(true);
  const endEmoji = reason === "completed" ? "🏆" : "🏁";
  syncPrompt(endEmoji);

  saveResult(game.score, game.mistakes, sovereignIndices.length, reason === "completed");
  showResult(reason);
}

/* ---------- Toast ---------- */

function showToast(msg, kind) {
  els.feedbackToast.textContent = msg;
  els.feedbackToast.className = `feedback-toast show ${kind}`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    els.feedbackToast.classList.remove("show");
  }, 1100);
}

/* ---------- Result overlay ---------- */

function showResult(reason) {
  els.resultTitle.textContent =
    reason === "completed" ? "You placed every country!" : "Game over — 5 misses";
  els.resultScore.textContent = `${game.score} / ${sovereignIndices.length}`;
  els.resultCopy.textContent = reason === "completed"
    ? "Every country on the map, found. That's a full round."
    : "Every round sharpens your map sense. Go again?";
  els.resultOverlay.classList.add("show");
}
function closeResult() { els.resultOverlay.classList.remove("show"); }

/* ---------- Persistence ---------- */

let storageAvailable = true;
let memoryHistory = [];
let memoryHighScore = 0;

(function checkStorage() {
  try {
    const testKey = "__geoGame_storage_test__";
    localStorage.setItem(testKey, "1");
    localStorage.removeItem(testKey);
  } catch (err) {
    storageAvailable = false;
    console.warn("localStorage unavailable — no persistence this session.", err);
  }
})();

function readHistory() {
  if (!storageAvailable) return memoryHistory;
  try { return JSON.parse(localStorage.getItem(STORAGE_HISTORY_KEY) || "[]"); }
  catch (err) { return memoryHistory; }
}

function writeHistory(history) {
  memoryHistory = history;
  if (!storageAvailable) return;
  try { localStorage.setItem(STORAGE_HISTORY_KEY, JSON.stringify(history)); }
  catch (err) { console.warn("Could not save history.", err); }
}

function readHighScore() {
  if (!storageAvailable) return memoryHighScore;
  try { return Number(localStorage.getItem(STORAGE_HIGH_KEY) || 0); }
  catch (err) { return memoryHighScore; }
}

function writeHighScore(value) {
  memoryHighScore = value;
  if (!storageAvailable) return;
  try { localStorage.setItem(STORAGE_HIGH_KEY, String(value)); }
  catch (err) { console.warn("Could not save high score.", err); }
}

function saveResult(score, mistakes, total, completed) {
  const history = readHistory();
  history.unshift({ score, mistakes, total, completed, date: new Date().toISOString() });
  writeHistory(history.slice(0, 10));
  const high = readHighScore();
  if (score > high) writeHighScore(score);
  renderHistory();
  loadHighScore();
}

function loadHighScore() {
  const high = readHighScore();
  els.highScoreNumber.textContent = high;
  els.highScoreOutof.textContent = `of ${sovereignIndices.length || "—"} countries`;
}

function renderHistory() {
  const history = readHistory();
  const empty = `<li class="history-empty">No games yet.</li>`;
  if (!history.length) {
    els.historyListPortrait.innerHTML = empty;
    els.historyListLandscape.innerHTML = empty;
    return;
  }
  const html = history.map(h => {
    const d = new Date(h.date);
    const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const cls = h.completed ? "completed" : "";
    return `<li class="${cls}"><span class="history-score">${h.score}</span><span class="history-date">${dateStr}</span></li>`;
  }).join("");
  els.historyListPortrait.innerHTML = html;
  els.historyListLandscape.innerHTML = html;
}

/* ---------- Drawer (hamburger) ---------- */

function openDrawer() {
  els.drawer.classList.add("open");
  els.drawerScrim.classList.add("show");
}
function closeDrawer() {
  els.drawer.classList.remove("open");
  els.drawerScrim.classList.remove("show");
}
els.menuToggle.addEventListener("click", openDrawer);
els.drawerClose.addEventListener("click", closeDrawer);
els.drawerScrim.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
