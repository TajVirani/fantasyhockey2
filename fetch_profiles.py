"""Fetch the game logs (and last-season stats) the bid report needs, through a persistent cache.

Usage: python3 -I fetch_profiles.py RAW_DIR TODAY(YYYY-MM-DD)
Reads RAW_DIR/p*/ (claim history) and RAW_DIR/sched/, and keeps profiles in cache/prof/<playerId>_<TAB>/
next to this script, with a `fetched_on` stamp in each folder.

What gets fetched:
- STATS (last season): once per player, never again. Team goalie units (ids with '#') have no
  last-season line, so their STATS tab is never asked for.
- GAME_LOG: when a player is new, or when the cached log was fetched before the last day the report
  needs from it: the end of the latest scoring week the player drew a bid in (capped at yesterday).
  So each week only the newly bid players and last week's players are fetched again.

Fantrax throttles profile reads, so calls are spaced out and throttled ones retried.
"""
import glob, json, os, re, subprocess, sys, time
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = "/home/pcpmi/Projects/Traxalytics/server"
LEAGUE = "s4b6q8kumtga13lv"
RAW = sys.argv[1]
TODAY = date.fromisoformat(sys.argv[2])
CACHE = f"{HERE}/cache/prof"
MON = {m: i for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(), 1)}

periods = []
for t in json.load(open(glob.glob(f"{RAW}/sched/*.json")[0]))["responses"][0]["data"]["tableList"]:
    m = re.findall(r"\w+ (\w+) (\d+), (\d+)", t.get("subCaption", ""))
    if len(m) == 2:
        periods.append(tuple(date(int(y), MON[mo], int(d)) for mo, d, y in m))
periods.sort()

latest_bid = {}
for f in glob.glob(f"{RAW}/p*/*.json"):
    for r in json.load(open(f))["responses"][0]["data"]["table"]["rows"]:
        if r.get("transactionCode") != "CLAIM" or r.get("claimType") != "WW":
            continue
        c = {x["key"]: x for x in r["cells"]}
        if "date" not in c:
            continue
        m = re.match(r"\w+ (\w+) (\d+), (\d+)", c["date"]["content"])
        d = date(int(m[3]), MON[m[1]], int(m[2]))
        pid = r["scorer"]["scorerId"]
        latest_bid[pid] = max(latest_bid.get(pid, d), d)


def needed_through(pid):
    d = latest_bid[pid]
    week_end = next(e for s, e in periods if e >= d)
    return min(week_end, TODAY - timedelta(days=1))


def state(d):
    fs = glob.glob(f"{d}/*.json")
    if not fs:
        return "missing"
    r = json.load(open(fs[0]))["responses"][0]
    if "data" in r:
        return "ok"
    return "throttled" if "too quickly" in r.get("pageError", {}).get("text", "") else "rejected"


def fetched_on(d):
    try:
        return date.fromisoformat(open(f"{d}/fetched_on").read().strip())
    except (OSError, ValueError):
        return None


todo = []
for pid in sorted(latest_bid):
    for tab in ("GAME_LOG", "STATS"):
        if tab == "STATS" and "#" in pid:
            continue
        d = f"{CACHE}/{pid}_{tab}"
        stamp = fetched_on(d)
        if state(d) != "ok" or stamp is None:
            todo.append((pid, tab))
        elif tab == "GAME_LOG" and stamp <= needed_through(pid):
            todo.append((pid, tab))
print(len(latest_bid), "players;", len(todo), "fetches", flush=True)

delay, throttles, rejected = 2.0, 0, []
while todo:
    pid, tab = todo.pop(0)
    d = f"{CACHE}/{pid}_{tab}"
    tmp = d + ".new"
    os.makedirs(tmp, exist_ok=True)
    for f in glob.glob(f"{tmp}/*"):
        os.remove(f)
    subprocess.run([f"{HERE}/fxprobe", "-league", LEAGUE, "-method", "getPlayerProfile",
                    "-arg", f"playerId={pid}", "-arg", f"tab={tab}", "-save", tmp],
                   cwd=SERVER, capture_output=True)
    s = state(tmp)
    if s == "ok":
        # replace the cached copy only with a good response
        os.makedirs(d, exist_ok=True)
        for f in glob.glob(f"{d}/*"):
            os.remove(f)
        for f in glob.glob(f"{tmp}/*"):
            os.replace(f, f"{d}/{os.path.basename(f)}")
        open(f"{d}/fetched_on", "w").write(str(TODAY))
    elif s == "throttled":
        throttles += 1
        todo.append((pid, tab))
        delay = min(delay * 1.3, 15)
        if throttles > 600:
            sys.exit(f"stopped: {throttles} throttled calls, {len(todo)} left")
    else:
        rejected.append(f"{pid}_{tab}")
    os.rmdir(tmp) if not os.listdir(tmp) else None
    time.sleep(delay)
print("done; rejected:", rejected, flush=True)
