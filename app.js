const DATA = {
  world: "data/countries-all-50m.json",
  france: "data/fr-departement-10m.geojson",
  us: "data/us-states-10m.geojson",
  worldBorders: "data/borders-50m.json",
  franceBorders: "data/fr-departement-borders-10m.geojson",
  usBorders: "data/us-states-borders-10m.geojson",
};

const SKIP_ADM = new Set([
  "IOA", "HMD", "NFK", "ATC",
  "MAC", "HKG",
  "FRO", "ALD",
  "SPM", "WLF", "MAF", "BLM", "PYF", "NCL", "ATF",
  "ABW", "CUW", "SXM",
  "NIU", "COK",
  "SGS", "IOT", "SHN", "PCN", "AIA", "FLK", "CYM", "BMU", "VGB", "TCA", "MSR", "JEY", "GGY", "IMN",
  "MNP", "VIR", "GUM", "ASM", "PRI",
  "ATA", "KAS", "SOL", "CYN",
]);

const RENAME = { CHN: "Chine" };

const ALIAS = {
  USA: ["usa", "us", "etats unis d amerique"],
  GBR: ["uk", "grande bretagne"],
  NLD: ["hollande"],
  CZE: ["republique tcheque"],
  MMR: ["myanmar"],
  VNM: ["vietnam"],
  ARE: ["emirats", "eau"],
  COD: ["rdc", "congo kinshasa", "zaire"],
  COG: ["congo brazzaville"],
  CAF: ["centrafrique"],
  SWZ: ["swaziland"],
  MKD: ["macedoine"],
  TLS: ["timor", "timor leste"],
  TWN: ["taiwan"],
  KOR: ["coree du sud"],
  PRK: ["coree du nord"],
  BIH: ["bosnie"],
  PNG: ["papouasie"],
  STP: ["sao tome"],
  CPV: ["cap vert"],
};

const RULES = {
  easy: "Quatre noms proposés. La forme est orientée au nord. 15 secondes par manche. 1 point si c’est le bon, 0 sinon.",
  hard: "Vous tapez le nom, des suggestions s’affichent. La forme est orientée au nord. 15 secondes par manche. 1 point ou 0.",
  hyper: "Vous tapez le nom. La forme peut être tournée dans n’importe quel sens. 15 secondes par manche. 1 point ou 0.",
};

const ROUND_TIME_MS = 15000;

const ASK = {
  world: "Quel pays est-ce ?",
  france: "Quel département est-ce ?",
  us: "Quel État est-ce ?",
};

const MAX_LINK_DEG = 13;
const MAX_FROM_MAIN_DEG = 13.2;
const MIN_PART_RATIO = 0.008;

const $ = (id) => document.getElementById(id);

const ui = {
  load: $("load-overlay"),
  loadText: $("load-text"),
  loadFill: $("load-bar-fill"),
  intro: $("intro-modal"),
  globe: $("globe"),
  rules: $("rules-note"),
  start: $("btn-start"),
  chrome: $("chrome"),
  kicker: $("round-kicker"),
  scoreLine: $("score-line"),
  historyWrap: $("history-wrap"),
  history: $("history"),
  stage: $("stage"),
  shape: $("shape"),
  shapePath: $("shape-path"),
  map: $("map"),
  mapTarget: $("map-target"),
  landFill: $("land-fill"),
  neighborCoast: $("neighbor-coast"),
  frontierLine: $("frontier-line"),
  frontierDisputed: $("frontier-disputed"),
  verdict: $("verdict"),
  verdictMark: $("verdict-mark"),
  dock: $("dock"),
  ask: $("ask"),
  askLabel: $("ask-label"),
  askHint: $("ask-hint"),
  choices: $("choices"),
  form: $("guess-form"),
  guess: $("guess"),
  suggest: $("suggest"),
  feedback: $("feedback"),
  feedbackKicker: $("feedback-kicker"),
  feedbackName: $("feedback-name"),
  feedbackDetail: $("feedback-detail"),
  next: $("btn-next"),
  skip: $("btn-skip"),
  finish: $("finish-modal"),
  finalScore: $("final-score"),
  recap: $("finish-recap"),
  replay: $("btn-replay"),
  timerBlock: $("timer-block"),
  timerFill: $("timer-fill"),
  timerValue: $("timer-value"),
  timerBar: document.querySelector("#timer-block .timer-bar"),
};

const settings = { territory: "world", length: 5, difficulty: "easy" };
let catalogs = null;
let rounds = [];
let index = 0;
let suggestItems = [];
let suggestIndex = 0;
let locked = false;

function norm(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .toLowerCase()
    .replace(/['’]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function keysFor(name, extra) {
  const keys = new Set();
  for (const raw of [name, ...(extra || [])]) {
    const spaced = norm(raw);
    if (!spaced) continue;
    keys.add(spaced);
    keys.add(spaced.replace(/ /g, ""));
  }
  return [...keys];
}

function fixRing(ring) {
  if (!ring.length) return [];
  const out = [[ring[0][0], ring[0][1]]];
  for (let i = 1; i < ring.length; i += 1) {
    let lon = ring[i][0];
    const prev = out[i - 1][0];
    while (lon - prev > 180) lon -= 360;
    while (prev - lon > 180) lon += 360;
    out.push([lon, ring[i][1]]);
  }
  return out;
}

function ringStats(ring) {
  let crossSum = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const x1 = ring[i][0];
    const y1 = ring[i][1];
    const x2 = ring[i + 1][0];
    const y2 = ring[i + 1][1];
    const cross = x1 * y2 - x2 * y1;
    crossSum += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  const area = Math.abs(crossSum) / 2;
  if (area < 1e-12) {
    let sx = 0;
    let sy = 0;
    ring.forEach((point) => {
      sx += point[0];
      sy += point[1];
    });
    return { cx: sx / ring.length, cy: sy / ring.length, area: 0 };
  }
  return { cx: cx / (3 * crossSum), cy: cy / (3 * crossSum), area };
}

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function degreeDistance(a, b) {
  const midLat = ((a.cy + b.cy) / 2) * Math.PI / 180;
  const dx = (a.cx - b.cx) * Math.cos(midLat);
  const dy = a.cy - b.cy;
  return Math.hypot(dx, dy);
}

function cluster(geometry) {
  const items = polygonsOf(geometry).map((polygon) => {
    const rings = polygon.map(fixRing).filter((ring) => ring.length >= 4);
    if (!rings.length) return null;
    const stats = ringStats(rings[0]);
    return { rings, cx: stats.cx, cy: stats.cy, area: stats.area };
  }).filter((item) => item && item.area > 0);

  if (!items.length) return [];
  items.sort((a, b) => b.area - a.area);
  const ref = items[0].cx;
  items.forEach((item) => {
    while (item.cx - ref > 180) {
      item.cx -= 360;
      item.rings = item.rings.map((ring) => ring.map(([lon, lat]) => [lon - 360, lat]));
    }
    while (ref - item.cx > 180) {
      item.cx += 360;
      item.rings = item.rings.map((ring) => ring.map(([lon, lat]) => [lon + 360, lat]));
    }
  });

  const kept = [items[0]];
  const rest = items.slice(1);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = rest.length - 1; i >= 0; i -= 1) {
      const item = rest[i];
      if (item.area < items[0].area * MIN_PART_RATIO) continue;
      if (degreeDistance(item, items[0]) > MAX_FROM_MAIN_DEG) continue;
      const near = kept.some((other) => degreeDistance(item, other) <= MAX_LINK_DEG);
      if (near) {
        kept.push(item);
        rest.splice(i, 1);
        changed = true;
      }
    }
  }
  return kept;
}

