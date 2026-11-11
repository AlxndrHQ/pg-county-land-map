#!/usr/bin/env python3
"""Turn cached raw pages into (1) slim tile features and (2) sharded parcel detail JSON.

Inputs:  data/raw/pages/*.geojson          (from fetch_parcels.py)
Outputs: data/build/parcels.geojsonl        one feature per line, tiny props, for tippecanoe
         web/data/parcels/<NNN>.json        detail records, sharded by last 3 digits of the id
         web/data/meta.json                 data date, counts, source attribution
         web/data/search.json               search index: entity owners, entity addresses, ZIPs, cities
                                            (private parcels are never in it, only in ZIP/city counts)

Owner-type codes used in tiles and details (colors in web/style.css):
  c  corporate / LLC / partnership
  i  institutional / REIT / bank / university / hospital
  g  government / public body
  r  religious / nonprofit / HOA
  p  person (no entity keyword)

PRIVACY RULE (HANDOFF.md section 2): a parcel owned by a person (type p) is flagged private
unless its land use is clearly commercial (COM/IND/OFF/MIX) and SDAT does not mark it residential. Private parcels draw as neutral outlines.
Their published detail record OMITS the owner name, care-of name, mailing address and deed
reference. The drawer links to SDAT, where the record is public, instead of republishing it.
"""
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ROOT / "data" / "raw" / "pages"
BUILD = ROOT / "data" / "build"
WEB_DATA = ROOT / "web" / "data"
SHARDS = WEB_DATA / "parcels"

# --- owner-type keyword lists (matched on whole words / phrases after normalization) ---
GOV = [
    "UNITED STATES", "USA", "U S A", "STATE OF MARYLAND", "STATE OF MD", "STATE HIGHWAY",
    "PRINCE GEORGES COUNTY", "PRINCE GEORGES CO", "PR GEORGES COUNTY", "PRINCE GEORGE COUNTY",
    "COUNTY COMMISSIONERS", "BOARD OF EDUCATION", "BD OF EDUCATION", "BOARD OF COUNTY",
    "MARYLAND NATIONAL CAPITAL", "MD NATIONAL CAPITAL", "MARYLAND NATL CAPITAL", "M NCPPC", "MNCPPC",
    "WASHINGTON SUBURBAN SANITARY", "WSSC", "CITY OF", "TOWN OF", "MAYOR AND", "MAYOR COUNCIL",
    "HOUSING AUTHORITY", "REDEVELOPMENT AUTHORITY", "REVENUE AUTHORITY", "STADIUM AUTHORITY",
    "WASHINGTON METROPOLITAN AREA TRANSIT", "WMATA", "DEPARTMENT OF", "DEPT OF",
    "BOARD OF REGENTS", "UNIVERSITY SYSTEM OF MARYLAND", "MARYLAND TRANSPORTATION AUTHORITY",
    "MARYLAND TRANSIT ADMINISTRATION", "MARYLAND AVIATION", "COMMISSIONERS OF", "FEDERAL",
    "GENERAL SERVICES ADMINISTRATION", "NATIONAL PARK SERVICE", "DISTRICT OF COLUMBIA",
    "AUTHORITY", "AUTH", "SANITARY", "WASHINGTON METRO", "TRANSIT", "COMMISSION",
]
REL = [
    "CHURCH", "CHURCHES", "MINISTRIES", "MINISTRY", "TEMPLE OF", "MOSQUE", "MASJID", "SYNAGOGUE",
    "CONGREGATION", "BAPTIST", "METHODIST", "CATHOLIC", "ARCHDIOCESE", "DIOCESE", "EPISCOPAL",
    "LUTHERAN", "PRESBYTERIAN", "TABERNACLE", "PARISH OF", "ADVENTIST", "PENTECOSTAL", "APOSTOLIC",
    "KINGDOM HALL", "JEHOVAHS WITNESSES", "ISLAMIC", "GOSPEL", "FELLOWSHIP",
    "FOUNDATION", "HOMEOWNERS", "HOME OWNERS", "HOA", "H O A", "CONDO ASSN", "CONDO ASSOCIATION", "UNIT OWNERS", "COMMUNITY ASSOCIATION", "COMMUNITY ASSN",
    "CIVIC ASSOCIATION", "CONDOMINIUM", "COUNCIL OF UNIT OWNERS", "SOCIETY", "LODGE NO",
    "AMERICAN LEGION", "VFW", "VETERANS OF FOREIGN WARS", "CEMETERY", "LAND TRUST", "CONSERVANCY",
    "BOYS AND GIRLS", "YMCA", "HABITAT FOR HUMANITY", "VOLUNTEER FIRE", "RESCUE SQUAD",
    "IGLESIA", "EVANGELICA", "DIOS", "ASSEMBLY OF GOD", "CRCH", "CHRCH", "CHAPEL", "ASSOCIATION",
    "OWNERS", "COMMUNITY", "MASTER", "ASSOCIA",
]
INST = [
    "REIT", "REALTY TRUST", "PROPERTY TRUST", "PROPERTIES TRUST", "INVESTMENT TRUST",
    "REAL ESTATE INVESTMENT", "BANK", "BANCORP", "SAVINGS", "FEDERAL CREDIT UNION", "CREDIT UNION",
    "INSURANCE", "ASSURANCE", "HOSPITAL", "HEALTH SYSTEM", "MEDICAL CENTER",
    "HEALTH CARE", "HEALTHCARE", "PENSION", "RETIREMENT SYSTEM",
]
# Only count as institutional when the name has no LLC/INC-style suffix ("COLLEGE PARK CENTER LLC").
INST_WEAK = ["UNIVERSITY", "COLLEGE", "SCHOOL", "ACADEMY"]
# Place names that contain institutional words; removed before matching.
PLACE_NAMES = ["COLLEGE PARK", "UNIVERSITY PARK", "UNIVERSITY BOULEVARD", "UNIVERSITY BLVD",
               "UNIVERSITY GARDENS", "UNIVERSITY HILLS", "UNIVERSITY HEIGHTS", "UNIVERSITY HTS",
               "UNIVERSITY ASSOCS", "UNIVERSITY ASSOCIATES", "SCHOOL HOUSE", "ACADEMY HILL"]
