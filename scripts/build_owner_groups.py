#!/usr/bin/env python3
"""Owner groups: link entity owners that are probably the same party (HANDOFF.md section 2).

Imported by build_parcels.py. Only ENTITY parcels are passed in: private (individually
owned) parcels never take part in grouping.

Links (union-find, so links chain: A~B and B~C puts A, B, C in one group):
  name     identical normalized owner name
  address  identical mailing address, down to suite/floor (corporate + institutional only)
  care-of  identical care-of entity name, e.g. "C/O LERNER ENTERPRISES LLC" (corporate + institutional only)

Guards against false merges:
  - PO boxes, blank streets and known registered-agent / tax-service names never link.
  - An address or care-of shared by more than HUB_LIMIT distinct owner names is treated as a
    service hub (manager, agent, tax firm) and does not link.
  - HOAs, churches and government link by exact name only. Their shared addresses are usually
    management companies or diocesan offices, which are not owners.

Every group carries the evidence that formed it, so the UI can say WHY entities are grouped.
Labels: data/owner_aliases.json (hand-written, must cite sources) > most common care-of entity
> the owner name with the most parcels.
"""
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ALIASES = ROOT / "data" / "owner_aliases.json"

HUB_LIMIT = 40
LINKABLE_TYPES = {"c", "i"}
SERVICE_WORDS = [
    "CORPORATION TRUST", "CT CORP", "CSC ", "REGISTERED AGENT", "ALTUS", "RYAN LLC", "DUCHARME",
    "MARVIN F POER", "POPP", "TAX ", "TAXES", " TAX", "ASSESSMENT", "PROPERTY ACQ", "RIGHT OF WAY",
    "KROLL", "PARAGON", "CORELOGIC", "LERETA", "ESCROW", "ATTN",
]

UNIT_RE = re.compile(r"\b(?:SUITE|STE|UNIT|RM|ROOM|#)\s*([A-Z0-9-]+)|\b(\d+)(?:ST|ND|RD|TH)?\s*(?:FLR|FLOOR|FL)\b|\b(?:FLR|FLOOR|FL)\s*(\d+)")
ABBR = [(r"\bSTREET\b", "ST"), (r"\bAVENUE\b", "AVE"), (r"\bROAD\b", "RD"), (r"\bBOULEVARD\b", "BLVD"),
        (r"\bDRIVE\b", "DR"), (r"\bLANE\b", "LN"), (r"\bPARKWAY\b", "PKWY"), (r"\bPKW\b", "PKWY"),
        (r"\bCOURT\b", "CT"), (r"\bPLACE\b", "PL"), (r"\bHIGHWAY\b", "HWY"), (r"\bCIRCLE\b", "CIR"),
        (r"\bTERRACE\b", "TER"), (r"\bNORTH\b", "N"), (r"\bSOUTH\b", "S"), (r"\bEAST\b", "E"), (r"\bWEST\b", "W")]
ENTITY_SUFFIX = re.compile(r"\b(LLC|L L C|INC|CORP|CORPORATION|CO|COMPANY|LP|LLP|LTD|PARTNERSHIP|ENTERPRISES|GROUP|"
                           r"HOLDINGS|PROPERTIES|ASSOCIATES|REALTY|TRUST|MANAGEMENT|DEVELOPMENT|PARTNERS)\b")


def _norm(s):
    s = (s or "").upper().replace("&", " AND ")
    s = re.sub(r"[^A-Z0-9# ]+", " ", s)
    return " ".join(s.split())


def is_service(s):
    s = " " + _norm(s) + " "
    return any(w in s for w in SERVICE_WORDS)


def unit_of(*parts):
    for p in parts:
        m = UNIT_RE.search(_norm(p))
        if m:
            return next(g for g in m.groups() if g).lstrip("0") or "0"
    return ""


def street_of(s):
    s = _norm(s)
    s = UNIT_RE.sub(" ", s)
    for a, b in ABBR:
        s = re.sub(a, b, s)
    return " ".join(s.split())


def address_key(mail_street, ico, zip5):
    """'2000 TOWER OAKS BLVD|8|20852', or None when the address can't safely link."""
    street = street_of(mail_street)
    if not street or not re.match(r"^\d", street) or street.startswith(("PO BOX", "P O BOX")):
        return None
    if is_service(ico) or is_service(mail_street):
        return None
    return f"{street}|{unit_of(mail_street, ico)}|{(zip5 or '').strip()}"


def careof_entity(ico):
    """'LERNER ENTERPRISES LLC 8TH FLR' -> 'LERNER ENTERPRISES LLC'; None if not an entity name."""
    s = _norm(ico)
    s = re.sub(r"^(C O|CO)\b\s*", "", s)
    s = UNIT_RE.sub(" ", s)
    s = " ".join(s.split())
    if (not s or re.match(r"^\d", s) or is_service(s) or not ENTITY_SUFFIX.search(s)
            or len(s.split()) < 2 or len(s) < 6):
        return None
    return s


