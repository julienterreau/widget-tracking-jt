require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { projectCity } = require("./lib/projection");
const C = require("./lib/classify");

const regionNames = (() => { try { return new Intl.DisplayNames(["fr"], { type: "region" }); } catch { return null; } })();
const countryName = (code, fallback) => { try { return (code && regionNames?.of(code)) || fallback || "Inconnu"; } catch { return fallback || "Inconnu"; } };

const env = (k, d) => String(process.env[k] ?? d).toLowerCase() === "true";
const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const TRACKING_ENABLED = env("TRACKING_ENABLED", "true");
// true = ce serveur n'est joignable QUE via Cloudflare : les en-têtes CF-* sont alors fiables.
const USE_CLOUDFLARE = env("USE_CLOUDFLARE", "false");
// false (défaut, comme le site) : l'adresse IP n'est jamais écrite sur disque, seul un hash quotidien est conservé.
const STORE_IP = env("STORE_IP", "false");
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 90);
const MAX_ROWS = Number(process.env.MAX_ROWS || 20000);
const PROXY_HOPS = Number.isFinite(Number(process.env.PROXY_HOPS)) ? Number(process.env.PROXY_HOPS) : 1;
const ONLINE_MS = 5 * 60 * 1000;

app.set("trust proxy", PROXY_HOPS);
app.disable("x-powered-by");
// text/plain : navigator.sendBeacon l'utilise pour éviter une requête CORS préalable.
app.use(express.json({ limit: "12kb", type: ["application/json", "text/plain"] }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
function siteHost(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `http://${raw}`).hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  } catch { return ""; }
}
function originAllowed(origin) {
  if (!origin) return "";
  if (!ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes(origin)) return origin;
  const host = siteHost(origin);
  const ok = host && ALLOWED_ORIGINS.some((item) => siteHost(item) === host);
  return ok ? origin : "";
}
app.use("/api", (req, res, next) => {
  const origin = originAllowed(req.get("origin"));
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

/* ---------- stockage : en mémoire, écrit sur disque en différé (pas de perte en cas de visites simultanées) ---------- */
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "visitors.json");
let rows = [];
try { rows = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch (e) { if (e.code !== "ENOENT") console.error("Lecture du stockage impossible :", e.message); }
rows = rows.map(migrate);
let saveTimer = null;
function prune() {
  const cutoff = RETENTION_DAYS > 0 ? Date.now() - RETENTION_DAYS * 864e5 : 0;
  rows = rows.filter((v) => Date.parse(v.at) >= cutoff).slice(-MAX_ROWS);
}
function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE + ".tmp", JSON.stringify(rows), "utf8");
    fs.renameSync(DATA_FILE + ".tmp", DATA_FILE);
  } catch (e) { console.error("Écriture impossible :", e.message); }
}
function scheduleSave() { if (!saveTimer) saveTimer = setTimeout(saveNow, 1500); }
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { saveNow(); process.exit(0); });
process.on("exit", () => { if (saveTimer) saveNow(); });

// Anciennes lignes (version 1 : ip, userAgent) -> format du site. L'IP est retirée si STORE_IP=false.
function migrate(v) {
  if (v.visitorId) return v;
  const ua = v.userAgent || "";
  const a = ua ? C.classifyAgent(ua) : { device: "Ordinateur", client: "Autre" };
  const out = { id: `visit-${crypto.randomUUID()}`, at: v.at, path: v.path || "/", countryCode: v.countryCode || "", country: v.country || "",
    city: v.city || "", lat: v.lat ?? null, lon: v.lon ?? null, device: a.device, client: a.client, source: "Accès direct",
    utmSource: "", utmMedium: "", utmCampaign: "", visitorId: C.visitorHash(v.ip || v.id || "", ua, new Date(v.at)), durationSec: null, site: v.site || "" };
  if (STORE_IP && v.ip) out.ip = v.ip;
  return out;
}

/* ---------- utilitaires ---------- */
const rateBuckets = new Map();
function rateLimit(max) {
  return (req, res, next) => {
    const key = C.clientIp(req, USE_CLOUDFLARE) || req.ip || "?";
    const now = Date.now();
    const recent = (rateBuckets.get(key) || []).filter((t) => now - t < 60_000);
    if (recent.length >= max) return res.status(429).json({ error: "Trop de requêtes. Réessayez dans une minute." });
    recent.push(now); rateBuckets.set(key, recent);
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, b] of rateBuckets) if (!b.some((t) => now - t < 60_000)) rateBuckets.delete(k); }, 60_000).unref();

// Site du visiteur : l'en-tête Origin du navigateur, pas un champ du corps (falsifiable).
function visitSite(req) {
  return siteHost(req.get("origin")) || siteHost(req.get("referer"));
}
// Sur un site autorisé, le tableau ne montre que ce site. Sur le serveur lui-même, tous les sites.
function scopedSite(req) {
  const host = visitSite(req);
  const self = siteHost(req.hostname);
  if (!host || host === self || host === "localhost" || host === "127.0.0.1") return "";
  return host;
}
function rowsFor(req) {
  const forced = scopedSite(req);
  const site = forced || siteHost(req.query.site);
  if (!site) return { site: "", list: rows };
  return { site, list: rows.filter((v) => v.site === site) };
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(503).json({ error: "Configurez ADMIN_TOKEN dans le fichier .env." });
  const s = req.get("x-admin-token") || "";
  if (s.length !== ADMIN_TOKEN.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(ADMIN_TOKEN)))
    return res.status(401).json({ error: "Accès refusé : jeton administrateur invalide." });
  next();
}