HARD_SUFFIX = ["LLC", "L L C", "INC", "INCORPORATED", "CORP", "CORPORATION", "LP", "LLP", "LLLP",
               "LTD", "PTNSHP", "PTNSH", "PARTNERSHIP", "OWNER"]
CORP = [
    "LLC", "L L C", "INC", "INCORPORATED", "CORP", "CORPORATION", "COMPANY", "CO", "LP",
    "LLP", "LTD", "LIMITED", "PARTNERSHIP", "PARTNERS", "ASSOCIATES", "HOLDINGS", "HOLDING",
    "PROPERTIES", "PROPERTY", "VENTURES", "INVESTMENTS", "INVESTORS", "INVESTMENT", "DEVELOPMENT",
    "DEVELOPERS", "ENTERPRISES", "GROUP", "REALTY", "PLC", "LLLP", "PTNSHP", "PTNSH", "BUILDERS", "HOMES",
    "CAPITAL", "FUND", "EQUITIES", "EQUITY", "MANAGEMENT", "APARTMENTS", "ASSOC", "ASSN", "DST", "HOMEBUYER",
    "RAILROAD", "RAILWAY", "ELECTRIC", "TELEPHONE", "GAS LIGHT", "POWER CO",
]
# A personal trust or estate is a person for privacy purposes.
PERSONAL_TRUST = ["TRUSTEE", "TRUSTEES", "TR", "REVOCABLE", "IRREVOCABLE", "LIVING TRUST",
                  "FAMILY TRUST", "LIVING TRUS", "TRUST", "ESTATE OF", "EST OF", "LIFE ESTATE", "ET AL", "ETAL", "PERS REP"]

# A person's name is shown only on clearly commercial land; everything else is private.
COMMERCIAL_USE = {"COM", "IND", "OFF", "MIX"}

USE_LABEL = {  # PG Planning MNCPPC_USE codes; uncertain codes are shown raw in the UI
    "AGR": "Agricultural", "CHU": "Church", "COM": "Commercial", "IND": "Industrial",
    "INS": "Institutional", "MF": "Multifamily", "MIX": "Mixed use", "OFF": "Office",
    "SFA": "Single-family attached", "SFD": "Single-family detached", "TH": "Townhouse",
    "VAC": "Vacant", "UNK": "Unknown",
}


