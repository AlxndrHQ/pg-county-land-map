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
    "ANNE ARUNDEL COUNTY", "ANNE ARUNDEL CO", "HOWARD COUNTY",
    "COMMONWEALTH OF VIRGINIA", "COMMONWEALTH OF VA", "VIRGINIA DEPARTMENT", "VIRGINIA DEPT", "ARLINGTON COUNTY",
    "COUNTY BOARD OF ARLINGTON", "FAIRFAX COUNTY", "BOARD OF SUPERVISORS", "PRINCE WILLIAM COUNTY", "PRINCE WILLIAM BOARD",
    "LOUDOUN COUNTY", "FAUQUIER COUNTY", "NORTHERN VIRGINIA REGIONAL", "NOVA PARKS", "PARK AUTHORITY", "SCHOOL BOARD",
    "DC GOVERNMENT", "D C GOVERNMENT", "EMBASSY", "GOVERNMENT OF", "INTERNATIONAL MONETARY FUND", "WORLD BANK", "DISTRICT OF COLUMBIA HOUSING", "ARCHITECT OF THE CAPITOL", "MONTGOMERY COUNTY", "MONTGOMERY CO MD", "CHARLES COUNTY",
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


def ms_date(v):
    """Epoch milliseconds or 'YYYY-MM-DD...' -> 'YYYY-MM-DD'."""
    if v in (None, "", 0):
        return None
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
    v = str(v).strip()
    return v[:10] if len(v) >= 10 and v[4] == "-" else None


def num(v):
    try:
        x = float(str(v).replace(",", "").strip())
        return int(x) if x.is_integer() else x
    except (TypeError, ValueError):
        return None


def join_addr(*parts):
    return " ".join(str(x) for x in (clean(p) for p in parts) if x not in (None, "")) or None


def dc_records():
    for f in raw_features("DC"):
        p = f["properties"]
        ssl = clean(p.get("SSL"))
        if not ssl:
            continue
        ptype = clean(p.get("PROPTYPE")) or ""
        n1, n2 = clean(p.get("OWNERNAME")), clean(p.get("OWNNAME2"))
        csz = clean(p.get("CITYSTZIP"))
        mail = " · ".join(x for x in [join_addr(p.get("ADDRESS1"), p.get("ADDRESS2")), csz] if x) or None
        site = clean(p.get("PREMISEADD"))
        zip5 = site[-5:] if site and site[-5:].isdigit() else None
        yield {
            "pid": "DC_" + ssl.replace(" ", "-"), "geom": f.get("geometry"),
            "name": (n1 + (f"; {n2}" if n2 else "")) if n1 else None,
            "ico": p.get("CAREOFNAME"), "mail_street": p.get("ADDRESS1"), "mail_zip": (csz or "")[-10:-5] or None,
            "mail": mail, "site": site, "city": "Washington", "zip": zip5, "acct": ssl,
            "ac": round(p["LANDAREA"] / 43560, 3) if p.get("LANDAREA") else None,
            "lv": p.get("NEWLAND"), "iv": p.get("NEWIMPR"), "tv": p.get("NEWTOTAL"),
            "sp": p.get("SALEPRICE") or None, "sd": ms_date(p.get("SALEDATE")), "lib": None, "fol": None,
            "deed": clean(p.get("INSTNO")),
            "use": clean(p.get("USECODE")), "use_label": ptype or None,
            "commercial": clean(p.get("CLASSTYPE")) == "2" and not ptype.startswith(("Residential", "Vacant"))
                          and not clean(p.get("HSTDCODE")),
            "zone": None, "yb": None, "url": None, "ex": None, "exc": None,
            "imported": p.get("EXTRACTDAT"), "basis": "record",
        }


# Business land uses only: a person's name is shown nowhere else (farms, apartments, vacant and unclear uses stay private).
AL_BUSINESS = ("COMMERC", "COM AREA", "OFFICE", "WHSE", "WAREHOUSE", "RESTAURANT", "FAST FOOD", "HOTEL", "SHOPPING",
               "SERVICE STATION", "FINANCIAL", "AUTO ", "STORAGE", "CONVENIENCE", "REPAIR", "INDUST", "GAS KIOSK", "RETAIL",
               "NURSING HOME")


