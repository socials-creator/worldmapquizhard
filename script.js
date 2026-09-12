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

// Islands mode reveals a point, not a shape, so the animation is
// deliberately slower and holds longer than the countries reveal —
// the whole point is to give the player time to actually place it.
const ISLAND_REVEAL_ZOOM_MS = 1500;
const ISLAND_REVEAL_HOLD_MS = 2800;
const ISLAND_SNAP_BACK_MS = 700;

// Tap detection: these thresholds work for both mouse and touch.
// We use SVG-space coordinates now (see handlePointerUp) so movement
// thresholds don't need to compensate for device-pixel-ratio differences.
const TAP_MAX_MOVE_PX = 12;
const TAP_MAX_DURATION_MS = 600;

const STORAGE_HISTORY_KEY = "geoGame.history.v6";
const STORAGE_HIGH_KEY = "geoGame.highScore.v6";
const STORAGE_HISTORY_KEY_ISLANDS = "geoGame.history.islands.v1";
const STORAGE_HIGH_KEY_ISLANDS = "geoGame.highScore.islands.v1";

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

/* ---------- Islands mode data ----------
   Islands aren't separate tappable shapes in the underlying country
   topology (most are part of a bigger country polygon, or too small
   to exist at 50m resolution at all), so this mode works differently
   from Countries: we store each island as a point (lon/lat), hit-test
   a tap by real-world distance to that point, and reveal misses/skips
   by panning to the exact coordinate instead of flashing a shape.

   "tier" sets both the tap-tolerance radius (generous for a huge
   landmass like Australia, tight for a coral atoll) and how far we
   zoom in on reveal, so a tiny island is actually visible once shown. */

const ISLAND_TIERS = {
  giant:  { radiusKm: 550, zoom: 3 },
  large:  { radiusKm: 400, zoom: 5 },
  medium: { radiusKm: 300, zoom: 8 },
  small:  { radiusKm: 220, zoom: 12 },
  tiny:   { radiusKm: 160, zoom: 18 },
};

