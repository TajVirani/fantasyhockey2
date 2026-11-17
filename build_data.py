"""Turn one week's raw Fantrax pulls into the dashboard's data files.

Usage: python3 -I build_data.py RAW_DIR OUT_DIR TODAY(YYYY-MM-DD)   (OUT_DIR is docs/data for the site)
Writes OUT_DIR/{bids,bid_entries,team_fp,budgets}.json and prints the checks.
Needs RAW_DIR from fetch.sh, and the profile cache (cache/prof) from fetch_profiles.py.
"""
import collections, glob, json, os, re, sqlite3, sys
from datetime import date

RAW, OUT = sys.argv[1], sys.argv[2]
TODAY = date.fromisoformat(sys.argv[3])
DB = "/home/pcpmi/Projects/Traxalytics/server/database/traxalytics.db"
PROF = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", "prof")
START_BUDGET = 1000
MON = {m: i for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(), 1)}


def first(pattern):
    fs = glob.glob(pattern)
    assert fs, f"missing {pattern}"
    return json.load(open(fs[0]))["responses"][0]


def tx_date(s):  # "Mon Oct 26, 2026, 12:00PM"
    m = re.match(r"\w+ (\w+) (\d+), (\d+)", s)
    return date(int(m[3]), MON[m[1]], int(m[2]))


# ---- scoring periods and weekly team points
periods, team_fp = [], []
for t in first(f"{RAW}/sched/*.json")["data"]["tableList"]:
    m = re.findall(r"\w+ (\w+) (\d+), (\d+)", t.get("subCaption", ""))
    if len(m) != 2:
        continue
    ws, we = (date(int(y), MON[mo], int(d)) for mo, d, y in m)
    periods.append((ws, we))
    rows = []
    for r in t["rows"]:
        c = r["cells"]
        for i in (0, 2):
            name, v = c[i]["content"], c[i + 1].get("content", "")
            if "League Average" not in name and v not in ("", None):
                rows.append(dict(key=f"{ws}|{name}", week_start=str(ws), week_end=str(we), team=name, fp=float(v)))
    if any(r["fp"] for r in rows):
        team_fp += rows
periods.sort()


def period_for(d):
    return next((s, e) for s, e in periods if e >= d)


# ---- claim history
rows = []
for f in glob.glob(f"{RAW}/p*/*.json"):
    rows += json.load(open(f))["responses"][0]["data"]["table"]["rows"]
team_of = {}
for r in rows:
    for c in r["cells"]:
        if c["key"] == "team":
            team_of[r["txSetId"]] = c["content"]

bids = collections.defaultdict(list)
scorer = {}
spent = collections.Counter()
drops = collections.Counter()
for r in rows:
    c = {x["key"]: x for x in r["cells"]}
    team = team_of.get(r["txSetId"])
    d = tx_date(c["date"]["content"]) if "date" in c else None
    if r.get("transactionCode") == "DROP" and r["resultCode"] == "EXECUTED" and d:
        drops[(team, d)] += 1
    if r.get("transactionCode") != "CLAIM":
        continue
    bid = c.get("bid", {}).get("content", "")
    if r["resultCode"] == "EXECUTED" and bid:
        spent[team] += float(bid)
    if r.get("claimType") != "WW" or bid == "":
        continue
    assert d, "claim row without a processed date"
    tip = re.sub(r"<[^>]+>", "", r.get("result", {}).get("toolTip", "") or "")
    if r["resultCode"] == "EXECUTED":
        status = "Won"
    elif "bid higher" in tip:
        status = "Outbid"
    elif "tiebreaker" in tip:
        status = "Lost tiebreak"
    elif "already won the claim" in tip:
        status = "dup"  # the same team's other bid on this player won
    elif "dropped or moved" in tip:
        status = "Voided"
    else:
        status = "Denied"
    sc = r["scorer"]
    scorer[sc["scorerId"]] = sc
    bids[(d, sc["scorerId"])].append(dict(team=team, bid=float(bid), status=status))


# ---- player game logs and last season
def season_date(s):  # "Oct 24" in the 2026-27 season
    mo, d = s.split()
    return date(2026 if MON[mo] >= 9 else 2027, MON[mo], int(d))


def tables(o, out):
    if isinstance(o, dict):
        if "rows" in o and "header" in o:
            out.append(o)
        for v in o.values():
            tables(v, out)
    elif isinstance(o, list):
        for v in o:
            tables(v, out)
    return out


def section(pid, tab):
    fs = glob.glob(f"{PROF}/{pid}_{tab}/*.json")
    r = json.load(open(fs[0]))["responses"][0] if fs else {}
    return (r.get("data", {}).get("sectionContent") or {}).get(tab, {}) if "data" in r else None