def al_records():
    vals = {r["ACCOUNTNO"]: r for r in (f["properties"] for f in raw_features("AL_values")) if r.get("ACCOUNTNO")}
    for f in raw_features("AL"):
        p = f["properties"]
        acct = clean(p.get("ACCOUNTNO"))
        if not acct:
            continue
        v = vals.get(acct, {})
        desc = clean(p.get("LANDDESC")) or ""
        n1, n2 = clean(p.get("OWN_NAME")), clean(p.get("OWNERNAME2"))
        city = join_addr(clean(p.get("OWN_CITY")) and clean(p.get("OWN_CITY")) + ",", p.get("OWN_STAT"), p.get("OWN_ZIP"))
        yield {
            "pid": "AL_" + acct, "geom": f.get("geometry"),
            "name": (n1 + (f"; {n2}" if n2 else "")) if n1 else None, "ico": None,
            "mail_street": p.get("OWN_ADD"), "mail_zip": p.get("OWN_ZIP"),
            "mail": " · ".join(x for x in [join_addr(p.get("OWN_ADD"), p.get("OWN_ADD2")), city] if x) or None,
            "site": ", ".join(x for x in [clean(p.get("ADDRESS_GIS")) + (f" #{clean(p.get('UNIT'))}" if clean(p.get("UNIT")) else "")
                                          if clean(p.get("ADDRESS_GIS")) else None, "Alexandria, VA"] if x),
            "city": "Alexandria", "zip": None, "acct": clean(p.get("PID_RE")) or acct,
            "ac": round(p["LAND_SF"] / 43560, 3) if p.get("LAND_SF") else None,
            "lv": v.get("LAND_CYR"), "iv": v.get("IMP_CYR"), "tv": v.get("TOT_CYR"),
            "sp": None, "sd": None, "lib": None, "fol": None, "deed": clean(p.get("INSTRUMENT")),
            "use": clean(p.get("LANDCODE")), "use_label": desc.title() or None,
            "commercial": any(w in desc.upper() for w in AL_BUSINESS) and "RES" not in desc.upper(),
            "zone": clean(p.get("ZONING")), "yb": None, "url": None, "ex": None, "exc": None,
            "imported": None, "basis": "record",
        }


FQ_BUSINESS = ("COMM - INDL", "COMMERCIAL", "PUBLIC SERVICE")


def fq_records():
    for f in raw_features("FQ"):
        p = f["properties"]
        pid = clean(p.get("PARCELID"))
        if not pid:
            continue
        desc = clean(p.get("Primary__1")) or ""
        n1, n2 = clean(p.get("OWNERNME1")), clean(p.get("Co_Owner2"))
        bp = clean(p.get("CURRENTOWN"))
        lib, fol = (bp.split("/", 1) + [None])[:2] if bp and "/" in bp else (None, None)
        sp = num(p.get("LASTSALEPR"))
        yield {
            "pid": "FQ_" + pid, "geom": f.get("geometry"),
            "name": (n1 + (f"; {n2}" if n2 else "")) if n1 else None, "ico": None,
            "mail_street": p.get("PSTLADDRES"), "mail_zip": p.get("PSTLZIP5"),
            "mail": " · ".join(x for x in [join_addr(p.get("PSTLADDRES"), p.get("PSTLADDR_1"), p.get("PSTLADDR_2")),
                                            join_addr(clean(p.get("PSTLCITY")) and clean(p.get("PSTLCITY")) + ",",
                                                      p.get("PSTLSTATE"), p.get("PSTLZIP5"))] if x) or None,
            "site": clean(p.get("SITEADDRES")), "city": None, "zip": None, "acct": pid,
            "ac": num(p.get("ACREAGE")), "lv": num(p.get("Land_Value")), "iv": num(p.get("Building_V")),
            "tv": num(p.get("Final_Valu")), "sp": sp or None, "sd": ms_date(p.get("LASTSALEDA")),
            "lib": lib, "fol": fol, "deed": None,
            "use": clean(p.get("Primary_Us")), "use_label": desc or None,
            "commercial": any(w in desc.upper() for w in FQ_BUSINESS) and "RES" not in desc.upper(),
            "zone": None, "yb": (clean(p.get("Year_Built")) or "").lstrip("0") or None,
            "url": None, "ex": None, "exc": None, "imported": None, "basis": "record",
        }


