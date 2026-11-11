#!/usr/bin/env bash
# Publish data/out/<CODE> folders to the storage-only data repos as ONE fresh commit each
# (history is not kept, so the repos stay small). Owner-group ids are shared across all regions and
# web/data/search.json, so publish every repo together with the map, never one alone.
#   scripts/publish_data.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
publish() {  # repo, codes...
  repo=$1; shift
  dir="$ROOT/../$repo-publish"
  rm -rf "$dir"; mkdir -p "$dir"; cd "$dir"
  git init -q -b main
  for c in "$@"; do cp -R "$ROOT/data/out/$c" "./$c"; done
  touch .nojekyll
  printf '%s\n' "# $repo" "" "Storage-only data for the Real Estate Map (https://alxndrhq.github.io/pg-county-land-map/): parcel tiles and detail files for $*. Built by scripts in AlxndrHQ/pg-county-land-map and republished as a single commit." "" "Individually owned homes carry no owner name, mailing address or deed reference." > README.md
  git add -A
  git commit -qm "Data for $* ($(date +%Y-%m-%d))"
  git remote add origin "https://github.com/AlxndrHQ/$repo.git"
  git push -q -f origin main
  echo "$repo: pushed $(du -sh --exclude=.git . 2>/dev/null | cut -f1 || true)"
  cd "$ROOT"
}
publish rem-data-md AA MO CH HO
publish rem-data-va DC AR AL FX PW LO FQ
