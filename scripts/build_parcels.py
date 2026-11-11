#!/usr/bin/env python3
"""Turn cached raw pages into (1) slim tile features and (2) sharded parcel detail JSON.

Inputs:  data/raw/pages/*.geojson          (from fetch_parcels.py)
Outputs: data/build/parcels.geojsonl        one feature per line, tiny props, for tippecanoe
         web/data/parcels/<NNN>.json        detail records, sharded by last 3 digits of the id
         web/data/meta.json                 data date, counts, source attribution
         web/data/search.json               search index: owner groups, entity addresses, ZIPs, cities
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

from build_owner_groups import address_key, build_groups, careof_entity

ROOT = Path(__file__).resolve().parent.parent
PAGES = ROOT / "data" / "raw" / "pages"
BUILD = ROOT / "data" / "build"
WEB_DATA = ROOT / "web" / "data"
SHARDS = WEB_DATA / "parcels"
SALES_HISTORY = ROOT / "data" / "history" / "sales.json"   # from fetch_sales.py (cumulative)


def sale_history(hist, pid, sd, sp, lf, private):
    """Merge the cumulative state sales history with the parcel's current last sale.
    Private parcels keep date and price only (no deed references)."""
    out = [dict(r) for r in hist.get(pid, [])]
    if sd and not any(r["d"] == sd for r in out):
        out.append({k: v for k, v in {"d": sd, "p": sp, "deed": lf}.items() if v})
    out.sort(key=lambda r: r["d"], reverse=True)
    if private:
        out = [{k: v for k, v in r.items() if k in ("d", "p")} for r in out]
    return out

# --- owner-type keyword lists (matched on whole words / phrases after normalization) ---
GOV = [
    "UNITED STATES", "USA", "U S A", "STATE OF MARYLAND", "STATE OF MD", "STATE HIGHWAY",
    "PRINCE GEORGES COUNTY", "PRINCE GEORGES CO", "PR GEORGES COUNTY", "PRINCE GEORGE COUNTY",
    "ANNE ARUNDEL COUNTY", "ANNE ARUNDEL CO", "HOWARD COUNTY", "MONTGOMERY COUNTY", "MONTGOMERY CO MD", "CHARLES COUNTY",
    "COUNTY COMMISSIONERS OF CHARLES", "COMMISSIONERS OF CHARLES COUNTY", "COUNTY COUNCIL", "STATE ROADS",
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
    "OWNERS", "COMMUNITY", "MASTER", "ASSOCIA", "ASSN", "COMMNTY", "COMNTY", "HOMEOWNRS", "HOMEOWNR",
    "HMOWNRS", "HMWNRS", "HMOWRS", "HMONRS", "HOMOWNS", "HOMEOWNS", "MINISTRIES INTERNATIONAL", "HMNWNRS", "HMOWNERS", "HMOWNRS", "HMWNRS", "HOMEOWNERS",
    "HOMEOWNRS", "HMOWRS", "HMOWNR", "HMWNR", "CLUSTER ASSN", "CONDO", "CONDOMINIUMS",
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
    "MALL", "SHOP CNTR", "SHOPPING", "SHOP CTR", "SHOPPING CENTER", "TOWN CENTER", "TOWNE CENTRE", "PLAZA LLC", "REGNAL", "REGIONAL",
    "CAPITAL", "FUND", "EQUITIES", "EQUITY", "MANAGEMENT", "APARTMENTS", "ASSOC", "DST", "HOMEBUYER",
    "RAILROAD", "RAILWAY", "ELECTRIC", "TELEPHONE", "GAS LIGHT", "POWER CO", "PEPCO", "BGE", "VERIZON", "COMCAST",
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


# ---------- sources: each yields normalized records ----------
# A record: pid, geom, name (None when the source publishes no names), ico, mail_* , site, city, zip,
# ac, lv, iv, tv, sp, sd, lib, fol, use, use_label, commercial (land use is clearly business),
# zone, yb, url, ex, exc, imported (ms or None), basis ("record" or "last buyer").

def pg_records():
    for page in sorted(PAGES.glob("*.geojson")):
        for f in json.loads(page.read_text())["features"]:
            p = f["properties"]
            use = clean(p.get("MNCPPC_USE"))
            yield {
                "pid": clean(p.get("PROPERTY_ID")) or f"oid{p['OBJECTID']}", "geom": f.get("geometry"),
                "name": clean(p.get("OWNER_NAME")), "ico": p.get("ICO_NAME"),
                "mail_street": p.get("MAIL_STREET"), "mail_zip": p.get("MAIL_ZIP5"), "mail": mail_address(p),
                "site": site_address(p), "city": clean(p.get("CITY")), "zip": clean(p.get("ZIP5")),
                "acct": f"{clean(p.get('ASSESS_DIST')) or '??'}-{clean(p.get('ACCOUNT')) or '?'}",
                "ac": p.get("LAND_AREA_ACRE"), "lv": p.get("FCV_LAND"), "iv": p.get("FCV_IMPS"), "tv": p.get("CURR_ASSESS"),
                "sp": p.get("SALES_PRICE") or None, "sd": sale_date(p.get("TRANSFER_DATE")),
                "lib": clean(p.get("LIBER")), "fol": clean(p.get("FOLIO")),
                "use": use, "use_label": USE_LABEL.get(use),
                "commercial": p.get("RESIDENTIAL_IND") != "H" and use in COMMERCIAL_USE,
                "zone": clean(p.get("ZONE_CODE1")), "yb": (clean(p.get("YEAR_BUILT")) or "").lstrip("0") or None,
                "url": clean(p.get("SDAT_ACCOUNT_URL")),
                "ex": p.get("EXEMPT_ASSESSMENT") or None, "exc": clean(p.get("EXEMPT_CLASS")),
                "imported": p.get("IMPRT_DATE"), "basis": "record",
            }


MD_COMMERCIAL = {"Commercial", "Industrial", "Commercial Condominium", "Exempt Commercial"}


def raw_features(code):
    for page in sorted((ROOT / "data" / "raw" / code).glob("*.geojson")):
        yield from json.loads(page.read_text())["features"]


def md_names(code):
    """ACCTID -> 'OWNER 1; OWNER 2' from a county owner table, or None if the county publishes none."""
    from sources import SOURCES
    key = code + "_names"
    if key not in SOURCES:
        return None
    src, out = SOURCES[key], {}
    for f in raw_features(key):
        r = f["properties"]
        n1 = clean(r.get("ASST_FIRST_OWNER") or r.get("OWNNAME1"))
        n2 = clean(r.get("ASST_SECND_OWNER") or r.get("OWNNAME2"))
        if n1:
            out[src["join"](r)] = n1 + (f"; {n2}" if n2 else "")
    return out


def md_records(code):
    names = md_names(code)
    for f in raw_features(code):
        p = f["properties"]
        acct = clean(p.get("ACCTID"))
        if not acct or acct == "NO ID":
            continue
        use = clean(p.get("DESCLU"))
        mail = " · ".join(x for x in [
            " ".join(x for x in [clean(p.get("OWNADD1")), clean(p.get("OWNADD2"))] if x),
            " ".join(x for x in [", ".join(x for x in [clean(p.get("OWNCITY")), clean(p.get("OWNSTATE"))] if x),
                                 clean(p.get("OWNERZIP"))] if x)] if x) or None
        site = ", ".join(x for x in [clean(p.get("ADDRESS")),
                                     " ".join(x for x in [clean(p.get("CITY")), clean(p.get("ZIPCODE"))] if x)] if x) or None
        yield {
            "pid": f"{code}_{acct}", "geom": f.get("geometry"),
            "name": names.get(acct) if names is not None else None, "names_published": names is not None,
            "ico": None, "mail_street": p.get("OWNADD1"), "mail_zip": p.get("OWNERZIP"), "mail": mail,
            "site": site, "city": (clean(p.get("CITY")) or "").title() or None, "zip": clean(p.get("ZIPCODE")),
            "acct": acct, "ac": p.get("ACRES"),
            "lv": p.get("NFMLNDVL"), "iv": p.get("NFMIMPVL"), "tv": p.get("NFMTTLVL"),
            "sp": p.get("CONSIDR1") or None, "sd": sale_date(p.get("TRADATE")),
            "lib": clean(p.get("DR1LIBER")), "fol": clean(p.get("DR1FOLIO")),
            "use": clean(p.get("LU")) or use, "use_label": use,
            "commercial": use in MD_COMMERCIAL and p.get("OOI") != "H",
            "zone": clean(p.get("ZONING")), "yb": (clean(p.get("YEARBLT")) or "").lstrip("0") or None,
            "url": clean(p.get("SDATWEBADR")), "ex": None, "exc": clean(p.get("DESCEXCL")),
            "imported": None, "basis": "record",
        }


REGIONS = [  # code, label, records(), output folder for detail shards
    ("PG", "Prince George's County, MD", pg_records, SHARDS),
    ("AA", "Anne Arundel County, MD", lambda: md_records("AA"), ROOT / "data" / "out" / "AA" / "parcels"),
    ("MO", "Montgomery County, MD", lambda: md_records("MO"), ROOT / "data" / "out" / "MO" / "parcels"),
    ("CH", "Charles County, MD", lambda: md_records("CH"), ROOT / "data" / "out" / "CH" / "parcels"),
    ("HO", "Howard County, MD", lambda: md_records("HO"), ROOT / "data" / "out" / "HO" / "parcels"),
]


def main():
    import sys
    only = set(sys.argv[1:])   # e.g. "PG AA": build just these regions (owner groups then cover only these)
    BUILD.mkdir(parents=True, exist_ok=True)
    hist = json.loads(SALES_HISTORY.read_text())["sales"] if SALES_HISTORY.exists() else {}
    entities, addrs, places = [], [], {}
    shards, region_meta = {}, {}
    max_import = 0

    for code, label, records, shard_dir in REGIONS:
        raw_dir = PAGES if code == "PG" else ROOT / "data" / "raw" / code
        if (only and code not in only) or not any(raw_dir.glob("*.geojson")):
            continue
        shard_dir.mkdir(parents=True, exist_ok=True)
        for old in shard_dir.glob("*.json"):
            old.unlink()
        seen = set()
        types, n_private, n_dupe, n_nogeom = Counter(), 0, 0, 0
        tiles = BUILD / ("parcels.geojsonl" if code == "PG" else f"{code}.geojsonl")
        with open(tiles, "w") as out:
            for r in records():
                if not r["geom"]:
                    n_nogeom += 1
                    continue
                pid, name = r["pid"], r["name"]
                published = r.get("names_published", True)
                max_import = max(max_import, r.get("imported") or 0)
                # No name for this record (county publishes none, or the name table has no match): owner unknown.
                t = owner_type(name) if published and name else "u"
                # PRIVACY: a person's parcel is private unless its land use is clearly business. Where the
                # source publishes no names at all ("u"), owner and mailing address are never shown.
                private = (t == "p" and not r["commercial"]) or t == "u"

                props = {"id": pid, "t": t}
                if private and t != "u":
                    props["pv"] = 1
                out.write(json.dumps({"type": "Feature", "properties": props, "geometry": r["geom"]},
                                     separators=(",", ":")) + "\n")
                if pid in seen:
                    n_dupe += 1
                    continue
                seen.add(pid)
                types[t] += 1
                n_private += private

                c = centroid(r["geom"])
                if r["zip"]:
                    places.setdefault(("zip", r["zip"]), []).append(c)
                if r["city"]:
                    places.setdefault(("city", r["city"].title()), []).append(c)

                lib, fol = r["lib"], r["fol"]
                d = {
                    "acct": r["acct"], "t": t, "a": r["site"], "ac": r["ac"],
                    "lv": r["lv"], "iv": r["iv"], "tv": r["tv"], "sp": r["sp"], "sd": r["sd"],
                    "lu": r["use"], "lul": r["use_label"], "z": r["zone"], "yb": r["yb"], "url": r["url"],
                    "ex": r["ex"], "exc": r["exc"], "c": c,
                }
                if t == "u":
                    d["nn"] = 1
                elif private:
                    d["pv"] = 1
                else:
                    d.update({"o": name, "co": clean(r["ico"]), "ma": r["mail"],
                              "lf": f"{lib}/{fol}" if lib and fol and lib.strip("0") else None})
                    if r["basis"] != "record":
                        d["ob"] = r["basis"]
                    if name and name != "UNKNOWN":
                        entities.append({
                            "id": pid, "name": name, "t": t, "c": c, "mail": d["ma"],
                            "akey": address_key(r["mail_street"], r["ico"], r["mail_zip"]),
                            "coe": careof_entity(r["ico"]), "ac": r["ac"], "tv": r["tv"],
                        })
                if d.get("a") and (not private or (t == "u" and r["commercial"])):
                    addrs.append([d["a"], pid])
                lf_raw = f"{lib.lstrip('0')}/{fol.lstrip('0') or '0'}" if lib and fol and lib.strip("0") else None
                sh = sale_history(hist, pid, d.get("sd"), d.get("sp"), lf_raw, private)
                if len(sh) > 1 or (sh and sh[0]["d"] != d.get("sd")):
                    d["sh"] = sh
                d = {k: v for k, v in d.items() if v not in (None, "", 0) or k in ("lv", "iv", "tv")}
                shards.setdefault((code, pid[-3:].rjust(3, "0")), {})[pid] = d
        region_meta[code] = {"name": label, "parcels": len(seen), "private": n_private, "by_type": dict(types)}
        print(f"{code}: {len(seen):,} parcels, {n_private:,} private, types {dict(types)}, "
              f"dupes {n_dupe}, no geometry {n_nogeom}", flush=True)

    pid_gid, groups = build_groups(entities)
    for pid, gid in pid_gid.items():
        code = pid.split("_")[0] if "_" in pid else "PG"
        shards[(code, pid[-3:].rjust(3, "0"))][pid]["g"] = gid

    dirs = {code: shard_dir for code, _, _, shard_dir in REGIONS}
    for (code, key), recs in shards.items():
        (dirs[code] / f"{key}.json").write_text(json.dumps(recs, separators=(",", ":")))

    search = {
        # index in this list == the "g" id stored on each parcel detail record
        "groups": [{
            "l": g["label"], "ls": g["label_src"], "t": g["t"], "ac": g["ac"], "tv": g["tv"],
            "b": bbox(g["pts"]), "ids": g["ids"], "pts": [round(v, 4) for pt in g["pts"] for v in pt],
            "m": g["members"], "ev": g["evidence"], **({"al": g["alias"]} if "alias" in g else {}),
        } for g in groups],
        "addrs": addrs,
        # [label, kind, parcel count, bbox]  (trim 2% outliers: stray geocodes)
        "places": sorted(([label, kind, len(pts), bbox(pts, 0.02)]
                          for (kind, label), pts in places.items() if len(pts) >= 20),
                         key=lambda r: -r[2]),
    }
    (WEB_DATA / "search.json").write_text(json.dumps(search, separators=(",", ":")))
    print(f"search: {len(search['groups'])} owner groups, {len(addrs)} addresses, {len(search['places'])} places")

    as_of = datetime.fromtimestamp(max_import / 1000, tz=timezone.utc) if max_import else None
    pg = region_meta.get("PG", {})
    meta = {
        "as_of": as_of.strftime("%Y-%m-%d") if as_of else None,
        "as_of_label": as_of.strftime("%b %Y") if as_of else None,
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "parcels": pg.get("parcels"), "private": pg.get("private"), "by_type": pg.get("by_type"),
        "regions": region_meta,
        "source": {
            "label": "Prince George's County DPIE, Property Flattened (parcel shapes + SDAT)",
            "url": "https://gis.princegeorgescountymd.gov/arcgis/rest/services/DPIE/SERVICES4PLS/MapServer/19",
        },
    }
    (WEB_DATA / "meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(region_meta, indent=2))


if __name__ == "__main__":
    main()
