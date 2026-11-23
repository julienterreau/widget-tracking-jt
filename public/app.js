/* Tableau de bord Visitor Tracker — carte identique à components/visits/reader-map.tsx
   (mêmes dimensions, mêmes classes .readers-*, même logique de clic). */
(() => {
  const MAP_SIZE = 760, MAP_CENTER = MAP_SIZE / 2, MAP_RADIUS = 300, MAP_CLIP = MAP_RADIUS * 0.86;
  const TICKS = ["0°", "90°E", "180°", "90°O"];
  const TOKEN_KEY = "visitorAdminToken";
  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat("fr-FR");

  const st = { token: "", range: "24h", site: "", data: null, selected: null, wide: false, timer: null, sig: "" };
  try { st.token = sessionStorage.getItem(TOKEN_KEY) || ""; } catch {}

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const round = (v) => Math.round(v * 100) / 100;
  const flag = (code) => /^[A-Z]{2}$/.test(code || "") ? [...code].map((c) => String.fromCodePoint(127397 + c.charCodeAt(0))).join("") : "";
  const visitLabel = (n) => `${nf.format(n)} ${n > 1 ? "visites" : "visite"}`;
  const pointKey = (p) => `${p.code}|${p.city}|${p.x}|${p.y}`;
  const pointLabel = (p) => (p.city ? `${p.city}, ${p.country}` : p.country) + " : " + visitLabel(p.count);
  const pinRadius = (n) => Math.min(12, 3.2 + Math.sqrt(n) * 1.55);
  const hitRadius = (n, wide) => { const r = pinRadius(n); return wide ? Math.max(28, r + 14) : Math.max(16, r + 6); };
  const time = (iso) => { try { return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); } catch { return "–"; } };

  function countryPoints(points) {
    const byCode = new Map();
    for (const p of [...points].sort((a, b) => b.count - a.count)) {
      const k = p.code || p.country;
      if (!byCode.has(k)) byCode.set(k, p);
    }
    return [...byCode.values()];
  }

  function closestPoint(points, x, y, limit) {
    let best = null, bestD = limit * limit;
    for (const p of points) {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d <= bestD) { best = p; bestD = d; }
    }
    return best;
  }

  /* ---------- carte ---------- */
  function mapSvg(points) {
    const ticksOuter = Array.from({ length: 72 }, (_, i) => {
      const a = i * 5 * Math.PI / 180, major = i % 6 === 0;
      const r1 = MAP_RADIUS + 30, r2 = MAP_RADIUS + (major ? 40 : 35);
      return `<line x1="${round(MAP_CENTER + r1 * Math.sin(a))}" y1="${round(MAP_CENTER + r1 * Math.cos(a))}" x2="${round(MAP_CENTER + r2 * Math.sin(a))}" y2="${round(MAP_CENTER + r2 * Math.cos(a))}" stroke="${major ? "var(--muted)" : "var(--high)"}" stroke-width="${major ? 1.2 : 1}" vector-effect="non-scaling-stroke"/>`;
    }).join("");
    const labels = TICKS.map((t, i) => {
      const a = i * Math.PI / 2, r = MAP_RADIUS + 56;
      return `<text x="${round(MAP_CENTER + r * Math.sin(a))}" y="${round(MAP_CENTER + r * Math.cos(a) + 4)}" text-anchor="middle" fill="var(--muted)" font-size="10" font-weight="700" letter-spacing="1.2">${t}</text>`;
    }).join("");
    const parallels = [60, 30, 0, -30, -60].map((lat) => `<circle cx="${MAP_CENTER}" cy="${MAP_CENTER}" r="${round(MAP_RADIUS * (90 - lat) / 180)}" vector-effect="non-scaling-stroke"/>`).join("");
    const meridians = Array.from({ length: 12 }, (_, i) => {
      const a = i * 30 * Math.PI / 180;
      return `<line x1="${MAP_CENTER}" y1="${MAP_CENTER}" x2="${round(MAP_CENTER + MAP_CLIP * Math.sin(a))}" y2="${round(MAP_CENTER + MAP_CLIP * Math.cos(a))}" vector-effect="non-scaling-stroke"/>`;
    }).join("");
    const ordered = [...points].sort((a, b) => {
      const A = pointKey(a) === st.selected, B = pointKey(b) === st.selected;
      return A !== B ? (A ? 1 : -1) : b.count - a.count;
    });
    const pins = ordered.map((p) => {
      const key = pointKey(p), r = pinRadius(p.count), on = key === st.selected;
      return `<g class="readers-hit" data-key="${esc(key)}" transform="translate(${round(p.x)} ${round(p.y)})" opacity="${st.selected && !on ? 0.38 : 1}" role="button" tabindex="0" aria-pressed="${on}" aria-label="${esc(pointLabel(p))}">
        ${r >= 8 ? `<circle class="readers-pulse" r="${r}" fill="var(--red)"/>` : ""}
        <circle class="readers-pin" r="${on ? r + 2 : r}"/>
        <circle class="readers-focus${on ? " is-on" : ""}" r="${r + 6}"/>
        <circle r="${hitRadius(p.count, st.wide)}" fill="transparent"/></g>`;
    }).join("");
    return `<svg class="readers-svg" viewBox="0 0 ${MAP_SIZE} ${MAP_SIZE}" id="mapSvg"><title>Terre plate, pôle Nord au centre</title>
      <defs>
        <radialGradient id="readers-ice" cx="50%" cy="50%" r="50%"><stop offset="86%" stop-color="var(--ice-edge)"/><stop offset="93%" stop-color="var(--ice)"/><stop offset="100%" stop-color="var(--paper)"/></radialGradient>
        <radialGradient id="readers-ocean" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="var(--ocean-mid)"/><stop offset="100%" stop-color="var(--ocean-deep)"/></radialGradient>
        <clipPath id="readers-disc"><circle cx="${MAP_CENTER}" cy="${MAP_CENTER}" r="${MAP_CLIP}"/></clipPath>
      </defs>
      <circle cx="${MAP_CENTER}" cy="${MAP_CENTER}" r="${MAP_RADIUS + 44}" fill="none" stroke="var(--line)" vector-effect="non-scaling-stroke"/>
      <circle cx="${MAP_CENTER}" cy="${MAP_CENTER}" r="${MAP_RADIUS + 30}" fill="none" stroke="var(--high)" vector-effect="non-scaling-stroke"/>
      ${ticksOuter}${labels}
      <circle cx="${MAP_CENTER}" cy="${MAP_CENTER}" r="${MAP_RADIUS + 22}" fill="url(#readers-ice)"/>
      <circle cx="${MAP_CENTER}" cy="${MAP_CENTER}" r="${MAP_RADIUS + 22}" fill="none" stroke="var(--red)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
      <circle cx="${MAP_CENTER}" cy="${MAP_CENTER}" r="${MAP_CLIP}" fill="url(#readers-ocean)"/>
      <image href="/earth-disk.webp" x="0" y="0" width="${MAP_SIZE}" height="${MAP_SIZE}" clip-path="url(#readers-disc)" preserveAspectRatio="xMidYMid meet"/>
      <g fill="none" stroke="rgba(255,255,255,.28)" clip-path="url(#readers-disc)" stroke-width="1" vector-effect="non-scaling-stroke">
        ${parallels}
        <circle cx="${MAP_CENTER}" cy="${MAP_CENTER}" r="${MAP_RADIUS / 2}" stroke="var(--red)" stroke-dasharray="3 4" stroke-opacity=".85" vector-effect="non-scaling-stroke"/>
        ${meridians}
      </g>
      <text x="${MAP_CENTER + MAP_RADIUS / 2 + 6}" y="${MAP_CENTER - 6}" fill="var(--red-bright)" font-size="9" font-weight="700" letter-spacing="1.5">ÉQUATEUR</text>
      ${pins}</svg>`;
  }

  function tipHtml(p) {
    const left = (p.x / MAP_SIZE) * 100, top = (p.y / MAP_SIZE) * 100;
    const above = top > 34, align = left < 24 ? "start" : left > 76 ? "end" : "center";
    const shiftX = align === "start" ? "0" : align === "end" ? "-100%" : "-50%";
    const shiftY = above ? "calc(-100% - 14px)" : "16px";
    const countryOnly = !p.city;
    return `<div class="readers-tip ${above ? "is-above" : "is-below"} is-${align}" role="dialog" aria-label="${esc(pointLabel(p))}" style="left:${left}%;top:${top}%;transform:translate(${shiftX},${shiftY})">
      <button type="button" class="readers-tip-x" data-close aria-label="Fermer">×</button>
      <p class="t1">${flag(p.code)} ${esc(countryOnly ? p.country : p.city)}</p>
      ${countryOnly ? "" : `<p class="t2">${esc(p.country)}</p>`}
      <p class="t3">${nf.format(p.count)}<small>${p.count > 1 ? "visites" : "visite"}</small></p></div>`;
  }

  function renderMap() {
    const points = st.data?.points || [];
    const open = points.find((p) => pointKey(p) === st.selected) || null;
    if (!open) st.selected = null;
    const lands = countryPoints(points);
    $("map").innerHTML = `<div class="readers-stage" id="stage">${mapSvg(points)}${open ? tipHtml(open) : ""}</div>` +
      (lands.length ? `<ul class="readers-lands">${lands.map((p) => `<li><button type="button" data-key="${esc(pointKey(p))}" aria-pressed="${pointKey(p) === st.selected}"><span class="readers-lands-dot" aria-hidden="true"></span>${esc(p.country)}</button></li>`).join("")}</ul>` : "");
    $("mapHint").hidden = !points.length;
  }

  function toggle(key) { st.selected = key === st.selected ? null : key; renderMap(); }

  function selectAt(ev) {
    const svg = $("mapSvg"), m = svg?.getScreenCTM();
    if (!svg || !m) return;
    const local = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
    const hit = closestPoint(st.data?.points || [], local.x, local.y, st.wide ? 36 : 18);
    if (!hit) { if (st.selected) { st.selected = null; renderMap(); } return; }
    toggle(pointKey(hit));
  }

  $("map").addEventListener("click", (ev) => {
    if (ev.target.closest("[data-close]")) { st.selected = null; renderMap(); return; }
    const chip = ev.target.closest(".readers-lands [data-key]");
    if (chip) { toggle(chip.dataset.key); return; }
    if (ev.target.closest(".readers-tip")) return;
    if (ev.target.closest("#mapSvg")) selectAt(ev);
  });
  $("map").addEventListener("keydown", (ev) => {
    const g = ev.target.closest(".readers-hit");
    if (g && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); toggle(g.dataset.key); }
  });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && st.selected) { st.selected = null; renderMap(); } });
  document.addEventListener("pointerdown", (ev) => {
    if (st.selected && !ev.target.closest("#map")) { st.selected = null; renderMap(); }
  });
  const mq = window.matchMedia("(max-width: 1000px)");
  const applyMq = () => { st.wide = mq.matches; if (st.data) renderMap(); };
  mq.addEventListener("change", applyMq); st.wide = mq.matches;

  /* ---------- données ---------- */
  function renderRank(countries, total) {
    const el = $("rank");
    if (!countries.length) { el.innerHTML = '<li class="rank-empty">Aucune visite sur cette période.</li>'; return; }
    el.innerHTML = countries.slice(0, 8).map((c) => {
      const share = total ? Math.max(3, Math.round((c.count / total) * 100)) : 0;
      return `<li><button type="button" data-code="${esc(c.countryCode)}" style="--w:${share}%"><span class="rk-flag" aria-hidden="true">${flag(c.countryCode)}</span><span class="rk-name">${esc(c.country)}</span><span class="rk-n">${nf.format(c.count)}</span></button></li>`;
    }).join("");
  }

  function renderPlain(id, list, total) {
    $(id).innerHTML = list.length ? list.map((c) => {
      const share = total ? Math.max(3, Math.round((c.count / total) * 100)) : 0;
      return `<li><div class="rk-plain" style="--w:${share}%"><span class="rk-name">${esc(c.label)}</span><span class="rk-n">${nf.format(c.count)}</span></div></li>`;
    }).join("") : '<li class="rank-empty">–</li>';
  }

  $("rank").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-code]");
    if (!b) return;
    const p = (st.data?.points || []).filter((x) => x.code === b.dataset.code).sort((a, c) => c.count - a.count)[0];
    if (p) toggle(pointKey(p));
  });

  function setLocked(locked, msg = "") {
    $("gate").hidden = !locked;
    $("figures").hidden = locked;
    $("recentWrap").hidden = locked;
    $("authMessage").textContent = msg;
    if (locked) { st.data = null; st.sig = ""; st.selected = null; $("onlineCount").textContent = "–"; renderMap(); }
  }

  async function refresh() {
    if (!st.token) return;
    try {
      const q = new URLSearchParams({ range: st.range });
      if (st.site) q.set("site", st.site);
      const r = await fetch(`/api/admin/summary?${q}`, { headers: { "x-admin-token": st.token }, cache: "no-store" });
      if (r.status === 401 || r.status === 503) {
        try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
        st.token = ""; setLocked(true, "Jeton invalide ou serveur non configuré."); return;
      }
      if (!r.ok) throw new Error();
      const d = await r.json();
      setLocked(false);
      fillSites(d.sites, d.site);
      $("onlineCount").textContent = nf.format(d.online);
      $("onlineLabel").textContent = d.online > 1 ? "lecteurs en ligne" : "lecteur en ligne";
      $("totalCount").textContent = nf.format(d.matched);
      $("totalWhere").textContent = `${d.matched > 1 ? "visites" : "visite"} · ${nf.format(d.total)} enregistrées`;
      renderRank(d.countries, d.matched);
      renderPlain("sources", d.sources, d.matched);
      renderPlain("devices", d.devices, d.matched);
      $("recentRows").innerHTML = d.recent.length ? d.recent.map((v) =>
        `<tr><td>${time(v.at)}</td><td>${flag(v.countryCode)} ${esc(v.city ? v.city + ", " + v.country : v.country || "Lieu inconnu")}</td><td>${esc(v.page)}</td><td>${esc(v.device)}</td><td>${esc(v.source)}</td><td class="ip">${esc(v.who)}</td></tr>`).join("")
        : '<tr><td colspan="6" class="rank-empty">Aucune visite sur cette période.</td></tr>';
      const sig = JSON.stringify(d.points);
      st.data = d;
      if (sig !== st.sig) { st.sig = sig; renderMap(); } // évite de relancer les pulsations à chaque actualisation
    } catch {
      $("authMessage").textContent = "Serveur injoignable. Nouvel essai dans 10 s.";
    }
  }

  $("gate").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const t = $("adminToken").value.trim();
    if (!t) return;
    st.token = t;
    try { sessionStorage.setItem(TOKEN_KEY, t); } catch {}
    $("authMessage").textContent = "Vérification…";
    refresh();
  });
  $("lock").addEventListener("click", () => {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
    st.token = ""; $("adminToken").value = ""; setLocked(true);
  });
  function fillSites(sites, current) {
    const sel = $("siteFilter");
    if (!sel || !Array.isArray(sites)) return;
    const html = `<option value="">Tous les sites</option>` + sites.map((s) => `<option value="${esc(s.site)}">${esc(s.site)} (${nf.format(s.count)})</option>`).join("");
    if (sel.dataset.html !== html) { sel.innerHTML = html; sel.dataset.html = html; }
    sel.value = current || st.site || "";
  }
  $("siteFilter").addEventListener("change", () => {
    st.site = $("siteFilter").value;
    st.sig = "";
    refresh();
  });
  document.querySelectorAll(".periods button").forEach((b) => b.addEventListener("click", () => {
    st.range = b.dataset.range;
    document.querySelectorAll(".periods button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    st.sig = ""; refresh();
  }));

  setLocked(!st.token);
  if (st.token) { $("adminToken").value = st.token; refresh(); }
  st.timer = setInterval(refresh, 10000);
})();
