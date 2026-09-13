/* Cochera — dashboard ESPHome (REST + EventSource). Vanilla JS, sin build. */
"use strict";

/* ---------- Entidades del firmware ---------- */
const SENSORS = { fondo: "Sensor Fondo", izq: "Sensor Izquierda", der: "Sensor Derecha" };
const NUMBERS_DIST = [
  "Tiempo Inactividad STOP (s)", "Umbral Inicio (cm)", "Umbral Precaucion (cm)",
  "Umbral Alerta (cm)", "Umbral STOP (cm)",
];
const NUMBERS_LAT = ["Umbral Lateral (cm)", "Umbral Desvío Chevron (cm)", "Umbral Poste Lateral (cm)"];
const NUMBERS_DIM = ["Ancho Portón (cm)", "Ancho Auto (cm)", "Ancho Auto con espejos (cm)", "Largo Garage (cm)", "Largo Auto (cm)"];
const NUMBERS_TEST = ["Prueba Fondo (cm)", "Prueba Izquierda (cm)", "Prueba Derecha (cm)"];
const TEXT_NOMBRE = "Nombre Cochera";
const SWITCH_POSTE = "Alerta Poste Lateral";
const SEL_PRUEBA = "Modo Prueba";
const BTN_RESET = "Reiniciar";
const TEXT_MODO = "Modo del Sistema";
const TEXT_SIM = "Simulación de Pantalla LED (8x32)";
const DEFAULTS = {
  "Tiempo Inactividad STOP (s)": 10, "Umbral Lateral (cm)": 50, "Umbral Desvío Chevron (cm)": 5,
  "Umbral Poste Lateral (cm)": 15, "Umbral Inicio (cm)": 150, "Umbral Precaucion (cm)": 50,
  "Umbral Alerta (cm)": 20, "Umbral STOP (cm)": 10,
  "Ancho Portón (cm)": 200, "Ancho Auto (cm)": 170, "Ancho Auto con espejos (cm)": 190,
  "Largo Garage (cm)": 500, "Largo Auto (cm)": 420,
  "Prueba Fondo (cm)": 0, "Prueba Izquierda (cm)": 0, "Prueba Derecha (cm)": 0,
};
const DEF_BASES = ["http://garage.local", "http://garage.lan"];

/* Telemetría del modal Sistema (nombres exactos del firmware) */
const SYS_TEXT = {
  "Info Dispositivo": "dev", "Motivo Reinicio": "reset", "Versión ESPHome": "ver",
  "IP": "ip", "Red WiFi": "ssid", "BSSID": "bssid", "MAC": "mac", "Firmware": "fw",
};
const SYS_SENSOR = {
  "Heap Libre": "heap", "Bloque Máx": "block", "Fragmentación": "frag",
  "Loop": "loop", "CPU": "cpu", "Tiempo Encendido": "up", "WiFi": "rssi",
};
/* Firmware publicado: repo y .bin para comparar versión (vacío = solo subida manual) */
const FW_REPO = "";
const FW_BIN = "parking.bin";

/* ---------- Estado ---------- */
const S = {
  base: null, es: null, status: "connecting", reconnecting: false,
  sensor: { fondo: NaN, izq: NaN, der: NaN },
  number: Object.assign({}, DEFAULTS),
  numCfg: {}, // name -> {min,max,step}
  poste: true, modo: "", sim: "",
  prueba: "Automático", nombre: "Cochera",
  ledColor: (function () { try { return localStorage.getItem("cochera_led") || "azul"; } catch (e) { return "azul"; } })(),
  sys: {}, msgs: 0, lastEv: 0,
  log: [], tried: new Map(),
};
/* Ancho total con espejos (entidad del firmware, solo esquema: los
   sensores miran la carrocería por debajo de los espejos). */
function mirrorW(carW) {
  const v = S.number["Ancho Auto con espejos (cm)"];
  if (v !== undefined && !isNaN(v) && v > carW) return v;
  return carW + 20;
}
const $ = (id) => document.getElementById(id);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/* Mapa id normalizado -> clave, para formato legacy domain-object_id */
const LOOKUP = {};
Object.entries(SENSORS).forEach(([k, n]) => { LOOKUP["sensor" + norm(n)] = ["sensor", k]; });
[...NUMBERS_DIST, ...NUMBERS_LAT, ...NUMBERS_DIM, ...NUMBERS_TEST].forEach((n) => { LOOKUP["number" + norm(n)] = ["number", n]; });
LOOKUP["switch" + norm(SWITCH_POSTE)] = ["switch", "poste"];
LOOKUP["text" + norm(TEXT_NOMBRE)] = ["text", "nombre"];
LOOKUP["select" + norm(SEL_PRUEBA)] = ["select", "prueba"];
LOOKUP["textsensor" + norm(TEXT_MODO)] = ["text", "modo"];
LOOKUP["textsensor" + norm(TEXT_SIM)] = ["text", "sim"];
LOOKUP["text_sensor" + norm(TEXT_MODO)] = ["text", "modo"];
LOOKUP["text_sensor" + norm(TEXT_SIM)] = ["text", "sim"];
Object.entries(SYS_TEXT).forEach(([n, k]) => {
  LOOKUP["textsensor" + norm(n)] = ["sys", "t" + k];
  LOOKUP["text_sensor" + norm(n)] = ["sys", "t" + k];
});
Object.entries(SYS_SENSOR).forEach(([n, k]) => { LOOKUP["sensor" + norm(n)] = ["sys", "s" + k]; });

function parseId(id) {
  if (id.indexOf("/") >= 0) {
    const p = id.split("/");
    return { domain: p[0], name: p.slice(1).join("/") };
  }
  const i = id.indexOf("-");
  if (i < 0) return null;
  return { domain: id.slice(0, i), legacy: id.slice(i + 1) };
}
function route(domain, name, data) {
  if (domain === "sensor") {
    for (const [k, n] of Object.entries(SENSORS)) if (n === name) {
      const v = parseFloat(data.value);
      S.sensor[k] = isNaN(v) ? NaN : v;
      return true;
    }
    if (SYS_SENSOR[name] !== undefined && data.value !== undefined) {
      const v = parseFloat(data.value);
      S.sys[SYS_SENSOR[name]] = isNaN(v) ? NaN : v;
      return true;
    }
    return false;
  }
  if (domain === "number" && data.value !== undefined) {
    if (S.number.hasOwnProperty(name)) { S.number[name] = parseFloat(data.value); return true; }
    return false;
  }
  if (domain === "switch") {
    if (name === SWITCH_POSTE) { S.poste = !!data.value; return true; }
    return false;
  }
  if (domain === "select") {
    // El estado del select llega como value (y en algunas versiones como state)
    if (name === SEL_PRUEBA) {
      const v = data.value !== undefined ? data.value : data.state;
      if (v !== undefined) S.prueba = String(v);
      return true;
    }
    return false;
  }
  if (domain === "text") {
    if (name === TEXT_NOMBRE) { S.nombre = String(data.state !== undefined ? data.state : data.value || ""); return true; }
    return false;
  }
  if (domain === "text_sensor" || domain === "textsensor") {
    if (name === TEXT_MODO) { S.modo = String(data.state || ""); return true; }
    if (name === TEXT_SIM) { S.sim = String(data.state || ""); return true; }
    if (SYS_TEXT[name] !== undefined) { S.sys[SYS_TEXT[name]] = String(data.state || ""); return true; }
    return false;
  }
  return false;
}
function routeLegacy(domain, objectId, data) {
  const hit = LOOKUP[domain + norm(objectId)] || LOOKUP[domain.replace(/_/g, "") + norm(objectId)];
  if (!hit) return false;
  const [d, key] = hit;
  if (d === "sensor") { const v = parseFloat(data.value); S.sensor[key] = isNaN(v) ? NaN : v; return true; }
  if (d === "number" && data.value !== undefined) {
    const name = [...NUMBERS_DIST, ...NUMBERS_LAT, ...NUMBERS_DIM].find((n) => norm(n) === norm(key)) || key;
    void name; S.number[key] = parseFloat(data.value); return true;
  }
  if (d === "switch") { S.poste = !!data.value; return true; }
  if (d === "select") {
    const v = data.value !== undefined ? data.value : data.state;
    if (v !== undefined) S.prueba = String(v);
    return true;
  }
  if (d === "text") {
    if (key === "modo") { S.modo = String(data.state || ""); return true; }
    if (key === "sim") { S.sim = String(data.state || ""); return true; }
    if (key === "nombre") { S.nombre = String(data.state !== undefined ? data.state : data.value || ""); return true; }
  }
  if (d === "sys") {
    if (key[0] === "t") { S.sys[key.slice(1)] = String(data.state || ""); return true; }
    const v = parseFloat(data.value);
    S.sys[key.slice(1)] = isNaN(v) ? NaN : v;
    return true;
  }
  return false;
}
function handleStateEvent(data) {
  if (!data || !data.id) return;
  rxFlash();
  S.msgs++;
  S.lastEv = Date.now();
  const p = parseId(String(data.id));
  if (!p) return;
  let ok;
  if (p.name !== undefined) ok = route(p.domain, p.name, data);
  else ok = routeLegacy(p.domain, p.legacy, data);
  if (ok) render();
}

