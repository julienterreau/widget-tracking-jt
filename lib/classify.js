// Port de lib/visits/classify.ts du site : mêmes filtres, mêmes libellés, même hash visiteur.
const { createHash } = require("crypto");
const { UAParser } = require("ua-parser-js");

const BOTS = [/bot\b/i, /spider/i, /crawler/i, /slurp/i, /facebookexternalhit/i, /embedly/i, /quora link preview/i,
  /pinterestbot/i, /slackbot/i, /whatsapp/i, /wget\//i, /curl\//i, /python-requests/i, /headless/i, /lighthouse/i,
  /pagespeed/i, /pingdom/i, /uptimerobot/i, /semrush/i, /ahrefs/i, /petalbot/i, /bytespider/i, /gptbot/i, /claudebot/i,
  /amazonbot/i, /bingbot/i, /googlebot/i, /yandex/i, /duckduckbot/i, /baiduspider/i, /applebot/i, /ia_archiver/i];

const OWN_HOSTS = new Set(["rustyjamesblog.link", "localhost", "127.0.0.1"]);
for (const o of String(process.env.ALLOWED_ORIGINS || "").split(",")) {
  try { OWN_HOSTS.add(new URL(o.trim()).hostname.replace(/^www\./, "")); } catch {}
}

function isBot(ua) { const u = String(ua || "").trim(); return !u || u.length < 8 || BOTS.some((p) => p.test(u)); }

function isPrefetch(get) {
  const purpose = `${get("purpose") || ""} ${get("sec-purpose") || ""}`.toLowerCase();
  return purpose.includes("prefetch") || get("next-router-prefetch") === "1" || get("x-middleware-prefetch") === "1";
}

function isPrivateAddress(a) {
  const v = String(a).toLowerCase();
  if (v === "::1" || v === "0.0.0.0" || v.startsWith("127.")) return true;
  if (v.startsWith("10.") || v.startsWith("192.168.") || v.startsWith("169.254.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(v)) return true;
  if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80:")) return true;
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return false;
}
const publicAddress = (v) => { const a = String(v || "").trim(); return !a || isPrivateAddress(a) ? null : a; };

/** Ordre du site : Cloudflare (si activé), puis la chaîne proxy d'Express, sans jamais retenir une adresse privée. */
function clientIp(req, useCloudflare) {
  const cf = useCloudflare ? publicAddress(req.get("cf-connecting-ip")) : null;
  if (cf) return cf;
  const viaProxy = publicAddress(String(req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, ""));
  return viaProxy || "";
}

function cloudflareCountry(get) {
  const code = String(get("cf-ipcountry") || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || ["XX", "T1", "A1", "A2"].includes(code)) return null;
  return code;
}

function visitorHash(ip, ua, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const salt = process.env.VISITOR_SALT || "rj-visites";
  return createHash("sha256").update(`${ip}\n${ua}\n${salt}\n${day}`).digest("hex").slice(0, 32);
}

function cleanPath(v) {
  if (typeof v !== "string") return null;
  if (!v.startsWith("/") || v.startsWith("//") || v.length > 500) return null;
  if (/[\u0000-\u001f\s]/.test(v)) return null;
  if (v.startsWith("/studio") || v.startsWith("/api")) return null;
  return v;
}

const clip = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
function readUtm(v) {
  const s = v && typeof v === "object" ? v : {};
  return { source: clip(s.source, 80), medium: clip(s.medium, 80), campaign: clip(s.campaign, 120) };
}

function namedSource(value) {
  const t = String(value).toLowerCase();
  if (!t) return null;
  if (/facebook|instagram|\bfb\b/.test(t)) return "Facebook";
  if (/google/.test(t)) return "Google";
  if (/telegram|^tg$/.test(t)) return "Telegram";
  if (/(^|[^a-z])x([^a-z]|$)|twitter|^tw$/.test(t)) return "X";
  return null;
}
function classifySource(referrer, utmSource) {
  const fromUtm = namedSource(utmSource);
  if (fromUtm) return fromUtm;
  if (!referrer) return "Accès direct";
  let host = "";
  try { host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, ""); } catch { return "Accès direct"; }
  if (OWN_HOSTS.has(host) || host.endsWith(".localhost")) return "Accès direct";
  if (host === "t.co" || host === "x.com" || host.endsWith("twitter.com")) return "X";
  if (host === "t.me" || host.endsWith("telegram.org") || host.endsWith("telegram.me")) return "Telegram";
  if (host.endsWith("facebook.com") || host.endsWith("fb.com") || host.endsWith("instagram.com")) return "Facebook";
  if (host.startsWith("google.") || host.includes(".google.")) return "Google";
  return namedSource(host) || "Autres sites";
}

function classifyAgent(ua) {
  const r = new UAParser(ua).getResult();
  const kind = r.device.type;
  const device = kind === "mobile" ? "Mobile" : kind === "tablet" ? "Tablette" : kind ? "Autre" : "Ordinateur";
  const os = r.os.name || "";
  const browser = /FBAN|FBAV|FB_IAB/i.test(ua) ? "Facebook in-app" : r.browser.name || "Autre";
  return { device, client: browser === "Facebook in-app" || !os ? browser : `${browser} · ${os}` };
}

/** Libellé lisible d'une page, comme pageName() du site. */
function pageName(p) {
  if (p === "/") return "Accueil";
  if (p === "/archives") return "Archives";
  if (p === "/visiteurs") return "Visiteurs";
  try {
    const slug = decodeURIComponent(p.split("?")[0].slice(1)).replace(/[-_]+/g, " ").trim();
    return slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : p;
  } catch { return p; }
}

module.exports = { isBot, isPrefetch, clientIp, cloudflareCountry, visitorHash, cleanPath, readUtm, classifySource, classifyAgent, pageName, isPrivateAddress };
