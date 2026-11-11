#!/usr/bin/env python3
"""Page through the PG County "Property Flattened" layer and cache raw GeoJSON pages.

Source: Prince George's County DPIE, Property Flattened (parcel shapes + SDAT attributes)
https://gis.princegeorgescountymd.gov/arcgis/rest/services/DPIE/SERVICES4PLS/MapServer/19

Why this layer and not MD iMAP: it is already limited to PG County and already joined
to SDAT, so it needs no county filter and no polygon/point join. MD iMAP Parcel
Boundaries remains the statewide cross-check (see HANDOFF.md section 1).

Pagination is keyset-based (OBJECTID > last seen), which is stable even if the
server's resultOffset ordering is not. Each page is cached to data/raw/pages/, so
a rerun only fetches pages that are missing. Use --fresh to refetch everything.

Stdlib only, so it runs anywhere (local or GitHub Actions) without pip installs.
"""
import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

LAYER = "https://gis.princegeorgescountymd.gov/arcgis/rest/services/DPIE/SERVICES4PLS/MapServer/19"
ROOT = Path(__file__).resolve().parent.parent
PAGES = ROOT / "data" / "raw" / "pages"
PAGE_SIZE = 2000  # layer maxRecordCount
DELAY_S = 0.6     # be polite to the county server

# Keep only what the map and the parcel drawer use.
FIELDS = [
    "OBJECTID", "PROPERTY_ID", "ACCOUNT", "ASSESS_DIST",
    "OWNER_NAME", "ICO_NAME", "MAIL_STREET", "MAIL_CITY", "MAIL_STATE", "MAIL_ZIP5",
    "HOUSE_NUMBER", "HOUSE_SUFFIX", "UNIT", "STREET_DIRECTION", "STREET_NAME", "STREET_TYPE",
    "CITY", "ZIP5",
    "LAND_AREA_ACRE", "FCV_LAND", "FCV_IMPS", "CURR_ASSESS",
    "SALES_PRICE", "TRANSFER_DATE", "LIBER", "FOLIO",
    "MNCPPC_USE", "BPRUC", "RESIDENTIAL_IND", "PG_TAX_CLASS", "EXEMPT_CLASS", "EXEMPT_ASSESSMENT",
    "ZONE_CODE1", "YEAR_BUILT", "STRUCTURE_SQ_FT", "DWELLING_UNITS",
    "SDAT_ACCOUNT_URL", "IMPRT_DATE",
]


def get(url, params, tries=5):
    q = url + "?" + urllib.parse.urlencode(params)
    for attempt in range(tries):
        try:
            req = urllib.request.Request(q, headers={"User-Agent": "pg-land-map/0.1 (open-data research)"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())
        except Exception as e:  # network blips, 5xx, bad JSON
            wait = 5 * (attempt + 1)
            print(f"  retry {attempt + 1}/{tries} in {wait}s: {e}", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"failed after {tries} tries: {q}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fresh", action="store_true", help="ignore cached pages")
    ap.add_argument("--limit-pages", type=int, default=0, help="stop after N pages (testing)")
    args = ap.parse_args()

    PAGES.mkdir(parents=True, exist_ok=True)
    if args.fresh:
        for p in PAGES.glob("*.geojson"):
            p.unlink()

    total = get(LAYER + "/query", {"where": "1=1", "returnCountOnly": "true", "f": "json"})["count"]
    print(f"server reports {total:,} records")

    # Resume after the highest OBJECTID already cached.
    last_oid, n_cached, page_no = -1, 0, 0
    for p in sorted(PAGES.glob("*.geojson")):
        d = json.loads(p.read_text())
        if d["features"]:
            last_oid = max(last_oid, max(f["properties"]["OBJECTID"] for f in d["features"]))
        n_cached += len(d["features"])
        page_no += 1
    if page_no:
        print(f"resuming: {page_no} pages / {n_cached:,} features cached, OBJECTID > {last_oid}")

    fetched = n_cached
    while True:
        d = get(LAYER + "/query", {
            "where": f"OBJECTID > {last_oid}",
            "orderByFields": "OBJECTID ASC",
            "outFields": ",".join(FIELDS),
            "outSR": "4326",
            "geometryPrecision": "6",
            "resultRecordCount": PAGE_SIZE,
            "f": "geojson",
        })
        feats = d.get("features", [])
        if not feats:
            break
        (PAGES / f"{page_no:05d}.geojson").write_text(json.dumps(d, separators=(",", ":")))
        last_oid = max(f["properties"]["OBJECTID"] for f in feats)
        fetched += len(feats)
        page_no += 1
        print(f"page {page_no:4d}  {fetched:>8,} / {total:,}", flush=True)
        if args.limit_pages and page_no >= args.limit_pages:
            break
        time.sleep(DELAY_S)

    print(f"done: {fetched:,} features in {page_no} pages -> {PAGES}")


if __name__ == "__main__":
    main()
