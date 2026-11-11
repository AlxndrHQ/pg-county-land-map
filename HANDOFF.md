# Handoff: Prince George's County Land Ownership Map

**Goal:** An interactive, open-data map of Prince George's County, MD that answers *"who owns the land under this?"*. For each parcel it shows the owner of record. It groups related LLCs into the people or companies behind them, and it supports parcel-by-parcel research ("case files") for sites of interest.

**Starting questions (the first four case files):**
1. **Former Landover Mall site.** Owned by Lerner Enterprises (the Lerner family, owners of the Washington Nationals). Lerner built the mall in 1972. It closed in 2002 and was demolished in 2006. The Planning Board has approved up to 4.1M SF of industrial use, which Lerner is planning as a data center campus.
2. **The land under the stadium (FedExField / Northwest Stadium).** Who holds title now that the Commanders are moving to the RFK site in DC.
3. **Bowie Town Center.** Who owns the land, and whether there is a ground-lease split between the land owner and the center operator.
4. **The newly built senior housing near the Lerner site in Landover.** The developer and the owning entity. The project's name and exact parcel are still unconfirmed: start by finding it in the PG Planning development applications.

**Sister project:** *Algos & Capital* (Wealth Web). It lives at https://alxndrhq.github.io/historical-wealth-mind-map/. Reuse its visual identity. When an ownership trail leads to someone profiled there (e.g., the Lerners), link to that profile.

---

## 1. Data sources

All sources below are public. Verify each endpoint's field list and refresh date in its layer metadata before building on it.

### Core: parcels and owner of record (statewide, filter to PG County)
| Source | Endpoint | Notes |
|---|---|---|
| **MD iMAP Parcel Boundaries** (polygons) | `https://geodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0` | The primary layer. Built from SDAT and MD Dept. of Planning data. Owner fields: `OWNNAME1`, `OWNNAME2`, `OWNADD1`, `OWNADD2`, `OWNCITY`, `OWNSTATE`. Max 1,000 records per query, so paginate with `resultOffset`. Polygons that share an account ID are dissolved together. |
| **MD iMAP Property Data** (parcel points) | `https://geodata.md.gov/imap/rest/services/PlanningCadastre/MD_PropertyData/MapServer/0` | Full SDAT attributes: owner, mailing address, land and improvement values, sale date and price, land use, acreage. Join it to the polygons on account ID. The statewide file is large, so prefer the bulk download (data.gov / MD iMAP catalog) over paging. |
| **PG County "Property Flattened"** | `https://gis.princegeorgescountymd.gov/arcgis/rest/services/DPIE/SERVICES4PLS/MapServer/19` | The county's own layer of parcel shapes merged with SDAT data (`OWNER_NAME`, etc.). Use it as a cross-check or a simpler alternative. |
| **City of Bowie Property layer** | `https://gis.cityofbowie.org/arcgis/rest/services/Property/Property_Flattened_WMS/MapServer/0` | Useful for the Bowie Town Center case. |

**License:** MD iMAP data may be freely redistributed as long as the metadata isn't altered. Derived products must credit the State of Maryland. Put an attribution line in the map footer: "Parcel data: MD iMAP, MDP, SDAT".

### Planning and development (what's proposed or built)
| Source | Where | Use |
|---|---|---|
| **M-NCPPC PG Planning GIS Open Data Portal** | http://gisdata.pgplanning.org/opendata/ (linked from https://www.pgplanning.org/data-tools/maps) | Zoning, detailed site plans, recorded plats, park parcels, tax-exempt parcels, development applications |
| **PGAtlas** | https://www.pgatlas.com | Interactive reference for checking things by hand (not a data source to scrape) |
| **PG County Open Data / GIS** | https://www.princegeorgescountymd.gov (Office of IT, GIS page) | Permits, county-owned property |

### Tracing the people behind the entity (manual research, one parcel at a time)
| Source | Use | Notes |
|---|---|---|
| **Maryland Land Records** (mdlandrec.net) | Deeds: grantor, grantee, signatories, consideration paid | Free account. There is no bulk API, so don't scrape it. Record deed references by hand in the case files. |
| **Maryland Business Express** (SDAT business entity search) | An LLC's registered agent, formation date, principal office, status | Maryland doesn't require LLC members to be listed, so expect gaps. |
| **SDAT Real Property Search** (sdat.dat.maryland.gov) | Per-account detail and sales history | Use it to confirm what the bulk data shows. |
| **SEC EDGAR** | Property lists for REITs and public companies | Useful if a town center is owned by a REIT. |

