#!/usr/bin/env python3
"""Fetch the last 12 months of PG County sales and merge them into a growing history file.

Source: MD iMAP "Property Sales" (SDAT transfers, rolling ~12-month window), Maryland Dept. of Planning
https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_PropertySales/MapServer/0

The state only publishes the most recent year, so data/history/sales.json is cumulative:
every run ADDS sales it has not seen (keyed by account + date + deed) and never drops old ones.
Run it at least once a year (monthly with the parcel refresh) and the history keeps growing.

Record per sale: d date (YYYY-MM-DD), p price, deed "liber/folio", prior "liber/folio" (the
seller's own deed, one step back in the chain of title), cv SDAT conveyance code.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

LAYER = "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_PropertySales/MapServer/0"
ROOT = Path(__file__).resolve().parent.parent
HISTORY = ROOT / "data" / "history" / "sales.json"
FIELDS = "OBJECTID,ACCTID,TRADATE,CONSIDR1,CONVEY1,DR1LIBER,DR1FOLIO,GR1LIBR1,GR1FOLO1,MDPVDATE"


def get(params, tries=5):
    url = LAYER + "/query?" + urllib.parse.urlencode(params)
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "pg-land-map/0.1 (open-data research)"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())
        except Exception as e:
            print(f"  retry {attempt + 1}: {e}", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(url)


def ref(lib, fol):
    lib, fol = (lib or "").strip().lstrip("0"), (fol or "").strip().lstrip("0") or "0"
    return f"{lib}/{fol}" if lib else None


def main():
    hist = json.loads(HISTORY.read_text()) if HISTORY.exists() else {"sales": {}, "runs": []}
    sales = hist["sales"]
    last, added, seen, edition = -1, 0, 0, None
    while True:
        d = get({"where": f"JURSCODE='PRIN' AND OBJECTID > {last}", "orderByFields": "OBJECTID",
                 "outFields": FIELDS, "returnGeometry": "false", "resultRecordCount": 2000, "f": "json"})
        feats = d.get("features", [])
        if not feats:
            break
        for f in feats:
            a = f["attributes"]
            last = max(last, a["OBJECTID"])
            seen += 1
            edition = a.get("MDPVDATE") or edition
            acct, t = (a.get("ACCTID") or "").strip(), (a.get("TRADATE") or "").strip()
            if len(acct) != 11 or len(t) != 8:
                continue
            pid = acct[2:]                      # "17" county prefix + district(2) + account(7) = PROPERTY_ID
            rec = {"d": f"{t[:4]}-{t[4:6]}-{t[6:]}", "p": a.get("CONSIDR1") or None,
                   "deed": ref(a.get("DR1LIBER"), a.get("DR1FOLIO")),
                   "prior": ref(a.get("GR1LIBR1"), a.get("GR1FOLO1")), "cv": a.get("CONVEY1")}
            rec = {k: v for k, v in rec.items() if v is not None}
            lst = sales.setdefault(pid, [])
            if not any(r["d"] == rec["d"] and r.get("deed") == rec.get("deed") for r in lst):
                lst.append(rec)
                lst.sort(key=lambda r: r["d"])
                added += 1
        print(f"  {seen:,} rows", flush=True)
        time.sleep(0.6)
    hist["runs"].append({"at": time.strftime("%Y-%m-%d"), "edition": edition, "rows": seen, "added": added})
    HISTORY.parent.mkdir(parents=True, exist_ok=True)
    HISTORY.write_text(json.dumps(hist, separators=(",", ":"), sort_keys=True))
    print(f"done: {seen:,} rows from edition {edition}, {added:,} new sales, {len(sales):,} parcels with history")


if __name__ == "__main__":
    main()