def name_key(name):
    s = _norm(name)
    s = re.sub(r"\bL L C\b", "LLC", s)
    s = re.sub(r"\b(THE)\b", "", s)
    s = re.sub(r"\((TX|RE|LEASED)\)", "", s)
    return " ".join(s.split())


class DSU:
    def __init__(self, n):
        self.p = list(range(n))

    def find(self, a):
        while self.p[a] != a:
            self.p[a] = self.p[self.p[a]]
            a = self.p[a]
        return a

    def union(self, a, b):
        a, b = self.find(a), self.find(b)
        if a != b:
            self.p[max(a, b)] = min(a, b)


def load_aliases():
    if not ALIASES.exists():
        return []
    rows = json.loads(ALIASES.read_text())
    for r in rows:
        if not r.get("sources"):
            raise ValueError(f"owner_aliases.json: alias {r.get('label')!r} has no sources (every alias must cite one)")
    return rows


def build_groups(recs):
    """recs: list of dicts with id, name, t, mail (display), akey, coe, ac, tv, c.
    Returns (pid -> gid, groups list)."""
    n = len(recs)
    dsu = DSU(n)
    by_name, by_addr, by_coe = defaultdict(list), defaultdict(list), defaultdict(list)
    for i, r in enumerate(recs):
        by_name[name_key(r["name"])].append(i)
        if r["t"] in LINKABLE_TYPES:
            if r["akey"]:
                by_addr[r["akey"]].append(i)
            if r["coe"]:
                by_coe[r["coe"]].append(i)

    for idx in by_name.values():
        for j in idx[1:]:
            dsu.union(idx[0], j)

    hubs = Counter()
    for kind, table in (("address", by_addr), ("care-of", by_coe)):
        for key, idx in table.items():
            names = {name_key(recs[i]["name"]) for i in idx}
            if len(names) < 2:
                continue
            if len(names) > HUB_LIMIT:
                hubs[kind] += 1
                continue
            for j in idx[1:]:
                dsu.union(idx[0], j)

    # Hand-researched aliases may also MERGE entities the mailing data misses (typos, different
    # offices). Each alias lists owner names in "match"; all of them join one group.
    aliases = load_aliases()
    for a in aliases:
        keys = {name_key(m) for m in a.get("match", [])}
        idx = [i for k in keys for i in by_name.get(k, [])]
        for j in idx[1:]:
            dsu.union(idx[0], j)

    members = defaultdict(list)
    for i in range(n):
        members[dsu.find(i)].append(i)

    alias_by_name = {name_key(m): a for a in aliases for m in a.get("match", [])}

    groups, pid_gid = [], {}
    # Largest groups first so ids are roughly meaningful; ids are only stable within one build.
    for root, idx in sorted(members.items(), key=lambda kv: -sum(recs[i]["ac"] or 0 for i in kv[1])):
        gid = len(groups)
        rs = [recs[i] for i in idx]
        names = Counter(r["name"] for r in rs)
        coes = Counter(r["coe"] for r in rs if r["coe"])
        alias = next((alias_by_name[name_key(nm)] for nm in names if name_key(nm) in alias_by_name), None)
        if alias:
            label, label_src = alias["label"], "alias"
        elif len(names) > 1 and coes:
            label, label_src = coes.most_common(1)[0][0], "care-of"
        else:
            label, label_src = names.most_common(1)[0][0], "owner"

        evidence = []
        if len(names) > 1:
            akeys = Counter(r["akey"] for r in rs if r["akey"] and r["t"] in LINKABLE_TYPES)
            for k, cnt in akeys.most_common(3):
                if cnt > 1:
                    disp = next(r["mail"] for r in rs if r["akey"] == k)
                    evidence.append(["address", disp, cnt])
            for k, cnt in coes.most_common(3):
                if cnt > 1:
                    evidence.append(["care-of", k, cnt])
        types = Counter(r["t"] for r in rs)
        g = {
            "gid": gid, "label": label, "label_src": label_src, "t": types.most_common(1)[0][0],
            "ids": [r["id"] for r in rs], "pts": [r["c"] for r in rs],
            "ac": round(sum(r["ac"] or 0 for r in rs), 2), "tv": sum(r["tv"] or 0 for r in rs),
            "members": [[nm, cnt] for nm, cnt in names.most_common()],
            "evidence": evidence,
        }
        if alias:
            g["alias"] = {k: alias[k] for k in ("sources", "wealth_web", "note") if k in alias}
        groups.append(g)
        for r in rs:
            pid_gid[r["id"]] = gid

    multi = [g for g in groups if len(g["members"]) > 1]
    print(f"owner groups: {len(groups)} groups, {len(multi)} with 2+ entity names; "
          f"hubs skipped: {dict(hubs)}")
    return pid_gid, groups