def pw_records():
    for f in raw_features("PW"):
        p = f["properties"]
        gpin = clean(p.get("GPIN"))
        if not gpin:
            continue
        unit = clean(p.get("UnitNumber"))
        site = join_addr(p.get("StreetNumber"), p.get("StreetName"), p.get("StreetType")) 
        if site and unit:
            site += f" #{unit}"
        city = join_addr(clean(p.get("CAMA_CITY")) and clean(p.get("CAMA_CITY")) + ",", p.get("CAMA_STATE"), p.get("CAMA_ZIPCODE"))
        yield {
            "pid": "PW_" + gpin, "geom": f.get("geometry"), "name": clean(p.get("CAMA_OWNER_CUR")), "ico": None,
            "mail_street": p.get("CAMA_ADDRESS2"), "mail_zip": p.get("CAMA_ZIPCODE"),
            "mail": " · ".join(x for x in [join_addr(p.get("CAMA_ADDRESS2"), p.get("CAMA_ADDRESS3")), city] if x) or None,
            "site": ", ".join(x for x in [site, join_addr(p.get("City"), p.get("ZipCode"))] if x) or None,
            "city": (clean(p.get("City")) or "").title() or None, "zip": clean(p.get("ZipCode")),
            "acct": clean(p.get("CAMA_Account")) or gpin,
            "ac": p.get("CAMA_TaxAcreage1") or p.get("Acreage"),
            "lv": None, "iv": None, "tv": None, "sp": None, "sd": None,
            "lib": clean(p.get("DeedBook")), "fol": clean(p.get("DeedPage")), "deed": clean(p.get("DeedInstrument")),
            "use": clean(p.get("CAMA_USECODE")), "use_label": None,
            # No public use-code table yet: treat every person-owned parcel as private (safe default).
            "commercial": False,
            "zone": None, "yb": None, "url": None, "ex": None, "exc": None, "imported": None, "basis": "record",
        }


def fx_records():
    def table(code):
        return {r["PARID"]: r for r in (f["properties"] for f in raw_features(code)) if r.get("PARID")}
    vals, use, legal = table("FX_values"), table("FX_use"), table("FX_legal")
    for f in raw_features("FX"):
        pin = clean(f["properties"].get("PIN"))
        if not pin:
            continue
        key = f["properties"]["PIN"]
        v, u, lg = vals.get(key, {}), use.get(key, {}), legal.get(key, {})
        site = join_addr(lg.get("ADRNO"), lg.get("ADRADD"), lg.get("ADRDIR"), lg.get("ADRSTR"), lg.get("ADRSUF"))
        yield {
            "pid": "FX_" + pin.replace(" ", "-"), "geom": f.get("geometry"), "name": None, "names_published": False,
            "ico": None, "mail_street": None, "mail_zip": None, "mail": None,
            "site": ", ".join(x for x in [site, join_addr(lg.get("CITYNAME"), lg.get("ZIP1"))] if x) or None,
            "city": (clean(lg.get("CITYNAME")) or "").title() or None, "zip": clean(lg.get("ZIP1")), "acct": pin,
            "ac": lg.get("ACRES"), "lv": v.get("APRLAND"), "iv": v.get("APRBLDG"), "tv": v.get("APRTOT"),
            "sp": None, "sd": None, "lib": None, "fol": None, "deed": None,
            "use": None, "use_label": clean(u.get("LUC_DESC")),
            "commercial": False, "zone": clean(u.get("ZONING_DESC")), "yb": None, "url": None,
            "ex": None, "exc": None if (v.get("FLAG4_DESC") or "").startswith("No ") else clean(v.get("FLAG4_DESC")),
            "imported": None, "basis": "record",
        }


def lo_records():
    for f in raw_features("LO"):
        p = f["properties"]
        mcpi = clean(p.get("PA_MCPI"))
        if not mcpi:
            continue
        yield {
            "pid": "LO_" + mcpi, "geom": f.get("geometry"), "name": None, "names_published": False,
            "ico": None, "mail_street": None, "mail_zip": None, "mail": None,
            "site": None, "city": None, "zip": None, "acct": mcpi, "ac": p.get("PA_LEGAL_ACRE"),
            "lv": None, "iv": None, "tv": None, "sp": None, "sd": None, "lib": None, "fol": None, "deed": None,
            "use": None, "use_label": clean(p.get("PA_SUBD_NAME")) and "Subdivision: " + clean(p.get("PA_SUBD_NAME")).title(),
            "commercial": False, "zone": None, "yb": None, "url": None, "ex": None, "exc": None,
            "imported": None, "basis": "record",
        }


def ar_rows(table):
    for f in sorted((ROOT / "data" / "raw" / f"AR_{table}").glob("*.json")):
        yield from json.loads(f.read_text())


