# Ground Truth — PG County land ownership map

The full brief is in [HANDOFF.md](HANDOFF.md). Read it before starting a milestone. These rules always apply:

## Non-negotiables
- **Privacy.** Highlight and make searchable only entity, institutional and government owners. When a person owns a residential, vacant or unclassified parcel, it is *private*. Draw it as a neutral outline, with no owner-name label, no search entry and no owner-group clustering. Its published detail record leaves out the owner name, care-of name, mailing address and deed reference, and the drawer links to SDAT instead. The rule lives in `scripts/build_parcels.py` (`owner_type`, `private`). When unsure, classify as a person: a false "entity" exposes a homeowner.
- **Every claim needs a source.** Keep the owner of record (fact, from SDAT) separate from the real party (inference). The real party must cite a deed, an LLC filing or reporting. Every entry in `data/owner_aliases.json` and every `data/cases/*.json` claim carries a source.
- **Land owner ≠ operator.** Record them separately (ground leases).
- **Attribution.** The map footer always reads "Parcel data: MD iMAP, MDP, SDAT" plus the data date.
- **Be polite to state and county servers.** Throttle requests and cache raw pages in `data/raw/` (gitignored). Never scrape mdlandrec.net.

## Style (match Algos & Capital: https://alxndrhq.github.io/historical-wealth-mind-map/)
- Paper/ink tokens live in `web/style.css`. Copy them exactly and don't invent new colors. The map palettes in `web/app.js` (`PAL`) mirror those tokens.
- Iowan Old Style serif for headings and owner names. JetBrains Mono uppercase letter-spaced labels. System sans for body text.
- Hairline outlines, no fills by default, and the accent color for selection. No glows, no gradients.
- Essentialist: prefer removing elements to adding them.

## Layout
```
scripts/fetch_parcels.py   page PG County "Property Flattened" layer -> data/raw/pages/ (cached, resumable)
scripts/build_parcels.py   classify owners, apply privacy rule -> data/build/parcels.geojsonl, web/data/parcels/NNN.json, web/data/meta.json
scripts/build_tiles.sh     tippecanoe -> web/data/parcels.pmtiles
web/                       static site (MapLibre GL + pmtiles), deployed to GitHub Pages by .github/workflows/pages.yml
```
Rebuild: `python3 scripts/fetch_parcels.py && python3 scripts/build_parcels.py && scripts/build_tiles.sh`
Preview: `cd web && python3 -m http.server 8000`. The server must support Range requests for PMTiles; Python's doesn't, so use `npx http-server web -p 8000` instead.

## Data source note
M1 uses the PG County DPIE "Property Flattened" layer (PG-only, already joined to SDAT). MD iMAP was down for maintenance on 2026-11-10. Keep MD iMAP Parcel Boundaries as the statewide cross-check.

## Milestones
M1 parcels on a map (done) → M2 search → M3 owner groups → M4 case files → M5 planning overlay → M6 leaderboard. Details are in HANDOFF.md §6.