def norm(s):
    s = (s or "").upper().replace("'", "").replace("&", " AND ")
    return " " + re.sub(r"[^A-Z0-9]+", " ", s).strip() + " "


def has(n, words):
    return any(f" {w} " in n for w in words)


def owner_type(name):
    n = norm(name)
    if n.strip() == "":
        return "p"
    for place in PLACE_NAMES:
        n = n.replace(f" {place} ", " ")
    if has(n, GOV):
        return "g"
    if has(n, INST):
        return "i"
    if has(n, REL):
        return "r"
    hard = has(n, HARD_SUFFIX)
    if has(n, INST_WEAK) and not hard:
        return "i"
    # A bare "... TRUST" or "... TRUSTEE" is usually a personal trust; treat it as a person.
    if has(n, PERSONAL_TRUST) and not hard:
        return "p"
    if hard or has(n, CORP):
        return "c"
    return "p"


def clean(v):
    if v is None:
        return None
    if isinstance(v, str):
        v = " ".join(v.split())
        return v or None
    return v


def site_address(p):
    num = (p.get("HOUSE_NUMBER") or "").lstrip("0")
    parts = [num + (p.get("HOUSE_SUFFIX") or "").strip(), p.get("STREET_DIRECTION"),
             p.get("STREET_NAME"), p.get("STREET_TYPE")]
    line = " ".join(x.strip() for x in parts if x and x.strip())
    unit = clean(p.get("UNIT"))
    if unit:
        line += f" #{unit}"
    tail = " ".join(x for x in [clean(p.get("CITY")), clean(p.get("ZIP5"))] if x)
    return ", ".join(x for x in [line, tail] if x) or None


def mail_address(p):
    city = ", ".join(x for x in [clean(p.get("MAIL_CITY")), clean(p.get("MAIL_STATE"))] if x)
    return " · ".join(x for x in [clean(p.get("MAIL_STREET")),
                                  " ".join(x for x in [city, clean(p.get("MAIL_ZIP5"))] if x)] if x) or None


def sale_date(s):
    s = clean(s)
    if s and len(s) == 8 and s.isdigit() and s != "00000000":
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    return None


def centroid(geom):
    """Vertex average of the first outer ring: cheap, good enough to fly to a parcel."""
    ring = geom["coordinates"][0] if geom["type"] == "Polygon" else geom["coordinates"][0][0]
    xs, ys = [c[0] for c in ring], [c[1] for c in ring]
    return [round(sum(xs) / len(xs), 5), round(sum(ys) / len(ys), 5)]


def bbox(points, trim=0.0):
    """Bounding box of points; trim drops that fraction of outliers at each edge."""
    xs, ys = sorted(p[0] for p in points), sorted(p[1] for p in points)
    k = int(len(xs) * trim)
    lo, hi = k, len(xs) - 1 - k
    return [xs[lo], ys[lo], xs[hi], ys[hi]]


