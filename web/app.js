/* Real Estate Map — parcels on a map (M1) + search (M2). */
(() => {
  "use strict";

  const BASE_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
  const PARCELS_URL = new URL("data/parcels.pmtiles", location.href).href;
  // Other jurisdictions live in storage-only data repos on the same GitHub Pages host (one map, many data sites).
  // Their parcel ids carry a prefix ("AA_020100000002454"); PG ids stay bare so saved projects keep working.
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const REGIONS = {
    AA: { name: "Anne Arundel County, MD", repo: "rem-data-md", county: "Anne Arundel",
          src: "Owner names from Anne Arundel County Planning and Zoning; values, land use and sales from SDAT via MD iMAP" },
    MO: { name: "Montgomery County, MD", repo: "rem-data-md", county: "Montgomery", noNames: true,
          src: "Values, land use and sales from SDAT via MD iMAP. Montgomery County publishes no owner names" },
    CH: { name: "Charles County, MD", repo: "rem-data-md", county: "Charles",
          src: "Owner names from Charles County's tax parcel layer; values, land use and sales from SDAT via MD iMAP" },
    HO: { name: "Howard County, MD", repo: "rem-data-md", county: "Howard", noNames: true,
          src: "Values, land use and sales from SDAT via MD iMAP. Howard County publishes no owner names in machine-readable form" },
    DC: { name: "Washington, DC", repo: "rem-data-va", county: "DC", place: "the District", state: "DC",
          src: "Owner of record, values and last sale from DC's Owner Polygons layer (Office of Tax and Revenue via DC GIS)",
          rec: ["DC real property search", "https://mytax.dc.gov/_/"] },
    AR: { name: "Arlington County, VA", repo: "rem-data-va", county: "Arlington", state: "VA",
          src: "Values, land use and sales from Arlington County's real estate data. The county redacts owner names; where shown, the owner is the most recent buyer when that buyer is a company",
          rec: ["Arlington property search", "https://propertysearch.arlingtonva.us/"] },
    AL: { name: "City of Alexandria, VA", repo: "rem-data-va", county: "Alexandria", place: "Alexandria", state: "VA",
          src: "Owner of record, land use and values from the City of Alexandria's parcel and assessment layers",
          rec: ["Alexandria real estate search", "https://realestate.alexandriava.gov/"] },
    FX: { name: "Fairfax County, VA", repo: "rem-data-va", county: "Fairfax", noNames: true, state: "VA",
          src: "Values, land use and zoning from Fairfax County Tax Administration. Fairfax publishes no owner names in its open data",
          rec: ["Fairfax iCARE", "https://icare.fairfaxcounty.gov/"] },
    PW: { name: "Prince William County, VA", repo: "rem-data-va", county: "Prince William", state: "VA",
          src: "Owner of record, mailing address and deed from Prince William County's open data (no values or sale prices published there)",
          rec: ["Prince William real estate assessments", "https://www.pwcva.gov/department/real-estate-assessments"] },
    LO: { name: "Loudoun County, VA", repo: "rem-data-va", county: "Loudoun", noNames: true, state: "VA",
          src: "Parcel shapes and acreage from Loudoun County GIS. Loudoun publishes no owner names, values or sales in machine-readable form",
          rec: ["Loudoun parcel database", "https://reparcelasmt.loudoun.gov/"] },
    FQ: { name: "Fauquier County, VA", repo: "rem-data-va", county: "Fauquier", state: "VA",
          src: "Owner of record, values and last sale from Fauquier County GIS tax parcels",
          rec: ["Fauquier property records", "https://www.actdatascout.com/RealProperty/Virginia/Fauquier"] },
  };
  const regionBase = (code) => LOCAL ? new URL(`data/r/${code}/`, location.href).href
    : `https://alxndrhq.github.io/${REGIONS[code].repo}/${code}/`;
  const regionOf = (id) => (/^([A-Z]{2})_/.exec(id || "") || [])[1] || "PG";
  const SRC = [["parcels", ""], ...Object.keys(REGIONS).map((c) => ["parcels-" + c, "-" + c])];
  const idsOf = (base) => SRC.map(([, sfx]) => base + sfx);
  const eachLayer = (base, fn) => { if (map) for (const id of idsOf(base)) if (map.getLayer(id)) fn(id); };
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
      tag: { gold: "#8A5A2B", clay: "#9B3D2E", blue: "#3E6A8A", violet: "#6B5B9A", green: "#3C7A5E", teal: "#2F7A80" },
    },
    dark: {
      bg: "#0E0E10", text: "#E8E6DF", muted: "#7A7A82", dim: "#56565D", line: "#26262B",
      accent: "#C9A875", accentSoft: "rgba(201,168,117,0.12)", edge: "#36363D", edgeStrong: "#5E5E66",
      water: "#141418", park: "#111113", building: "#131316",
      roadMajor: "#232328", roadMinor: "#1A1A1E", rail: "#2A2A30",
      t: { c: "#86A8C4", i: "#A99BD3", g: "#7FB89B", r: "#7CC3C8", p: "#36363D" },
      tag: { gold: "#C9A875", clay: "#E0907A", blue: "#86A8C4", violet: "#A99BD3", green: "#7FB89B", teal: "#7CC3C8" },
    },
  };
  const TYPE_LABEL = { c: "Corporate / LLC", i: "Institutional", g: "Government", r: "Religious / nonprofit", p: "Individual", u: "Owner not published" };

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

  const typeColorExpr = (P) => ["match", ["get", "t"], "c", P.t.c, "i", P.t.i, "g", P.t.g, "r", P.t.r, P.t.p];
  function parcelLayers(P) {
    const typeColor = typeColorExpr(P);
    const tc = tagColorExpr(P);
    const per = (base, def) => SRC.map(([src, sfx]) => ({ ...def, id: base + sfx, source: src, "source-layer": "parcels" }));
    return [
      ...per("parcel-hit", { type: "fill", minzoom: PARCEL_MINZOOM, filter: ["!=", ["get", "t"], "u"],
        paint: { "fill-color": P.bg, "fill-opacity": 0 } }),
      ...per("parcel-line", { type: "line", minzoom: PARCEL_MINZOOM,
        paint: {
          "line-color": muteOthers ? P.edge : typeColor,
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.3, 15, 0.7, 18, 1.2],
          "line-opacity": ["case", ["==", ["get", "t"], "p"], 0.9, 0.95],
        }, filter: typeFilter() }),
      ...per("pub-fill", { type: "fill", minzoom: PARCEL_MINZOOM, filter: pubFilter(), paint: { "fill-color": P.accentSoft } }),
      ...per("pub-line", { type: "line", minzoom: PARCEL_MINZOOM, filter: pubFilter(),
        paint: { "line-color": P.accent, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 16, 2], "line-dasharray": [2, 1] } }),
      ...per("tag-fill", { type: "fill", minzoom: PARCEL_MINZOOM, filter: tagFilter(), paint: { "fill-color": tc, "fill-opacity": 0.16 } }),
      ...per("tag-line", { type: "line", minzoom: PARCEL_MINZOOM, filter: tagFilter(),
        paint: { "line-color": tc, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.9, 16, 1.6] } }),
      { id: "tag-dots", type: "circle", source: "tagdots", maxzoom: 13,
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 1.8, 12, 3.2], "circle-color": ["get", "col"],
                 "circle-opacity": 0.9, "circle-stroke-color": P.bg, "circle-stroke-width": 0.6 } },
      { id: "spokes", type: "line", source: "seldots", filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": P.accent, "line-width": 0.7, "line-opacity": 0.55 } },
      { id: "sel-dots", type: "circle", source: "seldots", maxzoom: 14, filter: ["==", ["get", "k"], "pt"],
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 2.2, 13, 4], "circle-color": P.accent,
                 "circle-stroke-color": P.bg, "circle-stroke-width": 1 } },
      ...per("parcel-sel-fill", { type: "fill", filter: selFilter(), paint: { "fill-color": P.accentSoft } }),
      ...per("parcel-sel-line", { type: "line", filter: selFilter(),
        paint: { "line-color": P.accent, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.2, 17, 2] } }),
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
    for (const code of Object.keys(REGIONS))
      s.sources["parcels-" + code] = { type: "vector", url: "pmtiles://" + regionBase(code) + "parcels.pmtiles" };
    s.sources.seldots = { type: "geojson", data: dotsData() };
    s.sources.tagdots = { type: "geojson", data: tagDotsData(P) };
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
    map.on("load", () => { if (view.pub) applyPub(); });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("zoom", updateHint);
    updateHint();
    for (const id of idsOf("parcel-hit")) {
      map.on("mousemove", id, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
    }
    map.on("click", (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: idsOf("parcel-hit").filter((id) => map.getLayer(id)) })[0];
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
    eachLayer("parcel-sel-fill", (id) => map.setFilter(id, selFilter()));
    eachLayer("parcel-sel-line", (id) => map.setFilter(id, selFilter()));
  }

  themeBtn.addEventListener("click", () => {
    explicit = theme() === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", explicit); } catch (e) {}
    applyThemeAttr();
    if (map && baseStyle) map.setStyle(fullStyle());
    renderLegend();
  });
  systemDark.addEventListener("change", () => {
    if (explicit) return;
    applyThemeAttr();
    if (map && baseStyle) map.setStyle(fullStyle());
  });

  // ---------- parcel details (sharded JSON, loaded on click) ----------
  const shardCache = new Map();
  function loadShard(id) {
    const region = regionOf(id);
    const key = (region === "PG" ? "" : region + "/") + id.slice(-3).padStart(3, "0");
    const url = region === "PG" ? `data/parcels/${key}.json` : regionBase(region) + `parcels/${key.split("/")[1]}.json`;
    if (!shardCache.has(key)) {
      shardCache.set(key, fetch(url).then((r) => {
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
      body.innerHTML = (opts.back ? opts.back : "") + render({ ...d, id });
      wireBack();
      fillGroupRow(d);
      addProjectControl(id, d);
      addTagControl(id, d);
      addParcelNotes(id, d);
      if (!d.pv && !d.nn && d.g != null) fillCompany(d.g, id);
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
    const typeDot = `<span class="lbl type" style="--c:${d.t === "p" || d.t === "u" ? P.edgeStrong : P.t[d.t]}"><i></i>${esc(TYPE_LABEL[d.t] || "Owner")}</span>`;
    const reg = REGIONS[regionOf(d.id)];
    const title = d.nn ? "Owner not published" : d.pv ? "Individually owned" : esc(d.o || "Owner not listed");
    const privacyNote = d.nn
      ? (reg && reg.noNames
        ? `<p class="note">${esc(reg.place || reg.county + " County")} doesn't publish owner names in its open data, so this map doesn't show the owner or mailing address. The owner of record is on ${esc(reg.rec ? reg.rec[0] : "SDAT")}.</p>`
        : `<p class="note">This parcel has no owner name in the published data, so this map doesn't show an owner or mailing address. The owner of record is on ${esc(reg && reg.rec ? reg.rec[0] : "SDAT")}.</p>`)
      : d.pv
      ? `<p class="note">This home appears to be owned by an individual. To protect their privacy, this map doesn't show the owner's name or mailing address. The record is public on ${esc(reg && reg.rec ? reg.rec[0] : "SDAT")}.</p>`
      : "";
    const sale = d.sd || d.sp ? `${usd(d.sp)}<span class="sub">${esc(date(d.sd) || "date not recorded")}</span>` : null;
    const use = d.lu ? `${esc(d.lul || d.lu)}${d.lul ? ` <span class="num" style="color:var(--dim)">${esc(d.lu)}</span>` : ""}` : null;
    return `
      ${typeDot}
      <h2>${title}</h2>
      ${d.ob ? `<p class="note">Likely owner: the most recent buyer in the county's sales records, not the owner of record. Confirm with the deed.</p>` : ""}
      <p class="addr">${esc(d.a || "No site address on record")}</p>
      <div id="proj-slot"></div>
      <div id="tag-slot"></div>
      ${privacyNote}
      <dl>
        ${d.pv || d.nn ? "" : row("Mailing", [d.co, d.ma].filter(Boolean).map(esc).join("<br>") || "—")}
        ${d.g != null ? `<div id="grp-slot" style="display:contents"></div>` : ""}
        ${row("Account", `<span class="num">${esc(d.acct)}</span>`)}
        ${row("Area", `<span class="num">${acres(d.ac)}</span>`)}
        ${row("Land", `<span class="num">${usd(d.lv)}</span>`)}
        ${row("Building", `<span class="num">${usd(d.iv)}</span>`)}
        ${row("Assessed", `<span class="num">${usd(d.tv)}</span>`)}
        ${row("Tax status", taxStatus(d))}
        ${d.sh ? row(`Sales <span class="dim">${d.sh.length}</span>`, salesList(d.sh)) : row("Last sale", sale && `<span class="num">${sale}</span>`)}
        ${row("Deed", d.lf ? `<span class="num">${reg && reg.state ? "Book/page" : "Liber/folio"} ${esc(d.lf)}</span>` : d.dn && `<span class="num">Instrument ${esc(d.dn)}</span>`)}
        ${row("Land use", use)}
        ${row("Zoning", d.z && `<span class="num">${esc(d.z)}</span>`)}
        ${row("Built", d.yb && `<span class="num">${esc(d.yb)}</span>`)}
      </dl>
      <div id="co-slot"></div>
      <div id="pnote-slot"></div>
      <div class="src">
        ${reg ? esc(reg.src) + "." : `Owner of record and values from SDAT via PG County DPIE${asOfLabel ? `, as of ${esc(asOfLabel)}` : ""}.
        Sales combine SDAT's last sale with Maryland's 12-month Property Sales layer, collected since Nov 2026.`}
        <div class="links">
          ${reg && reg.rec ? `<a href="${esc(reg.rec[1])}" target="_blank" rel="noopener">${esc(reg.rec[0])} ↗</a><span class="dim"> search ${esc(d.acct)}</span><br>` : ""}
          ${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">SDAT record ↗</a><span class="dim"> needs a free SDAT login</span><br>` : ""}
          ${reg && reg.rec ? "" : `<a href="https://sdat.dat.maryland.gov/RealProperty/Pages/default.aspx" target="_blank" rel="noopener">SDAT public search ↗</a><span class="dim"> ${reg ? `${esc(reg.county)} · account ${esc(d.acct)}` : `Prince George's · district ${esc(d.acct.split("-")[0])} · account ${esc(d.acct.split("-")[1] || "")}`}. Shows the last 3 transfers.</span><br>`}
          ${!d.pv && !d.nn && d.lf && !(reg && reg.state) ? `<a href="https://mdlandrec.net" target="_blank" rel="noopener">Maryland Land Records ↗</a><span class="dim"> deed liber ${esc(d.lf.split("/")[0])}, folio ${esc(d.lf.split("/")[1])}. Full chain of title.</span><br>` : ""}
          ${!d.pv && !d.nn && d.o && d.t !== "g" ? entityLinks(d.o, reg && reg.state) : ""}
        </div>
      </div>`;
  }

  // Business-registry lookups for an entity name (opened by the viewer; nothing is fetched by the map).
  function entityLinks(name, state) {
    const q = encodeURIComponent(name);
    const reg = state === "VA" ? `<a href="https://cis.scc.virginia.gov/EntitySearch/Index" target="_blank" rel="noopener">Virginia SCC business search ↗</a><span class="dim"> registered agent, principal office</span><br>`
      : state === "DC" ? `<a href="https://corponline.dcra.dc.gov/" target="_blank" rel="noopener">DC CorpOnline ↗</a><span class="dim"> registered agent, officers</span><br>`
      : `<a href="https://egov.maryland.gov/BusinessExpress/EntitySearch" target="_blank" rel="noopener">Maryland Business Express ↗</a><span class="dim"> resident agent, principal office, formation state</span><br>`;
    return `${reg}
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
    loadGroup(gid).then((g) => {
      if (!g || !g.ids) return;
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
      const list = g.ids.slice(0, 300).map((id, i) =>
        `<li><button type="button" data-id="${esc(id)}">${esc(g.as[i] || "Account " + id)}</button></li>`).join("");
      body.innerHTML = `
        <span class="lbl type" style="--c:${P.t[g.t] || P.edgeStrong}"><i></i>${multi ? "Owner group · " : ""}${esc(TYPE_LABEL[g.t] || "Owner")}</span>
        <h2>${esc(g.l)}</h2>
        <p class="addr">${plural(n, "parcel")} · ${acres(g.ac)} · assessed ${usd(g.tv)}</p>
        ${ww}${alias}${why}${members}
        <div id="co-slot"></div>
        <div class="lbl sec">Parcels</div>
        <ul class="plist">${list}</ul>
        ${n > 300 ? `<p class="addr">Showing 300 of ${n.toLocaleString("en-US")}. All are highlighted on the map.</p>` : ""}`;
      body.querySelectorAll(".plist button").forEach((b) => b.addEventListener("click", () =>
        select(b.dataset.id, { fly: true, back: `<button type="button" class="back linkish">← ${esc(g.l)}</button>` })));
      fillCompany(gid);
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
      if (!multi && g.n < 2) { slot.remove(); return; }
      slot.innerHTML = `<dt>${multi ? "Owner group" : "Same owner"}</dt><dd><button type="button" class="linkish grp-link">${esc(g.l)}</button>
        <span class="sub">${multi ? plural(g.m.length, "entity") + " · " : ""}${plural(g.n, "parcel")} · ${acres(g.ac)}</span></dd>`;
      slot.querySelector(".grp-link").addEventListener("click", () => showGroup(d.g));
    }).catch(() => slot.remove());
  }

  // ---------- credit and equity for owners that are (subsidiaries of) public companies ----------
  // data/companies.json is built by scripts/fetch_sec.py from SEC filings: owner group -> company (CIK),
  // with shares outstanding, public float, total debt, interest expense. Linked by exact name, or by the
  // company's own subsidiary list (Exhibit 21), which is cited.
  let companiesP = null;
  const loadCompanies = () => companiesP || (companiesP = fetch("data/companies.json").then((r) => r.json())
    .catch((e) => { companiesP = null; throw e; }));
  const big = (v) => v == null ? null : Math.abs(v) >= 1e9 ? "$" + (v / 1e9).toFixed(v >= 1e11 ? 0 : 2) + "B"
    : Math.abs(v) >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M" : usd(v);
  const qdate = (s) => s ? new Date(s + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  // Same normalization as key() in fetch_sec.py: suffixes and punctuation don't matter.
  const DROP_WORDS = new Set(["INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "LLC", "L", "C", "LP", "LTD",
    "LIMITED", "PLC", "THE", "NV", "SA", "AG", "DE", "MD", "VA", "DC", "NEW"]);
  const coKey = (s) => String(s || "").toUpperCase().replace(/&/g, " AND ").replace(/\/[A-Z]{2,3}\/?/g, " ")
    .replace(/[^A-Z0-9]+/g, " ").split(" ").filter((t) => t && !DROP_WORDS.has(t)).join(" ");
  // ownerName: on a parcel, the company shows only when this parcel's own owner is the linked name
  // (owner groups are leads; a group can hold unrelated entities that share a manager's address).
  function fillCompany(gid, parcelId) {
    const slot = body.querySelector("#co-slot");
    if (!slot) return;
    loadCompanies().then((C) => {
      const cik = C.g[String(gid)];
      if (!cik || !document.contains(slot)) return;
      const c = C.co[cik], via = C.via[String(gid)] || {};
      if (parcelId && !(C.ids[String(gid)] || []).includes(parcelId)) return;
      const quote = c.ticker ? `https://finance.yahoo.com/quote/${encodeURIComponent(c.ticker)}` : null;
      const r = (k, v, sub) => v == null ? "" : `<div><dt>${k}</dt><dd><span class="num">${v}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</dd></div>`;
      const link = via.sources ? `Linked through the company's subsidiary list: ${via.sources.map((x) =>
        `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)} ↗</a>`).join("; ")}.`
        : `Linked by the owner name “${esc(via.via || "")}” matching the SEC registrant name.`;
      const scope = parcelId ? "" : ` Applies to parcels owned by “${esc(via.via || "")}”, not necessarily every entity in this group.`;
      slot.innerHTML = `
        <div class="lbl sec">Public company</div>
        <p class="coname">${esc(c.name)}${c.ticker ? ` <span class="num tick">${esc(c.ticker)}${c.exchange ? " · " + esc(c.exchange) : ""}</span>` : ""}</p>
        <dl class="codl">
          <div class="cohead"><span class="lbl">Equity</span></div>
          ${r("Shares out", c.shares != null ? Math.round(c.shares).toLocaleString("en-US") : null, c.shares_date && "as of " + qdate(c.shares_date))}
          ${r("Public float", big(c.float), c.float_date && "market value held by the public, " + qdate(c.float_date))}
          ${quote ? `<div><dt>Price</dt><dd><a href="${quote}" target="_blank" rel="noopener">Today's quote and market cap ↗</a></dd></div>` : ""}
          <div class="cohead"><span class="lbl">Credit</span></div>
          ${r("Total debt", big(c.debt), c.debt_date && "as of " + qdate(c.debt_date))}
          ${r("Due in a year", big(c.debt_current), null)}
          ${r("Interest paid", big(c.interest), c.interest_period && "fiscal year to " + qdate(c.interest_period))}
          ${r("Avg. rate", c.rate != null ? c.rate.toFixed(2) + "%" : null, "interest ÷ debt, an estimate")}
          ${c.debt == null && c.interest == null ? `<div><dt>Debt</dt><dd>Not tagged in recent SEC filings</dd></div>` : ""}
        </dl>
        <p class="note">${link}${scope} Figures from the company's latest SEC filings (<a href="${esc(c.links.filings)}" target="_blank" rel="noopener">filings ↗</a>).
          Bond-by-bond data isn't included yet.</p>`;
    }).catch(() => {});
  }

  // ---------- search: entity owners, addresses, ZIPs, cities, account numbers ----------
  const input = document.getElementById("q");
  const results = document.getElementById("results");
  let indexP = null;
  // The index is split (see build_parcels.py): a compact core here, each group's parcels in
  // data/groups/NNN.json (loadGroup), and addresses in data/addrs.json (loadAddrs, address searches only).
  function loadIndex() {
    if (!indexP) indexP = fetch("data/search.json").then((r) => r.json()).then((d) => {
      d.groups = d.groups.map(([l, t, ac, tv, b, n, m, ls, al]) =>
        ({ l, t, ac, tv, b, n, m: m || [[l, n]], ls, ...(al ? { al } : {}) }));
      // haystack: group label + every entity name in the group
      d.groupsU = d.groups.map((g) => (g.l + "\n" + g.m.map((m) => m[0]).join("\n")).toUpperCase());
      d.placesU = d.places.map((p) => p[0].toUpperCase());
      return d;
    }).catch((e) => { indexP = null; throw e; });
    return indexP;
  }
  const groupChunks = new Map();
  // Adds ids, pts, ev and as (addresses) to the group's record and resolves to it.
  function loadGroup(gid) {
    const k = String(Math.floor(gid / 100)).padStart(3, "0");
    if (!groupChunks.has(k)) groupChunks.set(k, fetch(`data/groups/${k}.json`).then((r) => {
      if (!r.ok) throw new Error("group file " + k);
      return r.json();
    }).catch((e) => { groupChunks.delete(k); throw e; }));
    return Promise.all([loadIndex(), groupChunks.get(k)]).then(([d, chunk]) => {
      const g = d.groups[gid], x = chunk[gid];
      if (g && x && !g.ids) Object.assign(g, { ids: x[0], pts: x[1], ev: x[2], as: x[3] });
      return g;
    });
  }
  let addrsP = null;
  function loadAddrs() {
    if (!addrsP) addrsP = fetch("data/addrs.json").then((r) => r.json()).then((a) => ({ a, u: a.map((x) => x[0].toUpperCase()) }))
      .catch((e) => { addrsP = null; throw e; });
    return addrsP;
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
      let ad = null;
      try { ad = await loadAddrs(); } catch (e) {}
      if (input.value.trim() !== raw) return;          // typed on while the address file loaded
      let n = 0;
      for (let i = 0; ad && i < ad.u.length && n < 6; i++) {
        if (hasAll(ad.u[i])) { items.push({ kind: "addr", a: ad.a[i] }); n++; }
      }
    }
    const geoQ = raw.length >= 3 && !items.some((it) => it.kind === "acct") ? raw : null;
    paint(geoQ);
    clearTimeout(geoTimer);
    if (geoQ) geoTimer = setTimeout(() => geoSearch(geoQ).then((hits) => {
      if (input.value.trim() !== raw || !hits.length) { if (input.value.trim() === raw) paint(); return; }
      items = items.filter((it) => it.kind !== "geo").concat(hits.map((h) => ({ kind: "geo", h })));
      paint();
    }), 350);
  }
  let geoTimer = null;

  // Place names (buildings, malls, landmarks) from OpenStreetMap via Photon, limited to the county.
  // Debounced by the search box timer and cached per query, to stay polite to the free service.
  const PG_BBOX = "-77.09,38.53,-76.66,39.13";
  const geoCache = new Map();
  function geoSearch(q) {
    const k = q.toLowerCase();
    if (!geoCache.has(k)) geoCache.set(k, fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=en&bbox=${PG_BBOX}`)
      .then((r) => (r.ok ? r.json() : { features: [] }))
      .then((j) => (j.features || []).map((f) => {
        const pr = f.properties || {};
        const street = [pr.housenumber, pr.street].filter(Boolean).join(" ");
        return { name: pr.name || street || pr.city || q, sub: [pr.name ? street : "", pr.city || pr.county].filter(Boolean).join(", "), c: f.geometry.coordinates };
      }))
      .catch(() => { geoCache.delete(k); return []; }));
    return geoCache.get(k);
  }

  const KIND_LABEL = { acct: "Account", place: "Places", owner: "Owners", addr: "Addresses", geo: "On the map (OpenStreetMap)" };
  function paint(pending) {
    if (!items.length) {
      results.innerHTML = `<div class="empty">${pending ? "Searching map places…" : "No matches. Homes owned by individuals aren't searchable by owner name."}</div>`;
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
        sub = `${multi ? plural(g.m.length, "entity") + " · " : ""}${plural(g.n, "parcel")} · ${acres(g.ac)}`;
      }
      else if (it.kind === "geo") { main = esc(it.h.name); sub = esc(it.h.sub); }
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
    else if (it.kind === "geo" && map) {
      // OSM points are approximate, so pin the place and let the viewer pick the parcel
      closeDrawer();
      setSelected([], [], { label: it.h.name, pt: it.h.c });
      map.flyTo({ center: it.h.c, zoom: 16.5 });
      toast("Pinned from OpenStreetMap. Click the parcel to see who owns it.");
    }
    else if (it.kind === "place" && map) {
      closeDrawer();
      const b = it.p[3];
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, maxZoom: 15 });
    }
  }

  // Wealth Web link: open it filtered to people based near this map's area, with a link back here.
  const wwLink = document.getElementById("ww-link");
  if (wwLink) wwLink.addEventListener("click", () => {
    const q = new URLSearchParams({ near: "MD,DC,VA", label: "Prince George's County", back: location.href });
    wwLink.href = "https://alxndrhq.github.io/historical-wealth-mind-map/?" + q.toString() + "#/grid";
  });

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
  // The note's thread from the doc (answers and follow-ups, in order), plus replies not yet in the doc.
  const answersHtml = (n) => {
    const thread = n.thread || (n.answers || []).map((t) => ({ k: "a", t }));
    const inDoc = new Set(thread.filter((i) => i.k === "f").map((i) => i.t.trim()));
    const local = (n.replies || []).filter((r) => !inDoc.has(r.text.trim()));
    const waiting = syncCfg.auto && ((thread.length && thread[thread.length - 1].k === "f") || local.some((r) => r.sent));
    return thread.map((i) => i.k === "a" ? `<span class="nans">↳ ${esc(i.t)}</span>` : `<span class="nfol">${esc(i.t)}</span>`).join("")
      + local.map((r) => `<span class="nfol">${esc(r.text)} <span class="sub">${r.sent ? "in Google Doc" : syncCfg.url ? "not sent yet" : "this browser only"}</span></span>`).join("")
      + (waiting ? `<span class="sub nwait">answer on the way</span>` : "")
      + (n.sent ? `<button type="button" class="linkish nreply" data-reply="${esc(n.id)}">Reply</button>` : "");
  };
  const isQuestionText = (t) => /\?|^\s*(who|what|why|how|when|where|which|is|are|does|do|did|can|could|should|was|were|has|have)\b/i.test(t || "");
  const noteStatus = (n) => syncCfg.auto && n.sent && !(n.answers || []).length && isQuestionText(n.text) && Date.now() - Date.parse(n.at) < 15 * 60000
    ? "in Google Doc · answer on the way" : noteStatus0(n);
  const noteStatus0 = (n) => (n.sent ? "in Google Doc" : syncCfg.url ? "not sent yet" : "this browser only");
  function addParcelNotes(id, d) {
    const slot = body.querySelector("#pnote-slot");
    if (!slot) return;
    const label = d.a || "Account " + d.acct;
    let owner = new Set([id]);               // this parcel, plus the owner group's parcels once the index loads
    if (!d.pv && d.g != null) loadGroup(d.g).then((g) => {
      if (g && g.ids && g.ids.length > 1) { owner = new Set(g.ids); paint(slot.querySelector("textarea") ? slot.querySelector("textarea").value : ""); }
    }).catch(() => {});
    const paint = (keep = "") => {
      if (!document.contains(slot)) return;
      const inN = projects.filter((p) => p.ids.includes(id));
      const rest = projects.filter((p) => !p.ids.includes(id));
      const notes = projects.flatMap((p) => (p.log || []).filter((n) => n.pid && owner.has(n.pid)).map((n) => ({ ...n, pname: p.name })))
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
            <button class="linkish" type="submit" title="Add (⌘↵ or Ctrl+Enter)">Add</button><span class="kbd">⌘↵</span>
          </div>
          <span class="syncstat">${syncCfg.url ? "Sends to your Project Notes doc" : `Saved in this browser · <button type="button" class="linkish" data-sync>Connect Google Doc</button>`}</span>
        </form>
        ${notes.length ? `<ul class="nlog">${notes.map((n) => `
          <li><span class="sub">${esc(noteWhen(n))} · ${esc(n.pname)}${n.pid !== id ? " · about " + esc(n.pl || "another parcel of this owner") : ""} · ${noteStatus(n)}</span>
            <span class="ntext">${esc(n.text)}</span>${answersHtml(n)}</li>`).join("")}</ul>` : ""}`;
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
    fetchAnswers();
    refreshNotes = () => paint(slot.querySelector("textarea") ? slot.querySelector("textarea").value : "");
  }
  let refreshNotes = null;
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-reply]"); if (!b) return;
    if (b.nextElementSibling && b.nextElementSibling.matches(".nreplyform")) { b.nextElementSibling.querySelector("input").focus(); return; }
    const f = document.createElement("form"); f.className = "nreplyform";
    f.innerHTML = `<input name="t" maxlength="2000" placeholder="Follow-up question…" aria-label="Follow-up">`;
    b.after(f); f.t.focus();
    f.addEventListener("submit", (ev) => {
      ev.preventDefault(); const text = f.t.value.trim(); if (!text) return;
      for (const p of projects) for (const n of p.log || []) if (n.id === b.dataset.reply) {
        n.replies = n.replies || [];
        n.replies.push({ id: newId(), at: new Date().toISOString(), text, sent: false });
        touch(p);
      }
      if (refreshNotes) refreshNotes();
      syncPending();
    });
  });

  // project view
  function loadMany(ids) { return Promise.all(ids.map((id) => loadShard(id).then((d) => [id, d]).catch(() => [id, null]))); }
  function showProject(pid) {
    const p = projects.find((x) => x.id === pid);
    if (!p) return;
    reqToken++;
    const token = reqToken;
    drawer.hidden = false;
    body.innerHTML = `<div class="lbl">Loading project…</div>`;
    Promise.all([loadMany(p.ids), loadIndex().catch(() => null)]).then(async ([rows, idx]) => {
      if (idx) await Promise.all([...new Set(rows.filter(([, d]) => d && !d.pv && d.g != null).map(([, d]) => d.g))]
        .map((gid) => loadGroup(gid).catch(() => null)));
      if (token !== reqToken) return;
      const ok = rows.filter(([, d]) => d);
      const pts = ok.flatMap(([, d]) => d.c || []);
      setSelected(p.ids, pts);
      const ac = ok.reduce((a, [, d]) => a + (d.ac || 0), 0), tv = ok.reduce((a, [, d]) => a + (d.tv || 0), 0);
      // One section per owner: an owner group (entities), or the parcel itself (people, ungrouped).
      const secs = new Map();
      for (const [id, d] of ok) {
        const g = !d.pv && d.g != null && idx ? idx.groups[d.g] : null;
        const key = g ? "g" + d.g : "p" + id;
        if (!secs.has(key)) secs.set(key, {
          key, gid: g ? d.g : null, label: g ? g.l : d.pv ? "Individually owned" : d.o || "Owner",
          sub: g ? `${g.m.length > 1 ? plural(g.m.length, "entity") + " · " : ""}${plural(g.n, "parcel")} in the region` : "",
          rows: [], match: new Set(g && g.ids ? g.ids : [id]), notes: [], last: "" });
        secs.get(key).rows.push([id, d]);
      }
      const general = [];
      for (const n of p.log || []) {
        const sec = n.pid && [...secs.values()].find((x) => x.match.has(n.pid));
        if (sec) { sec.notes.push(n); if (n.at > sec.last) sec.last = n.at; } else general.push(n);
      }
      const ordered = [...secs.values()].sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
      const noteLi = (n, multi) => `
          <li><span class="sub">${esc(noteWhen(n))}${multi && n.pl ? " · " + esc(n.pl) : ""} · ${noteStatus(n)}</span>
            <span class="ntext">${esc(n.text)}</span>${answersHtml(n)}</li>`;
      const sales = ok.flatMap(([id, d]) => (d.sh || (d.sd ? [{ d: d.sd, p: d.sp, deed: d.lf }] : []))
        .map((r) => ({ ...r, where: d.a || "Account " + d.acct, who: d.pv ? "Individually owned" : d.o }))).sort((a, b) => (a.d < b.d ? 1 : -1));
      const doc = (p.doc || "").trim();
      const docLink = /^https?:\/\//i.test(doc) ? `<a href="${esc(doc)}" target="_blank" rel="noopener">Open ↗</a>` : "";
      body.innerHTML = `
        <span class="lbl">Project · saved in this browser</span>
        <h2 contenteditable="plaintext-only" spellcheck="false" class="pname" title="Click to rename">${esc(p.name)}</h2>
        <p class="addr">${plural(p.ids.length, "parcel")} · ${acres(ac)} · assessed ${usd(tv)}</p>
        ${p.ids.length ? "" : `<p class="note">No parcels yet. Click any parcel on the map and choose “+ Add to project”.</p>`}
        ${ordered.length ? `<div class="lbl sec">By owner</div>${ordered.map((sec) => `
          <section class="osec">
            <div class="oshead">${sec.gid != null ? `<button type="button" class="oname" data-g="${sec.gid}">${esc(sec.label)}</button>` : `<span class="oname">${esc(sec.label)}</span>`}
              ${sec.sub ? `<span class="sub">${sec.sub}</span>` : ""}</div>
            <ul class="plist ptab">${sec.rows.map(([id, d]) => `
              <li><button type="button" data-id="${esc(id)}"><span>${esc(d.a || "Account " + d.acct)}</span>
                <span class="sub">${esc(d.pv ? "Individually owned" : d.o || "")}${d.sd ? " · sold " + d.sd.slice(0, 4) : ""}</span></button>
                <button type="button" class="rm" data-rm="${esc(id)}" aria-label="Remove from project">×</button></li>`).join("")}</ul>
            ${sec.notes.length ? `<ul class="nlog">${sec.notes.slice().sort((a, b) => (a.at < b.at ? 1 : -1)).map((n) => noteLi(n, sec.rows.length > 1)).join("")}</ul>` : ""}
            <form class="qadd" data-sec="${sec.key}"><input name="t" placeholder="Ask or note something about ${esc(sec.rows.length > 1 || sec.gid != null ? "this owner" : "this parcel")}…" aria-label="New note" maxlength="2000"></form>
          </section>`).join("")}` : ""}
        <div class="lbl sec">General notes</div>
        <form class="noteform" data-p="${p.id}">
          <textarea name="t" rows="2" placeholder="A note or question about the whole project…" aria-label="New note"></textarea>
          <div class="noterow">
            <button class="linkish" type="submit" title="Add (⌘↵ or Ctrl+Enter)">Add</button><span class="kbd">⌘↵</span>
            <span class="syncstat">${syncCfg.url
              ? `Sends to ${syncCfg.doc ? `<a href="${esc(syncCfg.doc)}" target="_blank" rel="noopener">Project Notes ↗</a>` : "your Project Notes doc"}`
              : "Saved in this browser"}</span>
          </div>
        </form>
        ${syncCfg.url ? "" : `<div class="synccta"><span>Send these notes to your Google Doc automatically.</span>
          <button type="button" class="linkish" data-sync>Set it up (one time, about 3 min) →</button></div>`}
        ${general.length ? `<ul class="nlog">${general.slice().reverse().map((n) => noteLi(n, true)).join("")}</ul>` : ""}
        ${sales.length ? `<details class="psales"><summary class="lbl sec">Sales, newest first · ${sales.length}</summary><ul class="sales tl">${sales.map((r) => `
          <li><span class="num">${esc(date(r.d))}</span> <span class="num">${r.p ? usd(r.p) : "no price"}</span>
          <span class="sub">${esc(r.where)}${r.who ? " · " + esc(r.who) : ""}${r.deed ? " · deed " + esc(r.deed) : ""}</span></li>`).join("")}</ul></details>` : ""}
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
      body.querySelectorAll(".qadd").forEach((f) => f.addEventListener("submit", (e) => {
        e.preventDefault();
        const text = f.t.value.trim(), sec = secs.get(f.dataset.sec); if (!text || !sec) return;
        const [id, d] = sec.rows[0];
        p.log = p.log || [];
        p.log.push({ id: newId(), at: new Date().toISOString(), kind: "note", text, sent: false, pid: id,
                     pl: sec.rows.length > 1 || sec.gid != null ? sec.label : d.a || "Account " + d.acct });
        touch(p); showProject(p.id); syncPending();
      }));
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
      fetchAnswers();
      refreshNotes = () => { if (body.querySelector(`.noteform[data-p="${p.id}"]`)) showProject(p.id); };
      if (map && pts.length) {
        const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
        map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: drawerPad(), maxZoom: 16.5 });
      }
    });
  }
  let lastProject = null;


  // ---------- color tags (saved in this browser only) ----------
  // A tag colors an owner's parcels across the map. Tagging a parcel that belongs to an entity
  // owner tags that owner's whole group; a person's parcel (private) is tagged on its own.
  // Each item keeps a snapshot of its parcel ids and centroids, so the map can draw dots
  // county-wide without loading parcel details.
  const TKEY = "rem.tags.v1", VKEY = "rem.view.v1";
  const TAG_COLORS = ["gold", "clay", "blue", "violet", "green", "teal"];
  let tags = [], view = { hide: [], mute: false };
  try { tags = JSON.parse(localStorage.getItem(TKEY) || "[]"); } catch (e) { tags = []; }
  try { view = { hide: [], mute: false, ...JSON.parse(localStorage.getItem(VKEY) || "{}") }; } catch (e) {}
  var muteOthers = view.mute && tags.some((t) => t.on);
  function saveTags() {
    try { localStorage.setItem(TKEY, JSON.stringify(tags)); localStorage.setItem(VKEY, JSON.stringify(view)); } catch (e) {}
    applyTags(); renderLegend();
  }
  const tagIds = (t) => [...new Set(t.items.flatMap((it) => it.ids))];
  function idColor() {               // first visible tag wins when a parcel is in several
    const m = new Map();
    for (const t of tags) if (t.on) for (const it of t.items) for (const id of it.ids) if (!m.has(id)) m.set(id, t.color);
    return m;
  }
  function tagColorExpr(P) {
    const byColor = new Map();
    for (const [id, c] of idColor()) { if (!byColor.has(c)) byColor.set(c, []); byColor.get(c).push(id); }
    if (!byColor.size) return P.accent;
    const e = ["match", ["get", "id"]];
    for (const [c, ids] of byColor) e.push(ids, P.tag[c] || P.accent);
    e.push(P.accent);
    return e;
  }
  let pubIds = [];
  function pubFilter() { return ["in", ["get", "id"], ["literal", view.pub ? pubIds : []]]; }
  function applyPub() {
    if (view.pub && !pubIds.length) {
      loadCompanies().then((C) => { pubIds = Object.values(C.ids).flat(); applyPub(); renderLegend(); }).catch(() => {});
      return;
    }
    eachLayer("pub-fill", (id) => map.setFilter(id, pubFilter()));
    eachLayer("pub-line", (id) => map.setFilter(id, pubFilter()));
  }
  function tagFilter() { return ["in", ["get", "id"], ["literal", [...idColor().keys()]]]; }
  function typeFilter() { return view.hide.length ? ["!", ["in", ["get", "t"], ["literal", view.hide]]] : ["has", "id"]; }
  function tagDotsData(P) {
    const f = [], seen = new Set();
    for (const t of tags) if (t.on) for (const it of t.items) for (let i = 0; i < it.ids.length; i++) {
      if (seen.has(it.ids[i]) || it.pts[2 * i] == null) continue;
      seen.add(it.ids[i]);
      f.push({ type: "Feature", properties: { col: P.tag[t.color] || P.accent },
               geometry: { type: "Point", coordinates: [it.pts[2 * i], it.pts[2 * i + 1]] } });
    }
    return { type: "FeatureCollection", features: f };
  }
  function applyTags() {
    muteOthers = view.mute && tags.some((t) => t.on);
    if (!map || !map.getLayer("tag-line")) return;
    const P2 = PAL[theme()];
    const P = PAL[theme()], tc = tagColorExpr(P), tf = tagFilter();
    eachLayer("tag-fill", (id) => { map.setFilter(id, tf); map.setPaintProperty(id, "fill-color", tc); });
    eachLayer("tag-line", (id) => { map.setFilter(id, tf); map.setPaintProperty(id, "line-color", tc); });
    map.getSource("tagdots").setData(tagDotsData(P));
    eachLayer("parcel-line", (id) => {
      map.setFilter(id, typeFilter());
      map.setPaintProperty(id, "line-color", muteOthers ? P2.edge : typeColorExpr(P2));
    });
  }

  // What a tag applied from this parcel covers: the owner's group, or just this parcel.
  function tagTarget(id, d, idx) {
    const g = !d.pv && d.g != null && idx && idx.groups[d.g] && idx.groups[d.g].ids ? idx.groups[d.g] : null;
    if (g) return { k: "g", label: g.l, ids: g.ids, pts: g.pts, ac: g.ac };
    return { k: "p", label: d.a || "Account " + d.acct, ids: [id], pts: d.c || [], ac: d.ac || 0 };
  }
  const itemHas = (it, id) => it.ids.includes(id);

  function addTagControl(id, d) {
    const slot = body.querySelector("#tag-slot");
    if (!slot) return;
    loadIndex().catch(() => null).then(async (idx) => {
      if (idx && !d.pv && d.g != null) await loadGroup(d.g).catch(() => null);
      if (!document.contains(slot)) return;
      const target = tagTarget(id, d, idx);
      const P = PAL[theme()];
      let open = false, color = TAG_COLORS.find((c) => !tags.some((t) => t.color === c)) || "gold";
      const paint = () => {
        const mine = tags.filter((t) => t.items.some((it) => itHasTarget(it)));
        slot.innerHTML = `<div class="tagrow">
          ${mine.map((t) => `<button type="button" class="tagchip" data-show="${t.id}"><i style="background:${P.tag[t.color]}"></i>${esc(t.name)}</button>`).join("")}
          <button type="button" class="linkish" data-toggle>${mine.length ? "Tags ▾" : "+ Color tag"}</button>
          <div class="tagpick" ${open ? "" : "hidden"}>
            <p class="sub">${target.k === "g" && target.ids.length > 1
              ? `Colors all ${plural(target.ids.length, "parcel")} of ${esc(target.label)}.`
              : target.k === "g" ? `Colors ${esc(target.label)}'s parcel.` : "Colors this parcel."}</p>
            ${tags.map((t) => `<button type="button" class="chip" aria-pressed="${t.items.some(itHasTarget)}" data-t="${t.id}"><i style="background:${P.tag[t.color]}"></i>${esc(t.name)}</button>`).join("")}
            <form class="newtag"><input name="n" placeholder="New tag, e.g. Federal" maxlength="60" aria-label="New tag name">
              <span class="swatches">${TAG_COLORS.map((c) => `<button type="button" class="sw" data-c="${c}" aria-pressed="${c === color}" aria-label="${c}" style="background:${P.tag[c]}"></button>`).join("")}</span>
              <button class="linkish" type="submit">Create</button></form>
          </div></div>`;
        slot.querySelector("[data-toggle]").addEventListener("click", () => { open = !open; paint(); });
        slot.querySelectorAll("[data-show]").forEach((b) => b.addEventListener("click", () => showTag(b.dataset.show)));
        slot.querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", () => {
          const t = tags.find((x) => x.id === b.dataset.t);
          if (t.items.some(itHasTarget)) t.items = t.items.filter((it) => !itHasTarget(it));
          else t.items.push({ ...target, ids: [...target.ids], pts: [...target.pts] });
          saveTags(); paint();
        }));
        slot.querySelectorAll(".sw").forEach((b) => b.addEventListener("click", () => {
          color = b.dataset.c; slot.querySelectorAll(".sw").forEach((x) => x.setAttribute("aria-pressed", x === b));
        }));
        slot.querySelector(".newtag").addEventListener("submit", (e) => {
          e.preventDefault(); const n = e.target.n.value.trim(); if (!n) return;
          tags.push({ id: newId(), name: n, color, on: true, items: [{ ...target, ids: [...target.ids], pts: [...target.pts] }] });
          saveTags(); paint();
        });
      };
      // the target is "in" a tag if an item covers this parcel and has the same scope
      const itHasTarget = (it) => itemHas(it, id) && (it.k === target.k || it.k === "p");
      paint();
    });
  }

  function showTag(tid) {
    const t = tags.find((x) => x.id === tid);
    if (!t) return;
    reqToken++;
    const P = PAL[theme()], ids = tagIds(t);
    const pts = t.items.flatMap((it) => it.pts);
    setSelected([]);                 // let the tag's own color show
    drawer.hidden = false;
    const ac = t.items.reduce((a, it) => a + (it.ac || 0), 0);
    body.innerHTML = `
      <span class="lbl">Color tag · saved in this browser</span>
      <h2 contenteditable="plaintext-only" spellcheck="false" class="pname" title="Click to rename">${esc(t.name)}</h2>
      <p class="addr">${plural(ids.length, "parcel")} · ${acres(ac)}</p>
      <div class="swatches big">${TAG_COLORS.map((c) => `<button type="button" class="sw" data-c="${c}" aria-pressed="${c === t.color}" aria-label="${c}" style="background:${P.tag[c]}"></button>`).join("")}</div>
      <div class="lbl sec">Owners and parcels</div>
      ${t.items.length ? `<ul class="plist ptab">${t.items.map((it, i) => `
        <li><button type="button" data-i="${i}"><span>${esc(it.label)}</span><span class="sub">${it.k === "g" ? "owner · " : ""}${plural(it.ids.length, "parcel")} · ${acres(it.ac || 0)}</span></button>
          <button type="button" class="rm" data-rm="${i}" aria-label="Remove from tag">×</button></li>`).join("")}</ul>`
        : `<p class="note">Nothing tagged yet. Open a parcel and choose “+ Color tag”.</p>`}
      <p class="note">Tags are your own markings, kept in this browser. They aren't part of the public record.</p>
      <div class="pact"><button type="button" class="linkish" data-vis>${t.on ? "Hide on map" : "Show on map"}</button>
        <button type="button" class="linkish danger" data-del>Delete tag</button></div>`;
    const nm = body.querySelector(".pname");
    nm.addEventListener("blur", () => { const v = nm.textContent.trim(); if (v && v !== t.name) { t.name = v.slice(0, 60); saveTags(); } });
    nm.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); nm.blur(); } });
    body.querySelectorAll(".sw").forEach((b) => b.addEventListener("click", () => { t.color = b.dataset.c; saveTags(); showTag(t.id); }));
    body.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => {
      const it = t.items[+b.dataset.i];
      if (it.k === "p") return select(it.ids[0], { fly: true });
      loadIndex().then((idx) => {
        const gid = idx.groups.findIndex((g) => g.l === it.label);
        if (gid >= 0) showGroup(gid); else select(it.ids[0], { fly: true });
      });
    }));
    body.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { t.items.splice(+b.dataset.rm, 1); saveTags(); showTag(t.id); }));
    body.querySelector("[data-vis]").addEventListener("click", () => { t.on = !t.on; saveTags(); showTag(t.id); });
    body.querySelector("[data-del]").addEventListener("click", () => {
      if (!confirm(`Delete the tag “${t.name}”?`)) return;
      tags = tags.filter((x) => x.id !== t.id); saveTags(); closeDrawer();
    });
    if (map && pts.length) {
      const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
      map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: drawerPad(), maxZoom: 16 });
    }
  }

  // Legend: owner types double as filters; tags list below with show/hide and "mute others".
  const legend = document.getElementById("legend");
  function renderLegend() {
    const P = PAL[theme()];
    const types = [["c", "--t-c"], ["i", "--t-i"], ["g", "--t-g"], ["r", "--t-r"], ["p", "--edge-strong"], ["u", "--edge"]];
    const counts = new Map(tags.map((t) => [t.id, tagIds(t).length]));
    legend.innerHTML = `
      <span class="lbl">Owner</span>
      ${types.map(([k, v]) => `<button type="button" class="key" data-type="${k}" aria-pressed="${!view.hide.includes(k)}" title="Show or hide on the map"><i style="--c:var(${v})"></i>${TYPE_LABEL[k]}</button>`).join("")}
      ${tags.length ? `<span class="lbl tagslbl">Your tags</span>
        ${tags.map((t) => `<span class="key tagkey"><button type="button" class="vis" data-vis="${t.id}" aria-pressed="${t.on}" aria-label="Show or hide ${esc(t.name)}"><i class="dot" style="background:${P.tag[t.color]}"></i></button><button type="button" class="tname" data-tag="${t.id}">${esc(t.name)} <span class="num dim">${counts.get(t.id)}</span></button></span>`).join("")}
        <button type="button" class="key mute" aria-pressed="${view.mute}">Fade untagged parcels</button>` : ""}
      <button type="button" class="key mute pub" aria-pressed="${!!view.pub}" title="Parcels owned by SEC-registered public companies or their listed subsidiaries">Public companies${view.pub && pubIds.length ? ` <span class="num">${pubIds.length}</span>` : ""}</button>`;
    legend.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.type;
      view.hide = view.hide.includes(k) ? view.hide.filter((x) => x !== k) : [...view.hide, k];
      saveTags();
    }));
    legend.querySelectorAll("[data-vis]").forEach((b) => b.addEventListener("click", () => {
      const t = tags.find((x) => x.id === b.dataset.vis); t.on = !t.on; saveTags();
    }));
    legend.querySelectorAll("[data-tag]").forEach((b) => b.addEventListener("click", () => showTag(b.dataset.tag)));
    const m = legend.querySelector(".mute:not(.pub)"); if (m) m.addEventListener("click", () => { view.mute = !view.mute; saveTags(); });
    legend.querySelector(".pub").addEventListener("click", () => { view.pub = !view.pub; saveTags(); applyPub(); });
  }
  renderLegend();

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
  async function sendReply(n, r) {
    const payload = { key: syncCfg.key, parent: { at: n.at, text: n.text }, text: r.text, at: r.at };
    const res = await fetch(syncCfg.url, { method: "POST", body: JSON.stringify(payload) });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || "not saved");
  }
  let syncing = false;
  async function syncPending() {
    if (syncing || !syncCfg.url || !syncCfg.key) return;
    syncing = true;
    let sent = 0, failed = null, sentQuestion = false;
    try {
      outer: for (const p of projects) for (const n of p.log || []) {
        if (!n.sent) {
          try { await sendNote(p, n); n.sent = true; sent++; if (isQuestionText(n.text)) sentQuestion = true; saveProjects(); }
          catch (e) { failed = e; break outer; }
        }
        for (const r of n.replies || []) {
          if (r.sent || !n.sent) continue;
          try { await sendReply(n, r); r.sent = true; sent++; sentQuestion = true; saveProjects(); }
          catch (e) { failed = e; break outer; }
        }
      }
    } finally { syncing = false; }
    if (failed) toast(`A note couldn't reach Google Docs (${failed.message}). It stays saved here and will retry.`);
    else if (sent) toast(sent === 1 ? "Note sent to Google Docs." : `${sent} notes sent to Google Docs.`);
    if (sent && refreshNotes && !drawer.hidden) refreshNotes();
    fetchAnswers();
    if (sentQuestion) {               // the answer routine takes a few minutes; look again then
      for (const ms of [60000, 180000, 300000, 480000]) setTimeout(() => fetchAnswers(true), ms);
    }
  }
  // Answers written under a note in the doc ("↳ Answer (Claude): …") come back here and show under the note.
  // Notes are matched by their minute (New York time, as the doc heading shows it) and their text.
  const nyMinute = (iso) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  };
  const normText = (t) => String(t || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).join("\n");
  let lastAnswers = 0;
  async function fetchAnswers(force) {
    if (!syncCfg.url || !syncCfg.key || (!force && Date.now() - lastAnswers < 60000)) return;
    lastAnswers = Date.now();
    let j;
    try { j = await (await fetch(`${syncCfg.url}?key=${encodeURIComponent(syncCfg.key)}&answers=1`)).json(); } catch (e) { return; }
    if (!j.ok || !Array.isArray(j.entries)) return;     // older script: no answers yet
    if (!!j.auto !== !!syncCfg.auto) { syncCfg.auto = !!j.auto; saveSync(); }
    const byKey = new Map(j.entries.map((x) => [x.head.split(" · ")[0] + "|" + normText(x.text),
      x.thread || (x.answers || []).map((t) => ({ k: "a", t }))]));
    let changed = false;
    for (const p of projects) for (const n of p.log || []) {
      if (!n.sent) continue;
      const th = byKey.get(nyMinute(n.at) + "|" + normText(n.text));
      if (th && JSON.stringify(th) !== JSON.stringify(n.thread || [])) {
        n.thread = th; n.answers = th.filter((i) => i.k === "a").map((i) => i.t); changed = true;
      }
    }
    if (changed) { saveProjects(); if (refreshNotes && !drawer.hidden) refreshNotes(); }
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
        const r = await fetch(`${url}?key=${encodeURIComponent(key)}&answers=1`);
        const j = await r.json();
        if (!j.ok) throw new Error(j.error === "bad key" ? "the key doesn't match" : j.error || "no answer");
        syncCfg = { url, key, doc: /^https:\/\/docs\.google\.com\//.test(doc) ? doc : "" }; saveSync();
        msg.textContent = `Connected to "${j.doc}". ` + (Array.isArray(j.entries)
          ? `Answers: on (${j.entries.filter((x) => x.answers && x.answers.length).length} answered so far). Automatic answers: ${j.auto === "claude" ? "on (Claude)" : j.auto ? "on (Gemini)" : "off"}.`
          : "Answers: off. This is the older script; paste the new version and deploy a new version to see answers on the map.");
        lastAnswers = 0; fetchAnswers(true);
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
      `Parcel data: MD iMAP, MDP, SDAT · county GIS (PG, Anne Arundel, Charles) · DC GIS / OTR · Arlington, Alexandria, Fairfax, Prince William, Loudoun and Fauquier GIS · Maryland ownership as of SDAT, ${asOfLabel}`;
  }).catch(() => {});

  const limits = document.getElementById("limits");
  document.getElementById("limits-btn").addEventListener("click", () => (limits.hidden = !limits.hidden));
  limits.querySelector("[data-close]").addEventListener("click", () => (limits.hidden = true));
})();