### Federal and housing
| Source | Use |
|---|---|
| **PAD-US** (USGS Protected Areas Database) | Federal, state and local public lands |
| **GSA real property data** | Federally owned and leased property |
| **HUD LIHTC database** and **MD DHCD** project lists | Subsidized and senior housing: project name, developer, owner, year placed in service. This is the likeliest route to case #4. |

---

## 2. Core idea: owner groups (hub and spoke)

The owner of record is usually an LLC, not a person. The most useful thing the map can do is **cluster parcels whose owner mailing addresses match**. Twenty differently named LLCs that all send their tax bills to the same office suite are almost always one owner.

**Pipeline step: `build_owner_groups`**
1. Normalize owner names: uppercase, strip punctuation, standardize LLC / L.L.C. / INC / LP / TRUST / ET AL.
2. Normalize mailing addresses: uppercase, standardize SUITE/STE and STREET/ST, strip the ZIP+4 suffix.
3. Group by normalized mailing address, and also by exact normalized name. Then merge the groups (union-find) so that a name link or an address link joins two groups.
4. Each group gets an `owner_group_id` and a display label. The label is the most frequent name in the group, or a hand-written alias.
5. Stats per group: parcel count, total acres, total assessed value, and a list of member entity names.

**Hand-written aliases:** `data/owner_aliases.json` maps a group ID to a real-world name plus a source, e.g. `{ "group": "...", "label": "Lerner Enterprises", "source": "deed liber/folio ..., news article URL" }`. Every alias must cite a source.

**Hub-and-spoke view:** Selecting an owner group draws its parcels in the accent color, connects them to the group label with hairlines, and lists the member LLCs. This matches the industry hub → spoke → offshoot structure the Wealth Web uses.

**Ground leases:** The parcel owner owns the land. The buildings or the operating business can belong to someone else. Case files should record `land_owner` and `operator` separately, and the UI should label the difference.

**Privacy rule:** Most parcels belong to individual homeowners. By default, highlight and make searchable only entity, institutional and government owners: LLCs, corporations, trusts, REITs, religious organizations, and public bodies. Draw individually owned residential parcels as neutral outlines, with no owner-name labels and no owner-group clustering. Detection heuristic: the owner name has no entity keyword and the land use code is residential.

---

## 3. Architecture (static first: no server, no cost)

```
scripts/            Python data pipeline (run locally or in GitHub Actions)
  fetch_parcels.py     page through MD iMAP REST, filter to PG County → data/raw/
  join_sdat.py         join polygons and SDAT attributes on account ID
  build_owner_groups.py
  build_tiles.sh       GeoJSON → tippecanoe → parcels.pmtiles
data/
  owner_aliases.json   hand-curated, sourced
  cases/*.json         case files (see §5)
web/
  index.html           single-page app, same structure as Algos & Capital
  style.css
  app.js
```

- **Map library:** MapLibre GL JS (open source), with the `pmtiles` JS protocol for the parcel layer.
- **Basemap:** OpenFreeMap or a Protomaps basemap (both built on OpenStreetMap), restyled to the paper and ink palettes. Muted streets, no POI clutter.
- **Parcel tiles:** tippecanoe → PMTiles. Keep tile attributes small (account ID, `owner_group_id`, land-use class, acres). Put full details in sharded JSON files (`data/parcels/<prefix>.json`) that load when a parcel is clicked.
- **Hosting:** GitHub Pages, like the other sites. PG County has about 312K parcels. If the PMTiles file goes over GitHub's 100 MB per-file limit, host it on Cloudflare R2 (free tier, supports range requests) or split it by zoom level.
- **Refresh:** a monthly GitHub Action reruns the pipeline. Store the data date and show it in the footer ("Ownership as of SDAT, MMM YYYY").

**Pipeline gotchas**
- Check which field holds the county or jurisdiction code before filtering. Inspect the layer's fields at `?f=pjson`. Don't guess the field name.
- Request `outSR=4326` and `f=geojson`, and paginate until `exceededTransferLimit` is false.
- Be polite to the state servers: throttle requests and cache raw pages to disk so reruns don't refetch everything.

---

## 4. UI and style (match Algos & Capital)

