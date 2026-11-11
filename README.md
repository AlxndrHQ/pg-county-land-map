# Ground Truth

An open-data map of Prince George's County, Maryland that answers one question: **who owns the land under this?**

Click any parcel to see its owner of record, mailing address, acreage, assessed land and building values, last sale, land use and zoning. All of it comes from Maryland's assessment records (SDAT).

A sister project to [Algos & Capital](https://alxndrhq.github.io/historical-wealth-mind-map/).

## Privacy
Most parcels belong to individual homeowners. The map highlights entity, institutional and government owners. When a person owns a residential parcel, it's drawn as a neutral outline. The map doesn't show that owner's name or mailing address and links to the public SDAT record instead.

## Data
- Parcel shapes + SDAT attributes: Prince George's County DPIE, [Property Flattened](https://gis.princegeorgescountymd.gov/arcgis/rest/services/DPIE/SERVICES4PLS/MapServer/19)
- Parcel data: MD iMAP, MDP, SDAT. Derived product; credit the State of Maryland.
- Basemap: [OpenFreeMap](https://openfreemap.org), © OpenStreetMap contributors

## Limits
SDAT lags real-world transfers by weeks to months. Parcel boundaries come from tax records, not legal surveys. Maryland LLCs need not disclose their members. The land owner isn't always the building owner or the operator.

## Build
```sh
brew install tippecanoe
python3 scripts/fetch_parcels.py     # ~180 pages, cached in data/raw/ (resumable)
python3 scripts/build_parcels.py
scripts/build_tiles.sh
npx http-server web -p 8000          # PMTiles needs a server that supports Range requests
```