/* ---------- REST ---------- */
async function apiGet(path) {
  const r = await fetch(S.base + path);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
async function apiPost(path) {
  txFlash();
  const r = await fetch(S.base + path, { method: "POST" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return true;
}
const enc = encodeURIComponent;
const numGet = (n) => apiGet("/number/" + enc(n));
const numSet = (n, v) => apiPost("/number/" + enc(n) + "/set?value=" + encodeURIComponent(v));
const swSet = (on) => apiPost("/switch/" + enc(SWITCH_POSTE) + (on ? "/turn_on" : "/turn_off"));
const selSet = (opt) => apiPost("/select/" + enc(SEL_PRUEBA) + "/set?option=" + enc(opt));
const textSet = (v) => apiPost("/text/" + enc(TEXT_NOMBRE) + "/set?value=" + enc(v));
const btnPress = (n) => apiPost("/button/" + enc(n) + "/press");

/* ---------- URLs ---------- */
function loadExtraUrls() {
  try { return new Set(JSON.parse(localStorage.getItem("cochera_urls") || "[]")); }
  catch (e) { return new Set(); }
}
function saveExtraUrls(s) {
  try { localStorage.setItem("cochera_urls", JSON.stringify(Array.from(s))); } catch (e) {}
}
function baseCandidates() {
  const out = [];
  const q = new URLSearchParams(location.search).get("garage");
  if (q) out.push(q.replace(/\/$/, ""));
  const last = null;
  try {
    const l = localStorage.getItem("cochera_base");
    if (l) out.push(l);
  } catch (e) {}
  DEF_BASES.forEach((u) => { if (out.indexOf(u) < 0) out.push(u); });
  loadExtraUrls().forEach((u) => { if (out.indexOf(u) < 0) out.push(u); });
  void last;
  return out;
}

/* ---------- Conexión ---------- */
function setStatus(st) {
  S.status = st;
  const pill = $("connPill"), txt = $("connText");
  pill.classList.remove("ok", "bad", "busy");
  if (st === "connected") { pill.classList.add("ok"); txt.textContent = "Conectado"; }
  else if (st === "connecting") { pill.classList.add("busy"); txt.textContent = "Conectando…"; }
  else { pill.classList.add("bad"); txt.textContent = "Desconectado"; }
  // Pill visible solo sin conexión; conectado vive solo dentro del menú.
  pill.hidden = (st === "connected");
  $("connState").textContent = txt.textContent;
  const mc = $("menuConnState");
  if (mc) mc.textContent = "· " + txt.textContent;
}
function markTried(url, st) { S.tried.set(url, st); renderTried(); }
function renderTried() {
  const el = $("triedList");
  el.innerHTML = "";
  S.tried.forEach((st, url) => {
    const s = document.createElement("span");
    s.className = st === "connected" ? "ok" : st === "failed" ? "bad" : "busy";
    s.textContent = url;
    el.appendChild(s);
  });
}
function connect(url) {
  if (S.es) { try { S.es.close(); } catch (e) {} S.es = null; }
  markTried(url, "trying");
  const es = new EventSource(url + "/events");
  S.es = es;
  let opened = false;
  const to = setTimeout(() => {
    if (!opened) { try { es.close(); } catch (e) {} markTried(url, "failed"); nextCandidate(); }
  }, 6000);
  es.onopen = () => {
    opened = true; clearTimeout(to);
    S.base = url;
    try { localStorage.setItem("cochera_base", url); } catch (e) {}
    markTried(url, "connected");
    setStatus("connected");
    S.reconnecting = false;
  };
  es.addEventListener("state", (e) => {
    try { handleStateEvent(JSON.parse(e.data)); } catch (err) {}
  });
  es.addEventListener("log", (e) => { rxFlash(); pushLog(String(e.data || "")); });
  es.onerror = () => {
    if (!opened) { clearTimeout(to); markTried(url, "failed"); nextCandidate(); }
    else setStatus("connecting");
  };
}
let candQueue = [], candTimer = null;
function tryReconnect() {
  if (S.reconnecting) return;
  S.reconnecting = true;
  setStatus("connecting");
  candQueue = baseCandidates();
  nextCandidate();
}
function nextCandidate() {
  if (!S.reconnecting) return;
  const url = candQueue.shift();
  if (!url) { S.reconnecting = false; setStatus("disconnected"); openDialog("connDialog"); return; }
  connect(url);
}

/* ---------- Log ---------- */
function pushLog(line) {
  S.log.push(line);
  if (S.log.length > 200) S.log.splice(0, S.log.length - 200);
  const pre = $("logPre");
  pre.textContent = S.log.join("\n");
  pre.scrollTop = pre.scrollHeight;
}

/* ---------- TX flash ---------- */
let txTo = null, rxTo = null;
function txFlash() {
  const pill = $("connPill"), led = $("txLed");
  pill.classList.add("busy");
  if (led) { led.classList.add("active", "led-flicker"); }
  clearTimeout(txTo);
  txTo = setTimeout(() => {
    if (S.status === "connected") pill.classList.remove("busy");
    if (led) led.classList.remove("active", "led-flicker");
  }, 400);
}
/* ---------- RX flash (cada evento recibido del equipo) ---------- */
function rxFlash() {
  const led = $("rxLed");
  if (!led) return;
  led.classList.add("active", "led-flicker");
  clearTimeout(rxTo);
  rxTo = setTimeout(() => { led.classList.remove("active", "led-flicker"); }, 250);
}

/* ---------- Tiers / modo ---------- */
function tier() {
  const f = S.sensor.fondo, N = S.number;
  if (isNaN(f)) return "none";
  if (f <= N["Umbral STOP (cm)"]) return "stop";
  if (f <= N["Umbral Alerta (cm)"]) return "alerta";
  if (f <= N["Umbral Precaucion (cm)"]) return "prec";
  if (f <= N["Umbral Inicio (cm)"]) return "normal";
  return "reposo";
}
function tierColor(t) {
  return t === "stop" ? "var(--bad)" : t === "alerta" ? "#e0680c" :
    t === "prec" ? "var(--warn)" : t === "normal" ? "var(--ok)" : "var(--amb)";
}

/* ---------- SVG cenital ---------- */
function renderSvg() {
  const svg = $("garageSvg");
  const gateW = Math.max(50, S.number["Ancho Portón (cm)"] || 200);
  const carW = Math.max(50, S.number["Ancho Auto (cm)"] || 170);
  const L = Math.max(200, S.number["Largo Garage (cm)"] || 500);
  const carL = Math.max(100, S.number["Largo Auto (cm)"] || 420);
  const N = S.number;
  const W = 340, H = 460, mX = 20, top = 30, bot = 430;
  const padX = 40;
  // Vano 20% más ancho que el portón; muros gruesos alrededor
  const vanoW = gateW * 1.2;
  const sx = (W - 2 * mX) / (vanoW + 2 * padX);
  const sy = (bot - top) / (L + 60);
  const X = (gx) => mX + (gx + gateW / 2 + padX) * sx;
  // Eje Y invertido: fondo (gy=L) arriba, portón (gy=0) abajo
  const Y = (gy) => bot - ((gy + 30) / (L + 60)) * (bot - top);
  const f = S.sensor.fondo, iz = S.sensor.izq, de = S.sensor.der;
  const t = tier();
  const col = tierColor(t === "none" ? "reposo" : t);
  // Vista centrada en el contenido: las cotas viven FUERA de las paredes
  // (±56px por lado para valor + vínculo); el viewBox se centra en X(0).
  const half = (vanoW * sx) / 2 + 56;
  svg.setAttribute("viewBox", `${(X(0) - half).toFixed(1)} 0 ${(half * 2).toFixed(1)} 460`);
  let s = "";
  const DOTS = ' stroke-dasharray="1 3" stroke-linecap="round"';
  // Umbrales como anillos por tramo (sin líneas): cada tramo entre umbrales
  // lleva su color sombreado. Distancias d medidas desde la pared de fondo.
  const uStop = Math.max(0, N["Umbral STOP (cm)"] || 10);
  const uAlerta = Math.max(0, N["Umbral Alerta (cm)"] || 20);
  const uPrec = Math.max(0, N["Umbral Precaucion (cm)"] || 50);
  const uIni = Math.max(0, N["Umbral Inicio (cm)"] || 150);
  const segs = [
    { d0: 0, d1: uStop, c: "var(--bad)", op: 0.30, tag: uStop },
    { d0: uStop, d1: uAlerta, c: "#e0680c", op: 0.22, tag: uAlerta },
    { d0: uAlerta, d1: uPrec, c: "var(--warn)", op: 0.16, tag: uPrec },
    { d0: uPrec, d1: uIni, c: "var(--ok)", op: 0.10, tag: uIni },
  ];
  const xL = X(-vanoW / 2), wV = vanoW * sx;
  const lblSpots = []; // {y, txt, c, side} etiquetas verticales intercaladas izq/der
  segs.forEach((g, i) => {
    const d0 = Math.max(0, Math.min(g.d0, L + 30)), d1 = Math.max(0, Math.min(g.d1, L + 30));
    if (!(d1 > d0)) return; // umbrales incoherentes: tramo colapsado, se omite
    const yT = Y(L - d0), yB = Y(L - d1);
    s += `<rect x="${xL.toFixed(1)}" y="${yT.toFixed(1)}" width="${wV.toFixed(1)}" height="${Math.max(1, yB - yT).toFixed(1)}" fill="${g.c}" opacity="${g.op}"/>`;
    // Centrada verticalmente en su tramo, sin "cm" (número solo, no se superpone).
    // Lado intercalado: STOP izq, Alerta der, Precaución izq, Inicio der.
    lblSpots.push({ y: (yT + yB) / 2, txt: String(Math.round(g.tag)), c: g.c, side: i % 2 === 0 ? "L" : "R" });
  });
  // Etiquetas de umbral: verticales al borde interno (izq/der intercalado),
  // en el color del sombreado correspondiente.
  {
    const xl = X(-vanoW / 2) + 6, xr = X(vanoW / 2) - 6;
    lblSpots.forEach((l) => {
      const x = l.side === "L" ? xl : xr;
      const y = Math.max(Y(L) + 8, Math.min(Y(0) - 4, l.y));
      s += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" transform="rotate(-90 ${x.toFixed(1)} ${y.toFixed(1)})" text-anchor="middle" font-size="9" font-weight="bold" fill="${l.c}" opacity="0.95">${l.txt}</text>`;
    });
  }
  // Zona objetivo: morro a distancia = Umbral STOP de la pared de fondo,
  // centrada lateralmente, tamaño = Largo/Ancho Auto configurados.
  // Gris neutro: sombreado + borde punteado semitransparente (independiente del tier).
  const tgtFrontGy = Math.max(-30, Math.min(L, L - uStop));
  const tgtFrontY = Y(tgtFrontGy);
  const tgtTailGy = tgtFrontGy - carL;
  const tgtTailY = Y(Math.max(-30, tgtTailGy));
  const tgtH = Math.max(4, tgtTailY - tgtFrontY);
  const tgtBodyW = carW * sx;
  const tgtX = X(0) - tgtBodyW / 2;
  s += `<rect x="${tgtX.toFixed(1)}" y="${tgtFrontY.toFixed(1)}" width="${tgtBodyW.toFixed(1)}" height="${tgtH.toFixed(1)}" rx="6" fill="#9aa0a6" fill-opacity="0.18" stroke="#9aa0a6" stroke-width="1.5" stroke-dasharray="4 3" stroke-opacity="0.65"/>`;
  // piso interior (vano) + muros en un solo trazo con uniones suaves:
  // frontal con abertura del portón, laterales y fondo. Termina al ras en
  // los postes (sin sobresalir). Jambas de la abertura en color del tier.
  const WALL = 7;
  s += `<rect x="${X(-vanoW / 2)}" y="${Y(L).toFixed(1)}" width="${(vanoW * sx).toFixed(1)}" height="${(Y(0) - Y(L)).toFixed(1)}" fill="none" stroke="currentColor" stroke-opacity="0.35"/>`;
  s += `<path d="M ${X(-gateW / 2).toFixed(1)} ${Y(0).toFixed(1)} L ${X(-vanoW / 2).toFixed(1)} ${Y(0).toFixed(1)} L ${X(-vanoW / 2).toFixed(1)} ${Y(L).toFixed(1)} L ${X(vanoW / 2).toFixed(1)} ${Y(L).toFixed(1)} L ${X(vanoW / 2).toFixed(1)} ${Y(0).toFixed(1)} L ${X(gateW / 2).toFixed(1)} ${Y(0).toFixed(1)}" fill="none" stroke="currentColor" stroke-opacity="0.85" stroke-width="${WALL}" stroke-linejoin="round" stroke-linecap="butt"/>`;
  s += `<rect x="${(X(-gateW / 2) - 2).toFixed(1)}" y="${(Y(0) - 7).toFixed(1)}" width="4" height="14" fill="${col}"/>`;
  s += `<rect x="${(X(gateW / 2) - 2).toFixed(1)}" y="${(Y(0) - 7).toFixed(1)}" width="4" height="14" fill="${col}"/>`;
  s += `<text x="${(X(0)).toFixed(1)}" y="${(Y(0) + 30).toFixed(1)}" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.45">${gateW}cm</text>`;
  s += `<text x="${(X(-vanoW / 2) + 34).toFixed(1)}" y="${(Y(L) - 10).toFixed(1)}" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.45">${Math.round(vanoW)}cm</text>`;
  // cota vertical del largo del garage, junto al muro izquierdo
  {
    const dx = X(-vanoW / 2) - 12, dy = (Y(0) + Y(L)) / 2;
    s += `<text x="${dx.toFixed(1)}" y="${dy.toFixed(1)}" transform="rotate(-90 ${dx.toFixed(1)} ${dy.toFixed(1)})" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.45">${L}cm</text>`;
  }
  // Cotas de medida (lecturas vivas): amarillo ámbar del tema, con halo
  // oscuro para legibilidad sobre cualquier sombreado. Solo cuando hay eco;
  // sin eco va "—" apagado.
  const HALO = ' paint-order="stroke" stroke="rgba(0,0,0,0.55)" stroke-width="3" stroke-linejoin="round"';
  // Color de lecturas por desvío y umbrales (verde→amarillo→rojo):
  // fondo por tier; laterales con pareja: lado cercano ≤ poste en rojo,
  // desvío > chevron en amarillo del lado cercano, resto verde.
  const validD = (v) => !isNaN(v) && v > 0;
  // Lejos de todo umbral (reposo) también es seguro: verde.
  const fCol = validD(f) ? (tier(f) === "reposo" ? "var(--ok)" : tierColor(tier(f))) : null;
  function latCol(v, o) {
    if (!validD(v)) return null;
    if (validD(o)) {
      const poste = S.number["Umbral Poste Lateral (cm)"] || 15;
      const desv = S.number["Umbral Desvío Chevron (cm)"] || 5;
      if (v <= poste || o <= poste) return v <= o ? "var(--bad)" : "var(--ok)";
      if (Math.abs(v - o) > desv) return v < o ? "var(--warn)" : "var(--ok)";
    }
    return "var(--ok)";
  }
  const izCol = latCol(iz, de), deCol = latCol(de, iz);
  // Auto a escala (paths REALES de temp/car.svg, sin PNGs externos ni gradientes:
  // misma geometría de carrocería/vidrios/espejos, ver web/car.svg).
  // Morro (parrilla/faros, y=0) hacia el fondo (arriba).
  // Ancho config = carrocería SIN espejos (es lo que miden los laterales, que
  // miran la zona media por debajo de los espejos); el total CON espejos sale
  // del campo local "Ancho Auto con espejos" y define el dibujo + el tope
  // lateral (los espejos son lo primero que toca muros/postes).
  // viewBox -519 -7 42767 74687 = bounding total con espejos.
  // Longitudinal por Sensor Fondo (morro a distancia f de la pared);
  // lateral por (der-izq)/2 sobre lecturas de carrocería. Sin detección
  // (sin fondo ni pareja lateral): se oculta el auto y queda la zona objetivo.
  const withMirrors = mirrorW(carW);
  const hasFondo = !isNaN(f) && f > 0;
  const hasLatPair = !isNaN(iz) && iz > 0 && !isNaN(de) && de > 0;
  const showCar = hasFondo || hasLatPair;
  const maxOff = Math.max(0, (gateW - withMirrors) / 2);
  let off = 0, carH = 0, frontY = NaN, totalW = 0;
  if (showCar) {
    if (hasLatPair) off = Math.max(-maxOff, Math.min(maxOff, (de - iz) / 2));
    carH = Math.min(carL * sy, Math.abs(Y(L) - Y(0)) - 10);
    frontY = hasFondo ? Y(Math.max(-30, Math.min(L, L - f))) : Y(0) - carH;
    totalW = withMirrors * sx;
    const x0 = X(off) - totalW / 2;
    // Ajuste horizontal del dibujo sobre su centro (x=20864): la carrocería
    // del dibujo es el 80.41% del total; si el cociente configurado difiere,
    // se comprime/estira en X para que carrocería Y total midan exacto.
    const kMir = (carW / withMirrors) / 0.8041;
    // Fade de cola: lo que asome del portón se funde a transparente. La
    // máscara vive DENTRO del dibujo (unidades del auto, no del esquema:
    // una máscara sobre el <svg> anidado cae en espacio ambiguo y el
    // navegador puede recortar todo el auto).
    const yGate = Y(0);
    const yuGate = -7 + ((yGate - frontY) / carH) * 74687;
    const yuFade = (44 / carH) * 74687;
    s += `<svg x="${x0.toFixed(1)}" y="${frontY.toFixed(1)}" width="${totalW.toFixed(1)}" height="${carH.toFixed(1)}" viewBox="-519 -7 42767 74687">`
      + `<defs><linearGradient id="fadeTailC" gradientUnits="userSpaceOnUse" x1="0" y1="${yuGate.toFixed(1)}" x2="0" y2="${(yuGate + yuFade).toFixed(1)}"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>`
      + `<mask id="maskTailC" maskUnits="userSpaceOnUse" x="-519" y="-7" width="42767" height="74687"><rect x="-519" y="-7" width="42767" height="74687" fill="#fff"/><rect x="-519" y="${yuGate.toFixed(1)}" width="42767" height="${(74687 - (yuGate + 7)).toFixed(1)}" fill="url(#fadeTailC)"/></mask></defs>`
      + `<g mask="url(#maskTailC)" transform="translate(20864 0) scale(${kMir.toFixed(4)} 1) translate(-20864 0)">`
      + `<path d="M38058.4 41225.1c0,0 -9.7,1238.8 -29,3170.8l0 125c-63.6,6197.8 -228.8,19194.3 -531.1,21675.3 0,0 159.9,4194 -2081,6298.8 0,0 -5,1.8 -14.4,5 0,0 -4.9,1.5 -13,4.5 -5,1.5 -9.4,3.3 -14.4,5.1 -38.5,12.6 -118.1,39.8 -238.5,76.7 -83.4,27.3 -184.2,57.5 -302.6,94.3 -12.5,5 -25.3,8.1 -38.3,11.5 -124.9,36.5 -267.4,78.4 -425.8,124.7 -70.4,19.2 -144.3,40.1 -220.9,62.5 -126.3,33.5 -264,71.9 -409.9,110.5 -160.2,43 -332.9,87.9 -515.5,134.3 -1.4,1.6 -2.9,1.6 -4.7,1.6 -99.2,24.1 -201.7,49.5 -307.4,76.8 -103.8,25.7 -212.9,51.3 -324.8,78.5 -4.9,1.6 -8.3,1.6 -13,3.4 -68.8,15.8 -140.9,33.4 -212.9,49.6 -502.7,116.8 -1059.7,237 -1666.5,356.8 -2511.4,494.8 -5863.1,958.7 -9657,987.6l0 1.7 -347.3 0 0 -1.7c-3801.7,-27.1 -7158.6,-494.5 -9669.8,-990.8 -694.7,-136 -1323.6,-275.3 -1880.9,-408.1 -5,-1.6 -8.1,-1.6 -12.8,-3.2 -1784.9,-424.3 -2815.6,-781.3 -2815.6,-781.3 -949.3,-891.6 -1466.4,-2156.2 -1749.7,-3318.3 -313.8,-1291.6 -336,-2458.5 -334.5,-2846.1 0,-60.7 1.6,-102.4 3.2,-121.7 0,-8 0,-12.8 0,-12.8 -400.2,-3281.5 -560.1,-24971.1 -560.1,-24971.1l480 -21729.6c-240,-2601.5 0,-8444 0,-8444 520.2,-4762.3 3121.6,-7603.4 3121.6,-7603.4 1627.6,-1780 3475.1,-2631.8 5214.9,-3042.9 0,0 0,0 1.3,0 1469.7,-349.1 2862.3,-384.3 3987.8,-398.9 987.7,-12.5 3681.7,-2.9 4388.9,0 706.2,-2.9 3401.8,-12.5 4387.7,0 2457.2,32.4 6203.1,160.5 9204.2,3441.8 0,0 2601.2,2841.1 3121.3,7603.4 0,0 240,5842.5 0,8444l480.3 21729.6z" fill="#9399a5" stroke="${col}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`
      + `<path d="M35231 16296.6c-640.2,-3308.1 -6429.3,-5549.3 -14366.4,-5549.3 -7937.1,0 -13726.2,2241.2 -14366.4,5549.3 -640.5,3308.2 2080.7,15740.7 2080.7,15740.7 3361.7,-1280.9 9182.9,-1760.9 12285.6,-1760.9 3102.9,0 8923.8,480 12285.4,1760.9 0,0 2721.2,-12432.5 2081,-15740.7z" fill="#D1D3D4"/>`
      + `<path d="M29054.8 35702.8l-16380.8 0c-882.6,0 -1601,717.9 -1601,1600.4l0 8163.6c0,882.6 718.5,1600.9 1601,1600.9l16380.8 0c882.6,0 1600.7,-718.2 1600.7,-1600.9l0 -8163.6c0,-882.5 -718.2,-1600.4 -1600.7,-1600.4z" fill="#E6E6E8"/>`
      + `<path d="M5310.4 18788.5c0,0 853.6,7843.2 1333.9,10831.5 480.3,2987.8 1165.6,15153.3 1249.6,19048.4l0 7950.3c0,0 -480.2,3734.9 -1291.5,5602.4l-686.1 2030.4 -285.6 263.8c0,0 -1387.3,-36869.6 -320.2,-45726.8z" fill="#D1D3D4"/>`
      + `<path d="M33150.5 32394c-3361.4,-1280.6 -9183.3,-1760.9 -12285.6,-1760.9 -3103.4,0 -8923.8,480.2 -12285.4,1760.9 0,0 -2721.2,-12431.2 -2080.7,-15739.6 78.5,-405.4 233.5,-794.1 460.9,-1165.6 1627.9,-2658.8 6939,-4384.2 13905.2,-4384.2 7451.4,0 13009.3,1975.3 14192.1,4954.2 76.9,195.2 136.2,393.7 174.5,595.6 640.2,3308.4 -2081,15739.6 -2081,15739.6z" fill="#131313"/>`
      + `<path d="M34416.5 19255.2c-79.8,1400.7 -1240.4,9004.1 -1440.6,10564.7 -199.8,1560.8 -1040.4,1240.7 -1040.4,1240.7 -3521.5,-1000.5 -8280.7,-1400.9 -11070.7,-1400.9 -1357.3,0 -3179,96.5 -5096.4,307.8 -2028.1,223.8 -4165.2,579.1 -5975.3,1093.1 0,0 -840.6,320.1 -1040.9,-1240.7 -199.8,-1560.5 -1360.5,-9164 -1440.6,-10564.7 0,0 160.2,-1440.8 1640.9,-1760.6 430.7,-92.8 945.9,-243.4 1597.9,-419.4 1888.2,-510.8 4917.2,-1232.4 10314.5,-1381.7 7256.2,200.1 10232,1437.5 11911.2,1801.1 1480.5,319.9 1640.4,1760.6 1640.4,1760.6z" fill="#110F13" fill-opacity="0.600000"/>`
      + `<path d="M33657.4 68357.4l-12792.5 132.7 -12792.8 -132.7c0,0 -1205.2,2949.9 1055,4919 2570.7,612.8 6703.7,1366.9 11563.5,1402.1l0 1.7 173.8 0 0.5 0 174 0 0 -1.7c4859.6,-35.2 8992.6,-789.3 11563.5,-1402.1 2260.2,-1969.1 1055,-4919 1055,-4919z" fill="#131313"/>`
      + `<path d="M5484.4 18788.5c0,0 853.6,7843.2 1333.6,10831.5 480.2,2987.8 1165.3,15153.3 1249.6,19048.4l0 7950.3c0,0 -480,3734.9 -1291.6,5602.4l-971.8 2294.2c0,0 -1387.3,-36869.6 -319.9,-45726.8z" fill="#131313"/>`
      + `<path d="M8067.4 48668.5l0 7950.8c0,0 -480.5,3734.5 -1291.8,5602.5l-657.7 1552.7c-25.8,-738 -70.7,-1998 -125.2,-3641.7 -7.8,-264.1 -15.9,-537.8 -27.1,-821.1 -102.2,-3227.2 -233.8,-7666 -341,-12461.8 -27.1,-1261.3 -54.2,-2548.4 -79.8,-3844.8 -160.2,-8634.2 -209.8,-17676.7 126.2,-22528.5 280.3,2476.2 808.2,7027.2 1147.9,9143.4 480,2988.6 1165.3,15153.7 1248.5,19048.4z" fill="#110F13" fill-opacity="0.600000"/>`
      + `<path d="M5285.4 46849.9c1061,467.4 2066.3,712.3 2754.6,837.3 -27.2,-803.7 -68.9,-1789.7 -120.3,-2882.9 -1133,-590.6 -2096.6,-1299.6 -2714.6,-1799.1l80.3 3844.8z" fill="#131313"/>`
      + `<path d="M20864.6 726.9c-1725.7,0 -5349,159.9 -6830,1000.4 0,0 3374.9,-479.9 6830,-479.9 3455,0 6829.7,479.9 6829.7,479.9 -1480.5,-840.5 -5104,-1000.4 -6829.7,-1000.4z" fill="#1f1f23"/>`
      + `<path d="M3700.3 44520.9l12.8 4.8 1498.2 398.6c72.5,68.8 422.7,396.9 912.8,745.9 520.1,371.3 1197.4,763.7 1860,886.9l22.2 -118.4c-665.8,-123.3 -1360.5,-541.1 -1880.7,-918.8 -496.1,-360.3 -835.5,-685.2 -841.8,-691.7l-11.2 -10.8 -1559.5 -416.5 -14.3 -4.8 1.5 125z" fill="#131313"/>`
      + `<path d="M7346.9 60454.5c-55.8,220.8 -115,438.7 -177.4,648.3l-1515.9 -970.2c-9.7,-264.1 -17.7,-537.8 -27.4,-821.1l1720.7 1142.9z" fill="#131313"/>`
      + `<path d="M5797.2 65027.8c-129.1,473.9 -502.4,1128.4 -1570,1302.9 0,-60.7 1.6,-102.4 3.2,-121.7 1584.8,-268.8 1558.7,-2137.8 1555.3,-2198.9l160.5 -59.8c0,6.3 -70.2,789.5 -148.9,1077.5z" fill="#131313"/>`
      + `<path d="M10416.3 67881.7l-480.3 -9.2c237.2,-12332.3 -1396.4,-35627.3 -1413.2,-35861.3l479 -33.6c16.4,234 1651.8,23550.5 1414.4,35904.1z" fill="#131313"/>`
      + `<path d="M30335.2 45466.9c0,707.3 -573.5,1280.7 -1280.4,1280.7l-16380.8 0c-707.5,0 -1280.6,-573.4 -1280.6,-1280.7l0 -8163.6c0,-707.1 573.2,-1280.6 1280.6,-1280.6l16380.8 0c707,0 1280.4,573.5 1280.4,1280.6l0 8163.6z" fill="#131313"/>`
      + `<path d="M7614.5 15270.6c-118.4,-394.7 -1087.8,-3369.8 -1097.8,-3400l114 -37.3c9.9,30 979.6,3006.6 1098.5,3402.9l-114.8 34.5z" fill="#131313"/>`
      + `<path d="M33657.2 68077.1c-80.1,-440 -920.4,-480.1 -920.4,-480.1l-11872.2 0 -11872.2 0c0,0 -840,40.1 -920.3,480.1 -80,440.3 853.9,3441.6 12792.5,3441.6 11938.4,0 12872.4,-3001.4 12792.6,-3441.6z" fill="#131313"/>`
      + `<path d="M6151.3 24845l-933.1 -775c-166.7,-41.5 -321.9,-12.5 -457.8,46.6 -110.3,48 -207.9,115.1 -286.7,182.6 -135.9,115 -216,225.7 -216,225.7 -832.4,1139.5 -3505.4,1243.6 -4080.1,1251.7 -70.4,1.5 -109,1.5 -109,1.5 -587.2,-1920.8 2774.1,-2828.4 3601.9,-3094.2 204.8,-65.7 433.8,-168 662.4,-281.8 688.5,-345.7 1365.4,-813.1 1365.4,-813.1 373,1574.9 453.1,3256 453.1,3256z" fill="#9399a5"/>`
      + `<path d="M4473.6 24299.3c-135.9,115 -216,225.7 -216,225.7 -832.4,1139.5 -3505.4,1243.6 -4080.1,1251.7 224.1,-270.6 736.4,-667.6 1892.1,-1012 1376.4,-409.6 2077.6,-585.4 2404,-465.4z" fill="#131313"/>`
      + `<path d="M6151.3 24845l-933.1 -775c-166.7,-41.5 -321.9,-12.5 -457.8,46.6 -135.9,-892.9 -308.9,-1426.2 -427.6,-1714.5 688.5,-345.7 1365.4,-813.1 1365.4,-813.1 373,1574.9 453.1,3256 453.1,3256z" fill="#131313"/>`
      + `<path d="M33657.2 68357.4c-80.1,-440.4 -920.4,-480.3 -920.4,-480.3l-11872.2 0 -11872.2 0c0,0 -840,39.9 -920.3,480.3 -80,440 853.9,3441.4 12792.5,3441.4 11938.4,0 12872.4,-3001.4 12792.6,-3441.4z" fill="#26262b"/>`
      + `<path d="M36418.7 18788.5c0,0 -853.6,7843.2 -1333.9,10831.5 -480.2,2987.8 -1165.8,15153.3 -1249.8,19048.4l0 7950.3c0,0 480.3,3734.9 1291.8,5602.4l686.1 2030.4 285.6 263.8c0,0 1387.3,-36869.6 320.1,-45726.8z" fill="#D1D3D4"/>`
      + `<path d="M36244.7 18788.5c0,0 -853.3,7843.2 -1333.6,10831.5 -480.5,2987.8 -1165.8,15153.3 -1249.8,19048.4l0 7950.3c0,0 480.2,3734.9 1291.5,5602.4l971.8 2294.2c0,0 1387.3,-36869.6 320.1,-45726.8z" fill="#131313"/>`
      + `<path d="M33661.9 48668.5l0 7950.8c0,0 480.2,3734.5 1291.5,5602.5l658.2 1552.7c25.6,-738 70.7,-1998 124.7,-3641.7 8.1,-264.1 16.1,-537.8 27.1,-821.1 102.5,-3227.2 233.8,-7666 341.2,-12461.8 27.2,-1261.3 54.3,-2548.4 80.1,-3844.8 159.9,-8634.2 209.5,-17676.7 -126.8,-22528.5 -280,2476.2 -808.2,7027.2 -1147.6,9143.4 -480.2,2988.6 -1165.3,15153.7 -1248.5,19048.4z" fill="#110F13" fill-opacity="0.600000"/>`
      + `<path d="M36444 46849.9c-1061.2,467.4 -2066.3,712.3 -2755.1,837.3 27.4,-803.7 68.9,-1789.7 120,-2882.9 1133.4,-590.6 2096.9,-1299.6 2714.9,-1799.1l-79.9 3844.8z" fill="#131313"/>`
      + `<path d="M38029.4 44395.9l0 125 -15.9 4.8 -1496.6 398.6c-72,68.8 -422.7,396.9 -910.7,745.9 -520.2,371.3 -1197.4,763.7 -1860.3,886.9l-22.5 -118.4c664.8,-123.3 1359.5,-539.4 1879.7,-918.8 497.4,-358.6 835.5,-685.2 841.8,-691.7l11.2 -10.8 1559.2 -416.5 14.1 -4.8z" fill="#131313"/>`
      + `<path d="M34382.2 60454.5c56,220.8 115.6,438.7 177.6,648.3l1515.9 -970.2c9.6,-264.1 17.5,-537.8 27.4,-821.1l-1721 1142.9z" fill="#131313"/>`
      + `<path d="M35931.5 65027.8c129.9,473.9 502.7,1128.4 1570.4,1302.9 0,-60.7 -1.5,-102.4 -3.3,-121.7 -1584.6,-268.8 -1558.5,-2137.8 -1555.1,-2198.9l-160.7 -59.8c0,6.3 70.7,789.5 148.7,1077.5z" fill="#131313"/>`
      + `<path d="M31312.9 67881.7l480.2 -9.2c-237.1,-12332.3 1396.5,-35627.3 1413.2,-35861.3l-479 -33.6c-16.4,234 -1651.8,23550.5 -1414.4,35904.1z" fill="#131313"/>`
      + `<path d="M34115 15270.6c118.1,-394.7 1087.5,-3369.8 1097.2,-3400l-114 -37.3c-9.9,30 -979.8,3006.6 -1098.5,3402.9l115.3 34.5z" fill="#131313"/>`
      + `<path d="M35578 24845l933.1 -775c166.4,-41.5 321.7,-12.5 458.1,46.6 110.1,48 207.9,115.1 286.5,182.6 135.9,115 216,225.7 216,225.7 832.4,1139.5 3505.6,1243.6 4080.3,1251.7 70.2,1.5 108.8,1.5 108.8,1.5 587.5,-1920.8 -2774.4,-2828.4 -3601.6,-3094.2 -204.8,-65.7 -433.8,-168 -662.9,-281.8 -688.2,-345.7 -1365.4,-813.1 -1365.4,-813.1 -372.8,1574.9 -452.8,3256 -452.8,3256z" fill="#9399a5"/>`
      + `<path d="M35578 24845l933.1 -775c166.4,-41.5 321.7,-12.5 458.1,46.6 135.9,-892.9 309,-1426.2 427.1,-1714.5 -688.2,-345.7 -1365.4,-813.1 -1365.4,-813.1 -372.8,1574.9 -452.8,3256 -452.8,3256z" fill="#131313"/>`
      + `<path d="M34416.5 19255.2c-79.8,1400.7 -1240.4,9004.1 -1440.6,10564.7 -199.8,1560.8 -1040.4,1240.7 -1040.4,1240.7 -3521.5,-1000.5 -8280.7,-1400.9 -11070.7,-1400.9 -1357.3,0 -3179,96.5 -5096.4,307.8l-5218 -12892.4c1888.2,-510.8 4917.2,-1232.4 10314.5,-1381.7 7256.2,200.1 10232,1437.5 11911.2,1801.1 1480.5,319.9 1640.4,1760.6 1640.4,1760.6z" fill="#ffffff" fill-opacity="0.35"/>`
      + `<path d="M35057 16058.7c-12053.2,-4442.2 -23546.6,-1923.9 -28097.3,-570 1627.9,-2658.8 6939,-4384.2 13905.2,-4384.2 7451.4,0 13009.3,1975.3 14192.1,4954.2z" fill="#ffffff" fill-opacity="0.25"/>`
      + `</g></svg>`;
  }
  const cota = (v, anchor, x, y, fs, c) => (!validD(v) || !c)
    ? `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${fs}" fill="currentColor" opacity="0.45" text-anchor="${anchor}">—</text>`
    : `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${fs}" font-weight="bold" fill="${c}" text-anchor="${anchor}"${HALO}>${Math.round(v)}</text>`;
  // Lecturas FUERA de las paredes, fuente 50% mayor (13→20, 14→21).
  const ySenLbl = Y(25) + 7;
  s += cota(iz, "end", X(-vanoW / 2) - 8, ySenLbl, 20, izCol);
  s += cota(de, "start", X(vanoW / 2) + 8, ySenLbl, 20, deCol);
  if (showCar) {
    // Cotas del espacio medido: línea SÓLIDA con terminaciones
    // perpendiculares. Laterales: poste→flanco a altura de sensores.
    // Fondo: pared→morro CENTRADA (el valor va arriba).
    // La línea DE PUNTOS va solo entre cada cota y su número, para
    // vincularlas visualmente.
    const ySen = Y(25);
    const flankL = X(off) - (carW * sx) / 2, flankR = X(off) + (carW * sx) / 2;
    const tickV = (x, y, c) => `<line x1="${x.toFixed(1)}" y1="${(y - 5).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y + 5).toFixed(1)}" stroke="${c}" stroke-width="1.5"/>`;
    const tickH = (x, y, c) => `<line x1="${(x - 5).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + 5).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${c}" stroke-width="1.5"/>`;
    const dimL = (x1, y1, x2, y2, c) => `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c}" stroke-width="1.5"/>`;
    const leader = (x1, y1, x2, y2, c) => `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c}" stroke-width="1.5"${DOTS}/>`;
    if (validD(iz)) {
      const x1 = X(-gateW / 2);
      s += dimL(x1, ySen, flankL, ySen, izCol) + tickV(x1, ySen, izCol) + tickV(flankL, ySen, izCol);
      s += leader(X(-vanoW / 2) - 8, ySen, x1, ySen, izCol);
    }
    if (validD(de)) {
      const x2 = X(gateW / 2);
      s += dimL(flankR, ySen, x2, ySen, deCol) + tickV(flankR, ySen, deCol) + tickV(x2, ySen, deCol);
      s += leader(x2, ySen, X(vanoW / 2) + 8, ySen, deCol);
    }
    if (hasFondo) {
      s += dimL(X(0), Y(L), X(0), frontY, fCol) + tickH(X(0), Y(L), fCol) + tickH(X(0), frontY, fCol);
      s += leader(X(0), Y(L) - 8, X(0), Y(L), fCol);
    }
    s += hasFondo
      ? `<text x="${(X(0)).toFixed(1)}" y="${(Y(L) - 10).toFixed(1)}" font-size="21" font-weight="bold" fill="${fCol}" text-anchor="middle"${HALO}>${Math.round(f)}</text>`
      : `<text x="${(X(0)).toFixed(1)}" y="${(Y(L) - 10).toFixed(1)}" font-size="11" fill="currentColor" opacity="0.7" text-anchor="middle">sin eco</text>`;
    // cotas del auto junto a él: ancho bajo la cola, largo rotado al centro
    s += `<text x="${(X(off)).toFixed(1)}" y="${(frontY + carH + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.45">${carW}cm</text>`;
    {
      const lx = X(off), ly = frontY + carH / 2;
      s += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" transform="rotate(-90 ${lx.toFixed(1)} ${ly.toFixed(1)})" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.45">${carL}cm</text>`;
    }
  } else {
    s += `<text x="${(X(0)).toFixed(1)}" y="${(tgtFrontY + tgtH / 2).toFixed(1)}" font-size="11" font-weight="bold" fill="#9aa0a6" text-anchor="middle" opacity="0.9">sin auto</text>`;
  }
  svg.innerHTML = s;
  const names = { stop: "STOP", alerta: "ALERTA", prec: "PRECAUCIÓN", normal: "NORMAL", reposo: "LISTO", none: "—" };
  const badge = $("modeBadge");
  const label = (S.modo || names[t] || "—");
  badge.textContent = label;
  badge.className = "badge " + (t === "stop" ? "bad" : t === "alerta" ? "warn" : t === "normal" || t === "prec" ? "ok" : "info");
  if (S.prueba && S.prueba !== "Automático") {
    badge.textContent = "PRUEBA · " + label;
    badge.className = "badge warn";
  }
}

/* ---------- Matriz 32x8 aproximada ---------- */
const MC = $("matrix").getContext("2d");
const PX = 8;
const DIG36 = [ // digitos 3x6 del usuario (num.gif, tira 1-9,0)
  [0x7,0x5,0x5,0x5,0x5,0x7],[0x6,0x2,0x2,0x2,0x2,0x7],[0x7,0x1,0x7,0x4,0x4,0x7],
  [0x7,0x1,0x3,0x1,0x1,0x7],[0x5,0x5,0x5,0x7,0x1,0x1],[0x7,0x4,0x7,0x1,0x1,0x7],
  [0x7,0x4,0x7,0x5,0x5,0x7],[0x7,0x1,0x1,0x1,0x1,0x1],[0x7,0x5,0x7,0x5,0x5,0x7],
  [0x7,0x5,0x5,0x7,0x1,0x7],
];
const GLYPH = { R:[0,28,18,18,28,18,18,0], E:[0,14,16,28,16,16,14,0], A:[0,12,18,18,30,18,18,0],
  D:[0,28,18,18,18,18,28,0], Y:[0,18,18,18,14,2,28,0], S:[0,14,16,12,2,2,28,0],
  T:[0,31,4,4,4,4,4,0], O:[0,12,18,18,18,18,12,0], P:[0,28,18,18,28,16,16,0], _: [0,0,0,0,0,0,0,30] };
const CHEV_C = { right: [0, 1, 2, 1, 0], left: [2, 1, 0, 1, 2] };
/* Marquesina lateral 7x5 del usuario (d==0: filas 0,4; d==1: 1,3; d==2: fila 2) */
const CHEVUP = [ // 4 frames 7x8, idénticos al firmware
  [28,54,99,73,28,54,99,73],
  [54,99,73,28,54,99,73,28],
  [99,73,28,54,99,73,28,54],
  [73,28,54,99,73,28,54,99],
];
const CHEVDER = [ // 4 frames 7x5, idénticos al firmware
  [102,51,25,51,102],
  [51,25,12,25,51],
  [25,76,102,76,25],
  [76,102,51,102,76],
];
const mirror7 = (v) => ((v & 0x40) >> 6) | ((v & 0x20) >> 4) | ((v & 0x10) >> 2) |
  (v & 8) | ((v & 4) << 2) | ((v & 2) << 4) | ((v & 1) << 6);
/* STOP gigante 32x8 (bit 31 = x0), idéntico al firmware */
const STOP32 = [0x00000000, 0x7EFEFEFE, 0x6018C2C2, 0x7F18C2C2,
                0x0318C2FE, 0x0318C2C0, 0x7F18FEC0, 0x00000000];
/* Paleta de LED (configurable en Configuración → Pantalla, default azul) */
const LED_COLORS = {
  azul:   { on: "#4d8dff", dim: "rgba(77,141,255,0.45)" },
  rojo:   { on: "#ff4646", dim: "rgba(255,70,70,0.45)" },
  verde:  { on: "#3ddc74", dim: "rgba(61,220,116,0.45)" },
  blanco: { on: "#eef3f8", dim: "rgba(238,243,248,0.45)" },
  ambar:  { on: "#ffb224", dim: "rgba(255,178,36,0.45)" },
};
const OFF_BG = "#05070b", OFF_DOT = "#141a23";
const ledOn = () => (LED_COLORS[S.ledColor] || LED_COLORS.azul).on;
const ledDim = () => (LED_COLORS[S.ledColor] || LED_COLORS.azul).dim;
function dot(x, y, style) {
  if (x < 0 || x > 31 || y < 0 || y > 7) return;
  MC.fillStyle = style;
  MC.beginPath();
  MC.arc(x * PX + PX / 2, y * PX + PX / 2, PX / 2 - 0.8, 0, 6.2832);
  MC.fill();
}
function mpx(x, y, on, dim) {
  dot(x, y, on ? (dim ? ledDim() : ledOn()) : OFF_DOT);
}
function mclear(inv, dimAll) {
  MC.fillStyle = OFF_BG;
  MC.fillRect(0, 0, 256, 64);
  const st = inv ? (dimAll ? ledDim() : ledOn()) : OFF_DOT;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 32; x++) dot(x, y, st);
}
function mtext(x, y, str, inv) {
  let cx = x;
  for (const ch of str) {
    const g = GLYPH[ch];
    if (g) for (let r = 0; r < 8; r++) for (let c = 0; c < 5; c++)
      if (g[r] & (1 << (4 - c))) {
        dot(cx + c, y + r, inv ? OFF_BG : ledOn());
      }
    cx += 5;
  }
}
function mvline(x, y0, h, inv) {
  for (let y = y0; y < y0 + h && y < 8; y++) if (y >= 0) dot(x, y, inv ? OFF_BG : ledOn());
}
function renderMatrix() {
  const m = S.modo, N = S.number;
  const f = S.sensor.fondo, iz = S.sensor.izq, de = S.sensor.der;
  const t = Math.floor(Date.now() / 500) % 2 === 0;
  const inv = m.indexOf("STOP") >= 0 || m.indexOf("Peligro Poste") >= 0;
  if (m.indexOf("STOP") >= 0 || m.indexOf("Peligro Poste") >= 0) {
    const dim = (m.indexOf("Parada Crítica") >= 0) && (Math.floor(Date.now() / 300) % 2 === 1);
    mclear(true, dim);
    // STOP gigante: mapa de bits libre de 32x8 (bit 31 = x0)
    for (let y = 0; y < 8; y++) for (let x = 0; x < 32; x++)
      if (STOP32[y] & (1 << (31 - x))) dot(x, y, OFF_BG);
  } else if (m.indexOf("Retroceso") >= 0) {
    mclear(false);
    // Misma marquesina ^ invertida verticalmente: baja
    const fir = Math.floor(Date.now() / 300) % 4;
    [1, 24].forEach((x) => {
      for (let r = 0; r < 8; r++) {
        const bits = CHEVUP[fir][7 - r];
        for (let c = 0; c < 7; c++) if (bits & (1 << (6 - c))) mpx(x + c, r, true);
      }
    });
  } else if (m.indexOf("Alineación") >= 0) {
    mclear(false);
    const dif = (!isNaN(iz) && !isNaN(de)) ? (iz - de) * 10 : 0;
    const lim = N["Umbral Desvío Chevron (cm)"] || 5;
    const dev = Math.abs(iz - de) > lim;
    let x0 = 15, x1 = 16;
    if (dev) {
      const pos = Math.max(0, Math.min(31, 15 + Math.round(dif / 20)));
      if (pos > 16) { x0 = 16; x1 = pos; } else { x0 = pos; x1 = 15; }
    }
    for (let x = x0; x <= x1; x++) mvline(x, 0, 8, false);
    const carve = [x0, x1];
    const drawN = (x, v) => {
      v = Math.max(0, Math.min(99, Math.round(v || 0)));
      const ds = v >= 10 ? [Math.floor(v / 10), v % 10] : [v];
      ds.forEach((d, i) => {
        for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++)
          if (DIG36[d][r] & (1 << (2 - c))) {
            const px = x + i * 4 + c;
            const inBar = px >= carve[0] && px <= carve[1];
            dot(px, 1 + r, inBar ? OFF_BG : ledOn());
          }
      });
    };
    drawN(0, iz); drawN(isNaN(de) || de >= 10 ? 25 : 29, de);
    if (dev) {
      // Marquesina 7x5 del usuario (4 frames @~100 ms = aprox. normal); izquierda = espejo
      const fi = Math.floor(Date.now() / 100) % 4;
      const drawM7 = (bx, mirror) => {
        for (let r = 0; r < 5; r++) {
          let bits = CHEVDER[fi][r];
          if (mirror) bits = mirror7(bits);
          for (let c = 0; c < 7; c++) if (bits & (1 << (6 - c))) mpx(bx + c, 1 + r, true);
        }
      };
      if (iz > de) drawM7(8, true); // pegado a derecha → corre a la izquierda
      else drawM7(17, false); // pegado a izquierda → corre a la derecha
    }
  } else if (m.indexOf("Aproximación") >= 0) {
    mclear(false);
    const ini = N["Umbral Inicio (cm)"] || 150, stp = N["Umbral STOP (cm)"] || 10;
    const den = Math.max(1, ini - stp);
    const fill = isNaN(f) ? 0 : Math.max(0, Math.min(24, Math.round((ini - f) / den * 24)));
    for (let x = 0; x < fill; x++) mvline(x, 0, 8, false);
    if (!isNaN(f)) {
      const v = Math.max(0, Math.min(999, Math.round(f)));
      const ds = String(v).split("").map(Number);
      ds.forEach((d, i) => {
        for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++)
          if (DIG36[d][r] & (1 << (2 - c))) {
            const px = i * 4 + c;
            dot(px, 1 + r, (px < fill) ? OFF_BG : ledOn());
          }
      });
    }
    const ini7 = N["Umbral Inicio (cm)"] || 150, pre7 = N["Umbral Precaucion (cm)"] || 50;
    // Fase continua como el firmware (el render web no es un tick fijo: avanza
    // por tiempo real transcurrido). Velocidad 0.5..1 frames/tick interpolada.
    const now7 = Date.now();
    if (!S._chevLastT) S._chevLastT = now7;
    const dt7 = Math.min(2000, Math.max(0, now7 - S._chevLastT));
    S._chevLastT = now7;
    let span7 = ini7 - pre7;
    if (!(span7 >= 1)) span7 = 1;
    let t7 = isNaN(f) ? 1 : (f - pre7) / span7;
    t7 = Math.max(0, Math.min(1, t7));
    S._chevPhase = (((S._chevPhase || 0) + (dt7 / 100) * (0.5 + 0.5 * t7)) % 4 + 4) % 4;
    const fi7 = Math.floor(S._chevPhase);
    for (let r = 0; r < 8; r++) {
      const bits = CHEVUP[fi7][r];
      for (let c = 0; c < 7; c++) {
        if (bits & (1 << (6 - c))) {
          const px = 25 + c;
          dot(px, r, (px < fill) ? OFF_BG : ledOn());
        }
      }
    }
    if (m.indexOf("Alerta") >= 0 && (Math.floor(Date.now() / 300) % 2 === 1)) {
      MC.fillStyle = "rgba(0,0,0,0.45)"; MC.fillRect(0, 0, 256, 64);
    }
  } else {
    mclear(false);
    mtext(1, 0, "READY");
    if (t) mtext(26, 0, "_");
  }
}

function render() { renderName(); renderSvg(); renderMatrix(); renderAdv(); if ($("sysDialog").open) renderSys(); }

/* ---------- Nombre de la cochera (barra + pestaña) ---------- */
function renderName() {
  const n = (S.nombre || "").trim() || "Cochera";
  const el = $("garageName");
  if (el && el.textContent !== n) el.textContent = n;
  const t = n + " · Asistente de Estacionamiento";
  if (document.title !== t) document.title = t;
  const inp = $("nameInput");
  if (inp && document.activeElement !== inp && inp.value !== (S.nombre || "")) inp.value = S.nombre || "";
}

/* ---------- Estado avanzado (select Modo Prueba + reinicio, estilo reloj) ---------- */
function renderAdv() {
  const sel = $("testModeSel");
  if (sel && document.activeElement !== sel && S.prueba && sel.value !== S.prueba) {
    if ([...sel.options].some((o) => o.value === S.prueba || o.text === S.prueba)) sel.value = S.prueba;
  }
  $("advTestState").textContent = S.prueba || "Automático";
  $("advRebootBtn").disabled = S.status !== "connected";
  const manual = S.prueba === "Manual";
  $("manualBox").hidden = !manual;
  if (manual && S.status === "connected") {
    if (!manualBuilt && !manualPending) {
      manualPending = true;
      ensureTestCfg().then(buildManual).catch(() => {}).finally(() => { manualPending = false; });
    }
    else if (manualBuilt) refreshManual();
  }
}

/* ---------- Distancias manuales (opción Manual del Modo Prueba) ---------- */
let manualBuilt = false, manualPending = false;
const manualRows = []; // {n, rg, nm, out, msg, paint}
async function ensureTestCfg() {
  await Promise.all(NUMBERS_TEST.map(async (n) => {
    if (S.numCfg[n]) return;
    try {
      const d = await apiGet("/number/" + enc(n) + "?detail=all");
      S.numCfg[n] = {
        min: parseFloat(d.min_value !== undefined ? d.min_value : d.min ?? 0),
        max: parseFloat(d.max_value !== undefined ? d.max_value : d.max ?? 100),
        step: parseFloat(d.step !== undefined ? d.step : d.step ?? 1),
      };
      if (d.value !== undefined) S.number[n] = parseFloat(d.value);
    } catch (e) {
      S.numCfg[n] = { min: 0, max: 100, step: 1 };
    }
  }));
}
function buildManual() {
  const box = $("cfgManual");
  box.innerHTML = "";
  manualRows.length = 0;
  NUMBERS_TEST.forEach((n) => {
    const cfg = S.numCfg[n] || { min: 0, max: 100, step: 1 };
    const row = document.createElement("div");
    row.className = "cfg-row";
    row.innerHTML = `<label><span></span><output></output></label>
      <input type="range" min max step value>
      <div class="numrow"><input type="number" min max step><span class="msg"></span></div>`;
    row.querySelector("label span").textContent = n + " (0 = sin eco)";
    const out = row.querySelector("output");
    const rg = row.querySelector('input[type="range"]');
    const nm = row.querySelector('input[type="number"]');
    const msg = row.querySelector(".msg");
    [rg, nm].forEach((el) => { el.min = cfg.min; el.max = cfg.max; el.step = cfg.step; });
    const cur = () => (S.number[n] !== undefined ? S.number[n] : 0);
    const paint = () => {
      if (document.activeElement === rg || document.activeElement === nm) return;
      rg.value = cur(); nm.value = cur();
      out.textContent = cur() <= 0 ? "sin eco" : cur();
    };
    paint();
    const commit = async (raw) => {
      let v = parseFloat(raw);
      if (isNaN(v)) { paint(); return; }
      v = Math.max(cfg.min, Math.min(cfg.max, v));
      try { await numSet(n, v); S.number[n] = v; paint(); render(); }
      catch (e) { msg.textContent = "⚠ no se pudo guardar"; msg.classList.add("err"); }
    };
    rg.addEventListener("change", () => commit(rg.value));
    nm.addEventListener("change", () => commit(nm.value));
    rg.addEventListener("input", () => { nm.value = rg.value; out.textContent = rg.value <= 0 ? "sin eco" : rg.value; });
    box.appendChild(row);
    manualRows.push({ paint });
  });
  manualBuilt = true;
}
function refreshManual() {
  manualRows.forEach((r) => r.paint());
}

/* ---------- Config ---------- */
const CFG_GROUPS = [
  ["cfgDistancia", ["Tiempo Inactividad STOP (s)", "Umbral Inicio (cm)", "Umbral Precaucion (cm)", "Umbral Alerta (cm)", "Umbral STOP (cm)"]],
  ["cfgLateral", ["Umbral Lateral (cm)", "Umbral Desvío Chevron (cm)", "Umbral Poste Lateral (cm)"]],
  ["cfgDims", ["Ancho Portón (cm)", "Ancho Auto (cm)", "Ancho Auto con espejos (cm)", "Largo Garage (cm)", "Largo Auto (cm)"]],
];
let cfgBuilt = false;
async function ensureNumCfg() {
  const all = [...NUMBERS_DIST, ...NUMBERS_LAT, ...NUMBERS_DIM];
  await Promise.all(all.map(async (n) => {
    if (S.numCfg[n]) return;
    try {
      const d = await apiGet("/number/" + enc(n) + "?detail=all");
      S.numCfg[n] = {
        min: parseFloat(d.min_value !== undefined ? d.min_value : d.min ?? 0),
        max: parseFloat(d.max_value !== undefined ? d.max_value : d.max ?? 100),
        step: parseFloat(d.step !== undefined ? d.step : d.step ?? 1),
      };
      if (d.value !== undefined) S.number[n] = parseFloat(d.value);
    } catch (e) {
      S.numCfg[n] = { min: 0, max: 100, step: 1 };
    }
  }));
}
function coherenceError(vals) {
  const g = (n) => vals[n] !== undefined ? vals[n] : S.number[n];
  if (!(g("Umbral STOP (cm)") < g("Umbral Alerta (cm)"))) return "STOP debe ser < Alerta";
  if (!(g("Umbral Alerta (cm)") <= g("Umbral Precaucion (cm)"))) return "Alerta debe ser ≤ Precaución";
  if (!(g("Umbral Precaucion (cm)") < g("Umbral Inicio (cm)"))) return "Precaución debe ser < Inicio";
  return "";
}
function buildConfig() {
  CFG_GROUPS.forEach(([boxId, names]) => {
    const box = $(boxId);
    box.innerHTML = "";
    names.forEach((n) => {
      const cfg = S.numCfg[n] || { min: 0, max: 100, step: 1 };
      const row = document.createElement("div");
      row.className = "cfg-row";
      row.innerHTML = `<label><span></span><output></output></label>
        <input type="range" min max step value>
        <div class="numrow"><input type="number" min max step><span class="msg"></span></div>`;
      const lab = row.querySelector("label span"); lab.textContent = n;
      const out = row.querySelector("output");
      const rg = row.querySelector('input[type="range"]');
      const nm = row.querySelector('input[type="number"]');
      const msg = row.querySelector(".msg");
      [rg, nm].forEach((el) => { el.min = cfg.min; el.max = cfg.max; el.step = cfg.step; });
      const cur = () => (S.number[n] !== undefined ? S.number[n] : DEFAULTS[n]);
      const paint = () => { rg.value = cur(); nm.value = cur(); out.textContent = cur(); };
      paint();
      const commit = async (raw) => {
        let v = parseFloat(raw);
        if (isNaN(v)) { paint(); return; }
        v = Math.max(cfg.min, Math.min(cfg.max, v));
        const trial = Object.assign({}, S.number, { [n]: v });
        const err = coherenceError(trial);
        if (err && ["Umbral STOP (cm)", "Umbral Alerta (cm)", "Umbral Precaucion (cm)", "Umbral Inicio (cm)"].indexOf(n) >= 0) {
          msg.textContent = "⛔ " + err; msg.classList.add("err");
          row.classList.add("blocked"); paint(); return;
        }
        if ((n === "Ancho Auto con espejos (cm)" && v <= trial["Ancho Auto (cm)"]) ||
            (n === "Ancho Auto (cm)" && trial["Ancho Auto con espejos (cm)"] <= v)) {
          msg.textContent = "⛔ con espejos debe superar al ancho sin espejos"; msg.classList.add("err");
          row.classList.add("blocked"); paint(); return;
        }
        msg.textContent = ""; msg.classList.remove("err"); row.classList.remove("blocked");
        try { await numSet(n, v); S.number[n] = v; paint(); render(); }
        catch (e) { msg.textContent = "⚠ no se pudo guardar"; msg.classList.add("err"); }
      };
      rg.addEventListener("change", () => commit(rg.value));
      nm.addEventListener("change", () => commit(nm.value));
      rg.addEventListener("input", () => { nm.value = rg.value; out.textContent = rg.value; });
      box.appendChild(row);
    });
  });
  const sw = $("swPoste");
  sw.checked = S.poste;
  sw.onchange = async () => {
    try { await swSet(sw.checked); S.poste = sw.checked; }
    catch (e) { sw.checked = S.poste; }
  };
  const ni = $("nameInput");
  if (document.activeElement !== ni) ni.value = S.nombre || "";
  $("nameWarn").hidden = true;
  cfgBuilt = true;
}
async function openConfig() {
  openDialog("configDialog");
  try { await ensureNumCfg(); } catch (e) {}
  buildConfig();
}

/* ---------- Scan ---------- */
async function probeIp(ip, signal) {
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 2500);
    const onAbort = () => ctl.abort();
    if (signal) signal.addEventListener("abort", onAbort);
    const r = await fetch("http://" + ip + "/sensor/" + enc(SENSORS.fondo), { signal: ctl.signal });
    clearTimeout(to);
    if (!r.ok) return false;
    const d = await r.json();
    const id = String(d.id || "");
    return id === "sensor/" + SENSORS.fondo || id === "sensor-sensor_fondo";
  } catch (e) { return false; }
}
async function runScan() {
  const box = $("scanResults");
  box.innerHTML = "Escaneando…";
  const sub = $("subnetSel").value;
  const ctl = new AbortController();
  const ips = [];
  for (let i = 1; i <= 254; i++) ips.push(sub + "." + i);
  let idx = 0, found = [];
  const workers = [];
  const N = 24;
  async function worker() {
    while (idx < ips.length && !ctl.signal.aborted) {
      const ip = ips[idx++];
      if (await probeIp(ip, ctl.signal)) {
        found.push(ip);
        renderScanResults(found);
      }
    }
  }
  for (let i = 0; i < N; i++) workers.push(worker());
  await Promise.all(workers);
  if (!found.length) box.innerHTML = "<p class='small muted'>Sin resultados. Probá con la IP directa.</p>";
  function renderScanResults(list) {
    box.innerHTML = "";
    list.forEach((ip) => {
      const b = document.createElement("button");
      b.className = "secondary small";
      b.textContent = "Usar " + ip;
      b.onclick = () => { addUrl("http://" + ip); };
      box.appendChild(b);
    });
  }
}

/* ---------- URLs UI ---------- */
function renderUrlList() {
  const box = $("triedList");
  box.innerHTML = "";
  renderTried();
}
function addUrl(u) {
  u = u.trim().replace(/\/$/, "");
  if (!/^https?:\/\//.test(u)) u = "http://" + u;
  try {
    const h = new URL(u).hostname;
    if (!(h === "garage.local" || h === "garage.lan" || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || (h.indexOf(".") > 0 && h.length > 3))) {
      return false;
    }
  } catch (e) { return false; }
  const s = loadExtraUrls(); s.add(u); saveExtraUrls(s);
  $("newUrl").value = "";
  tryReconnect();
  return true;
}

/* ---------- Share / QR ---------- */
function openShare() {
  openDialog("shareDialog");
  const base = location.origin + location.pathname;
  const url = base + "?garage=" + encodeURIComponent(S.base || "http://garage.local");
  $("shareUrl").textContent = url;
  try {
    window.QRCode.toCanvas($("qrCanvas"), url, { width: 180, margin: 1 });
  } catch (e) {
    $("shareUrl").textContent += " (QR no disponible sin red)";
  }
}

/* ---------- Tema ---------- */
function applyTheme(t) {
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}
function cycleTheme() {
  let t = "auto";
  try { t = localStorage.getItem("cochera_theme") || "auto"; } catch (e) {}
  t = t === "auto" ? "dark" : t === "dark" ? "light" : "auto";
  try { localStorage.setItem("cochera_theme", t); } catch (e) {}
  applyTheme(t);
}

/* ---------- Sistema + firmware ---------- */
function fmtBytes(v) {
  if (v === undefined || isNaN(v)) return "—";
  if (v >= 1048576) return (v / 1048576).toFixed(2) + " MB";
  if (v >= 1024) return (v / 1024).toFixed(1) + " kB";
  return Math.round(v) + " B";
}
function fmtDur(s) {
  if (s === undefined || isNaN(s)) return "—";
  s = Math.floor(s);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}
function wifiPct(rssi) {
  if (rssi === undefined || isNaN(rssi)) return "—";
  return Math.max(0, Math.min(100, Math.round(2 * (rssi + 100)))) + "%";
}
function parseFwDate(s) {
  // __DATE__ "Mmm dd yyyy" + __TIME__ "hh:mm:ss", ej: "Mar  5 2026 12:00:00"
  const M = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const m = String(s || "").match(/([A-Z][a-z]{2})\s+(\d+)\s+(\d+)\s+(\d+):(\d+):(\d+)/);
  if (!m) return null;
  return new Date(+m[3], M[m[1]] ?? 0, +m[2], +m[4], +m[5], +m[6]);
}
function renderSys() {
  const Y = S.sys;
  const set = (id, v) => { $(id).textContent = v; };
  set("sysIP", Y.ip || "—");
  set("sysSSID", Y.ssid || "—");
  set("sysWifi", (Y.rssi === undefined || isNaN(Y.rssi)) ? "—" : `${Y.rssi} dBm · ${wifiPct(Y.rssi)}`);
  set("sysBSSID", Y.bssid || "—");
  set("sysMAC", Y.mac || "—");
  set("sysVer", Y.ver || "—");
  set("sysFw", Y.fw || "—");
  set("sysUp", fmtDur(Y.up));
  set("sysReset", Y.reset || "—");
  set("sysCpu", (Y.cpu === undefined || isNaN(Y.cpu)) ? "—" : `${Math.round(Y.cpu / 1000000)} MHz`);
  set("sysHeap", fmtBytes(Y.heap));
  set("sysBlock", fmtBytes(Y.block));
  set("sysFrag", (Y.frag === undefined || isNaN(Y.frag)) ? "—" : `${Math.round(Y.frag)} %`);
  set("sysLoop", (Y.loop === undefined || isNaN(Y.loop)) ? "—" : `${(+Y.loop).toFixed(1)} ms`);
  set("sysMsgs", String(S.msgs));
  set("sysLat", S.lastEv ? `${Math.max(0, Date.now() - S.lastEv)} ms` : "—");
}
async function fwCheck() {
  const el = $("fwLatest"), box = $("fwAlert");
  $("fwInstalled").textContent = S.sys.fw || "—";
  if (!FW_REPO) {
    el.textContent = "sin configurar";
    box.innerHTML = `<p class="small muted">Definí FW_REPO en app.js (usuario/repo con ${FW_BIN} publicado) para comparar versiones. La subida manual funciona igual.</p>`;
    return;
  }
  el.textContent = "consultando…";
  try {
    const r = await fetch(`https://api.github.com/repos/${FW_REPO}/commits?path=${encodeURIComponent(FW_BIN)}&per_page=1`);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const c = await r.json();
    if (!c || !c.length) throw new Error("sin commits");
    const srv = new Date(c[0].commit.committer.date);
    el.textContent = srv.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const dev = parseFwDate(S.sys.fw);
    if (dev && srv.getTime() > dev.getTime() + 3600000) {
      box.innerHTML = `<p class="warn small"><strong>Hay versión más reciente.</strong> Descargá el .bin del repo y subilo abajo.</p>`;
    } else if (dev) {
      box.innerHTML = `<p class="small muted">El firmware está actualizado.</p>`;
    }
  } catch (e) {
    el.textContent = "no disponible";
    box.innerHTML = `<p class="small muted">No se pudo consultar GitHub (${e.message}).</p>`;
  }
}
function fwUpload() {
  const inp = $("fwFile");
  const bar = $("fwBar"), box = $("fwProg"), st = $("fwStatus");
  if (!inp.files || !inp.files.length) { st.textContent = "Elegí un archivo .bin primero."; box.hidden = false; return; }
  if (!S.base) { st.textContent = "Sin conexión al equipo."; box.hidden = false; return; }
  if (!confirm("Subir firmware al equipo. ¿Continuar?")) return;
  box.hidden = false;
  bar.value = 0;
  st.textContent = "Subiendo…";
  const xhr = new XMLHttpRequest();
  xhr.open("POST", S.base + "/update", true);
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      bar.value = Math.round((e.loaded / e.total) * 100);
      st.textContent = `Subiendo: ${bar.value}%`;
    }
  };
  xhr.onload = () => {
    if (xhr.status === 200) { st.textContent = "¡Listo! El equipo se reinicia solo."; }
    else { st.textContent = "Error del equipo: " + xhr.status; }
  };
  xhr.onerror = () => { st.textContent = "Bloqueado por el navegador (CORS/red). Probá desde la LAN con contenido inseguro permitido."; };
  const fd = new FormData();
  fd.append("update", inp.files[0]);
  xhr.send(fd);
}

/* ---------- Diálogos ---------- */
function openDialog(id) { const d = $(id); if (d && d.showModal) d.showModal(); }
function closeDialog(id) { const d = $(id); if (d && d.open) d.close(); }

/* ---------- Menú de 3 puntos ---------- */
function toggleMenu(force) {
  const m = $("menu");
  const show = force !== undefined ? force : m.hidden;
  m.hidden = !show;
  $("menuBtn").setAttribute("aria-expanded", show ? "true" : "false");
}
function menuGo(fn) { toggleMenu(false); fn(); }

/* ---------- Nombre de la cochera (Configuración) ---------- */
async function saveName() {
  const inp = $("nameInput"), warn = $("nameWarn");
  const v = inp.value.trim().replace(/\s+/g, " ");
  if (!v) { warn.textContent = "⛔ el nombre no puede estar vacío"; warn.hidden = false; return; }
  if (v.length > 64) { warn.textContent = "⛔ máximo 64 caracteres"; warn.hidden = false; return; }
  warn.hidden = true;
  const prev = S.nombre;
  try { await textSet(v); S.nombre = v; render(); }
  catch (e) {
    S.nombre = prev;
    warn.textContent = "⚠ no se pudo guardar (¿firmware con Nombre Cochera? reflashear)";
    warn.hidden = false;
  }
}

/* ---------- Arranque ---------- */
document.addEventListener("DOMContentLoaded", () => {
  try { applyTheme(localStorage.getItem("cochera_theme") || "auto"); } catch (e) {}
  $("menuBtn").onclick = (e) => { e.stopPropagation(); toggleMenu(); };
  document.addEventListener("click", (e) => {
    const m = $("menu");
    if (!m.hidden && !$("menuBtn").contains(e.target)) toggleMenu(false);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") toggleMenu(false); });
  $("mConfig").onclick = () => menuGo(openConfig);
  $("mTheme").onclick = () => menuGo(cycleTheme);
  $("mSys").onclick = () => menuGo(() => { renderSys(); openDialog("sysDialog"); });
  $("mAdv").onclick = () => menuGo(() => { $("advMsg").hidden = true; renderAdv(); openDialog("advDialog"); });
  $("mShare").onclick = () => menuGo(openShare);
  $("mLog").onclick = () => menuGo(() => openDialog("logDialog"));
  $("mConn").onclick = () => menuGo(() => { renderUrlList(); openDialog("connDialog"); });
  $("logClose").onclick = () => closeDialog("logDialog");
  $("configClose").onclick = () => closeDialog("configDialog");
  $("ledColorSel").value = S.ledColor;
  $("ledColorSel").onchange = () => {
    S.ledColor = $("ledColorSel").value;
    try { localStorage.setItem("cochera_led", S.ledColor); } catch (e) {}
    renderMatrix();
  };
  $("connPill").onclick = () => { renderUrlList(); openDialog("connDialog"); };
  $("txrxBtn").onclick = () => { renderUrlList(); openDialog("connDialog"); };
  $("connClose").onclick = () => closeDialog("connDialog");
  $("shareClose").onclick = () => closeDialog("shareDialog");
  $("sysClose").onclick = () => closeDialog("sysDialog");
  $("advClose").onclick = () => closeDialog("advDialog");
  $("testModeSel").onchange = async () => {
    const v = $("testModeSel").value;
    const msg = $("advMsg");
    try { await selSet(v); S.prueba = v; msg.hidden = true; render(); }
    catch (e) {
      msg.textContent = "⚠ No se pudo enviar al equipo. ¿Tiene el firmware con Modo Prueba (reflashear)?";
      msg.hidden = false;
      renderAdv();
    }
  };
  $("advRebootBtn").onclick = async () => {
    if (!confirm("¿Reiniciar el equipo?\n\nSe pierde la conexión unos segundos.")) return;
    const msg = $("advMsg");
    try { await btnPress(BTN_RESET); msg.hidden = true; }
    catch (e) {
      msg.textContent = "⚠ No se pudo enviar al equipo. ¿Tiene el firmware con el botón Reiniciar (reflashear)?";
      msg.hidden = false;
    }
  };
  $("fwOpenBtn").onclick = () => { closeDialog("sysDialog"); openDialog("fwDialog"); fwCheck(); };
  $("fwClose").onclick = () => closeDialog("fwDialog");
  $("fwUploadBtn").onclick = fwUpload;
  $("nameSaveBtn").onclick = saveName;
  $("nameInput").addEventListener("keydown", (e) => { if (e.key === "Enter") saveName(); });
  $("clearLog").onclick = () => { S.log = []; $("logPre").textContent = "— sin mensajes —"; };
  $("addUrlBtn").onclick = () => {
    if (!addUrl($("newUrl").value)) $("newUrl").setAttribute("aria-invalid", "true");
    else $("newUrl").removeAttribute("aria-invalid");
  };
  $("scanBtn").onclick = runScan;
  const ua = navigator.userAgent;
  let help = "Permitir contenido mixto / no seguro en los ajustes del navegador.";
  if (/Chrome/.test(ua)) help = "Chrome: candado → Configuración del sitio → Contenido no seguro → Permitir. Y permitir Red local.";
  else if (/Firefox/.test(ua)) help = "Firefox: escudo → desactivar protección mejorada para este sitio.";
  else if (/Safari/.test(ua)) help = "Safari: menú Desarrollo → permitir contenido mixto; en iOS, Ajustes → Privacidad → Red local.";
  $("browserHelp").textContent = help;
  document.addEventListener("securitypolicyviolation", () => {});
  setStatus("connecting");
  render();
  setInterval(renderMatrix, 500);
  tryReconnect();
});