gamelog, last_fpg, unfetched = {}, {}, []
for pid in scorer:
    gl = section(pid, "GAME_LOG")
    if gl is None:
        unfetched.append(scorer[pid]["name"])
    games = []
    for t in tables(gl or {}, []):
        h = [x.get("shortName") for x in t["header"]["cells"]]
        if "Date" in h and "FPts" in h:
            for row in t["rows"]:
                cells = [x.get("content") for x in row["cells"]]
                try:
                    games.append((season_date(cells[h.index("Date")]), float(cells[h.index("FPts")] or 0)))
                except (ValueError, KeyError):
                    pass
    gamelog[pid] = games
    for t in tables(section(pid, "STATS") or {}, []):
        h = [x.get("shortName") for x in t["header"]["cells"]]
        if "FP/G" in h:
            ly = [[x.get("content") for x in row["cells"]] for row in t["rows"]]
            ly = [c for c in ly if c[0] == "2025-26"]
            tot = [c for c in ly if c[1] == "Total"] or ly
            if tot and tot[0][h.index("FP/G")]:
                last_fpg[pid] = float(tot[0][h.index("FP/G")])
            break

# ---- NHL schedule (games per team per week)
sched = collections.defaultdict(list)
for d, h, a in sqlite3.connect(DB).execute(
        "select substr(date,1,10), home_team_id, away_team_id from nhl_games where game_type='regular'"):
    sched[h].append(date.fromisoformat(d))
    sched[a].append(date.fromisoformat(d))

# ---- bids and bid_entries
out_bids, out_entries = [], []
for (d, pid), es in bids.items():
    winners = {e["team"] for e in es if e["status"] == "Won"}
    best = {}
    for e in es:
        if e["status"] == "dup" and e["team"] in winners:
            continue
        k = e["team"]
        if k not in best or (e["status"] == "Won", e["bid"]) > (best[k]["status"] == "Won", best[k]["bid"]):
            best[k] = e
    entries = sorted(best.values(), key=lambda e: (e["status"] != "Won", -e["bid"]))
    for e in entries:
        if e["status"] == "dup":
            e["status"] = "Denied"
    sc = scorer[pid]
    ps, pe = period_for(d)
    prior = [fp for gd, fp in gamelog[pid] if gd < ps]
    wk = [fp for gd, fp in gamelog[pid] if ps <= gd <= pe]
    nhl = sc["name"] if sc.get("team") else sc.get("teamShortName")  # TmG units are named by team
    wk_games = sum(1 for g in sched.get(nhl, []) if ps <= g <= pe)
    win = next((e for e in entries if e["status"] == "Won"), None)
    second = max((e["bid"] for e in entries if e["status"] in ("Outbid", "Lost tiebreak")), default=None)
    fpg = sum(prior) / len(prior) if prior else None
    lyf = last_fpg.get(pid)
    basis = fpg if fpg is not None else lyf
    proj = basis * wk_games if basis is not None else None
    key = f"{d}|{pid}"
    out_bids.append(dict(
        key=key, date=str(d), week_start=str(ps), week_end=str(pe), player=sc["name"],
        pos=sc.get("posShortNames", ""), nhl=nhl, winner=win["team"] if win else None,
        bid=win["bid"] if win else None, second=second,
        overpay=win["bid"] - second if win and second is not None else None,
        bidders=len(entries), fpg=round(fpg, 2) if fpg is not None else None, gp=len(prior),
        ly_fpg=lyf, wk_games=wk_games, proj=round(proj, 1) if proj is not None else None,
        per_proj=round(win["bid"] / proj, 2) if win and proj else None,
        wk_fp=round(sum(wk), 1) if pe < TODAY and gamelog[pid] else None))
    for e in entries:
        out_entries.append(dict(key=key, date=str(d), player=sc["name"], team=e["team"], bid=e["bid"], result=e["status"]))

# ---- budgets
st = first(f"{RAW}/st/*.json")["data"]["fantasyTeamInfo"]
budgets = []
for tid, info in st.items():
    name = info["name"]
    rem = float(first(f"{RAW}/ro/{tid}/*.json")["data"]["miscData"]["salaryInfo"]["info"][0]["value"])
    dumps = sorted(d for (t, d), n in drops.items() if t == name and n >= 12)
    out = rem == 0 and bool(dumps)
    budgets.append(dict(team=name, spent=spent[name], remaining=rem, status="Eliminated" if out else "Alive",
                        eliminated_on=str(dumps[-1]) if out else None,
                        lost=START_BUDGET - spent[name] if out else 0.0,
                        traded=START_BUDGET - spent[name] - rem if not out else 0.0))

# ---- checks
tot_spent = sum(b["spent"] for b in budgets)
tot_lost = sum(b["lost"] for b in budgets)
tot_rem = sum(b["remaining"] for b in budgets)
start = START_BUDGET * len(budgets)
won_total = sum(b["bid"] for b in out_bids if b["bid"] is not None)
print("player-dates", len(out_bids), "entries", len(out_entries), "team_fp", len(team_fp))
print("claim runs", collections.Counter(b["date"] for b in out_bids))
print(f"spent {tot_spent} lost {tot_lost} remaining {tot_rem} start {start} -> reconciles: {start - tot_spent - tot_lost == tot_rem}")
print("won bids in bids.json", won_total, "(spent also counts FA claims with a bid)")
print("budget trades (alive teams, nonzero):", {b["team"]: b["traded"] for b in budgets if b["traded"]})
print("eliminated:", [(b["team"], b["eliminated_on"], b["lost"]) for b in budgets if b["status"] == "Eliminated"])
print("no game log:", unfetched)

for n, d in dict(bids=out_bids, bid_entries=out_entries, team_fp=team_fp, budgets=budgets).items():
    json.dump(d, open(f"{OUT}/{n}.json", "w"))
