#!/usr/bin/env bash
# GeoJSON (one feature per line) -> PMTiles for MapLibre, one file per jurisdiction.
# Requires tippecanoe >= 2.17 (writes .pmtiles directly). macOS: brew install tippecanoe
#
#   scripts/build_tiles.sh          PG plus every other region built by build_parcels.py
#   scripts/build_tiles.sh AA MO    just these regions
#
# PG -> web/data/parcels.pmtiles (served with the site). Others -> data/out/<CODE>/parcels.pmtiles,
# published to the storage-only data repos. Zoom 12-15: below z12 the region is a solid smear of
# parcels, so the app shows only the basemap there. z15 is the max detail stored; MapLibre overzooms.
set -euo pipefail
cd "$(dirname "$0")/.."

tile() {  # in out name
  tippecanoe --output="$2" --force --layer=parcels --name="$3" \
    --attribution="Parcel data: MD iMAP, MDP, SDAT; county GIS" \
    --minimum-zoom=12 --maximum-zoom=15 --read-parallel \
    --drop-smallest-as-needed --extend-zooms-if-still-dropping --simplification=4 \
    --quiet "$1"
  ls -lh "$2"
}

codes=("$@")
if [ ${#codes[@]} -eq 0 ]; then
  codes=(PG)
  for f in data/build/*.geojsonl; do
    c=$(basename "$f" .geojsonl); [ "$c" = parcels ] || codes+=("$c")
  done
fi
for c in "${codes[@]}"; do
  if [ "$c" = PG ]; then
    tile data/build/parcels.geojsonl web/data/parcels.pmtiles "PG County parcels"
  else
    mkdir -p "data/out/$c"
    tile "data/build/$c.geojsonl" "data/out/$c/parcels.pmtiles" "$c parcels"
  fi
done