function silhouette(geometry, rotationDeg) {
  const kept = cluster(geometry);
  if (!kept.length) return null;
  let geoArea = 0;
  let points = 0;
  kept.forEach((item) => {
    geoArea += item.area;
    points += item.rings[0].length;
  });
  const polygons = kept.map((item) => item.rings);
  const [lon0, lat0] = territoryCenter(polygons);
  const projected = projectPolygons(polygons, lon0, lat0)
    .map((rings) => rings.map((ring) => ring.map(([x, y]) => [x, -y])));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  projected.forEach((polygon) => polygon.forEach((ring) => ring.forEach(([x, y]) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  })));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rad = rotationDeg * Math.PI / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);
  const rotate = ([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cosR - dy * sinR, cy + dx * sinR + dy * cosR];
  };
  const rotated = projected.map((polygon) => polygon.map((ring) => ring.map(rotate)));

  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;
  rotated.forEach((polygon) => polygon.forEach((ring) => ring.forEach(([x, y]) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  })));
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < 1e-6 || height < 1e-6) return null;
  const pad = 6;
  const avail = 100 - pad * 2;
  const scale = avail / Math.max(width, height);
  const offsetX = pad + (avail - width * scale) / 2;
  const offsetY = pad + (avail - height * scale) / 2;
  const mapPoint = ([x, y]) => [
    offsetX + (x - minX) * scale,
    offsetY + (y - minY) * scale,
  ];

  let pathArea = 0;
  const commands = [];
  rotated.forEach((polygon) => polygon.forEach((ring) => {
    pathArea += Math.abs(ringStats(ring).area);
    ring.forEach((point, i) => {
      const [x, y] = mapPoint(point);
      commands.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`);
    });
    commands.push("Z");
  }));

  return {
    d: commands.join(" "),
    points,
    geoArea,
    sig: {
      aspect: width / height,
      fill: pathArea / (width * height),
    },
  };
}

function layoutFrom(items) {
  if (!items.length) return null;
  const polygons = [];
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  items.forEach((item) => {
    polygons.push(item.rings);
    item.rings.forEach((ring) => {
      ring.forEach(([lon, lat]) => {
        minLon = Math.min(minLon, lon);
        minLat = Math.min(minLat, lat);
        maxLon = Math.max(maxLon, lon);
        maxLat = Math.max(maxLat, lat);
      });
    });
  });
  return { polygons, minLon, minLat, maxLon, maxLat };
}

function polygonItems(geometry) {
  return polygonsOf(geometry).map((polygon) => {
    const rings = polygon.map(fixRing).filter((ring) => ring.length >= 4);
    if (!rings.length) return null;
    const stats = ringStats(rings[0]);
    return stats.area > 0 ? { rings, cx: stats.cx, cy: stats.cy, area: stats.area } : null;
  }).filter(Boolean);
}

function layoutGeometry(geometry) {
  return layoutFrom(cluster(geometry));
}

function layoutAll(geometry) {
  return layoutFrom(polygonItems(geometry));
}

const CONTESTED_BORDER = new Set([
  "Disputed (please verify)",
  "Line of control (please verify)",
  "Indefinite (please verify)",
  "Indeterminant frontier",
]);

function borderLines(collection) {
  const lines = [];
  collection.features.forEach((feature) => {
    const geometry = feature.geometry;
    if (!geometry) return;
    const kind = (feature.properties && (feature.properties.FEATURECLA || feature.properties.featurecla)) || "";
    const disputed = CONTESTED_BORDER.has(kind);
    const parts = geometry.type === "LineString"
      ? [geometry.coordinates]
      : geometry.type === "MultiLineString"
        ? geometry.coordinates
        : [];
    parts.forEach((line) => {
      const pts = fixRing(line);
      if (pts.length < 2) return;
      let minLon = Infinity;
      let minLat = Infinity;
      let maxLon = -Infinity;
      let maxLat = -Infinity;
      pts.forEach(([lon, lat]) => {
        minLon = Math.min(minLon, lon);
        minLat = Math.min(minLat, lat);
        maxLon = Math.max(maxLon, lon);
        maxLat = Math.max(maxLat, lat);
      });
      lines.push({ pts, minLon, minLat, maxLon, maxLat, disputed });
    });
  });
  return lines;
}

function atlasFrom(collection, idOf) {
  const list = [];
  collection.features.forEach((feature) => {
    const id = idOf(feature);
    if (!id) return;
    const layout = layoutAll(feature.geometry);
    if (!layout) return;
    list.push({ id, layout });
  });
  return list;
}

function entity(id, name, aliases, geometry, kind) {
  const drawn = silhouette(geometry, 0);
  if (!drawn) return null;
  if (kind === "world" && (drawn.points < 40 || drawn.geoArea < 0.05)) return null;
  if (kind !== "world" && drawn.points < 12) return null;
  return {
    id,
    name,
    keys: keysFor(name, aliases),
    geometry,
    sig: drawn.sig,
  };
}

function worldEntities(collection) {
  const list = [];
  collection.features.forEach((feature) => {
    const props = feature.properties || {};
    const id = props.ADM0_A3;
    if (!id || SKIP_ADM.has(id)) return;
    const sourceName = props.NAME_FR || props.NAME;
    const name = RENAME[id] || sourceName;
    const aliases = [...(ALIAS[id] || [])];
    if (sourceName && sourceName !== name) aliases.push(sourceName);
    const item = entity(id, name, aliases, feature.geometry, "world");
    if (item) list.push(item);
  });
  return list;
}

function franceEntities(collection) {
  return collection.features.map((feature) => {
    const props = feature.properties || {};
    const name = props.name_fr || props.name;
    const aliases = [];
    if (props.name && props.name !== name) aliases.push(props.name);
    if (name === "Réunion") aliases.push("La Réunion");
    return entity(props.iso_3166_2 || name, name, aliases, feature.geometry, "france");
  }).filter(Boolean);
}

function usEntities(collection) {
  return collection.features.map((feature) => {
    const props = feature.properties || {};
    if (props.type === "Federal District" || props.iso_3166_2 === "US-DC") return null;
    let name = props.name_fr || props.name;
    name = name.replace(/^État de /, "").replace(/^Etat de /, "");
    const aliases = [];
    if (props.name && norm(props.name) !== norm(name)) aliases.push(props.name);
    if (props.name_fr && norm(props.name_fr) !== norm(name)) aliases.push(props.name_fr);
    return entity(props.iso_3166_2 || name, name, aliases, feature.geometry, "us");
  }).filter(Boolean);
}

function shuffle(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sigDistance(a, b) {
  return Math.abs(Math.log(a.aspect) - Math.log(b.aspect)) + Math.abs(a.fill - b.fill) * 0.85;
}

function distractors(answer, pool) {
  const ranked = pool
    .filter((item) => item.id !== answer.id)
    .map((item) => ({ item, distance: sigDistance(answer.sig, item.sig) }))
    .sort((a, b) => a.distance - b.distance);
  return shuffle(ranked.slice(0, Math.min(12, ranked.length))).slice(0, 3).map((row) => row.item);
}

function tilt() {
  return 30 + Math.random() * 300;
}

function setPressed(selector, attr, value) {
  document.querySelectorAll(selector).forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset[attr] === value ? "true" : "false");
  });
}

function pointsSoFar() {
  return rounds.reduce((sum, round) => sum + (round.points || 0), 0);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function renderHistory() {
  const items = rounds
    .filter((round) => round.points !== null)
    .map((round) => {
      const miss = round.points === 0 ? " is-miss" : "";
      return `<li><span>${escapeHtml(round.entity.name)}</span><span class="score-num${miss}">${round.points}</span></li>`;
    });
  const total = pointsSoFar();
  const played = rounds.filter((round) => round.points !== null).length;
  ui.historyWrap.hidden = played === 0;
  if (played) {
    items.push(`<li class="score-history-total"><span>Score</span><span class="score-num">${total}</span></li>`);
  }
  ui.history.innerHTML = items.join("");
}

function showSuggestions(items) {
  suggestItems = items;
  suggestIndex = 0;
  if (!items.length) {
    ui.suggest.hidden = true;
    ui.suggest.innerHTML = "";
    return;
  }
  ui.suggest.innerHTML = items.map((item, i) => (
    `<li role="option" data-i="${i}" class="${i === 0 ? "is-active" : ""}">${item.name}</li>`
  )).join("");
  ui.suggest.hidden = false;
}

function moveSuggestion(delta) {
  if (!suggestItems.length) return;
  suggestIndex = (suggestIndex + delta + suggestItems.length) % suggestItems.length;
  [...ui.suggest.children].forEach((li, i) => li.classList.toggle("is-active", i === suggestIndex));
  ui.suggest.children[suggestIndex].scrollIntoView({ block: "nearest" });
}

function suggestionsFor(query) {
  const q = norm(query);
  const tight = q.replace(/ /g, "");
  if (tight.length < 1) return [];
  const pool = catalogs[settings.territory];
  const tokens = q.split(" ").filter(Boolean);
  const hits = pool.filter((item) => item.keys.some((key) => {
    if (key.includes(" ")) return tokens.every((token) => key.includes(token));
    return tight.length >= 2 && key.includes(tight);
  }));
  hits.sort((a, b) => {
    const aStart = norm(a.name).startsWith(q) ? 0 : 1;
    const bStart = norm(b.name).startsWith(q) ? 0 : 1;
    return aStart - bStart || a.name.length - b.name.length || a.name.localeCompare(b.name, "fr");
  });
  return hits.slice(0, 7);
}

function resolveGuess(query) {
  const q = norm(query);
  const tight = q.replace(/ /g, "");
  if (!q) return null;
  const pool = catalogs[settings.territory];
  const hits = pool.filter((item) => item.keys.includes(q) || item.keys.includes(tight));
  if (hits.length === 1) return hits[0];
  return null;
}

let spinFrame = 0;
let verdictFrame = 0;
let verdictTimer = 0;
let fitFrame = 0;
let fullHeight = window.innerHeight;
let timerFrame = 0;
let roundEndsAt = 0;

function stopRoundTimer() {
  cancelAnimationFrame(timerFrame);
  timerFrame = 0;
  ui.timerBlock.hidden = true;
}

function startRoundTimer() {
  stopRoundTimer();
  roundEndsAt = Date.now() + ROUND_TIME_MS;
  ui.timerBlock.hidden = false;
  ui.timerFill.style.width = "100%";
  ui.timerBar.setAttribute("aria-valuenow", "100");
  ui.timerValue.textContent = `${Math.round(ROUND_TIME_MS / 1000)} s`;
  tickRoundTimer();
}

function tickRoundTimer() {
  if (locked) return;
  const left = roundEndsAt - Date.now();
  if (left <= 0) {
    submit(null, "", true);
    return;
  }
  const pct = Math.max(0, Math.min(100, (left / ROUND_TIME_MS) * 100));
  ui.timerFill.style.width = `${pct}%`;
  ui.timerBar.setAttribute("aria-valuenow", String(Math.round(pct)));
  ui.timerValue.textContent = `${Math.max(0, Math.ceil(left / 1000))} s`;
  timerFrame = requestAnimationFrame(tickRoundTimer);
}

function shiftLon(lon, ref) {
  let next = lon;
  while (next - ref > 180) next -= 360;
  while (ref - next > 180) next += 360;
  return next;
}

function shiftPolygons(polygons, ref) {
  return polygons.map((rings) => {
    if (!rings.length || !rings[0].length) return [];
    const delta = shiftLon(rings[0][0][0], ref) - rings[0][0][0];
    return rings.map((ring) => ring.map(([lon, lat]) => [lon + delta, lat]));
  });
}

function boundsOf(rings) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  rings.forEach((ring) => {
    ring.forEach(([lon, lat]) => {
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    });
  });
  return { minLon, minLat, maxLon, maxLat };
}

let cachedSafeBottom = null;

function safeBottomInset() {
  if (cachedSafeBottom === null) cachedSafeBottom = safeInset("bottom");
  return cachedSafeBottom;
}

function safeInset(side) {
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  if (side === "left" || side === "right") probe.style.width = `env(safe-area-inset-${side})`;
  else probe.style.height = `env(safe-area-inset-${side})`;
  document.body.append(probe);
  const value = side === "left" || side === "right" ? probe.offsetWidth : probe.offsetHeight;
  probe.remove();
  return value || 0;
}

function slotFromCss() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const compact = window.matchMedia("(max-width: 720px)").matches;
  const padTop = (compact ? 78 : 72) + safeInset("top");
  const padBottom = (compact ? 230 : 210) + safeInset("bottom");
  const padX = compact ? 16 : 24;
  const size = compact
    ? Math.min(height * 0.46, width * 0.78, 420)
    : Math.min(height * 0.58, width * 0.58, 560);
  return {
    left: padX + (width - padX * 2 - size) / 2,
    top: padTop + (height - padTop - padBottom - size) / 2,
    size,
  };
}

function silhouetteSlot() {
  if (!ui.shape.classList.contains("is-context")) {
    const rect = ui.shape.getBoundingClientRect();
    if (rect.width > 1) return { left: rect.left, top: rect.top, size: rect.width };
  }
  return slotFromCss();
}

function toSphere(lon, lat, lon0, lat0) {
  const lambda = (lon - lon0) * Math.PI / 180;
  const phi = lat * Math.PI / 180;
  const phi0 = lat0 * Math.PI / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  return [
    cosPhi * Math.sin(lambda),
    Math.cos(phi0) * sinPhi - Math.sin(phi0) * cosPhi * Math.cos(lambda),
    Math.sin(phi0) * sinPhi + Math.cos(phi0) * cosPhi * Math.cos(lambda),
  ];
}

function inverseOrtho(x, y, lon0, lat0) {
  const rho2 = x * x + y * y;
  if (rho2 > 1) return null;
  const rho = Math.sqrt(rho2);
  if (rho < 1e-12) return [lon0, lat0];
  const c = Math.asin(Math.min(1, rho));
  const phi0 = lat0 * Math.PI / 180;
  const lambda0 = lon0 * Math.PI / 180;
  const phi = Math.asin(Math.cos(c) * Math.sin(phi0) + (y * Math.sin(c) * Math.cos(phi0)) / rho);
  const lambda = lambda0 + Math.atan2(
    x * Math.sin(c),
    rho * Math.cos(c) * Math.cos(phi0) - y * Math.sin(c) * Math.sin(phi0),
  );
  return [lambda * 180 / Math.PI, phi * 180 / Math.PI];
}

function territoryCenter(polygons) {
  const box = boundsOf(polygons.flat());
  let lon0 = (box.minLon + box.maxLon) / 2;
  let lat0 = (box.minLat + box.maxLat) / 2;
  for (let pass = 0; pass < 2; pass += 1) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    polygons.forEach((rings) => {
      if (!rings.length || !rings[0].length) return;
      const delta = shiftLon(rings[0][0][0], lon0) - rings[0][0][0];
      rings.forEach((ring) => ring.forEach(([lon, lat]) => {
        const point = toSphere(lon + delta, lat, lon0, lat0);
        if (point[2] <= 0) return;
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
      }));
    });
    if (!Number.isFinite(minX)) break;
    const next = inverseOrtho((minX + maxX) / 2, (minY + maxY) / 2, lon0, lat0);
    if (!next) break;
    lon0 = next[0];
    lat0 = next[1];
  }
  return [lon0, lat0];
}

function horizonPoint(a, b) {
  const dz = a[2] - b[2];
  const t = Math.abs(dz) < 1e-12 ? 0 : a[2] / dz;
  const x = a[0] + (b[0] - a[0]) * t;
  const y = a[1] + (b[1] - a[1]) * t;
  const len = Math.hypot(x, y) || 1;
  return [x / len, y / len, 0];
}

function horizonArc(a, b) {
  const start = Math.atan2(a[1], a[0]);
  let delta = Math.atan2(b[1], b[0]) - start;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const steps = Math.ceil(Math.abs(delta) / (Math.PI / 30));
  if (steps <= 1) return [];
  const arc = [];
  for (let step = 1; step < steps; step += 1) {
    const angle = start + (delta * step) / steps;
    arc.push([Math.cos(angle), Math.sin(angle)]);
  }
  return arc;
}

function clipFront(sphere) {
  if (sphere.length < 2) return [];
  const visible = (point) => point[2] >= -1e-8;
  const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  const pieces = [];
  let current = null;
  const closePiece = () => {
    if (current && current.length) pieces.push(current);
    current = null;
  };
  for (let i = 1; i < sphere.length; i += 1) {
    const a = sphere[i - 1];
    const b = sphere[i];
    const frontA = visible(a);
    const frontB = visible(b);
    if (frontA && frontB) {
      if (!current) current = [a];
      current.push(b);
    } else if (frontA) {
      if (!current) current = [a];
      current.push(horizonPoint(a, b));
      closePiece();
    } else if (frontB) {
      current = [horizonPoint(a, b), b];
    }
  }
  if (current && pieces.length && same(current[current.length - 1], pieces[0][0])) {
    pieces[0] = current.concat(pieces[0].slice(1));
    current = null;
  }
  if (current) pieces.push(current);
  if (!pieces.length) return [];
  if (pieces.length === 1 && same(pieces[0][0], pieces[0][pieces[0].length - 1])) {
    return [pieces[0].map((point) => [point[0], point[1]])];
  }
  const ring = [];
  pieces.forEach((piece, index) => {
    piece.forEach((point) => ring.push([point[0], point[1]]));
    const next = pieces[(index + 1) % pieces.length];
    horizonArc(piece[piece.length - 1], next[0]).forEach((point) => ring.push(point));
  });
  if (ring.length >= 3) ring.push(ring[0]);
  return ring.length >= 4 ? [ring] : [];
}

function projectPolygons(polygons, lon0, lat0) {
  const projected = [];
  polygons.forEach((rings) => {
    if (!rings.length || !rings[0].length) return;
    const delta = shiftLon(rings[0][0][0], lon0) - rings[0][0][0];
    const visible = [];
    rings.forEach((ring) => {
      const sphere = ring.map(([lon, lat]) => toSphere(lon + delta, lat, lon0, lat0));
      clipFront(sphere).forEach((part) => visible.push(part));
    });
    if (visible.length) projected.push(visible);
  });
  return projected;
}

function boundsXY(rings) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  rings.forEach((ring) => ring.forEach(([x, y]) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }));
  return { minX, minY, maxX, maxY };
}

function pathFromXY(rings, mapPoint, digits) {
  const commands = [];
  rings.forEach((ring) => {
    if (ring.length < 2) return;
    ring.forEach((point, index) => {
      const [x, y] = mapPoint(point[0], point[1]);
      commands.push(`${index === 0 ? "M" : "L"}${x.toFixed(digits)} ${y.toFixed(digits)}`);
    });
    commands.push("Z");
  });
  return commands.join("");
}

function boxNear(box, lon0, lat0, reach2) {
  const lon = Math.max(box.minLon, Math.min(lon0, box.maxLon));
  const lat = Math.max(box.minLat, Math.min(lat0, box.maxLat));
  const point = toSphere(lon, lat, lon0, lat0);
  if (point[2] <= 0) return false;
  return point[0] * point[0] + point[1] * point[1] <= reach2;
}

function frontSegment(a, b, lon0, lat0) {
  const start = toSphere(a[0], a[1], lon0, lat0);
  const end = toSphere(b[0], b[1], lon0, lat0);
  if (start[2] >= -1e-8 && end[2] >= -1e-8) return [start, end];
  if (start[2] < -1e-8 && end[2] < -1e-8) return null;
  const hit = horizonPoint(start, end);
  return start[2] >= -1e-8 ? [start, hit] : [hit, end];
}

function edgeKey(start, end) {
  const a = `${Math.round(start[0] * 1000)},${Math.round(start[1] * 1000)}`;
  const b = `${Math.round(end[0] * 1000)},${Math.round(end[1] * 1000)}`;
  if (a === b) return null;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function segmentIsJump(a, b) {
  const mid = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const dx = (a[0] - b[0]) * Math.cos(mid);
  const dy = a[1] - b[1];
  return dx * dx + dy * dy > 100;
}

function strokeCommands(segments, lon0, lat0, mapPoint) {
  const commands = [];
  segments.forEach((line) => {
    const piece = frontSegment(line[0], line[1], lon0, lat0);
    if (!piece) return;
    const [x1, y1] = mapPoint(piece[0][0], piece[0][1]);
    const [x2, y2] = mapPoint(piece[1][0], piece[1][1]);
    commands.push(`M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`);
  });
  return commands.join("");
}

function coastCommands(polygons, lon0, lat0, mapPoint) {
  const counts = new Map();
  const lines = new Map();
  polygons.forEach((rings) => {
    rings.forEach((ring) => {
      for (let i = 1; i < ring.length; i += 1) {
        if (segmentIsJump(ring[i - 1], ring[i])) continue;
        const key = edgeKey(ring[i - 1], ring[i]);
        if (!key) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
        if (!lines.has(key)) lines.set(key, [ring[i - 1], ring[i]]);
      }
    });
  });
  const coasts = [];
  lines.forEach((line, key) => {
    if (counts.get(key) === 1) coasts.push(line);
  });
  return strokeCommands(coasts, lon0, lat0, mapPoint);
}

function lineCommands(lines, lon0, lat0, mapPoint) {
  const segments = [];
  lines.forEach((line) => {
    for (let i = 1; i < line.length; i += 1) {
      if (!segmentIsJump(line[i - 1], line[i])) segments.push([line[i - 1], line[i]]);
    }
  });
  return strokeCommands(segments, lon0, lat0, mapPoint);
}

function drawSolo(round, rotation) {
  const drawn = silhouette(round.entity.geometry, rotation);
  ui.shape.setAttribute("viewBox", "0 0 100 100");
  ui.shape.setAttribute("preserveAspectRatio", "xMidYMid meet");
  ui.shapePath.setAttribute("d", drawn ? drawn.d : "");
  ui.shapePath.classList.toggle("is-wrong", round.points === 0);
  ui.stage.classList.add("is-instant");
  ui.stage.classList.remove("is-solution");
  document.body.classList.remove("is-solution");
  ui.landFill.setAttribute("d", "");
  ui.neighborCoast.setAttribute("d", "");
  ui.frontierLine.setAttribute("d", "");
  ui.frontierDisputed.setAttribute("d", "");
  ui.mapTarget.setAttribute("d", "");
  void ui.stage.offsetWidth;
  ui.stage.classList.remove("is-instant");
}

function visiblePolygons(atlas, lon0, lat0, reach2, skipId) {
  const polygons = [];
  atlas.forEach((item) => {
    if (item.id === skipId) return;
    shiftPolygons(item.layout.polygons, lon0).forEach((rings) => {
      if (!rings.length || !rings[0].length) return;
      if (!boxNear(boundsOf(rings), lon0, lat0, reach2)) return;
      polygons.push(rings);
    });
  });
  return polygons;
}

function drawContext(round) {
  const kind = settings.territory;
  const layout = layoutGeometry(round.entity.geometry);
  if (!layout) {
    drawSolo(round, 0);
    return;
  }
  const view = {
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight),
  };
  const slot = silhouetteSlot();
  const [lon0, lat0] = territoryCenter(layout.polygons);
  const target = projectPolygons(layout.polygons, lon0, lat0);
  const targetBox = boundsXY(target.flat());
  const geoW = targetBox.maxX - targetBox.minX;
  const geoH = targetBox.maxY - targetBox.minY;
  if (!(geoW > 1e-6) || !(geoH > 1e-6)) {
    drawSolo(round, 0);
    return;
  }
  const scale = (slot.size * 0.88) / Math.max(geoW, geoH);
  const midX = (targetBox.minX + targetBox.maxX) / 2;
  const midY = (targetBox.minY + targetBox.maxY) / 2;
  const centerX = slot.left + slot.size / 2;
  const centerY = slot.top + slot.size / 2;
  const mapPoint = (x, y) => [
    centerX + (x - midX) * scale,
    centerY - (y - midY) * scale,
  ];
  const viewXY = {
    minX: midX + (0 - centerX) / scale,
    maxX: midX + (view.width - centerX) / scale,
    minY: midY - (view.height - centerY) / scale,
    maxY: midY - (0 - centerY) / scale,
  };
  const reach2 = Math.max(
    viewXY.minX * viewXY.minX + viewXY.minY * viewXY.minY,
    viewXY.minX * viewXY.minX + viewXY.maxY * viewXY.maxY,
    viewXY.maxX * viewXY.maxX + viewXY.minY * viewXY.minY,
    viewXY.maxX * viewXY.maxX + viewXY.maxY * viewXY.maxY,
  ) + 0.04;
  const polygons = visiblePolygons(catalogs.atlas[kind], lon0, lat0, reach2);
  const coastPolygons = polygons.slice();
  if (kind !== "world") {
    const abroad = visiblePolygons(
      catalogs.atlas.world,
      lon0,
      lat0,
      reach2,
      kind === "france" ? "FRA" : "USA",
    );
    polygons.push(...abroad);
    coastPolygons.push(...abroad);
  }
  const landRings = [];
  polygons.forEach((rings) => {
    projectPolygons([rings], lon0, lat0).forEach((projected) => {
      projected.forEach((ring) => landRings.push(ring));
    });
  });
  const solid = [];
  const disputed = [];
  const borderSets = [catalogs.borders[kind]];
  if (kind !== "world") borderSets.push(catalogs.borders.world);
  borderSets.forEach((borders) => borders.forEach((line) => {
    if (!line.pts.length) return;
    const delta = shiftLon(line.pts[0][0], lon0) - line.pts[0][0];
    const shifted = line.pts.map(([lon, lat]) => [lon + delta, lat]);
    if (!boxNear(boundsOf([shifted]), lon0, lat0, reach2)) return;
    if (line.disputed) disputed.push(shifted);
    else solid.push(shifted);
  }));
  ui.map.setAttribute("viewBox", `0 0 ${view.width} ${view.height}`);
  ui.map.setAttribute("preserveAspectRatio", "none");
  ui.landFill.setAttribute("d", pathFromXY(landRings, mapPoint, 1));
  ui.neighborCoast.setAttribute("d", coastCommands(coastPolygons, lon0, lat0, mapPoint));
  ui.frontierLine.setAttribute("d", lineCommands(solid, lon0, lat0, mapPoint));
  ui.frontierDisputed.setAttribute("d", lineCommands(disputed, lon0, lat0, mapPoint));
  ui.mapTarget.setAttribute("d", pathFromXY(target.flat(), mapPoint, 1));
  ui.stage.classList.add("is-solution");
  document.body.classList.add("is-solution");
}

function draw(round, rotation = round.rotation) {
  if (round.showContext) drawContext(round);
  else drawSolo(round, rotation);
}

function clearVerdict() {
  cancelAnimationFrame(verdictFrame);
  window.clearTimeout(verdictTimer);
  if (ui.verdictMark) {
    ui.verdictMark.hidden = true;
    ui.verdictMark.textContent = "";
  }
  const canvas = ui.verdict;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function fitPlayfield() {
  const vv = window.visualViewport;
  const top = vv ? vv.offsetTop : 0;
  const height = vv ? vv.height : window.innerHeight;
  const width = vv ? vv.width : window.innerWidth;
  const root = document.documentElement;
  const focused = document.activeElement === ui.guess;
  const shrunk = fullHeight - height > 120;
  const keyboard = shrunk && (focused || root.classList.contains("is-keyboard"));
  if (!keyboard) fullHeight = Math.max(window.innerHeight, height);
  root.classList.toggle("is-keyboard", keyboard);
  root.style.setProperty("--vv-top", `${top}px`);
  root.style.setProperty("--vv-height", `${height}px`);
  const dockH = ui.dock && !ui.dock.hidden ? ui.dock.offsetHeight : 0;
  root.style.setProperty("--dock-h", `${dockH}px`);
  const chromeBottom = ui.chrome && !ui.chrome.hidden ? ui.chrome.getBoundingClientRect().bottom : top;
  const gap = window.matchMedia("(max-width: 720px)").matches ? 18 + safeBottomInset() : 30;
  const room = Math.max(88, Math.min(width - 32, top + height - dockH - gap - Math.max(top, chromeBottom) - 8));
  root.style.setProperty("--shape-room", `${Math.round(room)}px`);
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
}

function scheduleFit() {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(fitPlayfield);
}

function whenKeyboardSettled(done) {
  const vv = window.visualViewport;
  const visible = () => (vv ? vv.height : window.innerHeight);
  if (fullHeight - visible() < 120) {
    fitPlayfield();
    done();
    return;
  }
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (vv) vv.removeEventListener("resize", onResize);
    fitPlayfield();
    done();
  };
  const onResize = () => {
    if (fullHeight - visible() < 80) finish();
  };
  if (vv) vv.addEventListener("resize", onResize);
  window.setTimeout(finish, 420);
}

function bindViewport() {
  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener("resize", scheduleFit);
    vv.addEventListener("scroll", scheduleFit);
  }
  window.addEventListener("orientationchange", scheduleFit);
  if (ui.dock && "ResizeObserver" in window) new ResizeObserver(scheduleFit).observe(ui.dock);
  ui.guess.addEventListener("focus", () => {
    window.scrollTo(0, 0);
    scheduleFit();
  });
  scheduleFit();
}

function playVerdict(correct) {
  clearVerdict();
  const canvas = ui.verdict;
  if (!canvas) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.left = "0px";
  canvas.style.top = "0px";
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const shapeRect = ui.shape.getBoundingClientRect();
  const originX = shapeRect.width > 1 ? shapeRect.left + shapeRect.width / 2 : width / 2;
  const originY = shapeRect.height > 1 ? shapeRect.top + shapeRect.height / 2 : height * 0.36;
  const colors = correct
    ? ["#c23b33", "#8d241e", "#1c1915", "#e4c56a"]
    : ["#c23b33", "#8d241e"];
  const pieces = [];
  const count = correct ? 86 : 26;
  for (let i = 0; i < count; i += 1) {
    const angle = correct
      ? Math.random() * Math.PI * 2
      : Math.PI * (0.15 + Math.random() * 0.7);
    const speed = correct ? 220 + Math.random() * 640 : 80 + Math.random() * 280;
    pieces.push({
      x: originX + (Math.random() - 0.5) * 24,
      y: originY + (Math.random() - 0.5) * 16,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (correct ? 80 : 0),
      spin: Math.random() * Math.PI,
      spinV: (Math.random() - 0.5) * 10,
      size: correct ? 4 + Math.random() * 8 : 5 + Math.random() * 11,
      shape: Math.floor(Math.random() * 3),
      color: colors[Math.floor(Math.random() * colors.length)],
      drag: correct ? 0.985 : 0.97,
    });
  }
  const paintPiece = (piece) => {
    ctx.save();
    ctx.translate(piece.x, piece.y);
    ctx.rotate(piece.spin);
    ctx.fillStyle = piece.color;
    const s = piece.size;
    ctx.beginPath();
    if (!correct || piece.shape === 2) {
      ctx.arc(0, 0, s * 0.55, 0, Math.PI * 2);
    } else if (piece.shape === 0) {
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.55, 0);
      ctx.lineTo(0, s);
      ctx.lineTo(-s * 0.55, 0);
      ctx.closePath();
    } else {
      for (let k = 0; k < 8; k += 1) {
        const a = (k / 8) * Math.PI * 2 - Math.PI / 2;
        const rad = k % 2 ? s * 0.38 : s;
        if (k === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
        else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  };
  const paintMark = (scale, rotation, alpha) => {
    const mark = ui.verdictMark;
    if (!mark) return;
    mark.hidden = false;
    mark.textContent = correct ? "✅" : "❌";
    mark.style.left = `${originX}px`;
    mark.style.top = `${originY}px`;
    mark.style.opacity = String(alpha);
    mark.style.transform = `translate(-50%, -50%) rotate(${rotation}rad) scale(${scale})`;
  };
  const drawAt = (t) => {
    ctx.clearRect(0, 0, width, height);
    const flash = Math.max(0, 1 - t / 0.28);
    if (flash > 0) {
      ctx.fillStyle = correct
        ? `rgba(228, 197, 106, ${0.28 * flash})`
        : `rgba(194, 59, 51, ${0.16 * flash})`;
      ctx.fillRect(0, 0, width, height);
    }
    if (correct) {
      const ring = Math.min(1, t / 0.7);
      ctx.strokeStyle = `rgba(194, 59, 51, ${0.55 * (1 - ring)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(originX, originY, 28 + ring * 260, 0, Math.PI * 2);
      ctx.stroke();
    }
    const fade = t < 1.05 ? 1 : Math.max(0, 1 - (t - 1.05) / 0.45);
    ctx.globalAlpha = fade;
    pieces.forEach((piece) => {
      paintPiece(piece);
      piece.x += piece.vx / 60;
      piece.y += piece.vy / 60;
      piece.vy += correct ? 28 : 18;
      piece.vx *= piece.drag;
      piece.spin += piece.spinV / 60;
    });
    const pop = Math.min(1, t / 0.22);
    const settle = 1 + Math.sin(Math.min(1, t / 0.45) * Math.PI) * (correct ? 0.08 : 0);
    const slam = correct ? 0.72 + pop * 0.28 : 1.35 - pop * 0.35;
    paintMark(slam * settle, correct ? 0 : (-0.22 + pop * 0.14), fade);
    ctx.globalAlpha = 1;
  };
  if (reduce) {
    drawAt(0.45);
    verdictTimer = window.setTimeout(clearVerdict, 700);
    return;
  }
  const start = performance.now();
  const tick = (now) => {
    const t = (now - start) / 1000;
    if (t >= 1.55) {
      clearVerdict();
      return;
    }
    drawAt(t);
    verdictFrame = requestAnimationFrame(tick);
  };
  verdictFrame = requestAnimationFrame(tick);
}

function revealContext(round) {
  round.rotation = 0;
  round.showContext = true;
  draw(round, 0);
}

function settleNorth(round) {
  cancelAnimationFrame(spinFrame);
  const from = round.rotation;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!from || reduce) {
    revealContext(round);
    return;
  }
  const delta = from > 180 ? 360 - from : -from;
  const duration = 720;
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    if (t < 1) {
      drawSolo(round, from + delta * eased);
      spinFrame = requestAnimationFrame(tick);
      return;
    }
    revealContext(round);
  };
  spinFrame = requestAnimationFrame(tick);
}

function renderRound() {
  cancelAnimationFrame(spinFrame);
  const round = rounds[index];
  locked = false;
  clearVerdict();
  ui.feedback.classList.remove("is-hit", "is-miss");
  ui.kicker.textContent = `Manche ${index + 1} / ${rounds.length}`;
  ui.scoreLine.textContent = `Score ${pointsSoFar()}`;
  ui.askLabel.textContent = ASK[settings.territory];
  ui.askHint.hidden = settings.difficulty !== "hyper";
  ui.ask.hidden = false;
  ui.feedback.hidden = true;
  ui.shapePath.classList.remove("is-wrong");
  draw(round);

  if (settings.difficulty === "easy") {
    ui.form.hidden = true;
    ui.choices.hidden = false;
    ui.choices.innerHTML = "";
    round.choices.forEach((choice, choiceIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice";
      button.textContent = choice.name;
      button.addEventListener("click", () => submit(choice, choice.name));
      ui.choices.append(button);
      if (choiceIndex < 9) button.dataset.key = String(choiceIndex + 1);
    });
  } else {
    ui.choices.hidden = true;
    ui.choices.innerHTML = "";
    ui.form.hidden = false;
    ui.guess.value = "";
    ui.guess.disabled = false;
    showSuggestions([]);
    ui.guess.focus();
  }
  renderHistory();
  startRoundTimer();
}

function submit(entityGuess, typed, timedOut = false, skipped = false) {
  if (locked) return;
  stopRoundTimer();
  const round = rounds[index];
  locked = true;
  const correct = !timedOut && !skipped && entityGuess && entityGuess.id === round.entity.id;
  round.points = correct ? 1 : 0;
  round.typed = typed;
  round.timedOut = timedOut;
  round.skipped = skipped;
  ui.scoreLine.textContent = `Score ${pointsSoFar()}`;
  ui.ask.hidden = true;
  ui.feedback.hidden = false;
  ui.feedback.classList.toggle("is-hit", correct);
  ui.feedback.classList.toggle("is-miss", !correct);
  ui.feedbackKicker.textContent = skipped ? "Manche passée" : (timedOut ? "Temps écoulé" : (correct ? "Bonne réponse" : "Raté"));
  ui.feedbackName.textContent = round.entity.name;
  if (correct) {
    ui.feedbackDetail.textContent = "1 point.";
  } else if (skipped || timedOut) {
    ui.feedbackDetail.textContent = "0 point.";
  } else if (typed) {
    ui.feedbackDetail.textContent = `0 point. Vous aviez dit : ${typed}.`;
  } else {
    ui.feedbackDetail.textContent = "0 point.";
  }
  ui.next.textContent = index === rounds.length - 1 ? "Voir le score" : "Manche suivante";
  playVerdict(correct);
  ui.guess.blur();
  whenKeyboardSettled(() => {
    if (settings.difficulty === "hyper" && round.rotation) settleNorth(round);
    else revealContext(round);
    ui.next.focus({ preventScroll: true });
  });
  renderHistory();
}

function finish() {
  stopRoundTimer();
  clearVerdict();
  const total = pointsSoFar();
  ui.dock.hidden = true;
  ui.finalScore.textContent = `${total} / ${rounds.length}`;
  ui.recap.innerHTML = rounds.map((round) => {
    const miss = round.points === 0;
    const detail = round.skipped
      ? `<p class="finish-recap-detail">Manche passée.</p>`
      : (round.timedOut
      ? `<p class="finish-recap-detail">Temps écoulé.</p>`
      : (miss && round.typed
        ? `<p class="finish-recap-detail">Vous aviez dit : ${escapeHtml(round.typed)}</p>`
        : ""));
    return `<li>
      <p class="finish-recap-name">${escapeHtml(round.entity.name)}</p>
      <p class="finish-recap-score${miss ? " is-miss" : ""}">${round.points}</p>
      ${detail}
    </li>`;
  }).join("");
  ui.finish.hidden = false;
}

function startGame() {
  const pool = catalogs[settings.territory];
  const picked = shuffle(pool).slice(0, settings.length);
  rounds = picked.map((item) => ({
    entity: item,
    rotation: settings.difficulty === "hyper" ? tilt() : 0,
    choices: settings.difficulty === "easy" ? shuffle([item, ...distractors(item, pool)]) : null,
    points: null,
    typed: "",
    timedOut: false,
    skipped: false,
  }));
  index = 0;
  stopGlobe();
  ui.intro.hidden = true;
  ui.finish.hidden = true;
  ui.chrome.hidden = false;
  ui.historyWrap.hidden = false;
  ui.stage.hidden = false;
  ui.dock.hidden = false;
  renderRound();
}

function bindSettings() {
  document.querySelectorAll("[data-territory]").forEach((button) => {
    button.addEventListener("click", () => {
      settings.territory = button.dataset.territory;
      setPressed("[data-territory]", "territory", settings.territory);
    });
  });
  document.querySelectorAll("[data-length]").forEach((button) => {
    button.addEventListener("click", () => {
      settings.length = Number(button.dataset.length);
      setPressed("[data-length]", "length", String(settings.length));
    });
  });
  document.querySelectorAll("[data-difficulty]").forEach((button) => {
    button.addEventListener("click", () => {
      settings.difficulty = button.dataset.difficulty;
      setPressed("[data-difficulty]", "difficulty", settings.difficulty);
      ui.rules.textContent = RULES[settings.difficulty];
    });
  });
  ui.rules.textContent = RULES[settings.difficulty];
  ui.start.addEventListener("click", startGame);
  ui.skip.addEventListener("click", () => submit(null, "", false, true));
  ui.next.addEventListener("click", () => {
    if (index >= rounds.length - 1) finish();
    else {
      index += 1;
      renderRound();
    }
  });
  ui.replay.addEventListener("click", () => {
    stopRoundTimer();
    cancelAnimationFrame(spinFrame);
    clearVerdict();
    ui.finish.hidden = true;
    ui.chrome.hidden = true;
    ui.historyWrap.hidden = true;
    ui.stage.hidden = true;
    ui.dock.hidden = true;
    ui.intro.hidden = false;
    startGlobe();
  });
  ui.form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (locked) return;
    const typed = ui.guess.value.trim();
    const resolved = resolveGuess(typed);
    if (resolved) submit(resolved, resolved.name);
    else if (!ui.suggest.hidden && suggestItems[suggestIndex]) submit(suggestItems[suggestIndex], suggestItems[suggestIndex].name);
    else if (typed) submit(null, typed);
  });
  ui.guess.addEventListener("input", () => {
    showSuggestions(suggestionsFor(ui.guess.value));
  });
  ui.guess.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSuggestion(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSuggestion(-1);
    } else if (event.key === "Escape") {
      showSuggestions([]);
    }
  });
  ui.suggest.addEventListener("mousedown", (event) => {
    const li = event.target.closest("li");
    if (!li) return;
    event.preventDefault();
    const item = suggestItems[Number(li.dataset.i)];
    if (item) submit(item, item.name);
  });
  document.addEventListener("keydown", (event) => {
    if (settings.difficulty !== "easy" || locked || ui.dock.hidden) return;
    const n = Number(event.key);
    if (n >= 1 && n <= 4) {
      const button = ui.choices.children[n - 1];
      if (button) button.click();
    }
  });
}

