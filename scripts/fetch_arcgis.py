#!/usr/bin/env python3
"""Page through one ArcGIS parcel source from sources.py and cache raw GeoJSON pages.

    python3 scripts/fetch_arcgis.py AA MO CH

Pages go to data/raw/<code>/NNNNN.geojson (gitignored). Paging is keyset-based on OBJECTID
within the source's where clause, so a rerun resumes after the last cached page. Requests
are throttled; be polite to state and county servers (CLAUDE.md).
"""
import argparse
import json
import sys
import time
from pathlib import Path

from fetch_parcels import get
from sources import SOURCES

ROOT = Path(__file__).resolve().parent.parent
DELAY_S = 1.0


def fetch(code, fresh=False, limit_pages=0):
    src = SOURCES[code]
    oid = src.get("oid", "OBJECTID")
    out = ROOT / "data" / "raw" / code
    out.mkdir(parents=True, exist_ok=True)
    if fresh:
        for p in out.glob("*.geojson"):
            p.unlink()
    total = get(src["layer"] + "/query", {"where": src["where"], "returnCountOnly": "true", "f": "json"}).get("count", -1)
    last_oid, n, page_no = -1, 0, 0
    for p in sorted(out.glob("*.geojson")):
        feats = json.loads(p.read_text())["features"]
        if feats:
            last_oid = max(last_oid, max(f["properties"][oid] for f in feats))
        n += len(feats)
        page_no += 1
    print(f"{code}: server reports {total:,}; cached {n:,} in {page_no} pages", flush=True)
    while True:
        d = get(src["layer"] + "/query", {
            "where": f"({src['where']}) AND {oid} > {last_oid}",
            "orderByFields": f"{oid} ASC",
            "outFields": ",".join(src["fields"]),
            "outSR": "4326", "geometryPrecision": "6",
            "returnGeometry": "true" if src.get("geometry", True) else "false",
            "resultRecordCount": src["page"], "f": "geojson",
        })
        feats = d.get("features", [])
        if not feats:
            break
        (out / f"{page_no:05d}.geojson").write_text(json.dumps(d, separators=(",", ":")))
        last_oid = max(f["properties"][oid] for f in feats)
        n += len(feats)
        page_no += 1
        if page_no % 20 == 0:
            print(f"{code}: {n:,} / {total:,}", flush=True)
        if limit_pages and page_no >= limit_pages:
            break
        time.sleep(DELAY_S)
    print(f"{code}: done, {n:,} features in {page_no} pages", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("codes", nargs="+", choices=sorted(SOURCES))
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--limit-pages", type=int, default=0)
    a = ap.parse_args()
    for c in a.codes:
        fetch(c, a.fresh, a.limit_pages)
    sys.exit(0)
