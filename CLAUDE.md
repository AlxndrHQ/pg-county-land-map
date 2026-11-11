# Real Estate Map — PG County land ownership map

## Shared context (read first)
This project's current state and decision log live in Google Drive, shared with Gemini:
**AI Collaboration › Claude Projects › Real Estate Map**
- **Real Estate Map · Summary**: what it is, links, current state, open items. Read before working; rewrite it in place when the state changes.
- **Real Estate Map · Decisions**: newest-first log of what was decided and why. Add an entry (date · decision, then Why / Rejected / Revisit if / Decided by) whenever something is decided; never edit old entries.
- **Discussions/** and **Assets/** in that folder hold research, chat exports and files.
The folder's "00 Index" explains the system. Code stays here and on GitHub; the "why" lives in Drive.

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
scripts/build_parcels.py   classify owners, apply privacy rule -> data/build/parcels.geojsonl, web/data/parcels/NNN.json, web/data/search.json, web/data/meta.json
scripts/fetch_sales.py     MD iMAP Property Sales (rolling 12 months) -> data/history/sales.json (cumulative, committed; never delete)
scripts/build_tiles.sh     tippecanoe -> web/data/parcels.pmtiles
web/                       static site (MapLibre GL + pmtiles), deployed to GitHub Pages by .github/workflows/pages.yml
```
Rebuild: `python3 scripts/fetch_parcels.py && python3 scripts/fetch_sales.py && python3 scripts/build_parcels.py && scripts/build_tiles.sh`
Run fetch_sales.py at least every few months: the state only publishes the last 12 months, and history.json is how older sales are kept.
Preview: `cd web && python3 -m http.server 8000`. The server must support Range requests for PMTiles; Python's doesn't, so use `npx http-server web -p 8000` instead.

## Owner groups (M3)
`scripts/build_owner_groups.py` links entity owners by identical name, identical mailing address (to the suite/floor) and identical care-of entity, with guards against registered agents, tax services, PO boxes and HOA managers. Groups are leads, not facts, and the UI says so.
`data/owner_aliases.json` is hand-researched. Each entry labels a group and can merge entities the mailing data misses:
```json
[{ "label": "Douglas Development (Jemal family)", "match": ["DOUGLAS DEV CORP", "JEMAL S BRIGHTSEAT L L C"],
   "sources": [{ "label": "SDAT care-of on acct 13-XXXXXXX", "url": "https://..." }],
   "wealth_web": "https://alxndrhq.github.io/historical-wealth-mind-map/#/p/<id>" }]
```
The build fails if an alias has no `sources`.

## Projects
User-created research projects live only in the viewer's browser (localStorage key `rem.projects.v1`), with an Export button. The site never generates projects on its own.

## Data source note
M1 uses the PG County DPIE "Property Flattened" layer (PG-only, already joined to SDAT). MD iMAP was down for maintenance on 2026-11-10. Keep MD iMAP Parcel Boundaries as the statewide cross-check.

## Milestones
M1 parcels on a map (done) → M2 search (done: exact owner name, entity addresses, ZIP, city, account) → M3 owner groups (done) → M4 case files → M5 planning overlay → M6 leaderboard. Details are in HANDOFF.md §6.