function setProgress(ratio) {
  const value = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  ui.loadFill.style.width = `${value}%`;
  ui.loadFill.parentElement.setAttribute("aria-valuenow", String(value));
}

async function loadJson(url, from, to) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(url);
  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body && response.body.getReader();
  if (!reader) {
    setProgress(to);
    return response.json();
  }
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const intra = total ? received / total : 1;
    setProgress(from + (to - from) * intra);
  }
  const buffer = new Uint8Array(received);
  let offset = 0;
  chunks.forEach((chunk) => {
    buffer.set(chunk, offset);
    offset += chunk.length;
  });
  return JSON.parse(new TextDecoder().decode(buffer));
}

const GLOBE_TURN_MS = 300000;
const GLOBE_TILT = 22 * Math.PI / 180;
let globePolygons = [];
let globeCoasts = [];
let globeGraticule = [];
let globeFrame = 0;
let globeRunning = false;
let globeScratch = new Float32Array(0);

function globeUnit(lon, lat) {
  const lambda = lon * Math.PI / 180;
  const phi = lat * Math.PI / 180;
  const cosPhi = Math.cos(phi);
  return [cosPhi * Math.sin(lambda), Math.sin(phi), cosPhi * Math.cos(lambda)];
}

function chainGlobe(pairs) {
  const links = new Map();
  const connect = (from, to) => {
    if (!links.has(from.key)) links.set(from.key, []);
    links.get(from.key).push(to);
  };
  pairs.forEach(([a, b]) => {
    connect(a, b);
    connect(b, a);
  });
  const used = new Set();
  const edgeId = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const walk = (start, banned) => {
    const coords = [start];
    let prevKey = banned;
    let current = start;
    while (current) {
      const options = (links.get(current.key) || []).filter((next) => (
        next.key !== prevKey && !used.has(edgeId(current.key, next.key))
      ));
      if (options.length !== 1) break;
      used.add(edgeId(current.key, options[0].key));
      prevKey = current.key;
      current = options[0];
      coords.push(current);
      if (current.key === start.key) break;
    }
    return coords;
  };
  const lines = [];
  pairs.forEach(([a, b]) => {
    const first = edgeId(a.key, b.key);
    if (used.has(first)) return;
    used.add(first);
    const forward = walk(b, a.key);
    const backward = walk(a, b.key);
    lines.push(backward.reverse().concat(forward));
  });
  return lines;
}

