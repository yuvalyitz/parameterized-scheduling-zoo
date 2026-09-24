#!/usr/bin/env python3
"""Find a DOI for every cited paper that the bibliography gives no URL for.

Most entries in schedulingzoo's .bib files carry no DOI or URL (259 of 303
cited papers at the time of writing), so the panel could not link them.
This asks Crossref for each one by title and author and keeps a match only
when the title agrees almost verbatim and the year agrees within one -- a
wrong link is worse than none. Matches go to data/doi_cache.json, keyed by
bibkey, and the converter (convert_for_pzoo.py) reads that file to fill in
the `url` of every citation; this script also patches the current
data/schedulingzoo.json in place so a regeneration is not needed.

Entries Crossref cannot match are recorded with "doi": null so they are not
asked again; pass --retry to ask about them once more.

    python3 scripts/resolve_dois.py            # resolve what is missing
    python3 scripts/resolve_dois.py --retry    # also the earlier misses
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "schedulingzoo.json"
CACHE = ROOT / "data" / "doi_cache.json"
AGENT = "parameterized-scheduling-zoo/0.1 (https://github.com/yuvalyitz/parameterized-scheduling-zoo; mailto:yuvalyitz@gmail.com)"


def norm_title(t):
    t = re.sub(r"<[^>]+>", "", t or "")
    t = t.lower().replace("&", "and")
    t = re.sub(r"[^a-z0-9]+", " ", t)
    return t.strip()


def surnames(author):
    out = []
    for a in re.split(r"\s+and\s+", author or ""):
        a = a.strip()
        if not a:
            continue
        out.append((a.split(",")[0] if "," in a else a.split()[-1]).strip().lower())
    return out


def title_close(a, b):
    a, b = norm_title(a), norm_title(b)
    if not a or not b:
        return False
    if a == b or a in b or b in a:
        return True
    ta, tb = set(a.split()), set(b.split())
    return len(ta & tb) / len(ta | tb) >= 0.85


def crossref(title, author, year):
    q = {
        "query.bibliographic": title,
        "rows": "4",
        "select": "DOI,title,author,issued",
    }
    names = surnames(author)
    if names:
        q["query.author"] = " ".join(names)
    url = "https://api.crossref.org/works?" + urllib.parse.urlencode(q)
    req = urllib.request.Request(url, headers={"User-Agent": AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        items = json.load(resp)["message"]["items"]
    for it in items:
        it_title = " ".join(it.get("title") or [])
        if not title_close(title, it_title):
            continue
        parts = (it.get("issued") or {}).get("date-parts") or [[None]]
        it_year = parts[0][0] if parts and parts[0] else None
        try:
            y = int(str(year)[:4])
        except ValueError:
            y = None
        if it_year and y and abs(it_year - y) > 1:
            continue
        fam = {(a.get("family") or "").lower() for a in it.get("author") or []}
        if names and fam and not any(n in fam for n in names):
            continue
        return {"doi": it["DOI"], "title": it_title, "year": it_year}
    return None


def main():
    retry = "--retry" in sys.argv
    data = json.loads(DATA.read_text())
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    cited = {}
    for n in data["nodes"]:
        for r in n.get("classical", []) + n.get("params", []):
            if not r.get("url"):
                cited.setdefault(r["bibkey"], r)
    todo = [k for k in cited if k not in cache or (retry and not cache[k].get("doi"))]
    print(f"{len(cited)} cited papers without a URL, {len(todo)} to look up", file=sys.stderr)
    for i, key in enumerate(todo, 1):
        r = cited[key]
        try:
            hit = crossref(r.get("title") or "", r.get("author") or "", r.get("year") or "")
        except Exception as e:  # network hiccup: leave it for a retry
            print(f"  {key}: error {e}", file=sys.stderr)
            continue
        cache[key] = hit or {"doi": None}
        print(f"  [{i}/{len(todo)}] {key}: {hit['doi'] if hit else '-'}", file=sys.stderr)
        CACHE.write_text(json.dumps(cache, indent=1, ensure_ascii=False, sort_keys=True) + "\n")
        time.sleep(0.25)
    # Patch the current data file in place.
    filled = 0
    for n in data["nodes"]:
        for r in n.get("classical", []) + n.get("params", []) + n.get("inheritedParams", []) + n.get("inheritedApprox", []):
            if not r.get("url") and (cache.get(r["bibkey"]) or {}).get("doi"):
                r["url"] = "https://doi.org/" + cache[r["bibkey"]]["doi"]
                filled += 1
    DATA.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    found = sum(1 for v in cache.values() if v.get("doi"))
    print(f"{found}/{len(cache)} papers resolved; {filled} citations linked", file=sys.stderr)


if __name__ == "__main__":
    main()
