/* Ground Truth — M1: parcels on a map, click for SDAT attributes. */
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
      { id: "parcel-sel-fill", type: "fill", source: "parcels", "source-layer": "parcels",
        filter: ["==", ["get", "id"], selectedId || ""], paint: { "fill-color": P.accentSoft } },
      { id: "parcel-sel-line", type: "line", source: "parcels", "source-layer": "parcels",
        filter: ["==", ["get", "id"], selectedId || ""],
        paint: { "line-color": P.accent, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.2, 17, 2] } },
    ];
  }

  function fullStyle() {
    const P = PAL[theme()];
    const s = restyle(baseStyle, P);
    s.sources.parcels = {
      type: "vector", url: "pmtiles://" + PARCELS_URL,
      attribution: "Parcel data: MD iMAP, MDP, SDAT; PG County DPIE",
    };
    // Parcels sit above roads and below labels.
    const firstSymbol = s.layers.findIndex((l) => l.type === "symbol");
    s.layers.splice(firstSymbol < 0 ? s.layers.length : firstSymbol, 0, ...parcelLayers(P));
    return s;
  }

  // ---------- map ----------
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);

  let map, selectedId = null;

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
      if (f) select(f.properties.id, f.properties.t);
      else closeDrawer();
    });
  }).catch((err) => {
    document.getElementById("map").innerHTML =
      `<p style="padding:24px;color:var(--muted)">The basemap failed to load (${esc(String(err))}).</p>`;
  });

  function updateHint() {
    document.getElementById("hint").classList.toggle("off", map.getZoom() >= PARCEL_MINZOOM);
  }

  function setSelected(id) {
    selectedId = id;
    const f = ["==", ["get", "id"], id || ""];
    if (map.getLayer("parcel-sel-fill")) { map.setFilter("parcel-sel-fill", f); map.setFilter("parcel-sel-line", f); }
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

  function select(id, t) {
    setSelected(id);
    drawer.hidden = false;
    body.innerHTML = `<div class="lbl">Loading…</div>`;
    const token = ++reqToken;
    loadShard(id).then((d) => {
      if (token !== reqToken) return;
      body.innerHTML = d ? render(d) : `<div class="lbl">No record found for ${esc(id)}</div>`;
    }).catch((e) => {
      if (token === reqToken) body.innerHTML = `<div class="lbl">Couldn't load parcel details</div><p class="note">${esc(e.message)}</p>`;
    });
  }

  function closeDrawer() { drawer.hidden = true; setSelected(null); }
  document.getElementById("close").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeDrawer(); limits.hidden = true; } });

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
      ${privacyNote}
      <dl>
        ${d.pv ? "" : row("Mailing", [d.co, d.ma].filter(Boolean).map(esc).join("<br>") || "—")}
        ${row("Account", `<span class="num">${esc(d.acct)}</span>`)}
        ${row("Area", `<span class="num">${acres(d.ac)}</span>`)}
        ${row("Land", `<span class="num">${usd(d.lv)}</span>`)}
        ${row("Building", `<span class="num">${usd(d.iv)}</span>`)}
        ${row("Assessed", `<span class="num">${usd(d.tv)}</span>`)}
        ${row("Last sale", sale && `<span class="num">${sale}</span>`)}
        ${row("Deed", d.lf && `<span class="num">Liber/folio ${esc(d.lf)}</span>`)}
        ${row("Land use", use)}
        ${row("Zoning", d.z && `<span class="num">${esc(d.z)}</span>`)}
        ${row("Built", d.yb && `<span class="num">${esc(d.yb)}</span>`)}
      </dl>
      <div class="src">
        Owner of record and values from SDAT via PG County DPIE${asOfLabel ? `, as of ${esc(asOfLabel)}` : ""}.
        ${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">SDAT record ↗</a>` : ""}
      </div>`;
  }

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
