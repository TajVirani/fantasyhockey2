#!/usr/bin/env bash
# Pull this week's Fantrax data for the r/fantasyhockey #2 bid report.
# Usage: ./fetch.sh YYYY-MM-DD   (writes raw/<date>/; then fetch_profiles.py raw/<date> <date>, then build_data.py raw/<date> docs/data <date>)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
RAW="$HERE/raw/$1"
L=s4b6q8kumtga13lv
P="$HERE/fxprobe"
cd /home/pcpmi/Projects/Traxalytics/server
go build -o "$P" ./cmd/fantraxprobe
mkdir -p "$RAW/st" "$RAW/sched" "$RAW/p1"
"$P" -league $L -method getStandings -save "$RAW/st" | tail -1
"$P" -league $L -method getStandingsSchedule -save "$RAW/sched" | tail -1
"$P" -league $L -method getTransactionDetailsHistory -arg view=CLAIM_DROP -arg pageNumber=1 -arg executedOnly=false -save "$RAW/p1" | tail -1
N=$(jq '.responses[0].data.paginatedResultSet.totalNumPages' "$RAW"/p1/*.json)
for p in $(seq 2 "$N"); do
  mkdir -p "$RAW/p$p"
  "$P" -league $L -method getTransactionDetailsHistory -arg view=CLAIM_DROP -arg pageNumber=$p -arg executedOnly=false -save "$RAW/p$p" >/dev/null
  sleep 1
done
for t in $(jq -r '.responses[0].data.fantasyTeamInfo|keys[]' "$RAW"/st/*.json); do
  mkdir -p "$RAW/ro/$t"
  "$P" -league $L -team "$t" -method getTeamRosterInfo -save "$RAW/ro/$t" >/dev/null
  sleep 1
done
echo "fetched $N claim pages into $RAW"