const ISLANDS = [
  { name: "Australia", lon: 133.7751, lat: -25.2744, region: "Australia & NZ", tier: "giant" },
  { name: "Greenland", lon: -42.6043, lat: 71.7069, region: "Arctic", tier: "giant" },
  { name: "New Guinea", lon: 141.0, lat: -5.0, region: "Melanesia", tier: "giant" },
  { name: "Borneo", lon: 114.0, lat: 0.5, region: "Southeast Asia", tier: "giant" },
  { name: "Madagascar", lon: 46.8691, lat: -18.7669, region: "Indian Ocean", tier: "giant" },
  { name: "Baffin Island", lon: -70.0, lat: 68.0, region: "Arctic", tier: "giant" },
  { name: "Sumatra", lon: 101.5, lat: -0.5, region: "Southeast Asia", tier: "giant" },
  { name: "Honshu", lon: 138.0, lat: 36.5, region: "East Asia", tier: "large" },
  { name: "Great Britain", lon: -2.0, lat: 54.0, region: "Europe", tier: "large" },
  { name: "Victoria Island", lon: -108.0, lat: 71.0, region: "Arctic", tier: "large" },
  { name: "Ellesmere Island", lon: -80.0, lat: 79.0, region: "Arctic", tier: "large" },
  { name: "Sulawesi", lon: 121.0, lat: -2.0, region: "Southeast Asia", tier: "large" },
  { name: "South Island (NZ)", lon: 170.5, lat: -43.6, region: "Australia & NZ", tier: "large" },
  { name: "Java", lon: 110.0, lat: -7.5, region: "Southeast Asia", tier: "large" },
  { name: "North Island (NZ)", lon: 175.5, lat: -39.0, region: "Australia & NZ", tier: "large" },
  { name: "Newfoundland", lon: -56.0, lat: 49.0, region: "North Atlantic", tier: "large" },
  { name: "Cuba", lon: -77.8, lat: 21.5, region: "Caribbean", tier: "large" },
  { name: "Iceland", lon: -19.0, lat: 64.9, region: "North Atlantic", tier: "large" },
  { name: "Luzon", lon: 121.0, lat: 16.0, region: "Southeast Asia", tier: "large" },
  { name: "Sri Lanka", lon: 80.7, lat: 7.5, region: "Indian Ocean", tier: "medium" },
  { name: "Sakhalin", lon: 143.0, lat: 51.0, region: "East Asia", tier: "medium" },
  { name: "Hispaniola", lon: -71.0, lat: 19.0, region: "Caribbean", tier: "medium" },
  { name: "Tasmania", lon: 146.8, lat: -42.0, region: "Australia & NZ", tier: "medium" },
  { name: "Sicily", lon: 14.0, lat: 37.6, region: "Mediterranean", tier: "medium" },
  { name: "Ireland", lon: -8.0, lat: 53.4, region: "Europe", tier: "medium" },
  { name: "Hokkaido", lon: 143.0, lat: 43.5, region: "East Asia", tier: "medium" },
  { name: "Hawaiʻi (Big Island)", lon: -155.5, lat: 19.6, region: "Pacific", tier: "medium" },
  { name: "Cyprus", lon: 33.2, lat: 35.1, region: "Mediterranean", tier: "medium" },
  { name: "Puerto Rico", lon: -66.5, lat: 18.2, region: "Caribbean", tier: "medium" },
  { name: "Jamaica", lon: -77.3, lat: 18.1, region: "Caribbean", tier: "medium" },
  { name: "Corsica", lon: 9.1, lat: 42.2, region: "Mediterranean", tier: "small" },
  { name: "Crete", lon: 24.8, lat: 35.2, region: "Mediterranean", tier: "small" },
  { name: "Sardinia", lon: 9.0, lat: 40.1, region: "Mediterranean", tier: "small" },
  { name: "Bali", lon: 115.2, lat: -8.4, region: "Southeast Asia", tier: "small" },
  { name: "Fiji (Viti Levu)", lon: 178.0, lat: -17.7, region: "Pacific", tier: "small" },
  { name: "Trinidad", lon: -61.3, lat: 10.5, region: "Caribbean", tier: "small" },
  { name: "Zanzibar", lon: 39.2, lat: -6.2, region: "Indian Ocean", tier: "small" },
  { name: "Guam", lon: 144.8, lat: 13.4, region: "Pacific", tier: "small" },
  { name: "Espiritu Santo (Vanuatu)", lon: 166.9, lat: -15.3, region: "Pacific", tier: "small" },
  { name: "Bermuda", lon: -64.75, lat: 32.3, region: "North Atlantic", tier: "small" },
  { name: "Malta", lon: 14.4, lat: 35.9, region: "Mediterranean", tier: "small" },
  { name: "Malé Atoll (Maldives)", lon: 73.5, lat: 4.2, region: "Indian Ocean", tier: "small" },
  { name: "Galápagos (Isabela)", lon: -91.1, lat: -0.8, region: "Pacific", tier: "small" },
  { name: "Guadalcanal (Solomon Is.)", lon: 160.15, lat: -9.6, region: "Pacific", tier: "small" },
  { name: "Mahé (Seychelles)", lon: 55.45, lat: -4.6, region: "Indian Ocean", tier: "tiny" },
  { name: "Upolu (Samoa)", lon: -171.75, lat: -13.9, region: "Pacific", tier: "tiny" },
  { name: "Tongatapu (Tonga)", lon: -175.2, lat: -21.1, region: "Pacific", tier: "tiny" },
  { name: "Koror (Palau)", lon: 134.5, lat: 7.3, region: "Pacific", tier: "tiny" },
  { name: "Majuro (Marshall Is.)", lon: 171.2, lat: 7.1, region: "Pacific", tier: "tiny" },
  { name: "Tarawa (Kiribati)", lon: 173.0, lat: 1.4, region: "Pacific", tier: "tiny" },
  { name: "Nauru", lon: 166.9, lat: -0.53, region: "Pacific", tier: "tiny" },
  { name: "Funafuti (Tuvalu)", lon: 179.2, lat: -8.5, region: "Pacific", tier: "tiny" },
  { name: "Niue", lon: -169.9, lat: -19.05, region: "Pacific", tier: "tiny" },
  { name: "Pitcairn Island", lon: -130.1, lat: -25.07, region: "Pacific", tier: "tiny" },
  { name: "Easter Island (Rapa Nui)", lon: -109.35, lat: -27.1, region: "Pacific", tier: "tiny" },
].map((isl) => Object.assign({}, isl, ISLAND_TIERS[isl.tier]));

const islandIndices = ISLANDS.map((_, i) => i);
const islandRegionOf = ISLANDS.map((isl) => isl.region);

/* Distance between two lon/lat points in kilometres (haversine). Used
   to hit-test island taps — a real-world distance threshold stays
   consistent no matter how the player has panned or zoomed. */