/* ---------- géolocalisation : Cloudflare d'abord (comme le site), ipwho.is en secours ---------- */
const geoCache = new Map();
const NONE = { city: "", country: "", countryCode: "", lat: null, lon: null };
const dec = (v) => { const t = String(v || "").trim(); if (!t) return ""; try { return decodeURIComponent(t.replace(/\+/g, " ")).trim().slice(0, 80); } catch { return t.slice(0, 80); } };
const coord = (v) => { const n = Number(v); return v !== undefined && v !== null && v !== "" && Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };

async function lookupIp(ip) {
  if (!ip) return NONE;
  if (geoCache.has(ip)) return geoCache.get(ip);
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3500);
    const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal: ctl.signal });
    clearTimeout(t);
    const j = await r.json();
    const place = j.success ? { city: j.city || "", country: j.country || "", countryCode: j.country_code || "", lat: coord(j.latitude), lon: coord(j.longitude) } : NONE;
    geoCache.set(ip, place); setTimeout(() => geoCache.delete(ip), 6 * 36e5).unref?.();
    return place;
  } catch { return NONE; }
}
async function locate(req, ip) {
  const get = (h) => req.get(h);
  const code = USE_CLOUDFLARE ? C.cloudflareCountry(get) : null;
  if (code) {
    const lat = coord(get("cf-iplatitude")), lon = coord(get("cf-iplongitude"));
    const city = dec(get("cf-ipcity"));
    if (lat !== null && lon !== null) return { city, country: countryName(code), countryCode: code, lat, lon };
    const alt = await lookupIp(ip);          // ville de secours, seulement si dans le même pays
    if (alt.countryCode === code) return { ...alt, city: city || alt.city, country: countryName(code) };
    return { city, country: countryName(code), countryCode: code, lat: null, lon: null };
  }
  const place = await lookupIp(ip);
  return { ...place, country: place.countryCode ? countryName(place.countryCode, place.country) : place.country };
}

/* ---------- API publique : même contrat que /api/visites du site ---------- */
app.get("/api/health", (_req, res) => res.json({ ok: true, trackingEnabled: TRACKING_ENABLED, cloudflare: USE_CLOUDFLARE, storeIp: STORE_IP }));

async function recordVisit(req, res) {
  if (!TRACKING_ENABLED || C.isPrefetch((h) => req.get(h))) return res.status(204).end();
  const ua = String(req.get("user-agent") || "");
  if (C.isBot(ua)) return res.status(204).end();
  const body = typeof req.body === "object" && req.body ? req.body : {};
  const p = C.cleanPath(body.path);
  if (!p) return res.status(204).end();
  const ip = C.clientIp(req, USE_CLOUDFLARE);
  const place = await locate(req, ip);
  const agent = C.classifyAgent(ua);
  const utm = C.readUtm(body.utm);
  const referrer = typeof body.referrer === "string" ? body.referrer.slice(0, 500) : "";
  const row = {
    id: `visit-${crypto.randomUUID()}`, at: new Date().toISOString(), path: p,
    countryCode: place.countryCode || "", country: place.country || "", city: place.city || "", lat: place.lat, lon: place.lon,
    device: agent.device, client: agent.client, source: C.classifySource(referrer, utm.source),
    utmSource: utm.source, utmMedium: utm.medium, utmCampaign: utm.campaign,
    visitorId: C.visitorHash(ip, ua), durationSec: null, site: visitSite(req)
  };
  if (STORE_IP && ip) row.ip = ip;
  rows.push(row); prune(); scheduleSave();
  res.status(201).json({ id: row.id });
}
async function recordDuration(req, res) {
  const b = typeof req.body === "object" && req.body ? req.body : {};
  const secs = Number(b.seconds);
  if (typeof b.id === "string" && /^visit-[0-9a-f-]{36}$/.test(b.id) && Number.isFinite(secs) && secs >= 1) {
    const hit = rows.findLast((v) => v.id === b.id);
    if (hit) { hit.durationSec = Math.min(1800, Math.round(secs)); scheduleSave(); }
  }
  res.status(204).end();
}
const guard = (fn) => (req, res) => fn(req, res).catch((e) => { console.error("Visite non enregistrée :", e.message); if (!res.headersSent) res.status(204).end(); });
app.post(["/api/visites", "/api/visit"], rateLimit(30), guard(recordVisit));
app.post("/api/visites/duree", rateLimit(60), guard(recordDuration));