**Tokens (copy them exactly):**
```css
:root{ --bg:#FAFAF7; --text:#1F1D18; --muted:#6B6960; --dim:#9C998E; --line:#E8E6DF;
       --accent:#8A5A2B; --accent-soft:#8a5a2b1a; --edge:#C4C1B6; --edge-strong:#8F8C82;
       --serif:'Iowan Old Style','Apple Garamond',Georgia,serif;
       --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
       --mono:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace; }
/* dark (ink) */
     { --bg:#0E0E10; --text:#E8E6DF; --muted:#7A7A82; --dim:#56565D; --line:#26262B;
       --accent:#C9A875; --accent-soft:#c9a8751f; --edge:#36363D; --edge-strong:#5E5E66; }
```
- Iowan Old Style serif for headings and owner names. JetBrains Mono uppercase letter-spaced labels. System sans for body text.
- Hairline parcel outlines and no fills by default. The selected owner group gets an `--accent-soft` fill and an `--accent` outline. No glows and no gradients.
- Light/dark toggle, kept in sync with the basemap style.
- Essentialist: prefer removing elements to adding them.

**Owner-type colors (muted, reuse the Wealth Web hues):** corporate/LLC `#3E6A8A`, institutional/REIT `#6B5B9A`, government `#3C7A5E`, religious/nonprofit `#2F7A80`, individual = neutral outline only.

**Layout**
- Top bar: title, a search box (address, owner name or account number), and a theme toggle.
- Map fills the screen.
- Right-side drawer on parcel click: owner of record, mailing address, acres, assessed land and building value, last sale (date and price), land use and zoning, owner group (with link), and the case file if one exists.
- Owner-group drawer: label, parcel count, total acres, member LLCs, "show all on map", and a link to the Wealth Web profile if one exists.
- "Cases" list: the four starting sites as pinned stories.

---

## 5. Case files (the research layer)

`data/cases/<slug>.json`:
```json
{
  "slug": "landover-mall",
  "title": "Former Landover Mall",
  "accounts": ["<SDAT account IDs>"],
  "land_owner": { "entity": "<owner of record>", "owner_group_id": "...", "real_party": "Lerner Enterprises" },
  "operator": null,
  "status": "Planning Board approved up to 4.1M SF industrial; data center campus planned",
  "timeline": [
    { "year": 1972, "event": "Lerner opens Landover Mall" },
    { "year": 2002, "event": "Mall closes" },
    { "year": 2006, "event": "Demolished" }
  ],
  "sources": [ { "label": "...", "url": "...", "type": "deed|sdat|news|planning" } ],
  "wealth_web_link": "<profile URL if any>"
}
```
Rule: **every claim needs a source.** Keep the owner of record (fact, from SDAT) separate from the real party (inference, which must cite the deed, an LLC filing or reporting).

---

## 6. Milestones

1. **M1. Parcels on a map.** Fetch PG County parcels and render the PMTiles in MapLibre with paper/ink styling. Click a parcel to see its SDAT attributes.
2. **M2. Search.** Search by address, owner name and account number using a prebuilt search index (e.g., MiniSearch over the entity-owned subset).
3. **M3. Owner groups.** Mailing-address clustering, the hub-and-spoke highlight, and the group drawer.
4. **M4. Case files.** The four starting cases, researched with deeds, LLC filings and news, and cited.
5. **M5. Planning overlay.** Zoning and development-application layers from the M-NCPPC portal, so you can see what's proposed on each parcel.
6. **M6. Leaderboard.** The largest entity landowners in PG County by acres and by assessed value, with links to Wealth Web profiles.
7. **Later.** Monthly auto-refresh, change tracking ("parcels that changed hands this month"), and federal/PAD-US overlays.

---

## 7. Known limits (show these honestly in the UI)
- SDAT data lags real-world transfers by weeks to months.
- The parcel layer is an assessment and tax dataset, not a legal survey. Boundaries are approximate.
- Maryland LLCs can hide their members. Some trails will end at a registered agent or a law firm, and the map should say that rather than guess.
- Land owner ≠ building owner ≠ operator (ground leases).

---

## References
- MD iMAP Parcel Boundaries: https://geodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0
- MD iMAP Property Data (points): https://geodata.md.gov/imap/rest/services/PlanningCadastre/MD_PropertyData/MapServer/0
- data.gov listing: https://catalog.data.gov/dataset/md-imap-maryland-property-data-parcel-points
- PG County Property Flattened: https://gis.princegeorgescountymd.gov/arcgis/rest/services/DPIE/SERVICES4PLS/MapServer/19
- City of Bowie Property: https://gis.cityofbowie.org/arcgis/rest/services/Property/Property_Flattened_WMS/MapServer/0
- PG Planning Maps & GIS Data: https://www.pgplanning.org/data-tools/maps
- Landover Mall data center plan: https://datacenterdynamics.com/en/news/lerners-maryland-data-center-campus-could-total-820mw ; https://pgcedc.squarespace.com/latest-pgcedc-news/2024/10/29/5b-data-center-campus-on-former-landover-mall-footprint-could-break-ground-by-2026
