// Draws every [data-draw] element of the report from dash.data().
  window.wb = window.wb || {};
  const money = d3.format('$,.0f');
  const int = d3.format(',');
  const f2 = d3.format('.2f');
  const f1 = d3.format('.1f');
  const day = d3.utcFormat('%b %-d');
  const parseDay = (s) => new Date(s + 'T00:00:00Z');
  const enc = (s) => String(s).replace(/%/g, '%25').replace(/&/g, '%26').replace(/=/g, '%3D').replace(/,/g, '%2C');
  wb.sort = wb.sort || {col: 'bid', dir: -1};

  wb.rows = (id) => { const d = dash.data(id); return d.status === 'ok' ? d.data : null; };
  wb.fail = (el, id) => {
    if (dash.data(id).status === 'error') {
      const f = document.createElement('div');
      f.className = 'wb-fail';
      f.textContent = 'Failed to load';
      el.replaceChildren(f);
    } else {
      el.replaceChildren();
    }
  };
  wb.week = () => {
    const p = dash.params().week;
    if (p) return p;
    const w = wb.rows('weeks');
    return w && w.length ? w[w.length - 1].date : null;
  };

  // fantasy points by week
  dash.draw('team-select', (sel) => {
    const r = wb.rows('team_weeks') || [];
    const teams = Array.from(new Set(r.map((d) => d.team))).sort((a, b) => a.localeCompare(b));
    sel.replaceChildren(new Option('All teams', ''), ...teams.map((t) => new Option(t, t)));
    sel.value = dash.params().team ?? '';
    sel.onchange = () => dash.setParams({team: sel.value || null});
  });
  dash.draw('fp-lines', (el) => {
    const r = wb.rows('team_weeks');
    if (!r) return wb.fail(el, 'team_weeks');
    el.replaceChildren();
    const W = Math.max(el.clientWidth, 280), H = 640;
    const weeks = Array.from(new Set(r.map((d) => d.week_start))).sort();
    const pinned = dash.params().team || null;
    const lastWeek = weeks[weeks.length - 1];
    const leaders = r.filter((d) => d.week_start === lastWeek && !d.eliminated).sort((a, b) => a.rank - b.rank).slice(0, 3).map((d) => d.team);
    const LEAD = ['var(--wb-blue)', 'var(--wb-red)', 'var(--wb-ink)'];
    const cap = (s) => s.style('font-size', '14px').style('font-variant-numeric', 'tabular-nums').attr('fill', 'var(--wb-muted)');
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Fantasy points by team and week');
    const measure = (texts) => {
      const g = svg.append('g').attr('visibility', 'hidden').style('font-size', '14px').style('font-weight', '600');
      const widths = texts.map((s) => g.append('text').text(s).node().getComputedTextLength());
      g.remove();
      return d3.max(widths) || 0;
    };
    const labelled = pinned ? [pinned] : leaders;
    const m = {t: 24, r: Math.min(measure(labelled) + 28, W * 0.3), b: 30, l: 48};
    const x = d3.scalePoint(weeks, [m.l, W - m.r]);
    const [lo, hi] = d3.extent(r, (d) => d.fp);
    const y = d3.scaleLinear([lo * 0.92, hi * 1.04], [H - m.b, m.t]).nice();
    const yt = y.ticks(12);
    svg.append('g').selectAll('line').data(yt).join('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y).attr('stroke', 'var(--wb-soft)');
    cap(svg.append('g').selectAll('text').data(yt).join('text').attr('x', m.l - 10).attr('y', (v) => y(v) + 5).attr('text-anchor', 'end').text((v) => d3.format(',')(v)));
    const every = Math.max(1, Math.ceil(52 / (x.step() || 52)));
    cap(svg.append('g').selectAll('text').data(weeks.filter((w, i) => i % every === 0)).join('text').attr('x', x).attr('y', H - m.b + 22).attr('text-anchor', 'middle').text((w) => day(parseDay(w))));
    const names = Array.from(new Set(r.map((d) => d.team))).sort((a, b) => a.localeCompare(b));
    const series = names.map((team) => {
      const pts = r.filter((d) => d.team === team);
      const lead = leaders.indexOf(team);
      const out = pts[0].eliminated;
      return {team, pts, out, lead: lead >= 0, color: out ? '#B6C2D0' : (lead >= 0 ? LEAD[lead] : '#8A9AAE')};
    }).sort((a, b) => Number(a.lead) - Number(b.lead));
    const line = d3.line().x((d) => x(d.week_start)).y((d) => y(d.fp));
    const g = svg.append('g').selectAll('g').data(series).join('g');
    g.append('path').attr('d', (s) => line(s.pts)).attr('fill', 'none').attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
    g.selectAll('circle').data((s) => s.pts).join('circle').attr('cx', (p) => x(p.week_start)).attr('cy', (p) => y(p.fp)).attr('r', 3);
    const paint = (focus) => {
      const color = (s) => (s.team === focus ? 'var(--wb-blue)' : s.color);
      g.attr('opacity', (s) => (focus && s.team !== focus ? 0.2 : 1));
      g.select('path').attr('stroke', color).attr('stroke-width', (s) => (s.team === focus ? 3.5 : (s.lead && !focus ? 2.75 : 1.5))).attr('stroke-dasharray', (s) => (s.out && s.team !== focus ? '5 5' : null));
      g.selectAll('circle').attr('fill', function () { return color(d3.select(this.parentNode).datum()); });
      g.filter((s) => s.team === focus).raise();
    };
    paint(pinned);
    const endY = new Map();
    let prev = -Infinity;
    for (const s of series.filter((c) => labelled.includes(c.team)).sort((a, b) => y(a.pts[a.pts.length - 1].fp) - y(b.pts[b.pts.length - 1].fp))) {
      const yy = Math.max(y(s.pts[s.pts.length - 1].fp) + 5, prev + 18);
      endY.set(s.team, yy);
      prev = yy;
    }
    g.filter((s) => endY.has(s.team)).append('text')
      .attr('x', (s) => x(s.pts[s.pts.length - 1].week_start) + 12).attr('y', (s) => endY.get(s.team))
      .attr('fill', (s) => (s.team === pinned ? 'var(--wb-blue)' : s.color)).style('font-size', '14px').style('font-weight', '600').text((s) => s.team);
    const followed = series.find((s) => s.team === pinned);
    if (followed && x.step() >= 64) {
      cap(svg.append('g').selectAll('text').data(followed.pts).join('text')
        .attr('x', (p) => x(p.week_start)).attr('y', (p) => y(p.fp) - 12).attr('text-anchor', 'middle')
        .text((p) => f1(p.fp) + ' · #' + p.rank)).attr('fill', 'var(--wb-ink)').style('font-weight', '600');
    }
    const tip = document.createElement('div');
    tip.className = 'wb-tip';
    tip.hidden = true;
    el.appendChild(tip);
    const delaunay = d3.Delaunay.from(r, (d) => x(d.week_start), (d) => y(d.fp));
    svg.append('rect').attr('x', 0).attr('y', 0).attr('width', W).attr('height', H).attr('fill', 'transparent')
      .on('pointermove', (e) => {
        const [px, py] = d3.pointer(e);
        const p = r[delaunay.find(px, py)];
        paint(p.team);
        const a = document.createElement('div');
        a.textContent = p.team;
        const b = document.createElement('div');
        b.className = 'wb-tip-sub';
        b.textContent = day(parseDay(p.week_start)) + ' · ' + f1(p.fp) + ' FP · #' + p.rank + ' of ' + p.of;
        tip.replaceChildren(a, b);
        tip.hidden = false;
        const k = el.clientWidth / W, tw = tip.offsetWidth;
        tip.style.left = Math.max(0, Math.min(el.clientWidth - tw, x(p.week_start) * k - tw / 2)) + 'px';
        const top = y(p.fp) * k - tip.offsetHeight - 10;
        tip.style.top = (top < 0 ? y(p.fp) * k + 10 : top) + 'px';
      })
      .on('pointerleave', () => { tip.hidden = true; paint(pinned); });
  });

  dash.draw('last-run', (el) => {
    const r = wb.rows('weeks');
    const last = r && r.length ? r[r.length - 1].date : null;
    el.setAttribute('data-where', 'date=' + enc(last || ''));
    el.textContent = last ? day(parseDay(last)) : '—';
  });

  // exit interviews
  dash.draw('exit-date', (el) => {
    const r = wb.rows('budgets');
    const row = r && r.find((b) => b.team === el.dataset.team);
    el.textContent = row && row.eliminated_on ? day(parseDay(row.eliminated_on)) : '—';
  });

  // claim budget
  const pct1 = d3.format('.1%');
  one('f-spent', 'faab', 'spent', money);
  one('f-lost', 'faab', 'lost', money);
  one('f-elim', 'faab', 'eliminated', int);
  one('f-gone', 'faab', 'gone', money);
  one('f-rem', 'faab', 'remaining', money);
  one('f-pct', 'faab', 'pct', pct1);
  one('f-start', 'faab', 'start', money);
  one('f-zero', 'faab', 'zero_teams', (v) => v);
  dash.draw('f-meter', (el) => {
    const r = wb.rows('faab');
    if (!r || !r[0]) { el.textContent = '—'; return; }
    const f = r[0];
    el.setAttribute('aria-label', 'Of the ' + money(f.start) + ' starting budget, ' + money(f.spent) + ' has been spent, ' + money(f.lost) + ' lost to eliminations and ' + money(f.remaining) + ' is left');
    el.replaceChildren(...[[f.spent, '#5B8DEF'], [f.lost, 'var(--wb-red)'], [f.remaining, '#33445A']].map(([v, c]) => {
      const d = document.createElement('div');
      d.style.flex = v + ' 1 0';
      d.style.background = c;
      return d;
    }));
  });
  dash.draw('top-list', (el) => {
    const r = wb.rows('top_spenders');
    if (!r) { el.textContent = '—'; return; }
    const make = (cls, text) => { const n = document.createElement('div'); n.className = cls; if (text != null) n.textContent = text; return n; };
    el.replaceChildren(...r.map((b) => {
      const row = make('wb-spender');
      const name = make('wb-spender-name', b.team);
      if (b.status === 'Eliminated') { const st = document.createElement('span'); st.className = 'wb-spender-status'; st.textContent = 'Eliminated'; name.appendChild(st); }
      const track = make('wb-spender-track');
      const fill = make('wb-spender-fill');
      fill.style.width = Math.min(100, b.spent / 10) + '%';
      track.appendChild(fill);
      const mid = make('wb-spender-mid'); mid.append(name, track);
      const right = make('wb-spender-right'); right.append(make('wb-spender-spent', money(b.spent)), make('wb-spender-left', money(b.remaining) + ' left'));
      row.append(make('wb-spender-rank', int(b.rank)), mid, right);
      return row;
    }));
  });
  dash.draw('elim-table', (tbody) => {
    const r = wb.rows('budgets');
    if (!r) { tbody.replaceChildren(); return; }
    const out = r.filter((b) => b.status === 'Eliminated').sort((a, b) => (a.eliminated_on < b.eliminated_on ? -1 : 1));
    tbody.replaceChildren(...out.map((b) => {
      const tr = document.createElement('tr');
      tr.dataset.key = b.team;
      for (const [v, num] of [[b.team, false], [day(parseDay(b.eliminated_on)), false], [money(b.spent), true], [money(b.lost), true]]) {
        const td = document.createElement('td');
        td.textContent = v;
        if (num) td.className = 'wb-num';
        tr.appendChild(td);
      }
      return tr;
    }));
  });

  // single values
  function one(name, id, field, fmt) {
    dash.draw(name, (el) => {
      const r = wb.rows(id);
      el.textContent = r && r[0] && r[0][field] != null ? fmt(r[0][field]) : '—';
    });
  }
  one('t-spent', 'totals', 'spent', money);
  one('t-won', 'totals', 'won', int);
  one('t-bids', 'totals', 'team_bids', int);

  const wkField = (name, field, fmt) => dash.draw(name, (el) => {
    const r = wb.rows('weeks');
    const w = wb.week();
    const row = r && r.find((x) => x.date === w);
    el.setAttribute('data-where', 'date=' + enc(w || ''));
    el.textContent = row ? fmt(row[field]) : '—';
  });
  wkField('wk-start', 'week_start', (v) => day(parseDay(v)));
  wkField('wk-end', 'week_end', (v) => day(parseDay(v)));
  wkField('wk-won', 'won', int);
  wkField('wk-spent', 'spent', money);
  wkField('wk-bids', 'team_bids', int);
  wkField('wk-players', 'players', int);

  dash.draw('week-buttons', (el) => {
    const r = wb.rows('weeks');
    if (!r) { el.textContent = '—'; return; }
    const cur = wb.week();
    el.replaceChildren(...[{v: 'all', t: 'All'}].concat(r.map((w) => ({v: w.date, t: day(parseDay(w.date))}))).map((o) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wb-run';
      b.textContent = o.t;
      b.setAttribute('aria-pressed', String(o.v === cur));
      b.onclick = () => dash.setParams({week: o.v});
      return b;
    }));
  });

  // spend per Monday
  dash.draw('spend-chart', (el) => {
    const r = wb.rows('weeks');
    if (!r) return wb.fail(el, 'weeks');
    el.replaceChildren();
    const W = Math.max(el.clientWidth, 280), H = 260, m = {t: 22, r: 8, b: 28, l: 8};
    const sel = wb.week();
    const x = d3.scaleBand(r.map((d) => d.date), [m.l, W - m.r]).padding(0.3);
    const y = d3.scaleLinear([0, d3.max(r, (d) => d.spent) || 1], [H - m.b, m.t]).nice();
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Spent per claim run');
    svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', H - m.b).attr('y2', H - m.b).attr('stroke', 'var(--cds-chart-axis)');
    const bw = Math.min(x.bandwidth(), 56);
    const g = svg.selectAll('g.bar').data(r).join('g').attr('class', 'bar').style('cursor', 'pointer')
      .on('click', (e, d) => dash.setParams({week: d.date}));
    g.append('rect')
      .attr('x', (d) => x(d.date) + (x.bandwidth() - bw) / 2).attr('width', bw)
      .attr('y', (d) => y(d.spent)).attr('height', (d) => y(0) - y(d.spent))
      .attr('fill', (d) => (sel === 'all' || d.date === sel ? 'var(--wb-blue)' : 'var(--cds-chart-muted)'));
    g.append('text').attr('x', (d) => x(d.date) + x.bandwidth() / 2).attr('y', (d) => y(d.spent) - 6)
      .attr('text-anchor', 'middle').attr('fill', 'var(--color-fg)').style('font-size', 'var(--cds-font-size-caption)').style('font-variant-numeric', 'tabular-nums')
      .text((d) => money(d.spent));
    g.append('text').attr('x', (d) => x(d.date) + x.bandwidth() / 2).attr('y', H - m.b + 18)
      .attr('text-anchor', 'middle').attr('fill', 'var(--color-fg-muted)').style('font-size', 'var(--cds-font-size-caption)')
      .text((d) => day(parseDay(d.date)));
  });

  // spending by team
  dash.draw('team-chart', (el) => {
    const all = wb.rows('team_spend');
    if (!all) return wb.fail(el, 'team_spend');
    el.replaceChildren();
    const w = wb.week() || 'all';
    const picked = all.filter((r) => r.date === w);
    const byFp = picked.some((r) => r.fp != null);
    const rows = picked.sort((a, b) => (byFp ? (b.fp ?? -1) - (a.fp ?? -1) : 0) || b.bid_total - a.bid_total || b.spent - a.spent || (a.team < b.team ? -1 : 1));
    const W = Math.max(el.clientWidth, 280), rowH = 24, m = {t: byFp ? 22 : 4, b: 4};
    const H = m.t + m.b + rows.length * rowH;
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Spending by team');
    const cap = (s) => s.style('font-size', 'var(--cds-font-size-caption)').style('font-variant-numeric', 'tabular-nums');
    const measure = (texts) => {
      const g = cap(svg.append('g').attr('visibility', 'hidden'));
      const widths = texts.map((s) => g.append('text').text(s).node().getComputedTextLength());
      g.remove();
      return d3.max(widths) || 0;
    };
    const label = (r) => money(r.spent) + ' of ' + money(r.bid_total);
    const fpText = (r) => (r.fp == null ? '–' : f1(r.fp));
    const fw = byFp ? measure(rows.map(fpText).concat(['FP'])) + 14 : 0;
    const nameW = Math.min(measure(rows.map((r) => r.team)) + 10, W * 0.38);
    const l = nameW + fw;
    const rr = measure(rows.map(label)) + 10;
    const x = d3.scaleLinear([0, d3.max(rows, (r) => r.bid_total) || 1], [l, Math.max(l + 40, W - rr)]);
    const y = (i) => m.t + i * rowH;
    const bh = 14;
    const g = svg.selectAll('g.row').data(rows).join('g').attr('class', 'row').attr('transform', (r, i) => `translate(0,${y(i)})`);
    if (byFp) {
      cap(svg.append('text').attr('x', l - 8).attr('y', 14).attr('text-anchor', 'end').attr('fill', 'var(--color-fg-muted)').text('FP'));
      cap(svg.append('text').attr('x', l).attr('y', 14).attr('fill', 'var(--color-fg-muted)').text('Spent of total bid'));
      cap(g.append('text').attr('x', l - 8).attr('y', rowH / 2 + 4).attr('text-anchor', 'end').attr('fill', 'var(--color-fg-muted)').text(fpText));
    }
    cap(g.append('text').attr('x', nameW - 8).attr('y', rowH / 2 + 4).attr('text-anchor', 'end').attr('fill', 'var(--color-fg)')
      .text((r) => r.team)).each(function () {
        const n = this; const max = nameW - 12;
        let s = n.textContent;
        while (s.length > 4 && n.getComputedTextLength() > max) { s = s.slice(0, -2); n.textContent = s + '…'; }
      });
    g.append('rect').attr('x', l).attr('y', (rowH - bh) / 2).attr('height', bh)
      .attr('width', (r) => Math.max(0, x(r.bid_total) - l)).attr('fill', 'var(--cds-chart-muted)');
    g.append('rect').attr('x', l).attr('y', (rowH - bh) / 2).attr('height', bh)
      .attr('width', (r) => Math.max(0, x(r.spent) - l)).attr('fill', 'var(--wb-blue)');
    cap(g.append('text').attr('x', (r) => x(r.bid_total) + 6).attr('y', rowH / 2 + 4).attr('fill', 'var(--color-fg-muted)').text(label));
    const tip = document.createElement('div');
    tip.className = 'wb-tip';
    tip.hidden = true;
    el.appendChild(tip);
    g.append('rect').attr('x', 0).attr('width', W).attr('height', rowH).attr('fill', 'transparent')
      .on('mouseenter', (e, r) => {
        const a = document.createElement('div');
        a.textContent = r.team;
        const lines = [
          (r.fp == null ? 'No points yet this week' : f1(r.fp) + (w === 'all' ? ' FP this season' : ' FP that week')),
          int(r.bids) + (r.bids === 1 ? ' bid placed' : ' bids placed'),
          money(r.bid_total) + ' total bid',
          money(r.spent) + ' spent on ' + int(r.won) + (r.won === 1 ? ' player won' : ' players won'),
        ].map((s) => { const d = document.createElement('div'); d.className = 'wb-tip-sub'; d.textContent = s; return d; });
        tip.replaceChildren(a, ...lines);
        tip.hidden = false;
        const i = rows.indexOf(r);
        const scale = el.clientWidth / W;
        const tw = tip.offsetWidth;
        tip.style.left = Math.max(0, Math.min(el.clientWidth - tw, x(r.bid_total) * scale - tw / 2)) + 'px';
        const top = (y(i) * scale) - tip.offsetHeight - 4;
        tip.style.top = (top < 0 ? (y(i) + rowH) * scale + 4 : top) + 'px';
      })
      .on('mouseleave', () => { tip.hidden = true; });
  });

  // money left by team
  dash.draw('money-chart', (el) => {
    const all = wb.rows('money_left');
    if (!all) return wb.fail(el, 'money_left');
    el.replaceChildren();
    const rows = all.slice().sort((a, b) => b.remaining - a.remaining || (a.avg_place ?? 99) - (b.avg_place ?? 99) || a.team.localeCompare(b.team));
    const W = Math.max(el.clientWidth, 280), rowH = 24, m = {t: 22, b: 4};
    const H = m.t + m.b + rows.length * rowH;
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Money left by team');
    const cap = (s) => s.style('font-size', '14px').style('font-variant-numeric', 'tabular-nums');
    const measure = (texts) => {
      const g = cap(svg.append('g').attr('visibility', 'hidden'));
      const widths = texts.map((s) => g.append('text').text(s).node().getComputedTextLength());
      g.remove();
      return d3.max(widths) || 0;
    };
    const place = (r) => (r.avg_place == null ? '–' : f1(r.avg_place));
    const nameW = Math.min(measure(rows.map((r) => r.team)) + 10, W * 0.38);
    const pw = measure(rows.map(place).concat(['Avg place'])) + 16;
    const l = nameW + pw;
    const rr = measure(rows.map((r) => money(r.remaining))) + 10;
    const x = d3.scaleLinear([0, 1000], [l, Math.max(l + 40, W - rr)]);
    const y = (i) => m.t + i * rowH;
    const bh = 14;
    cap(svg.append('text').attr('x', l - 8).attr('y', 14).attr('text-anchor', 'end').attr('fill', 'var(--wb-muted)').text('Avg place'));
    cap(svg.append('text').attr('x', l).attr('y', 14).attr('fill', 'var(--wb-muted)').text('Left of $1,000'));
    const g = svg.selectAll('g.row').data(rows).join('g').attr('class', 'row').attr('transform', (r, i) => `translate(0,${y(i)})`);
    cap(g.append('text').attr('x', nameW - 8).attr('y', rowH / 2 + 4).attr('text-anchor', 'end').attr('fill', 'var(--wb-ink)')
      .text((r) => r.team)).each(function () {
        const n = this; const max = nameW - 12;
        let s = n.textContent;
        while (s.length > 4 && n.getComputedTextLength() > max) { s = s.slice(0, -2); n.textContent = s + '…'; }
      });
    cap(g.append('text').attr('x', l - 8).attr('y', rowH / 2 + 4).attr('text-anchor', 'end').attr('fill', 'var(--wb-muted)').text(place));
    g.append('rect').attr('x', l).attr('y', (rowH - bh) / 2).attr('height', bh).attr('width', x(1000) - l).attr('fill', 'var(--wb-soft)');
    g.append('rect').attr('x', l).attr('y', (rowH - bh) / 2).attr('height', bh).attr('width', (r) => Math.max(0, x(r.remaining) - l)).attr('fill', 'var(--wb-blue)');
    cap(g.append('text').attr('x', x(1000) + 6).attr('y', rowH / 2 + 4).attr('fill', 'var(--wb-ink)').style('font-weight', '600').text((r) => money(r.remaining)));
  });

  for (const tab of document.querySelectorAll('.wb-tab')) {
    tab.addEventListener('click', () => {
      for (const t of document.querySelectorAll('.wb-tab')) t.setAttribute('aria-selected', String(t === tab));
      for (const p of document.querySelectorAll('.wb-tab-panel')) p.hidden = p.dataset.panel !== tab.dataset.tab;
      dash.draw(tab.dataset.tab === 'money-left' ? 'money-chart' : 'team-chart');
    });
  }

  // players table
  const cols = [
    ['date', (r) => day(parseDay(r.date))],
    ['player', (r) => r.player],
    ['pos', (r) => r.pos],
    ['nhl', (r) => r.nhl || '–'],
    ['winner', (r) => r.winner || 'No winner'],
    ['bid', (r) => (r.bid == null ? '–' : money(r.bid))],
    ['second', (r) => (r.second == null ? '–' : money(r.second))],
    ['overpay', (r) => (r.overpay == null ? '–' : money(r.overpay))],
    ['bidders', (r) => int(r.bidders)],
    ['fpg', (r) => (r.fpg == null ? '–' : f2(r.fpg))],
    ['gp', (r) => int(r.gp)],
    ['ly_fpg', (r) => (r.ly_fpg == null ? '–' : f2(r.ly_fpg))],
    ['wk_games', (r) => int(r.wk_games)],
    ['proj', (r) => (r.proj == null ? '–' : f1(r.proj))],
    ['per_proj', (r) => (r.per_proj == null ? '–' : f2(r.per_proj))],
    ['wk_fp', (r) => (r.wk_fp == null ? '–' : f1(r.wk_fp))],
  ];
  const numeric = new Set(['bid', 'second', 'overpay', 'bidders', 'fpg', 'gp', 'ly_fpg', 'wk_games', 'proj', 'per_proj', 'wk_fp']);

  dash.draw('week-table', (tbody) => {
    const all = wb.rows('bids');
    if (!all) { tbody.replaceChildren(); return; }
    const w = wb.week();
    const pick = dash.params().pick;
    const {col, dir} = wb.sort;
    const rows = all.filter((r) => w === 'all' || r.date === w).sort((a, b) => {
      const va = a[col], vb = b[col];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
    tbody.replaceChildren(...rows.map((r) => {
      const tr = document.createElement('tr');
      tr.dataset.key = r.key;
      tr.className = 'wb-click' + (r.key === pick ? ' wb-picked' : '');
      for (const [k, f] of cols) {
        const td = document.createElement('td');
        td.textContent = f(r);
        if (numeric.has(k)) td.className = 'wb-num';
        if (k === 'winner' && r.winner == null) td.className = 'wb-muted';
        tr.appendChild(td);
      }
      return tr;
    }));
  });

  for (const t of document.querySelectorAll('.wb-week-table')) {
    t.addEventListener('click', (e) => {
      const sortBtn = e.target.closest('.wb-sort');
      if (sortBtn) {
        const c = sortBtn.dataset.col;
        wb.sort = {col: c, dir: wb.sort.col === c ? -wb.sort.dir : (numeric.has(c) || c === 'date' ? -1 : 1)};
        for (const th of t.querySelectorAll('th')) {
          const b = th.querySelector('.wb-sort');
          if (b) th.setAttribute('aria-sort', b.dataset.col === wb.sort.col ? (wb.sort.dir === 1 ? 'ascending' : 'descending') : 'none');
        }
        dash.draw('week-table');
        return;
      }
      const tr = e.target.closest('tr[data-key]');
      if (tr) { dash.setParams({pick: tr.dataset.key}); document.getElementById('player-bids')?.scrollIntoView({behavior: 'smooth', block: 'nearest'}); }
    });
  }

  // one player's bids
  const pickRow = () => {
    const all = wb.rows('bids');
    const k = dash.params().pick;
    return all && k ? all.find((r) => r.key === k) : null;
  };
  dash.draw('pick-name', (el) => {
    const r = pickRow();
    el.setAttribute('data-where', 'key=' + enc(dash.params().pick || ''));
    el.textContent = r ? r.player : '—';
  });
  dash.draw('pick-date', (el) => {
    const r = pickRow();
    el.setAttribute('data-where', 'key=' + enc(dash.params().pick || ''));
    el.textContent = r ? day(parseDay(r.date)) : '—';
  });
  dash.draw('pick-table', (tbody) => {
    const all = wb.rows('bid_entries');
    const k = dash.params().pick;
    if (!all || !k) { tbody.replaceChildren(); return; }
    const rows = all.filter((r) => r.key === k).sort((a, b) => (a.result === 'Won' ? -1 : b.result === 'Won' ? 1 : b.bid - a.bid));
    tbody.replaceChildren(...rows.map((r) => {
      const tr = document.createElement('tr');
      tr.dataset.key = enc(r.key) + ',' + enc(r.team);
      const a = document.createElement('td'); a.textContent = r.team;
      const b = document.createElement('td'); b.textContent = money(r.bid); b.className = 'wb-num';
      const c = document.createElement('td'); c.textContent = r.result; c.className = r.result === 'Won' ? 'wb-result-won' : 'wb-result-lost';
      tr.append(a, b, c);
      return tr;
    }));
  });

  // show and hide
  dash.onData(() => {
    const f = wb.rows('faab');
    const zc = f && f[0] ? f[0].zero_count : null;
    for (const el of document.querySelectorAll('.wb-zero-some')) el.hidden = !(zc > 0);
    for (const el of document.querySelectorAll('.wb-zero-none')) el.hidden = zc !== 0;
    const w = wb.week();
    for (const el of document.querySelectorAll('.wb-week-sentence')) el.hidden = w === 'all';
    for (const el of document.querySelectorAll('.wb-all-sentence')) el.hidden = w !== 'all';
    const k = dash.params().pick;
    for (const el of document.querySelectorAll('.wb-pick-empty')) el.hidden = !!k;
    for (const el of document.querySelectorAll('.wb-pick-detail')) el.hidden = !k;
  });