function haversineKm(lon1, lat1, lon2, lat2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
  modeCountriesBtn: document.getElementById("mode-countries-btn"),
  modeIslandsBtn: document.getElementById("mode-islands-btn"),
  // Landscape stats
  lsScore: document.getElementById("ls-score"),
  lsMistakes: document.getElementById("ls-mistakes"),
  lsRemaining: document.getElementById("ls-remaining"),
  lsPromptCountry: document.getElementById("ls-prompt-country"),
  lsSkipBtn: document.getElementById("skip-btn-ls"),
  lsNewGameBtn: document.getElementById("new-game-btn-ls"),
  lsPromptSection: document.getElementById("ls-prompt-section"),
  lsFindLabel: document.getElementById("ls-find-label"),
  modeCountriesBtnLs: document.getElementById("mode-countries-btn-ls"),
  modeIslandsBtnLs: document.getElementById("mode-islands-btn-ls"),
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
// Islands-mode point markers. Sits above the hit layer but is fully
// pointer-events:none (see CSS) so it never steals a tap from the map.
const markerLayer = g.append("g").attr("class", "marker-layer");

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
  // Island markers are positioned from raw projected coordinates, not
  // redrawn via `path`, so a resize invalidates them — just clear them.
  markerLayer.selectAll("*").remove();

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

// "countries" | "islands" — see setGameMode() below.
let gameMode = "countries";

function totalForMode() {
  return gameMode === "islands" ? islandIndices.length : sovereignIndices.length;
}

let game = {
  active: false,
  locked: false, // true while a turn's result is resolving/animating
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
        // Islands mode doesn't care which country shape was under the
        // tap — it scores by real-world distance to the target's point.
        if (gameMode === "islands") {
          handleIslandClick(svgPoint);
        } else {
          handleCountryClick(idx);
        }
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
  if (!game.active || game.locked) return;
  game.locked = true;
  game.mistakes++;
  if (gameMode === "islands") {
    showToast(`It was ${ISLANDS[game.targetIndex].name}`, "bad");
    revealIsland(game.targetIndex);
  } else {
    showToast(`It was ${nameOf[game.targetIndex]}`, "bad");
    revealCountry(game.targetIndex);
  }
  finishTurn(false);
}

els.newGameBtn.addEventListener("click", startGame);
els.lsNewGameBtn.addEventListener("click", startGame);
els.playAgainBtn.addEventListener("click", () => { closeResult(); startGame(); });
els.closeResultBtn.addEventListener("click", closeResult);
els.skipBtn.addEventListener("click", doSkip);
els.lsSkipBtn.addEventListener("click", doSkip);

/* ---------- Mode toggle (Countries / Islands) ---------- */

function setGameMode(mode) {
  if (mode === gameMode) return;
  gameMode = mode;

  // Switching modes mid-round would mix two different scoring systems
  // into one round, so we quietly end any in-progress round (it wasn't
  // finished, so it isn't saved to history) rather than try to carry
  // it over. The player just presses New game again.
  if (game.active) {
    game.active = false;
    game.locked = false;
    markerLayer.selectAll("*").remove();
    svg.transition().duration(400).call(zoomBehavior.transform, d3.zoomIdentity);
    syncSkipDisabled(true);
    syncPrompt(mode === "islands" ? "🏝️" : "🌍");
    syncStats();
  }

  updateModeButtons();
  if (els.lsFindLabel) els.lsFindLabel.textContent = mode === "islands" ? "Find this island" : "Find this country";
  loadHighScore();
  renderHistory();
}

function updateModeButtons() {
  const isIslands = gameMode === "islands";
  [els.modeCountriesBtn, els.modeCountriesBtnLs].forEach(b => b && b.classList.toggle("active", !isIslands));
  [els.modeIslandsBtn, els.modeIslandsBtnLs].forEach(b => b && b.classList.toggle("active", isIslands));
  [els.modeCountriesBtn, els.modeCountriesBtnLs].forEach(b => b && b.setAttribute("aria-selected", String(!isIslands)));
  [els.modeIslandsBtn, els.modeIslandsBtnLs].forEach(b => b && b.setAttribute("aria-selected", String(isIslands)));
}

if (els.modeCountriesBtn) els.modeCountriesBtn.addEventListener("click", () => setGameMode("countries"));
if (els.modeIslandsBtn) els.modeIslandsBtn.addEventListener("click", () => setGameMode("islands"));
if (els.modeCountriesBtnLs) els.modeCountriesBtnLs.addEventListener("click", () => setGameMode("countries"));
if (els.modeIslandsBtnLs) els.modeIslandsBtnLs.addEventListener("click", () => setGameMode("islands"));

function startGame() {
  if (!totalForMode()) return;

  if (gameMode === "countries") {
    assignColors();
    countryLayer.selectAll("path.country").attr("fill", d => colorForIndex(d.__colorIndex));
    const indiaIdxForRepaint = features.findIndex(f => f.properties.name === "India");
    indiaColorIndex = indiaIdxForRepaint >= 0 ? features[indiaIdxForRepaint].__colorIndex : 0;
    disputedLayer.selectAll("path.disputed-region").attr("fill", colorForIndex(indiaColorIndex));
  }
  markerLayer.selectAll("*").remove();

  game = {
    active: true,
    locked: false,
    score: 0,
    mistakes: 0,
    targetIndex: null,
    remaining: (gameMode === "islands" ? islandIndices : sovereignIndices).slice(),
    asked: [],
  };
  syncSkipDisabled(false);
  syncStats();
  pickNext();
}

function pickNext() {
  if (!game.remaining.length) { endGame("completed"); return; }

  game.locked = false;
  markerLayer.selectAll("*").remove();

  const prev = game.targetIndex;
  const groupOf = gameMode === "islands" ? islandRegionOf : continentOf;
  let pool;

  if (prev === null) {
    pool = game.remaining;
  } else {
    const sameGroup = game.remaining.filter(i => groupOf[i] === groupOf[prev]);
    const jump = Math.random() > SAME_CONTINENT_PROBABILITY || sameGroup.length === 0;
    pool = jump ? game.remaining : sameGroup;
  }

  const next = pool[Math.floor(Math.random() * pool.length)];
  game.targetIndex = next;
  game.remaining = game.remaining.filter(i => i !== next);
  game.asked.push(next);

  syncPrompt(gameMode === "islands" ? ISLANDS[next].name : nameOf[next]);
  syncStats();
}

function handleCountryClick(clickedIndex) {
  if (!game.active || game.locked) return;
  if (clickedIndex === null || clickedIndex === undefined || clickedIndex < 0) return;

  const target = game.targetIndex;
  const resolved = resolveSovereignIndex(clickedIndex);
  const isCorrect = resolved === target;
  game.locked = true;

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

/* ---------- Islands mode: click handling + reveal ----------
   There's no polygon to hit-test against, so a tap is scored purely by
   real-world distance from where the player tapped to the island's
   coordinate (see haversineKm above). This also means we don't know or
   care what the player *did* tap on — right country, wrong country,
   open ocean — only how close it was to the actual target. */

function handleIslandClick(svgPoint) {
  if (!game.active || game.locked) return;

  const t = d3.zoomTransform(svg.node());
  const projPoint = t.invert([svgPoint.x, svgPoint.y]);
  const lonlat = projection.invert(projPoint);
  if (!lonlat) return; // tapped outside the globe outline — not a real click

  const target = ISLANDS[game.targetIndex];
  const distKm = haversineKm(lonlat[0], lonlat[1], target.lon, target.lat);
  const isCorrect = distKm <= target.radiusKm;
  game.locked = true;

  if (isCorrect) {
    game.score++;
    showToast("Correct! ✓", "good");
    dropIslandMarker(target.lon, target.lat, "correct");
    finishTurn(true);
  } else {
    game.mistakes++;
    showToast(`Not quite — here's ${target.name}`, "bad");
    dropIslandMarker(lonlat[0], lonlat[1], "miss");
    revealIsland(game.targetIndex);
    finishTurn(false);
  }
}

/* Draws a small marker at a lon/lat inside the (already-zoomed) map
   group, so it tracks pan/zoom exactly like the country paths do.
   kind: "correct" (brief green pulse where the island actually is),
   "miss" (brief red X where the player actually tapped), or "target"
   (the slow, held green pulse used during a wrong/skip reveal). */
function dropIslandMarker(lon, lat, kind) {
  const p = projection([lon, lat]);
  if (!p) return;
  const [x, y] = p;

  const marker = markerLayer.append("g")
    .attr("class", `island-marker island-marker-${kind}`)
    .attr("transform", `translate(${x},${y})`);

  if (kind === "miss") {
    const s = 7;
    marker.append("line").attr("class", "island-marker-miss-line").attr("x1", -s).attr("y1", -s).attr("x2", s).attr("y2", s);
    marker.append("line").attr("class", "island-marker-miss-line").attr("x1", -s).attr("y1", s).attr("x2", s).attr("y2", -s);
    setTimeout(() => marker.remove(), 900);
    return;
  }

  // Size the marker so it reads clearly at whatever zoom it'll be seen
  // at: the destination zoom for a held "target" reveal, or the current
  // zoom for a quick "correct" flash.
  const k = kind === "target"
    ? ISLANDS[game.targetIndex].zoom
    : (d3.zoomTransform(svg.node()).k || 1);
  const r = Math.max(2.2, 9 / k);

  marker.append("circle").attr("class", "island-marker-ring").attr("r", r);
  marker.append("circle").attr("class", "island-marker-dot").attr("r", Math.max(1.4, r * 0.4));

  const life = kind === "target" ? ISLAND_REVEAL_HOLD_MS : 800;
  setTimeout(() => marker.remove(), life);
}

function revealIsland(index) {
  const target = ISLANDS[index];
  const point = projection([target.lon, target.lat]);
  if (!point) return;
  const [x, y] = point;

  dropIslandMarker(target.lon, target.lat, "target");

  const scale = Math.min(MAX_SCALE * 0.7, target.zoom);
  const tx = width / 2 - scale * x;
  const ty = height / 2 - scale * y;

  svg.transition().duration(ISLAND_REVEAL_ZOOM_MS).ease(d3.easeCubicInOut).call(
    zoomBehavior.transform,
    d3.zoomIdentity.translate(tx, ty).scale(scale)
  );
}

function finishTurn(wasCorrect) {
  syncStats();
  const isIslands = gameMode === "islands";
  const wrongHold = isIslands ? ISLAND_REVEAL_HOLD_MS : REVEAL_HOLD_MS;
  const delay = wasCorrect ? 500 : wrongHold;

  setTimeout(() => {
    if (game.mistakes >= MAX_MISTAKES) { endGame("mistakes"); return; }
    if (!game.remaining.length) { endGame("completed"); return; }
    if (!wasCorrect) {
      const backMs = isIslands ? ISLAND_SNAP_BACK_MS : 400;
      svg.transition().duration(backMs).call(zoomBehavior.transform, d3.zoomIdentity);
    }
    pickNext();
  }, delay);
}

function endGame(reason) {
  game.active = false;
  game.locked = false;
  syncSkipDisabled(true);
  const endEmoji = reason === "completed" ? "🏆" : "🏁";
  syncPrompt(endEmoji);

  saveResult(game.score, game.mistakes, totalForMode(), reason === "completed");
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
  const isIslands = gameMode === "islands";
  els.resultTitle.textContent = reason === "completed"
    ? (isIslands ? "You placed every island!" : "You placed every country!")
    : "Game over — 5 misses";
  els.resultScore.textContent = `${game.score} / ${totalForMode()}`;
  els.resultCopy.textContent = reason === "completed"
    ? (isIslands ? "Every island on the map, found. That's a full round." : "Every country on the map, found. That's a full round.")
    : "Every round sharpens your map sense. Go again?";
  els.resultOverlay.classList.add("show");
}
function closeResult() { els.resultOverlay.classList.remove("show"); }

/* ---------- Persistence ---------- */

let storageAvailable = true;
// Countries and Islands are tracked as separate high scores/history —
// they're different quizzes with different totals, so mixing them into
// one leaderboard wouldn't mean anything.
let memoryHistory = { countries: [], islands: [] };
let memoryHighScore = { countries: 0, islands: 0 };

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

function historyKey() { return gameMode === "islands" ? STORAGE_HISTORY_KEY_ISLANDS : STORAGE_HISTORY_KEY; }
function highKey() { return gameMode === "islands" ? STORAGE_HIGH_KEY_ISLANDS : STORAGE_HIGH_KEY; }

function readHistory() {
  if (!storageAvailable) return memoryHistory[gameMode];
  try { return JSON.parse(localStorage.getItem(historyKey()) || "[]"); }
  catch (err) { return memoryHistory[gameMode]; }
}

function writeHistory(history) {
  memoryHistory[gameMode] = history;
  if (!storageAvailable) return;
  try { localStorage.setItem(historyKey(), JSON.stringify(history)); }
  catch (err) { console.warn("Could not save history.", err); }
}

function readHighScore() {
  if (!storageAvailable) return memoryHighScore[gameMode];
  try { return Number(localStorage.getItem(highKey()) || 0); }
  catch (err) { return memoryHighScore[gameMode]; }
}

function writeHighScore(value) {
  memoryHighScore[gameMode] = value;
  if (!storageAvailable) return;
  try { localStorage.setItem(highKey(), String(value)); }
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
  els.highScoreOutof.textContent = `of ${totalForMode() || "—"} ${gameMode === "islands" ? "islands" : "countries"}`;
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