def ar_records():
    props = {}
    for r in ar_rows("Property"):
        props.setdefault(r["realEstatePropertyCode"], r)
    vals = {r["realEstatePropertyCode"]: r for r in ar_rows("Assessment")}
    last = {}
    for r in ar_rows("SalesHistory"):
        k = r["realEstatePropertyCode"]
        if k not in last or (r.get("saleDate") or "") > (last[k].get("saleDate") or ""):
            last[k] = r
    for f in raw_features("AR"):
        code = clean(f["properties"].get("RPCMSTR"))
        if not code:
            continue
        pr, v, s = props.get(code, {}), vals.get(code, {}), last.get(code, {})
        buyer = clean(s.get("granteeName"))
        buyer = buyer.rstrip(" &") if buyer else None
        # Owner names are redacted by the county. The latest buyer stands in for the owner only when it is
        # clearly an entity (decided 2026-11-11), labeled as such; a person's name is never used.
        name = buyer if buyer and owner_type(buyer) != "p" else None
        masked = pr.get("maskOwnerAddressInd")
        city = join_addr(clean(pr.get("ownerCityName")) and clean(pr.get("ownerCityName")) + ",",
                         pr.get("ownerStateCode"), pr.get("ownerZipCode"))
        cls = clean(pr.get("propertyClassTypeDsc")) or ""
        yield {
            "pid": "AR_" + code, "geom": f.get("geometry"), "name": name,
            "names_published": True, "ico": None,
            "mail_street": None if masked else pr.get("ownerStreetText"), "mail_zip": pr.get("ownerZipCode"),
            "mail": None if masked or not name else " · ".join(x for x in [clean(pr.get("ownerStreetText")), city] if x) or None,
            "site": ", ".join(x for x in [clean(pr.get("propertyStreetNbrNameText")),
                                          join_addr(pr.get("propertyCityName"), pr.get("propertyZipCode"))] if x) or None,
            "city": "Arlington", "zip": clean(pr.get("propertyZipCode")), "acct": code,
            "ac": round(pr["lotSizeQty"] / 43560, 3) if pr.get("lotSizeQty") else None,
            "lv": v.get("landValueAmt"), "iv": v.get("improvementValueAmt"), "tv": v.get("totalValueAmt"),
            "sp": s.get("saleAmt") or None, "sd": ms_date(s.get("saleDate")),
            "lib": clean(s.get("deedBookNbr")), "fol": clean(s.get("deedPageNbr")), "deed": None,
            "use": clean(pr.get("propertyClassTypeCode")), "use_label": cls.split("-", 1)[-1] if cls else None,
            "commercial": bool(pr.get("commercialInd")),
            "zone": clean(pr.get("zoningDescListText")), "yb": pr.get("propertyYearBuilt") or None,
            "url": None, "ex": None, "exc": clean(pr.get("taxExemptionTypeDsc")),
            "imported": None, "basis": "last buyer" if name else "record",
        }


REGIONS = [  # code, label, records(), output folder for detail shards
    ("PG", "Prince George's County, MD", pg_records, SHARDS),
    ("AA", "Anne Arundel County, MD", lambda: md_records("AA"), ROOT / "data" / "out" / "AA" / "parcels"),
    ("MO", "Montgomery County, MD", lambda: md_records("MO"), ROOT / "data" / "out" / "MO" / "parcels"),
    ("CH", "Charles County, MD", lambda: md_records("CH"), ROOT / "data" / "out" / "CH" / "parcels"),
    ("HO", "Howard County, MD", lambda: md_records("HO"), ROOT / "data" / "out" / "HO" / "parcels"),
    ("DC", "Washington, DC", dc_records, ROOT / "data" / "out" / "DC" / "parcels"),
    ("AR", "Arlington County, VA", ar_records, ROOT / "data" / "out" / "AR" / "parcels"),
    ("AL", "City of Alexandria, VA", al_records, ROOT / "data" / "out" / "AL" / "parcels"),
    ("FX", "Fairfax County, VA", fx_records, ROOT / "data" / "out" / "FX" / "parcels"),
    ("PW", "Prince William County, VA", pw_records, ROOT / "data" / "out" / "PW" / "parcels"),
    ("LO", "Loudoun County, VA", lo_records, ROOT / "data" / "out" / "LO" / "parcels"),
    ("FQ", "Fauquier County, VA", fq_records, ROOT / "data" / "out" / "FQ" / "parcels"),
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
                              "lf": f"{lib}/{fol}" if lib and fol and lib.strip("0") else None,
                              "dn": r.get("deed")})
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