function buildGlobe(atlas) {
  const polygons = [];
  const edgeCount = new Map();
  const edgeLine = new Map();
  atlas.forEach((item) => {
    item.layout.polygons.forEach((polygon) => {
      const packedRings = [];
      polygon.forEach((ring) => {
        const snapped = [];
        ring.forEach(([lon, lat]) => {
          const slon = Math.round(lon * 1000) / 1000;
          const slat = Math.round(lat * 1000) / 1000;
          const last = snapped[snapped.length - 1];
          if (!last || last[0] !== slon || last[1] !== slat) snapped.push([slon, slat]);
        });
        if (snapped.length < 4) return;
        const packed = new Float32Array(snapped.length * 3);
        snapped.forEach((point, index) => {
          const unit = globeUnit(point[0], point[1]);
          packed[index * 3] = unit[0];
          packed[index * 3 + 1] = unit[1];
          packed[index * 3 + 2] = unit[2];
        });
        packedRings.push(packed);
        for (let i = 1; i < snapped.length; i += 1) {
          const a = `${snapped[i - 1][0]},${snapped[i - 1][1]}`;
          const b = `${snapped[i][0]},${snapped[i][1]}`;
          if (a === b) continue;
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
          if (!edgeLine.has(key)) edgeLine.set(key, [snapped[i - 1], snapped[i]]);
        }
      });
      if (packedRings.length) polygons.push(packedRings);
    });
  });
  const coastPairs = [];
  edgeLine.forEach((line, key) => {
    if (edgeCount.get(key) !== 1) return;
    coastPairs.push([
      { key: `${line[0][0]},${line[0][1]}`, lon: line[0][0], lat: line[0][1] },
      { key: `${line[1][0]},${line[1][1]}`, lon: line[1][0], lat: line[1][1] },
    ]);
  });
  const packChain = (points) => {
    const packed = new Float32Array(points.length * 3);
    points.forEach((point, index) => {
      const unit = globeUnit(point.lon, point.lat);
      packed[index * 3] = unit[0];
      packed[index * 3 + 1] = unit[1];
      packed[index * 3 + 2] = unit[2];
    });
    return packed;
  };
  const coasts = chainGlobe(coastPairs).map(packChain);
  const graticule = [];
  const addLine = (coords) => {
    const packed = new Float32Array(coords.length * 3);
    coords.forEach((point, index) => {
      const unit = globeUnit(point[0], point[1]);
      packed[index * 3] = unit[0];
      packed[index * 3 + 1] = unit[1];
      packed[index * 3 + 2] = unit[2];
    });
    graticule.push(packed);
  };
  for (let lon = -180; lon < 180; lon += 15) {
    const coords = [];
    for (let lat = -78; lat <= 78; lat += 2) coords.push([lon, lat]);
    addLine(coords);
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const coords = [];
    for (let lon = -180; lon <= 180; lon += 2) coords.push([lon, lat]);
    addLine(coords);
  }
  globePolygons = polygons;
  globeCoasts = coasts;
  globeGraticule = graticule;
}

