#!/usr/bin/env python3
"""Arlington County real estate attributes from the county DataHub API (OData-style paging).

    python3 scripts/fetch_arlington.py

Parcel shapes come from the county ArcGIS layer (fetch_arcgis.py AR). Owner names in this API are
"Redacted" for every property; the sales history keeps the buyer (grantee), which the build uses,
for companies only, as a labeled "likely owner (last buyer)". Pages are cached to
data/raw/AR_<table>/ (gitignored) so a rerun resumes. Throttled to about one request per second.
"""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://datahub-v2.arlingtonva.us/api/RealEstate/"
TOP = 3000
TABLES = {  # name: (path, order key, filter)
    "Property": ("Property", "propertyKey", None),
    "Assessment": ("Assessment", "assessmentKey", "assessmentDate ge 2026-01-01T00:00:00Z"),
    "SalesHistory": ("SalesHistory", "salesHistoryKey", None),
}


def get(path, params):
    url = BASE + path + "?" + urllib.parse.urlencode(params, safe="$ ',:")
    url = url.replace(" ", "%20")
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "real-estate-map/0.2 (open-data research)",
                                                       "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())
        except Exception as e:
            print(f"  retry {attempt + 1}: {e}", flush=True)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(url)


def main():
    for name, (path, key, flt) in TABLES.items():
        out = ROOT / "data" / "raw" / f"AR_{name}"
        out.mkdir(parents=True, exist_ok=True)
        page = len(list(out.glob("*.json")))
        n = page * TOP
        while True:
            params = {"$top": TOP, "$skip": page * TOP, "$orderby": key}
            if flt:
                params["$filter"] = flt
            rows = get(path, params)
            if not rows:
                break
            (out / f"{page:05d}.json").write_text(json.dumps(rows, separators=(",", ":")))
            page += 1
            n += len(rows)
            if page % 10 == 0:
                print(f"{name}: {n:,}", flush=True)
            if len(rows) < TOP:
                break
            time.sleep(1.0)
        print(f"{name}: done, {n:,} rows", flush=True)


if __name__ == "__main__":
    main()
