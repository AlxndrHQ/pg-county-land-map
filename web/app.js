/* Real Estate Map — parcels on a map (M1) + search (M2). */
(() => {
  "use strict";

  const BASE_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
  const PARCELS_URL = new URL("data/parcels.pmtiles", location.href).href;
  const PARCEL_MINZOOM = 12;
  const PG_CENTER = [-76.85, 38.83];

  // ---------- palettes (mirror style.css tokens; MapLibre needs literal colors) ----------
  const PAL = {
    light: {
      bg: "#FAFAF7", text: "#1F1D18", muted: "#6B6960", dim: "#9C998E", line: "#E8E6DF",
      accent: "#8A5A2B", accentSoft: "rgba(138,90,43,0.10)", edge: "#C4C1B6", edgeStrong: "#8F8C82",
      water: "#E9E8E1", park: "#F2F2EB", building: "#F1F0EA",
      roadMajor: "#E2E0D8", roadMinor: "#EEEDE6", rail: "#D8D5CB",
      t: { c: "#3E6A8A", i: "#6B5B9A", g: "#3C7A5E", r: "#2F7A80", p: "#C4C1B6" },
    },
    dark: {
      bg: "#0E0E10", text: "#E8E6DF", muted: "#7A7A82", dim: "#56565D", line: "#26262B",
      accent: "#C9A875", accentSoft: "rgba(201,168,117,0.12)", edge: "#36363D", edgeStrong: "#5E5E66",
      water: "#141418", park: "#111113", building: "#131316",
      roadMajor: "#232328", roadMinor: "#1A1A1E", rail: "#2A2A30",
      t: { c: "#86A8C4", i: "#A99BD3", g: "#7FB89B", r: "#7CC3C8", p: "#36363D" },
    },
  };
  const TYPE_LABEL = { c: "Corporate / LLC", i: "Institutional", g: "Government", r: "Religious / nonprofit", p: "Individual" };

  // ---------- theme ----------
  const root = document.documentElement;
  const themeBtn = document.getElementById("theme");
  const systemDark = matchMedia("(prefers-color-scheme: dark)");
  let explicit = root.dataset.theme || null; // set by the inline script from localStorage
  const theme = () => explicit || (systemDark.matches ? "dark" : "light");
  function applyThemeAttr() {
    root.dataset.theme = theme();
    themeBtn.textContent = theme() === "dark" ? "Paper" : "Ink";
  }
  applyThemeAttr();

  // ---------- basemap restyle: Positron -> paper / ink, no POI clutter ----------
  let baseStyle = null;
  const KEEP_SYMBOLS = /^(label_(other|village|town|city|city_capital)|highway-name-(minor|major)|water_name_(point|line)_label)$/;

  function restyle(base, P) {
    const layers = [];
    for (const src of base.layers) {
      const l = JSON.parse(JSON.stringify(src));
      const id = l.id;
      if (l.type === "symbol") {
        if (!KEEP_SYMBOLS.test(id)) continue;
        l.paint = { ...(l.paint || {}), "text-color": id.startsWith("water") ? P.dim : P.muted,
                    "text-halo-color": P.bg, "text-halo-width": 1.4 };
        layers.push(l);
        continue;
      }
      if (/^(landcover_ice|landcover_glacier|landuse_residential|aeroway|road_area_pier|road_pier|highway_path|boundary_disputed)/.test(id)) continue;
      if (l.type === "raster") continue;
      const paint = l.paint || {};
      if (l.type === "background") paint["background-color"] = P.bg;
      else if (id === "water") paint["fill-color"] = P.water;
      else if (id === "park" || id === "landcover_wood") { paint["fill-color"] = P.park; paint["fill-opacity"] = 1; delete paint["fill-outline-color"]; }
      else if (id === "building") { paint["fill-color"] = P.building; paint["fill-outline-color"] = P.building; }
      else if (id === "waterway") paint["line-color"] = P.water;
      else if (/railway/.test(id)) paint["line-color"] = P.rail;
      else if (/boundary/.test(id)) { paint["line-color"] = P.edge; }
      else if (/motorway|major/.test(id)) paint["line-color"] = P.roadMajor;
      else if (/highway|tunnel/.test(id)) paint["line-color"] = P.roadMinor;
      l.paint = paint;
      layers.push(l);
    }
    const sources = { ...base.sources };
    delete sources.ne2_shaded;
    return { ...base, sources, layers };
  }

  function parcelLayers(P) {
    const typeColor = ["match", ["get", "t"], "c", P.t.c, "i", P.t.i, "g", P.t.g, "r", P.t.r, P.t.p];
    return [
      { id: "parcel-hit", type: "fill", source: "parcels", "source-layer": "parcels", minzoom: PARCEL_MINZOOM,
        paint: { "fill-color": P.bg, "fill-opacity": 0 } },
      { id: "parcel-line", type: "line", source: "parcels", "source-layer": "parcels", minzoom: PARCEL_MINZOOM,
        paint: {
          "line-color": typeColor,
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.3, 15, 0.7, 18, 1.2],
          "line-opacity": ["case", ["==", ["get", "t"], "p"], 0.9, 0.95],
        } },
      { id: "spokes", type: "line", source: "seldots", filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": P.accent, "line-width": 0.7, "line-opacity": 0.55 } },
      { id: "sel-dots", type: "circle", source: "seldots", maxzoom: 14, filter: ["==", ["get", "k"], "pt"],
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 2.2, 13, 4], "circle-color": P.accent,
                 "circle-stroke-color": P.bg, "circle-stroke-width": 1 } },
      { id: "parcel-sel-fill", type: "fill", source: "parcels", "source-layer": "parcels",
        filter: selFilter(), paint: { "fill-color": P.accentSoft } },
      { id: "parcel-sel-line", type: "line", source: "parcels", "source-layer": "parcels",
        filter: selFilter(),
        paint: { "line-color": P.accent, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.2, 17, 2] } },
      { id: "hub-dot", type: "circle", source: "seldots", filter: ["==", ["get", "k"], "hub"],
        paint: { "circle-radius": 5, "circle-color": P.bg, "circle-stroke-color": P.accent, "circle-stroke-width": 1.5 } },
      { id: "hub-label", type: "symbol", source: "seldots", filter: ["==", ["get", "k"], "hub"],
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 12,
                  "text-offset": [0, -1.3], "text-anchor": "bottom", "text-max-width": 14, "text-allow-overlap": true },
        paint: { "text-color": P.text, "text-halo-color": P.bg, "text-halo-width": 2 } },
    ];
  }

  function fullStyle() {
    const P = PAL[theme()];
    const s = restyle(baseStyle, P);
    s.sources.parcels = {
      type: "vector", url: "pmtiles://" + PARCELS_URL,
      attribution: "Parcel data: MD iMAP, MDP, SDAT; PG County DPIE",
    };
    s.sources.seldots = { type: "geojson", data: dotsData() };
    // Parcels sit above roads and below labels.
    const firstSymbol = s.layers.findIndex((l) => l.type === "symbol");
    s.layers.splice(firstSymbol < 0 ? s.layers.length : firstSymbol, 0, ...parcelLayers(P));
    return s;
  }

  // ---------- map ----------
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);

  let map, selectedIds = [];
  const selFilter = () => ["in", ["get", "id"], ["literal", selectedIds]];

  fetch(BASE_STYLE_URL).then((r) => r.json()).then((base) => {
    baseStyle = base;
    map = new maplibregl.Map({
      container: "map", style: fullStyle(), center: PG_CENTER, zoom: 10.2, minZoom: 8, maxZoom: 19,
      hash: "map", attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("zoom", updateHint);
    updateHint();
    map.on("mousemove", "parcel-hit", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "parcel-hit", () => (map.getCanvas().style.cursor = ""));
    map.on("click", (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: ["parcel-hit"] })[0];
      if (f) select(f.properties.id);
      else closeDrawer();
    });
  }).catch((err) => {
    document.getElementById("map").innerHTML =
      `<p style="padding:24px;color:var(--muted)">The basemap failed to load (${esc(String(err))}).</p>`;
  });

  function updateHint() {
    document.getElementById("hint").classList.toggle("off", map.getZoom() >= PARCEL_MINZOOM);
  }

  let selPts = [], selHub = null;
  function dotsData() {
    const f = [];
    for (let i = 0; i < selPts.length; i += 2) {
      const pt = [selPts[i], selPts[i + 1]];
      f.push({ type: "Feature", properties: { k: "pt" }, geometry: { type: "Point", coordinates: pt } });
      if (selHub) f.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [selHub.pt, pt] } });
    }
    if (selHub) f.push({ type: "Feature", properties: { k: "hub", label: selHub.label }, geometry: { type: "Point", coordinates: selHub.pt } });
    return { type: "FeatureCollection", features: f };
  }
  function setSelected(ids, pts, hub) {
    selectedIds = ids || [];
    selPts = pts || [];
    selHub = hub || null;
    if (map && map.getSource("seldots")) map.getSource("seldots").setData(dotsData());
    if (map && map.getLayer("parcel-sel-fill")) {
      map.setFilter("parcel-sel-fill", selFilter()); map.setFilter("parcel-sel-line", selFilter());
    }
  }

  themeBtn.addEventListener("click", () => {
    explicit = theme() === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", explicit); } catch (e) {}
    applyThemeAttr();
    if (map && baseStyle) map.setStyle(fullStyle());
  });
  systemDark.addEventListener("change", () => {
    if (explicit) return;
    applyThemeAttr();
    if (map && baseStyle) map.setStyle(fullStyle());
  });

  // ---------- parcel details (sharded JSON, loaded on click) ----------
  const shardCache = new Map();
  function loadShard(id) {
    const key = id.slice(-3).padStart(3, "0");
    if (!shardCache.has(key)) {
      shardCache.set(key, fetch(`data/parcels/${key}.json`).then((r) => {
        if (!r.ok) throw new Error(`shard ${key}: HTTP ${r.status}`);
        return r.json();
      }).catch((e) => { shardCache.delete(key); throw e; }));
    }
    return shardCache.get(key).then((s) => s[id]);
  }

  const drawer = document.getElementById("drawer");
  const body = document.getElementById("drawer-body");
  let reqToken = 0;

  function select(id, opts = {}) {
    setSelected([id]);
    drawer.hidden = false;
    body.innerHTML = `<div class="lbl">Loading…</div>`;
    const token = ++reqToken;
    loadShard(id).then((d) => {
      if (token !== reqToken) return;
      if (!d) { setSelected([]); body.innerHTML = `<div class="lbl">No parcel with account ${esc(opts.label || id)}</div>`; return; }
      body.innerHTML = (opts.back ? opts.back : "") + render(d);
      wireBack();
      fillGroupRow(d);
      addProjectControl(id, d);
      addParcelNotes(id, d);
      if (opts.fly && d.c && map) map.flyTo({ center: d.c, zoom: Math.max(map.getZoom(), 16.5), padding: drawerPad() });
    }).catch((e) => {
      if (token === reqToken) body.innerHTML = `<div class="lbl">Couldn't load parcel details</div><p class="note">${esc(e.message)}</p>`;
    });
  }

  function closeDrawer() { drawer.hidden = true; setSelected([]); }
  const drawerPad = () => (innerWidth > 640 ? { right: 400, top: 40, bottom: 40, left: 40 } : { bottom: innerHeight * 0.62, top: 20, left: 20, right: 20 });
  document.getElementById("close").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const el = document.activeElement;
    if (el && (el.isContentEditable || el.tagName === "TEXTAREA")) { el.blur(); return; }
    closeDrawer(); limits.hidden = true;
  });

  // ---------- formatting ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  const usd = (n) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
  const acres = (n) => (n == null ? "—" : (n < 10 ? n.toFixed(2) : n.toLocaleString("en-US", { maximumFractionDigits: 1 })) + " ac");
  function date(s) {
    if (!s) return null;
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  }
  const row = (k, v) => (v == null || v === "" ? "" : `<dt>${k}</dt><dd>${v}</dd>`);

  function salesList(sh) {
    return `<ul class="sales">${sh.map((r) => `<li><span class="num">${esc(date(r.d))}</span>
      <span class="num">${r.p ? usd(r.p) : "no price"}</span>
      ${r.deed ? `<span class="sub">deed ${esc(r.deed)}${r.prior ? ` · seller's deed ${esc(r.prior)}` : ""}</span>` : ""}</li>`).join("")}</ul>`;
  }

  function taxStatus(d) {
    if (!d.ex) return `Taxable`;
    const full = d.tv && d.ex >= d.tv;
    return `${full ? "Fully exempt" : `Partly exempt <span class="num">(${usd(d.ex)})</span>`}`
      + `<span class="sub">SDAT exempt class ${esc(d.exc || "—")}</span>`;
  }

  function render(d) {
    const P = PAL[theme()];
    const typeDot = `<span class="lbl type" style="--c:${d.t === "p" ? P.edgeStrong : P.t[d.t]}"><i></i>${esc(TYPE_LABEL[d.t] || "Owner")}</span>`;
    const title = d.pv ? "Individually owned" : esc(d.o || "Owner not listed");
    const privacyNote = d.pv
      ? `<p class="note">This home appears to be owned by an individual. To protect their privacy, this map doesn't show the owner's name or mailing address. The record is public on SDAT.</p>`
      : "";
    const sale = d.sd || d.sp ? `${usd(d.sp)}<span class="sub">${esc(date(d.sd) || "date not recorded")}</span>` : null;
    const use = d.lu ? `${esc(d.lul || d.lu)}${d.lul ? ` <span class="num" style="color:var(--dim)">${esc(d.lu)}</span>` : ""}` : null;
    return `
      ${typeDot}
      <h2>${title}</h2>
      <p class="addr">${esc(d.a || "No site address on record")}</p>
      <div id="proj-slot"></div>
      ${privacyNote}
      <dl>
        ${d.pv ? "" : row("Mailing", [d.co, d.ma].filter(Boolean).map(esc).join("<br>") || "—")}
        ${d.g != null ? `<div id="grp-slot" style="display:contents"></div>` : ""}
        ${row("Account", `<span class="num">${esc(d.acct)}</span>`)}
        ${row("Area", `<span class="num">${acres(d.ac)}</span>`)}
        ${row("Land", `<span class="num">${usd(d.lv)}</span>`)}
        ${row("Building", `<span class="num">${usd(d.iv)}</span>`)}
        ${row("Assessed", `<span class="num">${usd(d.tv)}</span>`)}
        ${row("Tax status", taxStatus(d))}
        ${d.sh ? row(`Sales <span class="dim">${d.sh.length}</span>`, salesList(d.sh)) : row("Last sale", sale && `<span class="num">${sale}</span>`)}
        ${row("Deed", d.lf && `<span class="num">Liber/folio ${esc(d.lf)}</span>`)}
        ${row("Land use", use)}
        ${row("Zoning", d.z && `<span class="num">${esc(d.z)}</span>`)}
        ${row("Built", d.yb && `<span class="num">${esc(d.yb)}</span>`)}
      </dl>
      <div id="pnote-slot"></div>
      <div class="src">
        Owner of record and values from SDAT via PG County DPIE${asOfLabel ? `, as of ${esc(asOfLabel)}` : ""}.
        Sales combine SDAT's last sale with Maryland's 12-month Property Sales layer, collected since Nov 2026.
        <div class="links">
          ${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">SDAT record ↗</a><span class="dim"> needs a free SDAT login</span><br>` : ""}
          <a href="https://sdat.dat.maryland.gov/RealProperty/Pages/default.aspx" target="_blank" rel="noopener">SDAT public search ↗</a><span class="dim"> Prince George's · district ${esc(d.acct.split("-")[0])} · account ${esc(d.acct.split("-")[1] || "")}. Shows the last 3 transfers.</span><br>
          ${!d.pv && d.lf ? `<a href="https://mdlandrec.net" target="_blank" rel="noopener">Maryland Land Records ↗</a><span class="dim"> deed liber ${esc(d.lf.split("/")[0])}, folio ${esc(d.lf.split("/")[1])}. Full chain of title.</span><br>` : ""}
          ${!d.pv && d.o && d.t !== "g" ? entityLinks(d.o) : ""}
        </div>
      </div>`;
  }

  // Business-registry lookups for an entity name (opened by the viewer; nothing is fetched by the map).
  function entityLinks(name) {
    const q = encodeURIComponent(name);
    return `<a href="https://egov.maryland.gov/BusinessExpress/EntitySearch" target="_blank" rel="noopener">Maryland Business Express ↗</a><span class="dim"> resident agent, principal office, formation state</span><br>
      <a href="https://opencorporates.com/companies?q=${q}" target="_blank" rel="noopener">OpenCorporates ↗</a><span class="dim"> same name across other states' registries</span>`;
  }

  // ---------- owner group view (hub and spoke; HANDOFF.md section 2) ----------
  let lastGroup = null;
  const plural = (n, w) => `${n.toLocaleString("en-US")} ${n === 1 ? w : w === "entity" ? "entities" : w + "s"}`;
  const EV_LABEL = { address: "Same mailing address", "care-of": "Same care-of name" };

  function hubOf(pts) {
    // the parcel nearest the group's mean position, so the hub sits on real land
    let mx = 0, my = 0, n = pts.length / 2;
    for (let i = 0; i < pts.length; i += 2) { mx += pts[i] / n; my += pts[i + 1] / n; }
    let best = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      const dd = (pts[i] - mx) ** 2 + (pts[i + 1] - my) ** 2;
      if (dd < bd) { bd = dd; best = i; }
    }
    return [pts[best], pts[best + 1]];
  }

  function showGroup(gid) {
    loadIndex().then((d) => {
      const g = d.groups[gid];
      if (!g) return;
      lastGroup = gid;
      reqToken++;
      const n = g.ids.length, multi = g.m.length > 1;
      const hub = multi && n <= 400 ? { label: g.l, pt: hubOf(g.pts) } : null;
      setSelected(g.ids, g.pts, hub);
      drawer.hidden = false;
      const P = PAL[theme()];
      const ww = g.al && g.al.wealth_web
        ? `<p class="addr"><a href="${esc(g.al.wealth_web)}" target="_blank" rel="noopener">Wealth Web profile ↗</a></p>` : "";
      const why = multi ? `
        <div class="lbl sec">Why these are grouped</div>
        <ul class="ev">${g.ev.map(([k, v, c]) => `<li><span class="lbl">${esc(EV_LABEL[k] || k)}</span>${esc(v)} <span class="num dim">× ${c}</span></li>`).join("")}
          ${g.ev.length ? "" : `<li>Owner names that match after normalizing spelling.</li>`}</ul>
        <p class="note">This is an inference from SDAT mailing records, not a legal fact. A shared address usually means a common owner, but it can also be a property manager, lawyer or accountant. Confirm with deeds or LLC filings.</p>` : "";
      const alias = g.al ? `<p class="note">Name from a researched alias. Sources: ${g.al.sources.map((s) =>
        s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>` : esc(s.label)).join("; ")}</p>` : "";
      const members = multi ? `
        <div class="lbl sec">${plural(g.m.length, "entity")} of record</div>
        <ul class="mlist">${g.m.map(([nm, c]) => `<li><span>${esc(nm)}</span><span class="num dim">${c}</span></li>`).join("")}</ul>` : "";
      const list = g.ids.slice(0, 300).map((id) =>
        `<li><button type="button" data-id="${esc(id)}">${esc(addrById.get(id) || "Account " + id)}</button></li>`).join("");
      body.innerHTML = `
        <span class="lbl type" style="--c:${P.t[g.t] || P.edgeStrong}"><i></i>${multi ? "Owner group · " : ""}${esc(TYPE_LABEL[g.t] || "Owner")}</span>
        <h2>${esc(g.l)}</h2>
        <p class="addr">${plural(n, "parcel")} · ${acres(g.ac)} · assessed ${usd(g.tv)}</p>
        ${ww}${alias}${why}${members}
        <div class="lbl sec">Parcels</div>
        <ul class="plist">${list}</ul>
        ${n > 300 ? `<p class="addr">Showing 300 of ${n.toLocaleString("en-US")}. All are highlighted on the map.</p>` : ""}`;
      body.querySelectorAll(".plist button").forEach((b) => b.addEventListener("click", () =>
        select(b.dataset.id, { fly: true, back: `<button type="button" class="back linkish">← ${esc(g.l)}</button>` })));
      const bb = g.b;
      if (map) map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: drawerPad(), maxZoom: 17 });
    });
  }
  function wireBack() {
    const b = body.querySelector(".back");
    if (!b) return;
    if (b.hasAttribute("data-backp") && lastProject) b.addEventListener("click", () => showProject(lastProject));
    else if (lastGroup != null) b.addEventListener("click", () => showGroup(lastGroup));
  }
  // In the parcel drawer: link to the owner group when it holds more than this one name.
  function fillGroupRow(d) {
    const slot = body.querySelector("#grp-slot");
    if (!slot || d.g == null) return;
    loadIndex().then((idx) => {
      const g = idx.groups[d.g];
      if (!g || !body.contains(slot)) return;
      const multi = g.m.length > 1;
      if (!multi && g.ids.length < 2) { slot.remove(); return; }
      slot.innerHTML = `<dt>${multi ? "Owner group" : "Same owner"}</dt><dd><button type="button" class="linkish grp-link">${esc(g.l)}</button>
        <span class="sub">${multi ? plural(g.m.length, "entity") + " · " : ""}${plural(g.ids.length, "parcel")} · ${acres(g.ac)}</span></dd>`;
      slot.querySelector(".grp-link").addEventListener("click", () => showGroup(d.g));
    }).catch(() => slot.remove());
  }

  // ---------- search: entity owners, addresses, ZIPs, cities, account numbers ----------
  const input = document.getElementById("q");
  const results = document.getElementById("results");
  let indexP = null;
  const addrById = new Map();
  function loadIndex() {
    if (!indexP) indexP = fetch("data/search.json").then((r) => r.json()).then((d) => {
      for (const [a, id] of d.addrs) addrById.set(id, a);
      // haystack: group label + every entity name in the group
      d.groupsU = d.groups.map((g) => (g.l + "\n" + g.m.map((m) => m[0]).join("\n")).toUpperCase());
      d.addrsU = d.addrs.map((a) => a[0].toUpperCase());
      d.placesU = d.places.map((p) => p[0].toUpperCase());
      return d;
    }).catch((e) => { indexP = null; throw e; });
    return indexP;
  }
  input.addEventListener("focus", () => loadIndex().catch(() => {}));

  let items = [], active = -1, timer = 0;
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(runSearch, 90); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      paintActive();
    } else if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(timer);
      const keep = active;
      runSearch().then(() => choose(items[Math.max(keep, 0)]));
    } else if (e.key === "Escape") {
      closeResults(); input.blur();
    }
  });
  document.addEventListener("keydown", (e) => {
    const el = document.activeElement;
    const typing = el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    if (e.key === "/" && !typing) { e.preventDefault(); input.focus(); }
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".search")) closeResults(); });
  function closeResults() { results.hidden = true; active = -1; }

  async function runSearch() {
    const raw = input.value.trim();
    items = [];
    if (raw.length < 2) { closeResults(); return; }
    let d;
    try { d = await loadIndex(); } catch (e) {
      results.innerHTML = `<div class="empty">Search index failed to load.</div>`; results.hidden = false; return;
    }
    const q = raw.toUpperCase().replace(/\s+/g, " ");
    const toks = q.split(" ");
    const hasAll = (h) => toks.every((t) => h.includes(t));

    // Account number: "19-2822633", "19 2822633" or the 9-digit property id.
    const parts = raw.split(/[\s-]+/);
    if (/^\d{9}$/.test(raw)) items.push({ kind: "acct", id: raw, label: raw });
    else if (parts.length === 2 && /^\d{1,2}$/.test(parts[0]) && /^\d{5,7}$/.test(parts[1]))
      items.push({ kind: "acct", id: parts[0].padStart(2, "0") + parts[1].padStart(7, "0"), label: raw });

    const places = [];
    d.placesU.forEach((h, i) => { if (h.startsWith(q)) places.push(d.places[i]); });
    places.slice(0, 4).forEach((p) => items.push({ kind: "place", p }));

    const pref = [], rest = [];
    const nq = "\n" + q;
    for (let i = 0; i < d.groupsU.length && pref.length < 8; i++) {
      const h = "\n" + d.groupsU[i];
      if (h.includes(nq)) pref.push(i); else if (rest.length < 8 && hasAll(h)) rest.push(i);
    }
    [...pref, ...rest].slice(0, 8).forEach((i) => items.push({ kind: "owner", gid: i, g: d.groups[i], q }));

    if (/\d/.test(q) || items.length < 6) {
      let n = 0;
      for (let i = 0; i < d.addrsU.length && n < 6; i++) {
        if (hasAll(d.addrsU[i])) { items.push({ kind: "addr", a: d.addrs[i] }); n++; }
      }
    }
    paint();
  }

  const KIND_LABEL = { acct: "Account", place: "Places", owner: "Owners", addr: "Addresses" };
  function paint() {
    if (!items.length) {
      results.innerHTML = `<div class="empty">No matches. Homes owned by individuals aren't searchable by owner name.</div>`;
      results.hidden = false; return;
    }
    let html = "", last = "";
    items.forEach((it, i) => {
      if (it.kind !== last) { html += `<div class="lbl grp">${KIND_LABEL[it.kind]}</div>`; last = it.kind; }
      let main, sub = "";
      if (it.kind === "acct") main = `Go to account ${esc(it.label)}`;
      else if (it.kind === "place") { main = esc(it.p[1] === "zip" ? "ZIP " + it.p[0] : it.p[0]); sub = `${it.p[2].toLocaleString("en-US")} parcels`; }
      else if (it.kind === "owner") {
        const g = it.g, multi = g.m.length > 1;
        // when the hit is a member name, say which one
        const via = multi && !g.l.toUpperCase().includes(it.q) ? g.m.find(([nm]) => nm.toUpperCase().includes(it.q)) : null;
        main = esc(g.l) + (via ? `<span class="via">via ${esc(via[0])}</span>` : "");
        sub = `${multi ? plural(g.m.length, "entity") + " · " : ""}${plural(g.ids.length, "parcel")} · ${acres(g.ac)}`;
      }
      else main = esc(it.a[0]);
      html += `<button type="button" class="res" data-i="${i}"><span>${main}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</button>`;
    });
    results.innerHTML = html;
    results.hidden = false;
    active = -1;
    results.querySelectorAll(".res").forEach((b) => b.addEventListener("click", () => choose(items[+b.dataset.i])));
  }
  function paintActive() {
    results.querySelectorAll(".res").forEach((b) => b.classList.toggle("on", +b.dataset.i === active));
  }

  function choose(it) {
    if (!it) return;
    closeResults();
    input.blur();
    if (it.kind === "acct") select(it.id, { fly: true, label: it.label });
    else if (it.kind === "addr") select(it.a[1], { fly: true });
    else if (it.kind === "owner") showGroup(it.gid);
    else if (it.kind === "place" && map) {
      closeDrawer();
      const b = it.p[3];
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, maxZoom: 15 });
    }
  }

  // ---------- projects (saved in this browser only) ----------
  const PKEY = "rem.projects.v1";
  let projects = [], storageOK = true;
  try { projects = JSON.parse(localStorage.getItem(PKEY) || "[]"); } catch (e) { storageOK = false; projects = []; }
  for (const p of projects) {           // v1 had one free-text "notes" field; keep it as the first log entry
    if (!Array.isArray(p.log)) p.log = [];
    if (p.notes && p.notes.trim()) p.log.push({ id: "n" + Date.parse(p.updated || p.created || 0).toString(36), at: p.updated || new Date().toISOString(), kind: "note", text: p.notes.trim(), sent: false });
    delete p.notes;
  }
  function saveProjects() {
    try { localStorage.setItem(PKEY, JSON.stringify(projects)); storageOK = true; } catch (e) { storageOK = false; }
    renderProjMenu();
  }
  const newId = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function createProject(name, ids = []) {
    const p = { id: newId(), name: name.trim() || "Untitled project", ids: [...ids], log: [], doc: "",
                created: new Date().toISOString(), updated: new Date().toISOString() };
    projects.unshift(p); saveProjects(); return p;
  }
  const touch = (p) => { p.updated = new Date().toISOString(); saveProjects(); };

  // header menu
  const projBtn = document.getElementById("proj-btn");
  const projMenu = document.getElementById("proj-menu");
  function renderProjMenu() {
    projBtn.textContent = projects.length ? `Projects ${projects.length}` : "Projects";
    projMenu.innerHTML = `
      ${projects.map((p) => `<button type="button" class="res" data-p="${p.id}"><span>${esc(p.name)}</span><span class="sub">${plural(p.ids.length, "parcel")}</span></button>`).join("")}
      <form class="newproj"><input name="n" placeholder="New project name" aria-label="New project name" maxlength="80"><button class="linkish" type="submit">Create</button></form>
      <p class="hint2">Projects are saved in this browser only. ${storageOK ? "" : "<b>This browser is blocking storage, so projects will be lost on reload.</b>"}</p>
      <p class="hint2"><button type="button" class="linkish" data-sync>${syncCfg.url ? "Google Doc: connected" : "Connect Google Doc"}</button>${syncCfg.url ? "" : " to send project notes to Drive"}</p>`;
    projMenu.querySelector("[data-sync]").addEventListener("click", () => { projMenu.hidden = true; showSyncSettings(); });
    projMenu.querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", () => { projMenu.hidden = true; showProject(b.dataset.p); }));
    projMenu.querySelector(".newproj").addEventListener("submit", (e) => {
      e.preventDefault();
      const n = e.target.n.value.trim(); if (!n) return;
      const p = createProject(n); projMenu.hidden = true; showProject(p.id);
    });
  }
  projBtn.addEventListener("click", (e) => { e.stopPropagation(); projMenu.hidden = !projMenu.hidden; });
  document.addEventListener("click", (e) => { if (!e.target.closest("#proj-menu, #proj-btn")) projMenu.hidden = true; });

  // "Add to project" in the parcel drawer
  function addProjectControl(id, d) {
    const slot = body.querySelector("#proj-slot");
    if (!slot) return;
    const paint = () => {
      const inN = projects.filter((p) => p.ids.includes(id));
      slot.innerHTML = `<div class="projrow">
        <button type="button" class="linkish" data-toggle>${inN.length ? `In ${plural(inN.length, "project")} ▾` : "+ Add to project"}</button>
        <div class="projpick" hidden>
          ${projects.map((p) => `<button type="button" class="chip" aria-pressed="${p.ids.includes(id)}" data-p="${p.id}">${esc(p.name)}</button>`).join("")}
          <form><input name="n" placeholder="New project…" maxlength="80" aria-label="New project name"></form>
        </div></div>`;
      const pick = slot.querySelector(".projpick");
      slot.querySelector("[data-toggle]").addEventListener("click", () => (pick.hidden = !pick.hidden));
      pick.querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", () => {
        const p = projects.find((x) => x.id === b.dataset.p);
        p.ids = p.ids.includes(id) ? p.ids.filter((x) => x !== id) : [...p.ids, id];
        touch(p); paint(); slot.querySelector(".projpick").hidden = false;
      }));
      pick.querySelector("form").addEventListener("submit", (e) => {
        e.preventDefault(); const n = e.target.n.value.trim(); if (!n) return;
        createProject(n, [id]); paint();
      });
    };
    paint();
  }

  // Notes and questions written from the parcel drawer. Each note belongs to a project (it is
  // sent under that project's name) and remembers the parcel it is about.
  const noteWhen = (n) => new Date(n.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const noteStatus = (n) => (n.sent ? "in Google Doc" : syncCfg.url ? "not sent yet" : "this browser only");
  function addParcelNotes(id, d) {
    const slot = body.querySelector("#pnote-slot");
    if (!slot) return;
    const label = d.a || "Account " + d.acct;
    const paint = (keep = "") => {
      if (!document.contains(slot)) return;
      const inN = projects.filter((p) => p.ids.includes(id));
      const rest = projects.filter((p) => !p.ids.includes(id));
      const notes = projects.flatMap((p) => (p.log || []).filter((n) => n.pid === id).map((n) => ({ ...n, pname: p.name })))
        .sort((a, b) => (a.at < b.at ? 1 : -1));
      slot.innerHTML = `
        <div class="lbl sec">Notes and questions</div>
        <form class="noteform pnote">
          <textarea name="t" rows="2" placeholder="Write a note or a question about this parcel…" aria-label="New note"></textarea>
          <div class="noterow">
            <select name="p" aria-label="Project">
              ${inN.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}
              ${rest.map((p) => `<option value="${p.id}">${esc(p.name)} (adds parcel)</option>`).join("")}
              <option value="__new">New project</option>
            </select>
            <button class="linkish" type="submit">Add</button>
          </div>
          <span class="syncstat">${syncCfg.url ? "Sends to your Project Notes doc" : `Saved in this browser · <button type="button" class="linkish" data-sync>Connect Google Doc</button>`}</span>
        </form>
        ${notes.length ? `<ul class="nlog">${notes.map((n) => `
          <li><span class="sub">${esc(noteWhen(n))} · ${esc(n.pname)} · ${noteStatus(n)}</span>
            <span class="ntext">${esc(n.text)}</span></li>`).join("")}</ul>` : ""}`;
      const f = slot.querySelector("form");
      f.t.value = keep;
      const sl = f.querySelector("[data-sync]"); if (sl) sl.addEventListener("click", showSyncSettings);
      const add = () => {
        const text = f.t.value.trim(); if (!text) return;
        let p = projects.find((x) => x.id === f.p.value);
        if (!p) {
          const n = prompt("Name the new project", label); if (n === null) return;
          p = createProject(n || label, [id]);
        }
        if (!p.ids.includes(id)) p.ids = [...p.ids, id];
        p.log = p.log || [];
        p.log.push({ id: newId(), at: new Date().toISOString(), kind: "note", text, sent: false, pid: id, pl: label });
        touch(p); paint(); addProjectControl(id, d); syncPending();
      };
      f.addEventListener("submit", (e) => { e.preventDefault(); add(); });
      f.t.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); } });
    };
    paint();
    refreshNotes = () => paint(slot.querySelector("textarea") ? slot.querySelector("textarea").value : "");
  }
  let refreshNotes = null;

  // project view
  function loadMany(ids) { return Promise.all(ids.map((id) => loadShard(id).then((d) => [id, d]).catch(() => [id, null]))); }
  function showProject(pid) {
    const p = projects.find((x) => x.id === pid);
    if (!p) return;
    reqToken++;
    const token = reqToken;
    drawer.hidden = false;
    body.innerHTML = `<div class="lbl">Loading project…</div>`;
    Promise.all([loadMany(p.ids), loadIndex().catch(() => null)]).then(([rows, idx]) => {
      if (token !== reqToken) return;
      const ok = rows.filter(([, d]) => d);
      const pts = ok.flatMap(([, d]) => d.c || []);
      setSelected(p.ids, pts);
      const ac = ok.reduce((a, [, d]) => a + (d.ac || 0), 0), tv = ok.reduce((a, [, d]) => a + (d.tv || 0), 0);
      const groups = new Map();
      for (const [, d] of ok) if (d.g != null && idx && idx.groups[d.g] && idx.groups[d.g].m.length > 1) groups.set(d.g, idx.groups[d.g]);
      const sales = ok.flatMap(([id, d]) => (d.sh || (d.sd ? [{ d: d.sd, p: d.sp, deed: d.lf }] : []))
        .map((r) => ({ ...r, where: d.a || "Account " + d.acct, who: d.pv ? "Individually owned" : d.o }))).sort((a, b) => (a.d < b.d ? 1 : -1));
      const doc = (p.doc || "").trim();
      const docLink = /^https?:\/\//i.test(doc) ? `<a href="${esc(doc)}" target="_blank" rel="noopener">Open ↗</a>` : "";
      body.innerHTML = `
        <span class="lbl">Project · saved in this browser</span>
        <h2 contenteditable="plaintext-only" spellcheck="false" class="pname" title="Click to rename">${esc(p.name)}</h2>
        <p class="addr">${plural(p.ids.length, "parcel")} · ${acres(ac)} · assessed ${usd(tv)}</p>
        ${p.ids.length ? "" : `<p class="note">No parcels yet. Click any parcel on the map and choose “+ Add to project”.</p>`}
        ${ok.length ? `<div class="lbl sec">Parcels</div><ul class="plist ptab">${ok.map(([id, d]) => `
          <li><button type="button" data-id="${esc(id)}"><span>${esc(d.a || "Account " + d.acct)}</span>
            <span class="sub">${esc(d.pv ? "Individually owned" : d.o || "")}${d.sd ? " · sold " + d.sd.slice(0, 4) : ""}</span></button>
            <button type="button" class="rm" data-rm="${esc(id)}" aria-label="Remove from project">×</button></li>`).join("")}</ul>` : ""}
        ${groups.size ? `<div class="lbl sec">Owner groups involved</div><ul class="plist">${[...groups].map(([gid, g]) => `
          <li><button type="button" data-g="${gid}">${esc(g.l)} <span class="sub">${plural(g.m.length, "entity")} · ${plural(g.ids.length, "parcel")}</span></button></li>`).join("")}</ul>` : ""}
        ${sales.length ? `<div class="lbl sec">Sales, newest first</div><ul class="sales tl">${sales.map((r) => `
          <li><span class="num">${esc(date(r.d))}</span> <span class="num">${r.p ? usd(r.p) : "no price"}</span>
          <span class="sub">${esc(r.where)}${r.who ? " · " + esc(r.who) : ""}${r.deed ? " · deed " + esc(r.deed) : ""}</span></li>`).join("")}</ul>` : ""}
        <div class="lbl sec">Notes and questions</div>
        <form class="noteform" data-p="${p.id}">
          <textarea name="t" rows="3" placeholder="Write a note or a question about this project…" aria-label="New note"></textarea>
          <div class="noterow">
            <button class="linkish" type="submit">Add</button>
            <span class="syncstat">${syncCfg.url
              ? `Sends to ${syncCfg.doc ? `<a href="${esc(syncCfg.doc)}" target="_blank" rel="noopener">Project Notes ↗</a>` : "your Project Notes doc"}`
              : "Saved in this browser"}</span>
          </div>
        </form>
        ${syncCfg.url ? "" : `<div class="synccta"><span>Send these notes to your Google Doc automatically.</span>
          <button type="button" class="linkish" data-sync>Set it up (one time, about 3 min) →</button></div>`}
        <ul class="nlog">${(p.log || []).slice().reverse().map((n) => `
          <li><span class="sub">${esc(noteWhen(n))}${n.pl ? " · " + esc(n.pl) : ""} · ${noteStatus(n)}</span>
            <span class="ntext">${esc(n.text)}</span></li>`).join("")}</ul>
        <div class="lbl sec">Research doc</div>
        <div class="pdoc"><input class="pdocin" placeholder="Paste a Google Doc link" value="${esc(doc)}"> ${docLink}</div>
        <div class="pact"><button type="button" class="linkish" data-export>Export</button>
          <button type="button" class="linkish danger" data-del>Delete project</button></div>`;
      body.querySelectorAll(".ptab [data-id]").forEach((b) => b.addEventListener("click", () =>
        select(b.dataset.id, { fly: true, back: `<button type="button" class="back linkish" data-backp>← ${esc(p.name)}</button>` })));
      body.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
        p.ids = p.ids.filter((x) => x !== b.dataset.rm); touch(p); showProject(p.id); }));
      body.querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", () => showGroup(+b.dataset.g)));
      const nm = body.querySelector(".pname");
      nm.addEventListener("blur", () => { const v = nm.textContent.trim(); if (v && v !== p.name) { p.name = v.slice(0, 80); touch(p); } });
      nm.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); nm.blur(); } });
      const nf = body.querySelector(".noteform");
      const addNote = () => {
        const text = nf.t.value.trim(); if (!text) return;
        p.log = p.log || [];
        p.log.push({ id: newId(), at: new Date().toISOString(), kind: "note", text, sent: false });
        touch(p); showProject(p.id); syncPending();
      };
      nf.addEventListener("submit", (e) => { e.preventDefault(); addNote(); });
      nf.t.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNote(); } });
      const sl = body.querySelector(".synccta [data-sync]"); if (sl) sl.addEventListener("click", showSyncSettings);
      body.querySelector(".pdocin").addEventListener("change", (e) => { p.doc = e.target.value.trim(); touch(p); showProject(p.id); });
      body.querySelector("[data-export]").addEventListener("click", () => {
        const blob = new Blob([JSON.stringify(p, null, 2)], { type: "application/json" });
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: p.name.replace(/[^\w-]+/g, "-") + ".json" });
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
      body.querySelector("[data-del]").addEventListener("click", () => {
        if (!confirm(`Delete the project “${p.name}”? This can't be undone.`)) return;
        projects = projects.filter((x) => x.id !== p.id); saveProjects(); closeDrawer();
      });
      lastProject = p.id;
      refreshNotes = () => { if (body.querySelector(`.noteform[data-p="${p.id}"]`)) showProject(p.id); };
      if (map && pts.length) {
        const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
        map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: drawerPad(), maxZoom: 16.5 });
      }
    });
  }
  let lastProject = null;


  // ---------- send project notes to a Google Doc (via the owner's Apps Script web app) ----------
  // The map is a public static site, so it cannot write to Drive by itself. The owner deploys
  // scripts/apps-script/project-notes.gs from inside their "Project Notes" doc; this page then
  // POSTs each note there with a private key. URL and key live only in this browser.
  const SKEY = "rem.notesync.v1";
  let syncCfg = {};
  try { syncCfg = JSON.parse(localStorage.getItem(SKEY) || "{}"); } catch (e) { syncCfg = {}; }
  const saveSync = () => { try { localStorage.setItem(SKEY, JSON.stringify(syncCfg)); } catch (e) {} };
  const validUrl = (u) => /^https:\/\/script\.google(usercontent)?\.com\//.test(u || "");
  const mapBase = location.origin + location.pathname;

  async function parcelRefs(ids) {
    const rows = await loadMany(ids.slice(0, 50));
    return rows.filter(([, d]) => d).map(([, d]) => ({
      label: [d.a || "No site address", d.pv ? "individually owned" : d.o, "acct " + d.acct].filter(Boolean).join(" · "),
      url: d.c ? `${mapBase}#map=17/${d.c[1]}/${d.c[0]}` : mapBase,
    }));
  }
  async function sendNote(p, n) {
    const payload = { key: syncCfg.key, project: p.name, kind: n.kind, text: n.text, at: n.at, parcels: await parcelRefs(n.pid ? [n.pid] : p.ids) };
    // text/plain body = a "simple" cross-origin request, which Apps Script web apps accept without a preflight
    const r = await fetch(syncCfg.url, { method: "POST", body: JSON.stringify(payload) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "not saved");
  }
  let syncing = false;
  async function syncPending() {
    if (syncing || !syncCfg.url || !syncCfg.key) return;
    syncing = true;
    let sent = 0, failed = null;
    try {
      for (const p of projects) for (const n of p.log || []) {
        if (n.sent) continue;
        try { await sendNote(p, n); n.sent = true; sent++; saveProjects(); }
        catch (e) { failed = e; break; }
      }
    } finally { syncing = false; }
    if (failed) toast(`A note couldn't reach Google Docs (${failed.message}). It stays saved here and will retry.`);
    else if (sent) toast(sent === 1 ? "Note sent to Google Docs." : `${sent} notes sent to Google Docs.`);
    if (sent && refreshNotes && !drawer.hidden) refreshNotes();
  }
  function toast(msg) {
    let t = document.getElementById("toast");
    if (!t) { t = Object.assign(document.createElement("div"), { id: "toast", className: "toast", role: "status" }); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), 4000);
  }

  function showSyncSettings() {
    reqToken++;
    drawer.hidden = false;
    setSelected([]);
    body.innerHTML = `
      <span class="lbl">Project notes · Google Doc</span>
      <h2>Connect Google Doc</h2>
      <p class="addr">Notes and questions you add to a project are sent to your "Real Estate Map · Project Notes" doc, newest first. Nothing is stored on this website; the link and key below stay in this browser.</p>
      <ol class="steps">
        <li>In Google Drive, open <b>AI Collaboration › Claude Projects › Real Estate Map › Real Estate Map · Project Notes</b>, then <b>Extensions › Apps Script</b>.</li>
        <li><button type="button" class="linkish" data-copy>Copy the script</button>, select everything in Code.gs, paste over it, and save (⌘S). <span class="sub copymsg"></span></li>
        <li>Run <b>setup</b> once, approve the prompt, and copy the key from the Execution log.</li>
        <li><b>Deploy › New deployment › Web app</b>: execute as Me, access Anyone. Copy the Web app URL.</li>
        <li>Paste both below and press Test.</li>
      </ol>
      <form class="syncform">
        <label>Web app URL<input name="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(syncCfg.url || "")}" autocomplete="off"></label>
        <label>Key<input name="key" type="password" placeholder="From the setup() log" value="${esc(syncCfg.key || "")}" autocomplete="off"></label>
        <label>Doc link (optional, for an "open" link)<input name="doc" placeholder="https://docs.google.com/document/d/…" value="${esc(syncCfg.doc || "")}" autocomplete="off"></label>
        <div class="pact"><button class="linkish" type="submit">Test and save</button>
          ${syncCfg.url ? `<button type="button" class="linkish danger" data-disc>Disconnect</button>` : ""}
          <span class="syncmsg sub"></span></div>
      </form>`;
    const f = body.querySelector(".syncform"), msg = body.querySelector(".syncmsg");
    body.querySelector("[data-copy]").addEventListener("click", async () => {
      const cm = body.querySelector(".copymsg");
      try {
        const r = await fetch("https://raw.githubusercontent.com/AlxndrHQ/pg-county-land-map/main/scripts/apps-script/project-notes.gs");
        if (!r.ok) throw new Error("HTTP " + r.status);
        await navigator.clipboard.writeText(await r.text());
        const btn = body.querySelector("[data-copy]");
        btn.textContent = "Copied to clipboard ✓";
        cm.textContent = "Now paste it into Code.gs.";
      } catch (e) {
        cm.innerHTML = `Couldn't copy (${esc(e.message)}). <a href="https://github.com/AlxndrHQ/pg-county-land-map/blob/main/scripts/apps-script/project-notes.gs" target="_blank" rel="noopener">Open the script ↗</a> and copy it from there.`;
      }
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const url = f.url.value.trim(), key = f.key.value.trim(), doc = f.doc.value.trim();
      if (!validUrl(url)) { msg.textContent = "That isn't an Apps Script web app URL."; return; }
      if (!key) { msg.textContent = "Add the key from setup()."; return; }
      msg.textContent = "Testing…";
      try {
        const r = await fetch(`${url}?key=${encodeURIComponent(key)}`);
        const j = await r.json();
        if (!j.ok) throw new Error(j.error === "bad key" ? "the key doesn't match" : j.error || "no answer");
        syncCfg = { url, key, doc: /^https:\/\/docs\.google\.com\//.test(doc) ? doc : "" }; saveSync();
        msg.textContent = `Connected to "${j.doc}".`;
        renderProjMenu(); syncPending();
      } catch (err) { msg.textContent = `Couldn't connect: ${err.message}. Check the URL, the key, and that access is set to Anyone.`; }
    });
    const d = body.querySelector("[data-disc]");
    if (d) d.addEventListener("click", () => { syncCfg = {}; saveSync(); renderProjMenu(); showSyncSettings(); });
  }
  renderProjMenu();
  syncPending();

  // ---------- footer + limits ----------
  let asOfLabel = null;
  fetch("data/meta.json").then((r) => r.json()).then((m) => {
    asOfLabel = m.as_of_label;
    if (asOfLabel) document.getElementById("asof").textContent =
      `Parcel data: MD iMAP, MDP, SDAT · PG County DPIE · Ownership as of SDAT, ${asOfLabel}`;
  }).catch(() => {});

  const limits = document.getElementById("limits");
  document.getElementById("limits-btn").addEventListener("click", () => (limits.hidden = !limits.hidden));
  limits.querySelector("[data-close]").addEventListener("click", () => (limits.hidden = true));
})();
