// A small stand-in for the claude.ai Dashboard runtime the report was first written for:
// loads the JSON files in data/, runs calcs, and redraws every [data-draw] element when
// data, a filter or the width changes. Same API surface the report's scripts use.
(() => {
  const SOURCES = {
    bids: 'data/bids.json',
    bid_entries: 'data/bid_entries.json',
    team_fp: 'data/team_fp.json',
    budgets: 'data/budgets.json',
  };
  const store = {};
  const failed = {};
  const calcs = [];
  const draws = new Map();
  const onDatas = [];
  const params = {week: null, pick: null, team: null};

  const runCalcs = () => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of calcs) {
        if (c.id in store || !c.inputs.every((i) => i in store)) continue;
        store[c.id] = c.fn(...c.inputs.map((i) => store[i]));
        changed = true;
      }
    }
  };

  const drawOne = (name, fn) => {
    for (const el of document.querySelectorAll(`[data-draw="${CSS.escape(name)}"]`)) {
      if (el.closest('[hidden]')) continue;
      try { fn(el); } catch (err) { console.error(`draw ${name}:`, err); }
    }
  };

  const render = () => {
    for (const fn of onDatas) {
      try { fn(); } catch (err) { console.error('onData:', err); }
    }
    for (const [name, fn] of draws) drawOne(name, fn);
  };

  window.dash = {
    data(id) {
      if (id in store) return {status: 'ok', data: store[id]};
      const c = calcs.find((x) => x.id === id);
      const err = c ? c.inputs.some((i) => failed[i]) : failed[id];
      return {status: err ? 'error' : 'loading', data: []};
    },
    calc(id, {inputs, fn}) { calcs.push({id, inputs, fn}); },
    draw(name, fn) {
      if (fn) draws.set(name, fn);
      else if (draws.has(name)) drawOne(name, draws.get(name));
    },
    onData(fn) { onDatas.push(fn); },
    params: () => ({...params}),
    setParams(p) { Object.assign(params, p); render(); },
    setLink(name) { history.replaceState(null, '', '#' + name); },
  };

  let resizeTimer = 0;
  let lastWidth = 0;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastWidth) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { lastWidth = window.innerWidth; render(); }, 120);
  });

  document.addEventListener('DOMContentLoaded', () => {
    lastWidth = window.innerWidth;
    render();
    Promise.all(Object.entries(SOURCES).map(([id, url]) =>
      fetch(url, {cache: 'no-cache'})
        .then((r) => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); })
        .then((rows) => { store[id] = rows; })
        .catch((err) => { failed[id] = true; console.error(err); }),
    )).then(() => { runCalcs(); render(); });
  });
})();
