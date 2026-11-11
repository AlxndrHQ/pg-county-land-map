#!/usr/bin/env bash
# GeoJSON (one feature per line) -> PMTiles for MapLibre.
# Requires tippecanoe >= 2.17 (writes .pmtiles directly). macOS: brew install tippecanoe
#
# Zoom 12-15: below z12 the county is a solid smear of parcels, so the app shows
# only the basemap there. z15 is the max detail stored; MapLibre overzooms beyond it.
set -euo pipefail
cd "$(dirname "$0")/.."

IN=data/build/parcels.geojsonl
OUT=web/data/parcels.pmtiles

tippecanoe \
  --output="$OUT" --force \
  --layer=parcels \
  --name="PG County parcels" \
  --attribution="Parcel data: MD iMAP, MDP, SDAT; PG County DPIE" \
  --minimum-zoom=12 --maximum-zoom=15 \
  --read-parallel \
  --drop-smallest-as-needed \
  --extend-zooms-if-still-dropping \
  --simplification=4 \
  "$IN"

ls -lh "$OUT"
