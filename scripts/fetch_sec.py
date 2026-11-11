#!/usr/bin/env python3
"""Link owner groups to SEC-registered public companies and pull their credit and equity facts.

    python3 scripts/fetch_sec.py          run after build_parcels.py (owner-group ids change with each build)

Writes web/data/companies.json:
  {"built": date, "co": {cik: {name, ticker, exchange, shares, shares_date, float, float_date,
                               debt, debt_current, debt_date, interest, interest_period, rate, links}},
   "g": {group id: cik}}

Sources (all free, official): SEC company_tickers_exchange.json and XBRL companyfacts.
SEC fair-access rules: a User-Agent with a contact email (read from the gitignored .sec_contact file,
never committed), at most 10 requests/second. This script makes at most ONE request per second,
caches every response in data/raw/sec/ (gitignored) so reruns fetch nothing twice, and stops at the
first 403/429 instead of retrying. Links are matched by exact normalized name; data/owner_aliases.json
entries with a "cik" add researched links (subsidiaries), each with a source.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "raw" / "sec"
OUT = ROOT / "web" / "data" / "companies.json"
DELAY_S = 1.1
_last = [0.0]


def agent():
    f = ROOT / ".sec_contact"
    if not f.exists():
        sys.exit("Put a contact email in .sec_contact (gitignored); the SEC requires one in the User-Agent.")
    return "Real Estate Map research " + f.read_text().strip()


def get(url, cache_name, max_age_days=None):
    path = CACHE / cache_name
    if path.exists() and (max_age_days is None or time.time() - path.stat().st_mtime < max_age_days * 86400):
        return json.loads(path.read_text())
    wait = DELAY_S - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": agent(), "Accept-Encoding": "identity"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            sys.exit(f"SEC refused ({e.code}) at {url}. Stopping without retrying; try again later.")
        if e.code == 404 or e.code >= 500:   # missing, or the search choked on this name: skip it, don't retry
            return None
        raise
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return json.loads(body)


SUB_LOOKUPS = 300   # largest unlinked company owners to look up as possible subsidiaries (one request each)


def ex21_parent(name):
    """The one SEC registrant whose recent Exhibit 21 lists this exact name, or None."""
    import hashlib, urllib.parse
    phrase = re.sub(r"\s+", " ", name.replace(";", " ")).strip()
    if len(key(phrase).split()) < 2:            # too generic to search safely
        return None
    # Institution names repeat across states ("Alexandria Hospital" in Louisiana); only link those with a legal suffix.
    if re.search(r"\b(HOSPITAL|MEDICAL|SCHOOL|COLLEGE|UNIVERSITY|CHURCH|ASSOCIATION|ASSN|FOUNDATION|CLUB)\b", phrase.upper()) \
            and not re.search(r"\b(LLC|L L C|INC|CORP|LP|L P|LLP|LTD|TRUST)\b", phrase.upper()):
        return None
    q = urllib.parse.quote(f'"{phrase}"')
    d = get(f"https://efts.sec.gov/LATEST/search-index?q={q}&startdt=2022-01-01&enddt=2030-12-31",
            "fts/" + hashlib.sha1(phrase.encode()).hexdigest()[:16] + ".json", max_age_days=90)
    hits = [h for h in ((d or {}).get("hits") or {}).get("hits", [])
            if str(h["_source"].get("file_type", "")).startswith("EX-21") and h["_source"].get("file_date", "") >= "2022"]
    parents = {}
    for h in hits:
        src = h["_source"]
        cik = (src.get("ciks") or [None])[0]
        if cik:
            parents.setdefault(cik, h)
    if len(parents) != 1:
        return None
    cik, h = next(iter(parents.items()))
    src = h["_source"]
    accn, fname = h["_id"].split(":", 1)
    url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accn.replace('-', '')}/{fname}"
    # Search matches phrases inside longer names ("CC Owner LLC" in "XYZ CC Owner LLC"). Open the exhibit
    # and require the owner name as a complete entry.
    body = get_text(url, "ex21/" + accn + "_" + re.sub(r"[^A-Za-z0-9._-]", "_", fname))
    want = key(phrase)
    import html
    parts = re.split(r"<[^>]+>|\n|\r|\t|  +", html.unescape(body or "").replace("\xa0", " "))
    # entries often end with the state in parentheses or a footnote mark: "CVS Pharmacy, Inc. (Rhode Island)"
    entries = {key(re.sub(r"(\s*\([^)]*\)|\s*\*+|\s*\d+)$", "", x.strip())) for x in parts if x.strip()}
    if want not in entries:
        return None
    disp = (src.get("display_names") or ["?"])[0]
    m = re.search(r"\(([A-Z.]+)(?:,[^)]*)?\)\s*\(CIK", disp)
    return {"cik": cik.zfill(10), "parent": re.sub(r"\s*\(.*$", "", disp).strip(), "ticker": m.group(1) if m else None,
            "date": src.get("file_date"), "url": url}


def get_text(url, cache_name):
    path = CACHE / cache_name
    if path.exists():
        return path.read_text(errors="replace")
    wait = DELAY_S - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": agent()}), timeout=60) as r:
            body = r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            sys.exit(f"SEC refused ({e.code}) at {url}. Stopping without retrying; try again later.")
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)
    return body


DROP = {"INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "LLC", "L", "C", "LP", "LTD", "LIMITED",
        "PLC", "THE", "NV", "SA", "AG", "DE", "MD", "VA", "DC", "NEW"}


def key(name):
    s = (name or "").upper().replace("&", " AND ")
    s = re.sub(r"/[A-Z]{2,3}/?", " ", s)            # SEC state tags like "/DE/"
    toks = [t for t in re.sub(r"[^A-Z0-9]+", " ", s).split() if t not in DROP]
    return " ".join(toks)


def total_debt(facts):
    """Total debt at the latest reporting date: the largest of the debt concepts reported on that date
    (companies tag debt differently; the total is the biggest line on the balance sheet date)."""
    names = ["LongTermDebt", "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",
             "DebtLongtermAndShorttermCombinedAmount", "LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations",
             "SeniorNotes", "UnsecuredDebt", "SecuredDebt", "NotesPayable", "SeniorLongTermNotes", "DebtInstrumentCarryingAmount",
             "LongTermDebtFairValue"]
    rows = []
    for n in names:
        for r in ((facts.get("us-gaap") or {}).get(n) or {}).get("units", {}).get("USD", []):
            if r.get("form") in ("10-K", "10-Q", "10-K/A", "10-Q/A") and not r.get("start"):
                rows.append((r["end"], r["val"], r.get("form"), n))
    if not rows:
        return None
    end = max(r[0] for r in rows)
    best = max((r for r in rows if r[0] == end and r[3] != "LongTermDebtFairValue"), key=lambda r: r[1], default=None)
    return (best[1], best[0], best[2], best[3]) if best else None


def latest(facts, ns, names, unit, forms=("10-K", "10-Q", "10-K/A", "10-Q/A"), annual=False):
    """Most recent value across candidate concepts: (value, end date, form, accession)."""
    best = None
    for n in names:
        for row in ((facts.get(ns) or {}).get(n) or {}).get("units", {}).get(unit, []):
            if row.get("form") not in forms:
                continue
            if annual and (row.get("fp") != "FY" or not row.get("start")):
                continue
            if annual and (datetime.fromisoformat(row["end"]) - datetime.fromisoformat(row["start"])).days < 300:
                continue
            if best is None or row["end"] > best[1] or (row["end"] == best[1] and row.get("filed", "") > best[4]):
                best = (row["val"], row["end"], row.get("form"), row.get("accn"), row.get("filed", ""))
    return best


def main():
    tick = get("https://www.sec.gov/files/company_tickers_exchange.json", "company_tickers_exchange.json", max_age_days=7)
    fields = tick["fields"]
    rows_all = [dict(zip(fields, row)) for row in tick["data"]]
    # One ticker per company: prefer common stock ("COST") over preferred/units ("FRT-PC", "MER-PK").
    best_ticker = {}
    for r in rows_all:
        cik, t = str(r["cik"]).zfill(10), r["ticker"] or ""
        score = ("-" in t or "." in t, len(t))
        if cik not in best_ticker or score < best_ticker[cik][0]:
            best_ticker[cik] = (score, r)
    by_key = {}
    for r in rows_all:
        k = key(r["name"])
        if k and (len(k.split()) >= 2 or len(k) >= 7):   # skip short one-word names: too easy to mismatch
            by_key.setdefault(k, best_ticker[str(r["cik"]).zfill(10)][1])

    search = json.loads((ROOT / "web" / "data" / "search.json").read_text())
    aliases = json.loads((ROOT / "data" / "owner_aliases.json").read_text()) if (ROOT / "data" / "owner_aliases.json").exists() else []
    alias_cik = {}
    for a in aliases:
        if a.get("cik"):
            for m in a.get("match", []):
                alias_cik[key(m)] = (str(a["cik"]).zfill(10), a.get("sources", []))

    g2cik, how = {}, {}
    for gid, row in enumerate(search["groups"]):
        label, t, members, n = row[0], row[1], row[6] or [[row[0], row[5]]], row[5] or 1
        if t not in ("c", "i"):
            continue
        # Link through the label, or through a member that holds at least half the group's parcels
        # (a bank holding a few foreclosures as trustee must not label a whole group).
        # A label taken from a care-of name ("C/O CVS PHARMACY") names a tenant or agent, not an owner: skip it.
        cands = ([label] if row[7] != "care-of" else []) + [nm for nm, c in members if nm != label and c * 2 >= n]
        for nm in cands:
            k = key(nm)
            if k in alias_cik:
                g2cik[gid], how[gid] = alias_cik[k][0], {"via": nm, "sources": alias_cik[k][1]}
                break
            if k in by_key:
                g2cik[gid], how[gid] = str(by_key[k]["cik"]).zfill(10), {"via": nm}
                break

    # Subsidiaries: look the largest unlinked company owners up in SEC full-text search, Exhibit 21
    # (subsidiary lists in annual reports) filed since 2022. Link only when exactly one parent lists the name.
    sub_ticker = {}
    ranked = sorted(((row[3] or 0, gid, row) for gid, row in enumerate(search["groups"])
                     if row[1] in ("c", "i") and gid not in g2cik), reverse=True)[:SUB_LOOKUPS]
    for _, gid, row in ranked:
        members, n = row[6] or [[row[0], row[5]]], row[5] or 1
        names = ([row[0]] if row[7] != "care-of" else []) + [nm for nm, c in members if nm != row[0] and c * 2 >= n]
        for nm in names[:2]:
            hit = ex21_parent(nm)
            if hit:
                g2cik[gid] = hit["cik"]
                if hit.get("ticker"):
                    sub_ticker[hit["cik"]] = hit["ticker"]
                how[gid] = {"via": nm, "sources": [{"label": f"Listed as a subsidiary in {hit['parent']}'s annual report, Exhibit 21 ({hit['date']})",
                                                    "url": hit["url"]}]}
                break
    ciks = sorted(set(g2cik.values()))
    print(f"{len(g2cik)} owner groups linked to {len(ciks)} public companies", flush=True)
    names = {cik: r for cik, (_, r) in best_ticker.items()}
    co, shard_cache = {}, {}
    for i, cik in enumerate(ciks):
        f = get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json", f"facts/{cik}.json", max_age_days=30)
        if not f:
            continue
        facts = f.get("facts", {})
        shares = latest(facts, "dei", ["EntityCommonStockSharesOutstanding"], "shares")
        flt = latest(facts, "dei", ["EntityPublicFloat"], "USD")
        debt = total_debt(facts)
        cutoff = (datetime.now(timezone.utc).replace(tzinfo=None) - __import__("datetime").timedelta(days=548)).strftime("%Y-%m-%d")
        if debt and debt[1] < cutoff:      # the company stopped using these tags: an old figure would mislead
            debt = None
        cur = latest(facts, "us-gaap", ["LongTermDebtCurrent", "DebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"], "USD")
        intr = latest(facts, "us-gaap", ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt",
                                         "InterestPaidNet"], "USD", annual=True)
        r = names.get(cik, {})
        c = {"name": r.get("name") or f.get("entityName"), "ticker": r.get("ticker") or sub_ticker.get(cik),
             "exchange": r.get("exchange")}
        if shares:
            c.update(shares=shares[0], shares_date=shares[1])
        if flt:
            c.update(float=flt[0], float_date=flt[1])
        if debt:
            c.update(debt=debt[0], debt_date=debt[1], debt_form=debt[2], debt_concept=debt[3])
        if cur and debt and cur[1] == debt[1]:
            c["debt_current"] = cur[0]
        if intr:
            c.update(interest=intr[0], interest_period=intr[1])
            if debt and debt[0]:
                rate = intr[0] / debt[0] * 100
                if 0.5 <= rate <= 12:          # outside this range the two figures don't describe the same debt
                    c["rate"] = round(rate, 2)
        c["links"] = {"filings": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=10-K",
                      "facts": f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"}
        co[cik] = c
        if (i + 1) % 25 == 0:
            print(f"  {i + 1}/{len(ciks)} companies", flush=True)

    # Exactly which parcels each link covers: the group's parcels whose OWN owner name is the linked name
    # (a group can also hold unrelated entities that share a manager's address).
    pids = {}
    for g, cik in g2cik.items():
        if cik not in co:
            continue
        chunk = json.loads((ROOT / "web" / "data" / "groups" / f"{g // 100:03d}.json").read_text())[str(g)]
        want, keep = key(how[g]["via"]), []
        for pid in chunk[0]:
            region = pid.split("_")[0] if "_" in pid else None
            shard = (ROOT / "web" / "data" / "parcels" / f"{pid[-3:].rjust(3, '0')}.json") if region is None \
                else (ROOT / "data" / "out" / region / "parcels" / f"{pid[-3:].rjust(3, '0')}.json")
            rec = shard_cache.setdefault(shard, json.loads(shard.read_text())).get(pid, {})
            if any(key(n) == want for n in (rec.get("o") or "").split(";")):
                keep.append(pid)
        pids[g] = keep
    out = {"built": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "co": co,
           "ids": {str(g): v for g, v in pids.items() if v},
           "g": {str(g): c for g, c in g2cik.items() if c in co},
           "via": {str(g): h for g, h in how.items() if g2cik[g] in co}}
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT.relative_to(ROOT)}: {len(co)} companies, {len(out['g'])} groups")


if __name__ == "__main__":
    main()