def main():
    BUILD.mkdir(parents=True, exist_ok=True)
    SHARDS.mkdir(parents=True, exist_ok=True)
    for old in SHARDS.glob("*.json"):
        old.unlink()

    shards = {}
    seen = set()
    types, n_private, n_dupe, n_nogeom = Counter(), 0, 0, 0
    max_import = 0
    owners = {}           # owner name -> {t, ids, ac, pts}   (entity / non-private only)
    addrs = []            # [address, id] for non-private parcels
    places = {}           # ("zip"|"city", label) -> [points]

    with open(BUILD / "parcels.geojsonl", "w") as out:
        for page in sorted(PAGES.glob("*.geojson")):
            for f in json.loads(page.read_text())["features"]:
                p = f["properties"]
                if not f.get("geometry"):
                    n_nogeom += 1
                    continue
                pid = clean(p.get("PROPERTY_ID")) or f"oid{p['OBJECTID']}"
                max_import = max(max_import, p.get("IMPRT_DATE") or 0)
                use = clean(p.get("MNCPPC_USE"))
                name = clean(p.get("OWNER_NAME"))
                t = owner_type(name)
                residential = p.get("RESIDENTIAL_IND") == "H" or use not in COMMERCIAL_USE
                private = t == "p" and residential

                # Tile feature: keep attributes tiny (HANDOFF.md section 3).
                props = {"id": pid, "t": t}
                if private:
                    props["pv"] = 1
                out.write(json.dumps({"type": "Feature", "properties": props, "geometry": f["geometry"]},
                                     separators=(",", ":")) + "\n")

                if pid in seen:  # same account drawn by several shapes: one detail record
                    n_dupe += 1
                    continue
                seen.add(pid)
                types[t] += 1
                n_private += private

                c = centroid(f["geometry"])
                if clean(p.get("ZIP5")):
                    places.setdefault(("zip", clean(p["ZIP5"])), []).append(c)
                if clean(p.get("CITY")):
                    places.setdefault(("city", clean(p["CITY"]).title()), []).append(c)

                acct = f"{clean(p.get('ASSESS_DIST')) or '??'}-{clean(p.get('ACCOUNT')) or '?'}"
                lib, fol = clean(p.get("LIBER")), clean(p.get("FOLIO"))
                d = {
                    "acct": acct, "t": t,
                    "a": site_address(p),
                    "ac": p.get("LAND_AREA_ACRE"),
                    "lv": p.get("FCV_LAND"), "iv": p.get("FCV_IMPS"), "tv": p.get("CURR_ASSESS"),
                    "sp": p.get("SALES_PRICE") or None, "sd": sale_date(p.get("TRANSFER_DATE")),
                    "lu": use, "lul": USE_LABEL.get(use), "z": clean(p.get("ZONE_CODE1")),
                    "yb": (clean(p.get("YEAR_BUILT")) or "").lstrip("0") or None,
                    "url": clean(p.get("SDAT_ACCOUNT_URL")),
                    "ex": p.get("EXEMPT_ASSESSMENT") or None, "exc": clean(p.get("EXEMPT_CLASS")),
                    "c": c,
                }
                if private:
                    d["pv"] = 1
                else:
                    d.update({
                        "o": name, "co": clean(p.get("ICO_NAME")), "ma": mail_address(p),
                        "lf": f"{lib}/{fol}" if lib and fol and lib.strip("0") else None,
                    })
                    if name and name != "UNKNOWN":
                        g = owners.setdefault(name, {"t": t, "ids": [], "ac": 0.0, "pts": []})
                        g["ids"].append(pid)
                        g["ac"] += p.get("LAND_AREA_ACRE") or 0
                        g["pts"].append(c)
                    if d.get("a"):
                        addrs.append([d["a"], pid])
                d = {k: v for k, v in d.items() if v not in (None, "", 0) or k in ("lv", "iv", "tv")}
                shards.setdefault(pid[-3:].rjust(3, "0"), {})[pid] = d

    for key, recs in shards.items():
        (SHARDS / f"{key}.json").write_text(json.dumps(recs, separators=(",", ":")))

    search = {
        # [name, type, parcel count, acres, bbox, ids, flat centroids [x0,y0,x1,y1,...]]
        "owners": sorted(([n, g["t"], len(g["ids"]), round(g["ac"], 2), bbox(g["pts"]), g["ids"],
                           [round(v, 4) for pt in g["pts"] for v in pt]]
                          for n, g in owners.items()), key=lambda r: -r[3]),
        "addrs": addrs,
        # [label, kind, parcel count, bbox]  (trim 2% outliers: stray geocodes)
        "places": sorted(([label, kind, len(pts), bbox(pts, 0.02)]
                          for (kind, label), pts in places.items() if len(pts) >= 20),
                         key=lambda r: -r[2]),
    }
    (WEB_DATA / "search.json").write_text(json.dumps(search, separators=(",", ":")))
    print(f"search: {len(search['owners'])} owners, {len(addrs)} addresses, {len(search['places'])} places")

    as_of = datetime.fromtimestamp(max_import / 1000, tz=timezone.utc) if max_import else None
    meta = {
        "as_of": as_of.strftime("%Y-%m-%d") if as_of else None,
        "as_of_label": as_of.strftime("%b %Y") if as_of else None,
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "parcels": len(seen), "private": n_private, "by_type": dict(types),
        "source": {
            "label": "Prince George's County DPIE, Property Flattened (parcel shapes + SDAT)",
            "url": "https://gis.princegeorgescountymd.gov/arcgis/rest/services/DPIE/SERVICES4PLS/MapServer/19",
        },
    }
    (WEB_DATA / "meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))
    print(f"shards: {len(shards)}  duplicate shapes: {n_dupe}  no geometry: {n_nogeom}")


if __name__ == "__main__":
    main()