const onlineCount = (list) => new Set(list.filter((v) => Date.parse(v.at) >= Date.now() - ONLINE_MS).map((v) => v.visitorId)).size;
const placeLabel = (v) => (v.city && v.country ? `${v.city}, ${v.country}` : "Lieu inconnu");
// Même forme que LiveSnapshot du site : { online, visits: [{ id, at, place, device, source, page }] }.
app.get("/api/visites/direct", (req, res) => {
  const { list } = rowsFor(req);
  res.setHeader("Cache-Control", "no-store");
  res.json({ online: onlineCount(list), visits: list.slice(-10).reverse().map((v) => ({ id: v.id, at: v.at, place: placeLabel(v), device: v.device, source: v.source, page: C.pageName(v.path) })) });
});

/* ---------- API administrateur ---------- */
app.get("/api/admin/stats", requireAdmin, (req, res) => {
  const { site, list } = rowsFor(req);
  res.json({ site, online: onlineCount(list), total: list.length, visitors: list.slice(-100).reverse() });
});
app.get("/api/admin/export", requireAdmin, (req, res) => {
  const { list } = rowsFor(req);
  res.setHeader("Content-Disposition", "attachment; filename=visitor-export.json");
  res.json(list);
});

// Même regroupement que mapPoints() du site : pays | ville | lat | lon, projeté sur le disque.
function mapPoints(list) {
  const groups = new Map();
  for (const v of list) {
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) continue;
    const xy = projectCity(v.lon, v.lat);
    if (!xy) continue;
    const key = `${v.countryCode}|${v.city}|${v.lat.toFixed(2)}|${v.lon.toFixed(2)}`;
    const hit = groups.get(key);
    if (hit) { hit.count++; continue; }
    groups.set(key, { city: v.city || "", country: countryName(v.countryCode, v.country), code: v.countryCode || "", count: 1, x: xy[0], y: xy[1] });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

const SPANS = { "1h": 36e5, "24h": 864e5, "7j": 6048e5, "30j": 2592e6, "7d": 6048e5, "30d": 2592e6, tout: Infinity };
app.get("/api/admin/summary", requireAdmin, (req, res) => {
  const span = SPANS[req.query.range] ?? SPANS["24h"];
  const q = String(req.query.q || "").trim().toLowerCase().slice(0, 80);
  const country = String(req.query.country || ""), city = String(req.query.city || "");
  const scoped = rowsFor(req);
  const list = scoped.list.filter((v) =>
    (span === Infinity || Date.parse(v.at) >= Date.now() - span) && (!country || countryName(v.countryCode, v.country) === country) && (!city || v.city === city) &&
    (!q || [v.ip, v.visitorId?.slice(0, 8), v.city, v.country, v.path, v.device, v.source, v.site].some((x) => String(x || "").toLowerCase().includes(q))));
  const sites = scopedSite(req) ? [] : [...rows.reduce((m, v) => {
    if (!v.site) return m;
    m.set(v.site, (m.get(v.site) || 0) + 1);
    return m;
  }, new Map())].sort((a, b) => b[1] - a[1]).map(([site, count]) => ({ site, count }));
  const group = (keyFn, extra, limit = 100) => {
    const m = new Map();
    for (const v of list) {
      const k = keyFn(v);
      const e = m.get(k) || { count: 0, last: v.at, ...extra(v) };
      e.count++; if (v.at > e.last) e.last = v.at;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.count - a.count || (a.last < b.last ? 1 : -1)).slice(0, limit);
  };
  const named = (key) => (v) => v[key] || "Inconnu";
  res.json({
    site: scoped.site, sites,
    online: onlineCount(scoped.list), total: scoped.list.length, matched: list.length, storeIp: STORE_IP,
    countries: group((v) => v.countryCode || v.country || "?", (v) => ({ country: countryName(v.countryCode, v.country) || "Inconnu", countryCode: v.countryCode || "" })),
    cities: group((v) => `${v.city}|${v.countryCode}`, (v) => ({ city: v.city || "Ville inconnue", country: countryName(v.countryCode, v.country) })),
    visitors: group((v) => v.visitorId, (v) => ({ id: v.ip || `·${v.visitorId.slice(0, 6)}`, city: v.city || "Ville inconnue", country: countryName(v.countryCode, v.country), device: v.device })),
    sources: group(named("source"), (v) => ({ label: v.source || "Accès direct" }), 10),
    devices: group(named("device"), (v) => ({ label: v.device || "Autre" }), 10),
    points: mapPoints(list),
    recent: list.slice(-30).reverse().map((v) => ({ at: v.at, city: v.city, country: countryName(v.countryCode, v.country), countryCode: v.countryCode || "",
      page: C.pageName(v.path), device: v.device, source: v.source, who: v.ip || `·${v.visitorId.slice(0, 6)}` }))
  });
});

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "API route not found" });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Visitor Tracker : http://localhost:${PORT}  (Cloudflare: ${USE_CLOUDFLARE ? "oui" : "non"} · IP stockée: ${STORE_IP ? "oui" : "non"})`);
  if (!ADMIN_TOKEN) console.warn("ATTENTION : définissez ADMIN_TOKEN dans .env avant d'exposer ce serveur.");
});
