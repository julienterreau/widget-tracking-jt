/*! Visitor Tracker Widget — « Nocturnal Gazette »
 *  <script src="https://VOTRE-SERVEUR/widget.js" defer></script>
 *  Suit les pages comme components/visit-tracker.tsx du site (navigation interne, referrer, UTM, durée).
 *  Attributs : data-track="false" (ne pas enregistrer les visites) · data-endpoint="https://..." (serveur d'API)
 *  Le panneau n'apparaît que sur l'URL suffixée par #visitors, ou si le jeton est déjà en session.
 *  Mêmes couleurs que app/gazette.css ; reprend les polices du site (--font-garamond / --font-montserrat) si présentes.
 */
(() => {
  const me = document.currentScript || document.querySelector('script[src*="widget.js"]');
  let origin = "";
  try { origin = me && me.src ? new URL(me.src, location.href).origin : ""; } catch {}
  const base = ((me && me.dataset.endpoint) || origin).replace(/\/$/, "");
  const KEY = "vt_admin_token";
  const store = {
    get: () => { try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; } },
    set: (v) => { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch {} }
  };

  /* Suivi : même comportement que components/visit-tracker.tsx du site (page vue à chaque changement d'URL,
     y compris la navigation interne de Next.js, referrer, UTM, durée de lecture). */
  const tracking = !me || me.dataset.track !== "false";
  let current = null; // { url, id, started, sent, closed }
  const skipPath = (p) => p.startsWith("/studio") || p.startsWith("/api");
  function flush(v) {
    if (!v || v.sent || !v.id) return;
    const seconds = Math.round((performance.now() - v.started) / 1000);
    if (seconds < 1) return;
    v.sent = true;
    const body = JSON.stringify({ id: v.id, seconds });
    const url = base + "/api/visites/duree";
    // text/plain : pas de requête CORS préalable, le serveur l'accepte.
    if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: "text/plain;charset=UTF-8" }))) return;
    fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body, keepalive: true }).catch(() => {});
  }
  function track() {
    if (!tracking || store.get()) return;                         // pas de comptage pour l'administrateur connecté
    const url = location.pathname + location.search;
    if (current && current.url === url) return;                    // hash seul (#visitors) : pas une nouvelle page
    if (current) { current.closed = true; flush(current); }
    if (skipPath(location.pathname)) { current = null; return; }
    const v = current = { url, id: null, started: performance.now(), sent: false, closed: false };
    const q = new URLSearchParams(location.search);
    fetch(base + "/api/visites", {
      method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
      body: JSON.stringify({ path: location.pathname, referrer: document.referrer, utm: {
        source: q.get("utm_source") || "", medium: q.get("utm_medium") || "", campaign: q.get("utm_campaign") || "" } })
    }).then((r) => (r.status === 201 ? r.json() : null)).then((j) => {
      v.id = j && j.id || null;
      if (v.closed || document.visibilityState === "hidden") flush(v);
    }).catch(() => {});
  }
  for (const m of ["pushState", "replaceState"]) {
    const orig = history[m];
    history[m] = function () { const r = orig.apply(this, arguments); setTimeout(track, 0); return r; };
  }
  window.addEventListener("popstate", () => setTimeout(track, 0));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(current); });
  window.addEventListener("pagehide", () => flush(current));
  track();

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const flag = (cc) => /^[A-Za-z]{2}$/.test(cc || "") ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : "";
  const ago = (iso) => {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    return s < 60 ? "à l'instant" : s < 3600 ? `il y a ${Math.floor(s / 60)} min` : s < 86400 ? `il y a ${Math.floor(s / 3600)} h` : `il y a ${Math.floor(s / 86400)} j`;
  };
  const nf = new Intl.NumberFormat("fr-FR");

  const st = { open: false, tab: "countries", range: "24h", q: "", country: "", city: "", data: null, timer: null };

  const host = document.createElement("div");
  host.id = "vt-widget";
  host.style.cssText = "all:initial;position:fixed;right:1rem;bottom:1rem;z-index:2147483000;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
  <style>
    :host{
      --ink:#0d0b14;--wire:#1a1622;--high:#2b2931;--line:#2b2438;--muted:#847a91;--paper:#f5f0e9;
      --red:#ef003f;--red-bright:#ff5262;--red-soft:#ffb3b4;--secondary:#d7bbf8;--up:#3dbe86;
      --serif:var(--font-garamond,'EB Garamond'),Georgia,'Times New Roman',serif;
      --sans:var(--font-montserrat,'Montserrat'),system-ui,-apple-system,'Segoe UI',sans-serif;
      color-scheme:dark;font-size:16px
    }
    *{box-sizing:border-box;margin:0;padding:0;font-family:var(--sans)}
    button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
    :focus-visible{outline:2px solid var(--secondary);outline-offset:2px}
    .fab{display:flex;align-items:center;gap:.6rem;padding:.65rem 1rem;background:var(--ink);color:var(--paper);border:1px solid var(--line);border-top:3px solid var(--red);font-size:.75rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;transition:border-color .2s}
    .fab:hover{border-color:var(--muted);border-top-color:var(--red)}
    .fab i{width:.5rem;height:.5rem;border-radius:50%;background:var(--red);animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
    .panel{position:absolute;right:0;bottom:3.4rem;width:min(26rem,calc(100vw - 2rem));max-height:min(40rem,calc(100vh - 6rem));display:none;flex-direction:column;background:var(--ink);color:#e6e0ec;border:1px solid var(--line);border-top:3px solid var(--red);overflow:hidden}
    .panel.open{display:flex}
    header{display:flex;justify-content:space-between;align-items:flex-start;padding:.9rem 1rem .8rem;border-bottom:1px solid var(--line)}
    header b{display:block;font:700 1.375rem/1 var(--serif);letter-spacing:-.01em;color:var(--paper)}
    header small{display:block;margin-top:.3rem;font-size:.6875rem;color:var(--muted)}
    .x{width:1.75rem;height:1.75rem;font-size:1.25rem;line-height:1;color:var(--muted)}
    .x:hover{color:var(--paper)}
    .gate{padding:1rem;display:flex;flex-direction:column;gap:.6rem}
    .gate p{font-size:.78rem;color:var(--muted);line-height:1.5}
    input,select{background:var(--ink);border:1px solid var(--line);color:var(--paper);padding:.55rem .65rem;font-size:.8rem;min-width:0;border-radius:0}
    input:focus,select:focus{border-color:var(--red);outline:none}
    .pri{padding:.65rem;background:var(--paper);color:var(--ink);border:1px solid var(--paper);font-size:.7rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase;transition:background .2s,color .2s}
    .pri:hover{background:var(--red);border-color:var(--red);color:var(--paper)}
    .err{min-height:1.1em;font-size:.72rem;color:var(--red-soft)}
    .bar{display:flex;gap:.5rem;padding:.8rem 1rem 0}.bar input{flex:1}
    .chips{display:flex;gap:.35rem;flex-wrap:wrap;padding:.5rem 1rem 0}
    .chips:empty{display:none}
    .chip{padding:.1rem .4rem;border:1px solid var(--red);font-size:.6rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--red-bright)}
    .tabs{display:flex;gap:1.25rem;padding:.8rem 1rem 0;border-bottom:1px solid var(--line)}
    .tab{padding:.15rem 0 .55rem;margin-bottom:-1px;font-size:.7rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);border-bottom:2px solid transparent;transition:color .2s}
    .tab:hover{color:var(--paper)}
    .tab.on{color:var(--paper);border-bottom-color:var(--red)}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);border-bottom:1px solid var(--line)}
    .stats span{padding:.65rem 1rem;font-size:.65rem;color:var(--muted);line-height:1.3}
    .stats span+span{border-left:1px solid var(--line)}
    .stats b{display:block;font:700 1.5rem/1 var(--serif);color:var(--paper);margin-bottom:.15rem}
    .list{overflow:auto;flex:1;min-height:7.5rem}
    .row{position:relative;display:grid;grid-template-columns:1fr auto;gap:.1rem .75rem;width:100%;padding:.65rem 1rem .75rem;border-bottom:1px solid var(--line);text-align:left;transition:background .2s}
    .row:hover{background:var(--wire)}
    .row .t{font-size:.8rem;font-weight:600;color:var(--paper);overflow-wrap:anywhere}
    .row .t em{font-style:normal;font-weight:400;color:var(--muted)}
    .row .n{font:700 1.1rem/1.2 var(--serif);color:var(--red-bright)}
    .row .s{grid-column:1/-1;font-size:.68rem;color:var(--muted)}
    .row .meter{position:absolute;left:0;bottom:-1px;height:2px;background:var(--red);opacity:.85}
    .empty{padding:2rem 1rem;text-align:center;color:var(--muted);font-size:.78rem}
    footer{display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.65rem 1rem;border-top:1px solid var(--line);font-size:.65rem;color:var(--muted)}
    footer .btns{display:flex;gap:.4rem}
    footer button{padding:.3rem .6rem;border:1px solid var(--line);font-size:.65rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);transition:color .2s,border-color .2s}
    footer button:hover{color:var(--paper);border-color:var(--muted)}
    @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
  </style>
  <button class="fab" id="fab" type="button" aria-expanded="false" aria-controls="panel"><i aria-hidden="true"></i><span id="fabTxt">Lecteurs</span></button>
  <section class="panel" id="panel" role="dialog" aria-label="Lecteurs du site">
    <header><div><b>Lecteurs</b><small>Pays, villes et lecteurs</small></div><button class="x" id="close" type="button" aria-label="Fermer">×</button></header>
    <form class="gate" id="gate">
      <p>Saisissez le jeton administrateur (<code>ADMIN_TOKEN</code>) pour afficher les visites.</p>
      <input id="tok" type="password" placeholder="Jeton" autocomplete="off" aria-label="Jeton administrateur">
      <button class="pri" type="submit">Déverrouiller</button><div class="err" id="err" role="status"></div>
    </form>
    <div id="main" style="display:none;flex-direction:column;min-height:0;flex:1">
      <div class="bar"><input id="q" type="search" placeholder="Filtrer : ville, pays, page" aria-label="Filtrer"><select id="range" aria-label="Période">
        <option value="1h">1 h</option><option value="24h" selected>24 h</option><option value="7j">7 j</option><option value="30j">30 j</option><option value="tout">Tout</option></select></div>
      <div class="chips" id="chips"></div>
      <div class="tabs" role="tablist"><button class="tab on" role="tab" type="button" data-tab="countries">Pays</button><button class="tab" role="tab" type="button" data-tab="cities">Villes</button><button class="tab" role="tab" type="button" data-tab="visitors">Lecteurs</button></div>
      <div class="stats"><span><b id="sOnline">–</b>en ligne</span><span><b id="sMatch">–</b>visites</span><span><b id="sTotal">–</b>enregistrées</span></div>
      <div class="list" id="list"></div>
      <footer><span id="upd">Actualisation 10 s</span><span class="btns"><button id="csv" type="button">CSV</button><button id="lock" type="button">Verrouiller</button></span></footer>
    </div>
  </section>`;
  const $ = (id) => root.getElementById(id);

  async function load() {
    const token = store.get();
    if (!token) return;
    const p = new URLSearchParams({ range: st.range, q: st.q, country: st.country, city: st.city });
    try {
      const r = await fetch(`${base}/api/admin/summary?${p}`, { headers: { "x-admin-token": token }, cache: "no-store" });
      if (r.status === 401 || r.status === 503) { store.set(""); $("err").textContent = "Jeton invalide ou serveur non configuré."; showGate(); return; }
      if (!r.ok) throw 0;
      st.data = await r.json();
      $("gate").style.display = "none"; $("main").style.display = "flex";
      render();
    } catch { $("upd").textContent = "Serveur injoignable"; }
  }
  function showGate() { $("gate").style.display = "flex"; $("main").style.display = "none"; }

  function render() {
    const d = st.data; if (!d) return;
    $("fabTxt").textContent = `${nf.format(d.online)} en ligne`;
    $("sOnline").textContent = nf.format(d.online); $("sMatch").textContent = nf.format(d.matched); $("sTotal").textContent = nf.format(d.total);
    $("upd").textContent = "Mis à jour à " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    $("chips").innerHTML = [st.country && ["country", "Pays : " + st.country], st.city && ["city", "Ville : " + st.city]]
      .filter(Boolean).map(([k, t]) => `<button class="chip" type="button" data-clear="${k}" aria-label="Retirer le filtre">${esc(t)} ×</button>`).join("");
    root.querySelectorAll(".tab").forEach((b) => { const on = b.dataset.tab === st.tab; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    const rows = d[st.tab] || [];
    if (!rows.length) { $("list").innerHTML = '<div class="empty">Aucune visite pour ces critères.</div>'; return; }
    const max = rows[0].count;
    $("list").innerHTML = rows.map((r, i) => {
      const title = st.tab === "countries" ? `${flag(r.countryCode)} ${esc(r.country)}`
        : st.tab === "cities" ? `${esc(r.city)} <em>· ${esc(r.country)}</em>`
        : `${esc(r.id)} <em>· ${esc(r.device)}</em>`;
      const sub = st.tab === "visitors" ? `${esc(r.city)}, ${esc(r.country)} · ${ago(r.last)}` : `Dernière visite ${ago(r.last)}`;
      return `<button class="row" type="button" data-i="${i}"><span class="t">${title}</span><span class="n">${nf.format(r.count)}</span>
        <span class="s">${sub}</span><span class="meter" style="width:${Math.max(3, r.count / max * 100)}%"></span></button>`;
    }).join("");
  }

  function pick(i) {
    const r = (st.data[st.tab] || [])[i]; if (!r) return;
    if (st.tab === "countries") st.country = r.country;
    else if (st.tab === "cities") { st.city = r.city; st.country = r.country; }
    else { st.q = String(r.id).replace(/^·/, ""); $("q").value = st.q; }
    load();
  }

  function csv() {
    const rows = (st.data?.visitors || []).map((r) => [r.id, r.city, r.country, r.device, r.count, r.last]);
    const body = [["lecteur", "ville", "pays", "appareil", "visites", "derniere_visite"], ...rows]
      .map((l) => l.map((c) => `"${String(c).replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + body], { type: "text/csv" }));
    a.download = "visiteurs.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function setOpen(v) {
    st.open = v; $("panel").classList.toggle("open", v); $("fab").setAttribute("aria-expanded", String(v));
    clearInterval(st.timer);
    if (v) { store.get() ? load() : showGate(); st.timer = setInterval(load, 10000); }
  }

  let mounted = false;
  function mount() {
    if (mounted) return;
    if (location.hash !== "#visitors" && !store.get()) return;
    mounted = true;
    document.body.appendChild(host);
    $("fab").onclick = () => setOpen(!st.open);
    $("close").onclick = () => setOpen(false);
    root.addEventListener("keydown", (e) => { if (e.key === "Escape" && st.open) { setOpen(false); $("fab").focus(); } });
    $("gate").onsubmit = (e) => { e.preventDefault(); const t = $("tok").value.trim(); if (t) { store.set(t); $("err").textContent = ""; load(); } };
    $("lock").onclick = () => { store.set(""); st.data = null; $("fabTxt").textContent = "Lecteurs"; showGate(); };
    $("csv").onclick = csv;
    let t; $("q").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); load(); }, 300); };
    $("range").onchange = (e) => { st.range = e.target.value; load(); };
    root.querySelectorAll(".tab").forEach((b) => b.onclick = () => { st.tab = b.dataset.tab; render(); });
    $("chips").onclick = (e) => { const k = e.target.closest("[data-clear]")?.dataset.clear; if (!k) return; if (k === "country") st.city = ""; st[k] = ""; load(); };
    $("list").onclick = (e) => { const r = e.target.closest(".row"); if (r) pick(+r.dataset.i); };
    if (store.get()) load();
  }
  // Fonctionne aussi pour une navigation côté client (Next.js) qui change le hash vers #visitors.
  window.addEventListener("hashchange", mount);
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", mount) : mount();
})();