function traceGlobeRing(ctx, points, radius, cx, cy) {
  points.forEach((point, index) => {
    const x = cx + point[0] * radius;
    const y = cy - point[1] * radius;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

function drawGlobe(now) {
  const canvas = ui.globe;
  if (!canvas) return;
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pxW = Math.round(width * dpr);
  const pxH = Math.round(height * dpr);
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const radius = 0.55 * Math.hypot(width, height);
  const cx = width / 2;
  const cy = height / 2;
  const spin = (now / GLOBE_TURN_MS) * Math.PI * 2;
  const cosS = Math.cos(spin);
  const sinS = Math.sin(spin);
  const cosT = Math.cos(GLOBE_TILT);
  const sinT = Math.sin(GLOBE_TILT);
  const orient = (x, y, z) => {
    const x1 = x * cosS - z * sinS;
    const z1 = x * sinS + z * cosS;
    return [x1, y * cosT - z1 * sinT, y * sinT + z1 * cosT];
  };
  ctx.beginPath();
  globeGraticule.forEach((data) => {
    let pen = false;
    const count = data.length / 3;
    for (let i = 0; i < count; i += 1) {
      const point = orient(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
      if (point[2] < 0.02) {
        pen = false;
        continue;
      }
      const sx = cx + point[0] * radius;
      const sy = cy - point[1] * radius;
      if (!pen) {
        ctx.moveTo(sx, sy);
        pen = true;
      } else ctx.lineTo(sx, sy);
    }
  });
  ctx.strokeStyle = "rgba(28, 25, 21, 0.22)";
  ctx.lineWidth = 0.7;
  ctx.stroke();
  const addRing = (data) => {
    const count = data.length / 3;
    if (globeScratch.length < count * 3) globeScratch = new Float32Array(count * 3);
    const view = globeScratch;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < count; i += 1) {
      const x = data[i * 3];
      const y = data[i * 3 + 1];
      const z = data[i * 3 + 2];
      const x1 = x * cosS - z * sinS;
      const z1 = x * sinS + z * cosS;
      const vy = y * cosT - z1 * sinT;
      const vz = y * sinT + z1 * cosT;
      view[i * 3] = x1;
      view[i * 3 + 1] = vy;
      view[i * 3 + 2] = vz;
      if (vz < minZ) minZ = vz;
      if (vz > maxZ) maxZ = vz;
    }
    if (maxZ < 0.02) return false;
    if (minZ >= -1e-6) {
      for (let i = 0; i < count; i += 1) {
        const sx = cx + view[i * 3] * radius;
        const sy = cy - view[i * 3 + 1] * radius;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      return true;
    }
    const points = [];
    for (let i = 0; i < count; i += 1) points.push([view[i * 3], view[i * 3 + 1], view[i * 3 + 2]]);
    const parts = clipFront(points);
    parts.forEach((part) => traceGlobeRing(ctx, part, radius, cx, cy));
    return parts.length > 0;
  };
  globePolygons.forEach((polygon) => {
    ctx.beginPath();
    let drawn = false;
    polygon.forEach((ring) => {
      if (addRing(ring)) drawn = true;
    });
    if (!drawn) return;
    ctx.fillStyle = "#ffffff";
    ctx.fill("evenodd");
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 0.7;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  });
  const strokeChains = (chains, color, width) => {
    ctx.beginPath();
    chains.forEach((data) => {
      let pen = false;
      let previous = null;
      const count = data.length / 3;
      for (let i = 0; i < count; i += 1) {
        const point = orient(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
        if (point[2] < 0.015) {
          if (pen && previous && previous[2] >= 0.015) {
            const hit = horizonPoint(previous, point);
            ctx.lineTo(cx + hit[0] * radius, cy - hit[1] * radius);
          }
          pen = false;
          previous = point;
          continue;
        }
        const sx = cx + point[0] * radius;
        const sy = cy - point[1] * radius;
        if (!pen) {
          if (previous && previous[2] < 0.015) {
            const hit = horizonPoint(previous, point);
            ctx.moveTo(cx + hit[0] * radius, cy - hit[1] * radius);
            ctx.lineTo(sx, sy);
          } else ctx.moveTo(sx, sy);
          pen = true;
        } else ctx.lineTo(sx, sy);
        previous = point;
      }
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  };
  strokeChains(globeCoasts, "#8a837c", 0.95);
}

function startGlobe() {
  if (!globePolygons.length) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  stopGlobe();
  if (reduce) {
    drawGlobe(0);
    return;
  }
  globeRunning = true;
  const loop = (now) => {
    if (!globeRunning) return;
    drawGlobe(now);
    globeFrame = requestAnimationFrame(loop);
  };
  globeFrame = requestAnimationFrame(loop);
}

function stopGlobe() {
  globeRunning = false;
  cancelAnimationFrame(globeFrame);
}

async function boot() {
  bindSettings();
  bindViewport();
  try {
    const world = await loadJson(DATA.world, 0, 0.28);
    const france = await loadJson(DATA.france, 0.28, 0.42);
    const us = await loadJson(DATA.us, 0.42, 0.58);
    const worldBorders = await loadJson(DATA.worldBorders, 0.58, 0.72);
    const franceBorders = await loadJson(DATA.franceBorders, 0.72, 0.82);
    const usBorders = await loadJson(DATA.usBorders, 0.82, 0.9);
    setProgress(0.92);
    catalogs = {
      world: worldEntities(world),
      france: franceEntities(france),
      us: usEntities(us),
      atlas: {
        world: atlasFrom(world, (feature) => feature.properties && feature.properties.ADM0_A3),
        france: atlasFrom(france, (feature) => feature.properties && (feature.properties.iso_3166_2 || feature.properties.name_fr)),
        us: atlasFrom(us, (feature) => feature.properties && feature.properties.iso_3166_2),
      },
      borders: {
        world: borderLines(worldBorders),
        france: borderLines(franceBorders),
        us: borderLines(usBorders),
      },
    };
    setProgress(1);
    if (catalogs.world.length < 20 || catalogs.france.length < 90 || catalogs.us.length < 50) {
      throw new Error("catalogue incomplet");
    }
    buildGlobe(catalogs.atlas.world);
    ui.load.classList.add("is-done");
    ui.load.setAttribute("aria-busy", "false");
    ui.intro.hidden = false;
    startGlobe();
    window.setTimeout(() => { ui.load.hidden = true; }, 500);
  } catch (error) {
    ui.loadText.textContent = "Le chargement des cartes a échoué.";
    console.error(error);
  }
}

window.addEventListener("resize", () => {
  scheduleFit();
  const round = rounds[index];
  if (round && round.showContext) drawContext(round);
  if (!ui.intro.hidden && !globeRunning && globePolygons.length) drawGlobe(0);
});

boot();
