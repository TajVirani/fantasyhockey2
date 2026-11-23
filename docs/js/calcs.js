// Derived tables the report draws from (the same calcs the Dashboard version used).
  dash.calc('weeks', {
    inputs: ['bids'],
    title: 'Bids per claim run',
    description: 'Players won, money spent and team bids at each Monday claim run.',
    fn: (bids) => {
      const out = {};
      for (const b of bids) {
        const w = out[b.date] || (out[b.date] = {date: b.date, week_start: b.week_start, week_end: b.week_end, won: 0, spent: 0, team_bids: 0, players: 0});
        w.players += 1;
        w.team_bids += b.bidders;
        if (b.winner != null) { w.won += 1; w.spent += b.bid; }
      }
      return Object.values(out).sort((a, b) => (a.date < b.date ? -1 : 1));
    },
  });

  dash.calc('team_spend', {
    inputs: ['bid_entries', 'bids', 'team_fp'],
    title: 'Spending by team',
    description: 'Per team and claim run: bids placed, total bid, money spent on bids won, players won, and the team\'s fantasy points in the scoring week that claim run fed. date "all" sums every claim run and every week played.',
    fn: (bid_entries, bids, team_fp) => {
      const weekOf = {};
      for (const b of bids) weekOf[b.date] = b.week_start;
      const fpOf = {};
      const season = {};
      for (const f of team_fp) {
        fpOf[f.week_start + '|' + f.team] = f.fp;
        season[f.team] = (season[f.team] || 0) + f.fp;
      }
      const out = {};
      const add = (date, e) => {
        const key = date + '|' + e.team;
        const fp = date === 'all' ? season[e.team] : fpOf[weekOf[date] + '|' + e.team];
        const r = out[key] || (out[key] = {key, date, team: e.team, fp: fp == null ? null : fp, bids: 0, bid_total: 0, spent: 0, won: 0});
        r.bids += 1;
        r.bid_total += e.bid;
        if (e.result === 'Won') { r.spent += e.bid; r.won += 1; }
      };
      for (const e of bid_entries) { add(e.date, e); add('all', e); }
      return Object.values(out);
    },
  });

  dash.calc('team_weeks', {
    inputs: ['team_fp', 'budgets'],
    title: 'Team points and rank by week',
    description: 'Each team\'s fantasy points and rank among teams still playing, per scoring week. Weeks after a team was eliminated are left out.',
    fn: (team_fp, budgets) => {
      const out = new Set(budgets.filter((b) => b.status === 'Eliminated').map((b) => b.team));
      const weeks = {};
      for (const f of team_fp) if (f.fp > 0) (weeks[f.week_start] = weeks[f.week_start] || []).push(f);
      const rows = [];
      for (const list of Object.values(weeks)) {
        list.sort((a, b) => b.fp - a.fp);
        list.forEach((f, i) => rows.push({key: f.key, week_start: f.week_start, week_end: f.week_end, team: f.team, fp: f.fp, rank: i + 1, of: list.length, eliminated: out.has(f.team)}));
      }
      return rows.sort((a, b) => (a.week_start < b.week_start ? -1 : a.week_start > b.week_start ? 1 : a.rank - b.rank));
    },
  });

  dash.calc('money_left', {
    inputs: ['budgets', 'team_weeks'],
    title: 'Money left by team',
    description: 'Remaining claim budget for each team still in, with its average weekly finish over the last 3 scoring weeks played.',
    fn: (budgets, team_weeks) => {
      const last3 = Array.from(new Set(team_weeks.map((w) => w.week_start))).sort().slice(-3);
      return budgets.filter((b) => b.status === 'Alive').map((b) => {
        const ranks = team_weeks.filter((w) => w.team === b.team && last3.includes(w.week_start)).map((w) => w.rank);
        return {team: b.team, remaining: b.remaining, avg_place: ranks.length ? ranks.reduce((s, r) => s + r, 0) / ranks.length : null, weeks: ranks.length};
      });
    },
  });

  dash.calc('turnover', {
    inputs: ['budgets', 'bid_entries', 'bids'],
    title: 'Roster turnover by team',
    description: 'For each team still in: players added through claims (free agents included), in total and per scoring week, and its bids counted once per player per scoring week (the winning or highest bid).',
    fn: (budgets, bid_entries, bids) => {
      const weekOf = {};
      for (const b of bids) weekOf[b.key] = b.week_start;
      const best = {};
      for (const e of bid_entries) {
        const k = e.team + '|' + e.key.split('|')[1] + '|' + weekOf[e.key];
        const cur = best[k];
        if (!cur || (e.result === 'Won') > (cur.result === 'Won') || ((e.result === 'Won') === (cur.result === 'Won') && e.bid > cur.bid)) best[k] = e;
      }
      const byTeam = {};
      for (const e of Object.values(best)) (byTeam[e.team] = byTeam[e.team] || []).push(e);
      const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
      return budgets.filter((b) => b.status === 'Alive').map((b) => {
        const es = byTeam[b.team] || [];
        const lost = es.filter((e) => e.result !== 'Won').map((e) => e.bid);
        return {
          team: b.team, adds: b.adds, per_week: b.adds / b.periods, bids: es.length,
          won: es.length - lost.length, avg_bid: avg(es.map((e) => e.bid)), avg_lost: avg(lost),
          top_bid: es.length ? Math.max(...es.map((e) => e.bid)) : null,
        };
      });
    },
  });

  dash.calc('faab', {
    inputs: ['budgets'],
    title: 'Claim budget summary',
    description: 'Spent, lost to eliminations and left, against the $1,000 each team started with, and the teams still in that have spent nothing.',
    fn: (budgets) => {
      const START = 1000;
      const sum = (k) => budgets.reduce((s, b) => s + b[k], 0);
      const spent = sum('spent'), lost = sum('lost'), remaining = sum('remaining');
      const start = START * budgets.length;
      const eliminated = budgets.filter((b) => b.status === 'Eliminated').length;
      const zero = budgets.filter((b) => b.status === 'Alive' && b.spent === 0).map((b) => b.team);
      const pct = remaining / start;
      return [{start, spent, lost, gone: spent + lost, remaining, pct, eliminated, zero_teams: zero.join(', '), zero_count: zero.length}];
    },
  });

  dash.calc('top_spenders', {
    inputs: ['budgets', 'bid_entries'],
    title: 'Top 5 spenders, last 3 claim runs',
    description: 'The five teams that spent the most per claim run on average over the last 3 claim runs, with what each has left.',
    fn: (budgets, bid_entries) => {
      const last3 = Array.from(new Set(bid_entries.map((e) => e.date))).sort().slice(-3);
      const spent = {};
      for (const e of bid_entries) if (e.result === 'Won' && last3.includes(e.date)) spent[e.team] = (spent[e.team] || 0) + e.bid;
      return budgets.map((b) => ({team: b.team, avg: (spent[b.team] || 0) / last3.length, remaining: b.remaining, status: b.status}))
        .sort((a, b) => b.avg - a.avg).slice(0, 5).map((b, i) => ({rank: i + 1, ...b}));
    },
  });

  dash.calc('totals', {
    inputs: ['bids'],
    title: 'All claim runs',
    description: 'Totals over every claim run.',
    fn: (bids) => {
      const won = bids.filter((b) => b.winner != null);
      return [{
        spent: won.reduce((s, b) => s + b.bid, 0),
        won: won.length,
        team_bids: bids.reduce((s, b) => s + b.bidders, 0),
      }];
    },
  });
