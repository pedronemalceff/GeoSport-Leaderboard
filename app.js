/* GeoSport Tracker — manual score tracker for GeoSports (geosports.app)
   Plain JS + Chart.js. Data lives in localStorage and data/scores.json in the repo. */

const WEIGHTS = [1, 1, 2, 3, 3];
const MAX_DAY = 1000;
const LS_DATA = 'gst-data';
const LS_GH = 'gst-gh';
const LS_THEME = 'gst-theme';
const LS_RANGE = 'gst-range';
const TIERS = [
  { key: 'perfect', label: 'Perfect', test: s => s === 100, var: '--t-perfect' },
  { key: 'great', label: 'Great', test: s => s >= 90 && s < 100, var: '--t-great' },
  { key: 'ballpark', label: 'Ballpark', test: s => s >= 50 && s < 90, var: '--t-ballpark' },
  { key: 'miles', label: 'Miles off', test: s => s >= 1 && s < 50, var: '--t-miles' },
  { key: 'anti', label: 'Antipodal', test: s => s === 0, var: '--t-anti' },
];

/* ---------- utils ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n).toLocaleString();
const fmt1 = n => (Math.round(n * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const uid = () => Math.random().toString(36).slice(2, 10);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
function todayET() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(d, n) {
  const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10);
}
function dayDiff(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5); }
function dateRange(a, b) { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; }
function prettyDate(d, opts = { month: 'short', day: 'numeric' }) {
  return new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
}
const dayTotal = q => q.reduce((s, v, i) => s + (Number(v) || 0) * WEIGHTS[i], 0);
const tierOf = s => TIERS.find(t => t.test(s)) || TIERS[4];
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------- state ---------- */
let data = emptyData();
let repoUpdatedAt = null;
let range = store.get(LS_RANGE, 'all');
let logLimit = 15;
const charts = {};

function emptyData() { return { version: 1, updatedAt: null, players: [], games: [] }; }
function normalize(d) {
  const out = emptyData();
  if (!d || typeof d !== 'object') return out;
  out.updatedAt = d.updatedAt || null;
  out.players = (d.players || []).filter(p => p && p.id && p.name).map(p => ({ id: String(p.id), name: String(p.name) }));
  const ids = new Set(out.players.map(p => p.id));
  out.games = (d.games || [])
    .filter(g => g && ids.has(g.player) && /^\d{4}-\d{2}-\d{2}$/.test(g.date) && Array.isArray(g.q) && g.q.length === 5)
    .map(g => ({ id: g.id || uid(), date: g.date, player: g.player, q: g.q.map(v => Math.max(0, Math.min(100, Math.round(Number(v) || 0)))), ...(g.demo ? { demo: true } : {}) }));
  return out;
}
function save({ push = true } = {}) {
  data.updatedAt = new Date().toISOString();
  store.set(LS_DATA, data);
  render();
  const gh = store.get(LS_GH, {});
  if (push && gh.auto && gh.token) ghPush(true);
}
const playerById = id => data.players.find(p => p.id === id);
const playerColor = id => {
  const i = data.players.findIndex(p => p.id === id);
  return css(`--s${(i % 8) + 1}`);
};

async function load() {
  let repo = null;
  try {
    const r = await fetch('data/scores.json', { cache: 'no-store' });
    if (r.ok) repo = normalize(await r.json());
  } catch {}
  repoUpdatedAt = repo?.updatedAt || null;
  const local = store.get(LS_DATA, null);
  if (local && (!repo || (local.updatedAt || '') >= (repo.updatedAt || ''))) data = normalize(local);
  else if (repo) { data = repo; store.set(LS_DATA, data); }
  render();
}

/* ---------- derived stats ---------- */
function rangeBounds() {
  const today = todayET();
  if (range === 'all') {
    const first = data.games.reduce((m, g) => (g.date < m ? g.date : m), today);
    return { start: first, end: today };
  }
  return { start: addDays(today, -(Number(range) - 1)), end: today };
}
const gamesIn = (a, b) => data.games.filter(g => g.date >= a && g.date <= b);

function streaks(pid) {
  const dates = [...new Set(data.games.filter(g => g.player === pid).map(g => g.date))].sort();
  let best = 0, run = 0, prev = null;
  for (const d of dates) { run = prev && dayDiff(prev, d) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  // current streak: must include today or yesterday (today's game may not be played yet)
  const today = todayET();
  let cur = 0;
  if (prev && dayDiff(prev, today) <= 1) {
    cur = 1;
    for (let i = dates.length - 1; i > 0; i--) { if (dayDiff(dates[i - 1], dates[i]) === 1) cur++; else break; }
  }
  return { best, cur };
}

function dailyWinners(games) {
  const byDate = {};
  games.forEach(g => (byDate[g.date] ||= []).push(g));
  const wins = {};
  let contested = 0;
  Object.values(byDate).forEach(list => {
    if (list.length < 2) return;
    contested++;
    const top = Math.max(...list.map(g => dayTotal(g.q)));
    list.filter(g => dayTotal(g.q) === top).forEach(g => (wins[g.player] = (wins[g.player] || 0) + 1));
  });
  return { wins, contested };
}

function playerStats(games) {
  const { wins } = dailyWinners(games);
  return data.players.map(p => {
    const gs = games.filter(g => g.player === p.id);
    const totals = gs.map(g => dayTotal(g.q));
    const taps = gs.flatMap(g => g.q);
    return {
      p, games: gs.length,
      total: totals.reduce((a, b) => a + b, 0),
      avg: gs.length ? totals.reduce((a, b) => a + b, 0) / gs.length : 0,
      best: gs.length ? Math.max(...totals) : 0,
      perfect: taps.filter(s => s === 100).length,
      wins: wins[p.id] || 0,
    };
  });
}
function avgFor(pid, a, b) {
  const gs = gamesIn(a, b).filter(g => g.player === pid);
  return gs.length ? gs.reduce((s, g) => s + dayTotal(g.q), 0) / gs.length : null;
}

/* ---------- render ---------- */
function render() {
  const has = data.games.length > 0;
  const hasPlayers = data.players.length > 0;
  $('#emptyState').hidden = has;
  $('#dash').hidden = !hasPlayers;
  $('#dash').classList.toggle('only-podium', !has);
  $('#emptyMsg').textContent = hasPlayers
    ? 'Hit + Add score after today’s round.'
    : 'Add players in Settings, then log your first score. Or load demo data to see the dashboard.';
  $('#demoBanner').hidden = !data.games.some(g => g.demo);
  renderBadge();
  document.querySelectorAll('#rangeSeg button').forEach(b => b.setAttribute('aria-selected', b.dataset.range === range));
  if (!hasPlayers) return;
  const { start, end } = rangeBounds();
  $('#rangeNote').textContent = has ? `${prettyDate(start)} – ${prettyDate(end)}` : '';
  const games = gamesIn(start, end);
  renderPodium(games);
  if (!has) return;
  renderKpis();
  renderLeaderboard(games);
  renderDaily(start, end);
  renderRace(start, end);
  renderQ(games);
  renderTiers(games);
  renderWins(games);
  renderH2H(games);
  renderHeat();
  renderRecords();
  renderLog();
}

function renderPodium(games) {
  const label = { 7: 'Last 7 days', 30: 'Last 30 days', 90: 'Last 90 days', all: 'All time' }[range];
  $('#podiumNote').textContent = `${label} · total points`;
  const rows = playerStats(games).sort((a, b) => b.total - a.total || b.avg - a.avg || data.players.indexOf(a.p) - data.players.indexOf(b.p)).slice(0, 3);
  const medals = ['🥇', '🥈', '🥉'];
  const leader = rows[0]?.total || 0;
  const html = [0, 1, 2].map(i => {
    const r = rows[i];
    if (!r) return `<div class="pod p${i + 1} empty"><div class="medal">${medals[i]}</div><div class="avatar">?</div><div class="pn muted">Open spot</div><div class="pts">–</div><div class="step">${i + 1}</div></div>`;
    const c = playerColor(r.p.id);
    const gap = !r.games ? 'No games yet'
      : i === 0 ? (rows[1] && rows[1].total < r.total ? `+${fmt(r.total - rows[1].total)} lead` : rows[1] ? 'Tied' : 'Leader')
      : (leader - r.total ? `${fmt(leader - r.total)} back` : 'Tied for 1st');
    return `<div class="pod p${i + 1}">
      <div class="medal">${medals[i]}</div>
      <div class="avatar" style="background:${c};--ring:${c}">${esc(r.p.name.trim()[0]?.toUpperCase() || '?')}</div>
      <div class="pn">${esc(r.p.name)}</div>
      <div class="pts">${fmt(r.total)}<small>pts</small></div>
      <div class="pmeta">${r.games ? `${fmt(r.avg)} avg · ${r.games} games · ${r.wins} wins` : '&nbsp;'}</div>
      <div class="gap">${gap}</div>
      <div class="step">${i + 1}</div></div>`;
  }).join('');
  $('#podium').innerHTML = html;
}

function renderBadge() {
  const b = $('#syncBadge');
  if (!data.games.length) { b.hidden = true; return; }
  b.hidden = false;
  const dirty = data.updatedAt && (!repoUpdatedAt || data.updatedAt > repoUpdatedAt);
  b.textContent = dirty ? '● Not saved to repo' : '✓ In sync with repo';
  b.title = dirty ? 'Export JSON or push via GitHub sync (Settings)' : '';
}

function deltaHtml(cur, prev) {
  if (cur == null || prev == null) return '<span class="muted">no prior data</span>';
  const d = cur - prev;
  if (Math.abs(d) < 0.5) return '<span class="muted">→ flat vs prior</span>';
  return `<span class="${d > 0 ? 'delta-up' : 'delta-down'}">${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d))}</span> <span class="muted">vs prior</span>`;
}

function renderKpis() {
  const today = todayET();
  const all = playerStats(data.games).filter(s => s.games).sort((a, b) => b.total - a.total);
  const lead = all[0], second = all[1];
  const tile = (label, valueHtml, meta, hero) =>
    `<div class="kpi${hero ? ' hero' : ''}"><div class="label">${label}</div><div class="value">${valueHtml}</div><div class="meta">${meta}</div></div>`;
  const who = s => `<span class="swatch" style="background:${playerColor(s.p.id)}"></span><span class="nm">${esc(s.p.name)}</span>`;

  const trendTile = (days, label) => {
    const a = addDays(today, -(days - 1)), pa = addDays(today, -(2 * days - 1)), pb = addDays(today, -days);
    const rows = data.players.map(p => ({ p, cur: avgFor(p.id, a, today), prev: avgFor(p.id, pa, pb) })).filter(r => r.cur != null);
    if (!rows.length) return tile(label, '—', 'No games in this window');
    rows.sort((x, y) => y.cur - x.cur);
    const r = rows[0];
    return tile(label, `${who(r)}`, `${fmt(r.cur)} avg · ${deltaHtml(r.cur, r.prev)}`);
  };

  const todays = data.games.filter(g => g.date === today).map(g => ({ g, t: dayTotal(g.q) })).sort((a, b) => b.t - a.t);
  const todayTile = todays.length
    ? tile("Today's best", `${who({ p: playerById(todays[0].g.player) })}`, `${fmt(todays[0].t)} pts · ${todays.length} of ${data.players.length} played`)
    : tile("Today's best", '—', 'No scores yet today');

  $('#kpis').innerHTML =
    tile('All-time leader', `<span class="crown">👑</span>${who(lead)}`,
      `${fmt(lead.total)} pts${second ? ` · +${fmt(lead.total - second.total)} over ${esc(second.p.name)}` : ''}`, true) +
    trendTile(7, '1-week leader') +
    trendTile(30, '1-month leader') +
    todayTile;
}

function renderLeaderboard(games) {
  const today = todayET();
  const rows = playerStats(games).filter(s => s.games).sort((a, b) => b.total - a.total || b.avg - a.avg);
  const maxT = Math.max(1, ...rows.map(r => r.total));
  $('#lbNote').textContent = `${games.length} games in range`;
  const head = `<tr><th>#</th><th class="name">Player</th><th>Total</th><th>Avg</th><th>Best</th><th>Games</th><th>Wins</th><th>Perfects</th><th>Streak</th><th>7D trend</th><th>Last 5</th></tr>`;
  const body = rows.map((r, i) => {
    const cur = avgFor(r.p.id, addDays(today, -6), today), prev = avgFor(r.p.id, addDays(today, -13), addDays(today, -7));
    let trend = '<span class="muted">—</span>';
    if (cur != null && prev != null) {
      const d = cur - prev;
      trend = Math.abs(d) < 0.5 ? '<span class="muted">→</span>' : `<span class="${d > 0 ? 'delta-up' : 'delta-down'}">${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d))}</span>`;
    }
    const last5 = data.games.filter(g => g.player === r.p.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).reverse()
      .map(g => { const t = dayTotal(g.q); return `<span class="dot" title="${prettyDate(g.date)}: ${t}" style="background:${css(tierOf(Math.round(t / 10)).var)}"></span>`; }).join('');
    const st = streaks(r.p.id);
    const color = playerColor(r.p.id);
    return `<tr class="${i === 0 ? 'lead' : ''}">
      <td>${i + 1}</td>
      <td class="name"><span class="pname"><span class="swatch" style="background:${color}"></span>${esc(r.p.name)}</span></td>
      <td><span class="bar-cell" style="width:${Math.max(4, (r.total / maxT) * 70)}px;background:${color}"></span>${fmt(r.total)}</td>
      <td>${fmt(r.avg)}</td><td>${fmt(r.best)}</td><td>${r.games}</td><td>${r.wins}</td><td>${r.perfect}</td>
      <td>${st.cur ? `🔥 ${st.cur}` : '<span class="muted">0</span>'}</td>
      <td>${trend}</td>
      <td><span class="dots">${last5}</span></td></tr>`;
  }).join('');
  $('#leaderboard').innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
}

/* ---------- charts ---------- */
function baseOpts(extra = {}) {
  const ink2 = css('--ink-2'), muted = css('--muted'), grid = css('--grid'), axis = css('--axis');
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { color: ink2, usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, boxHeight: 10, padding: 14, font: { size: 12 } } },
      tooltip: {
        backgroundColor: css('--surface'), titleColor: css('--ink'), bodyColor: ink2, borderColor: css('--border'), borderWidth: 1,
        padding: 10, cornerRadius: 8, usePointStyle: true, boxPadding: 4,
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: axis }, ticks: { color: muted, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 16 } },
      y: { grid: { color: grid }, border: { display: false }, ticks: { color: muted, font: { size: 11 } }, beginAtZero: true },
    },
    ...extra,
  };
}
function mkChart(id, cfg) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id), cfg);
}
const activePlayers = games => data.players.filter(p => games.some(g => g.player === p.id));

function renderDaily(start, end) {
  const days = dateRange(start, end);
  const rolling = $('#rollToggle').checked;
  const games = gamesIn(addDays(start, -6), end);
  const players = activePlayers(gamesIn(start, end));
  const datasets = players.map(p => {
    const map = {}; games.filter(g => g.player === p.id).forEach(g => (map[g.date] = dayTotal(g.q)));
    const values = days.map(d => {
      if (!rolling) return map[d] ?? null;
      const win = dateRange(addDays(d, -6), d).map(x => map[x]).filter(v => v != null);
      return win.length ? Math.round(win.reduce((a, b) => a + b, 0) / win.length) : null;
    });
    const c = playerColor(p.id);
    return { label: p.name, data: values, borderColor: c, backgroundColor: c, borderWidth: 2, tension: 0.3, spanGaps: true,
      pointRadius: days.length > 45 ? 0 : 3, pointHoverRadius: 5, pointBorderWidth: 2, pointBorderColor: css('--surface') };
  });
  mkChart('dailyChart', {
    type: 'line',
    data: { labels: days.map(d => prettyDate(d)), datasets },
    options: baseOpts({ scales: { ...baseOpts().scales, y: { ...baseOpts().scales.y, max: MAX_DAY } } }),
  });
}

function renderRace(start, end) {
  const days = dateRange(start, end);
  const games = gamesIn(start, end);
  const players = activePlayers(games);
  const datasets = players.map(p => {
    const map = {}; games.filter(g => g.player === p.id).forEach(g => (map[g.date] = dayTotal(g.q)));
    let acc = 0;
    const c = playerColor(p.id);
    return { label: p.name, data: days.map(d => (acc += map[d] || 0)), borderColor: c, backgroundColor: c, borderWidth: 2,
      pointRadius: 0, pointHoverRadius: 5, tension: 0.2, stepped: false };
  });
  mkChart('raceChart', { type: 'line', data: { labels: days.map(d => prettyDate(d)), datasets }, options: baseOpts() });
}

function renderQ(games) {
  const players = activePlayers(games);
  const datasets = players.map(p => {
    const gs = games.filter(g => g.player === p.id);
    const c = playerColor(p.id);
    return { label: p.name, data: [0, 1, 2, 3, 4].map(i => Math.round(gs.reduce((s, g) => s + g.q[i], 0) / gs.length)),
      backgroundColor: c, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 22, categoryPercentage: 0.7, barPercentage: 0.9 };
  });
  const opts = baseOpts();
  opts.scales.y.max = 100;
  opts.plugins.tooltip.callbacks = { label: c => ` ${c.dataset.label}: ${c.parsed.y} avg (${c.parsed.y * WEIGHTS[c.dataIndex]} weighted)` };
  mkChart('qChart', { type: 'bar', data: { labels: ['Q1 ×1', 'Q2 ×1', 'Q3 ×2', 'Q4 ×3', 'Q5 ×3'], datasets }, options: opts });
}

function renderWins(games) {
  const { wins, contested } = dailyWinners(games);
  const players = activePlayers(games).sort((a, b) => (wins[b.id] || 0) - (wins[a.id] || 0));
  const opts = baseOpts({ indexAxis: 'y', interaction: { mode: 'nearest', intersect: true } });
  opts.plugins.legend.display = false;
  opts.scales = {
    x: { ...opts.scales.y, ticks: { ...opts.scales.y.ticks, precision: 0 } },
    y: { grid: { display: false }, border: { color: css('--axis') }, ticks: { color: css('--ink-2'), font: { size: 12 } } },
  };
  opts.plugins.tooltip.callbacks = { label: c => ` ${c.parsed.x} wins of ${contested} contested days` };
  mkChart('winsChart', {
    type: 'bar',
    data: { labels: players.map(p => p.name), datasets: [{ data: players.map(p => wins[p.id] || 0),
      backgroundColor: players.map(p => playerColor(p.id)), borderRadius: 4, borderSkipped: 'start', maxBarThickness: 26 }] },
    options: opts,
  });
}

function renderTiers(games) {
  const players = activePlayers(games);
  const rows = players.map(p => {
    const taps = games.filter(g => g.player === p.id).flatMap(g => g.q);
    const counts = TIERS.map(t => taps.filter(t.test).length);
    const segs = TIERS.map((t, i) => counts[i]
      ? `<span style="width:${(counts[i] / taps.length) * 100}%;background:${css(t.var)}" title="${t.label}: ${counts[i]} (${Math.round((counts[i] / taps.length) * 100)}%)"></span>` : '').join('');
    const good = Math.round(((counts[0] + counts[1]) / taps.length) * 100);
    return `<div class="tier-row"><div class="tier-top"><span class="pname"><span class="swatch" style="background:${playerColor(p.id)}"></span>${esc(p.name)}</span>
      <span class="muted">${good}% great or better · ${taps.length} taps</span></div><div class="tier-bar">${segs}</div></div>`;
  }).join('');
  const legend = `<div class="tier-legend">${TIERS.map(t => `<span><i style="background:${css(t.var)}"></i>${t.label}</span>`).join('')}</div>`;
  $('#tierBars').innerHTML = rows + legend;
}

function renderH2H(games) {
  const players = activePlayers(games);
  if (players.length < 2) { $('#h2h').innerHTML = '<tbody><tr><td class="muted">Needs 2+ players</td></tr></tbody>'; return; }
  const byDate = {}; games.forEach(g => ((byDate[g.date] ||= {})[g.player] = dayTotal(g.q)));
  const rec = (a, b) => {
    let w = 0, l = 0, t = 0;
    Object.values(byDate).forEach(d => { if (d[a] == null || d[b] == null) return; d[a] > d[b] ? w++ : d[a] < d[b] ? l++ : t++; });
    return { w, l, t };
  };
  const head = `<tr><th></th>${players.map(p => `<th><span class="pname"><span class="swatch" style="background:${playerColor(p.id)}"></span>${esc(p.name)}</span></th>`).join('')}</tr>`;
  const body = players.map(a => `<tr><td><span class="pname"><span class="swatch" style="background:${playerColor(a.id)}"></span>${esc(a.name)}</span></td>${players.map(b => {
    if (a.id === b.id) return '<td class="self">—</td>';
    const r = rec(a.id, b.id);
    if (!r.w && !r.l && !r.t) return '<td class="muted">0-0</td>';
    return `<td class="${r.w > r.l ? 'win' : r.w < r.l ? 'lose' : ''}">${r.w}-${r.l}${r.t ? `-${r.t}` : ''}</td>`;
  }).join('')}</tr>`).join('');
  $('#h2h').innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
}

const HEAT_STEPS = [[0, '--q1', '<400'], [400, '--q2', '400+'], [550, '--q3', '550+'], [700, '--q4', '700+'], [800, '--q5', '800+'], [900, '--q6', '900+']];
function heatVar(t) { let v = HEAT_STEPS[0][1]; HEAT_STEPS.forEach(([min, cv]) => { if (t >= min) v = cv; }); return v; }

function renderHeat() {
  const sel = $('#heatPlayer');
  const prev = sel.value;
  sel.innerHTML = data.players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  sel.value = data.players.some(p => p.id === prev) ? prev : data.players[0]?.id;
  const pid = sel.value;
  const today = todayET();
  const map = {}; data.games.filter(g => g.player === pid).forEach(g => (map[g.date] = dayTotal(g.q)));
  // 26 weeks, columns start Sunday
  const dow = new Date(today + 'T00:00:00Z').getUTCDay();
  const start = addDays(today, -dow - 7 * 25);
  let html = '', lastMonth = null;
  for (let w = 0; w < 26; w++) {
    const colStart = addDays(start, w * 7);
    const m = colStart.slice(0, 7);
    html += `<div class="mo" style="grid-column:${w + 1}">${m !== lastMonth ? prettyDate(colStart, { month: 'short' }) : ''}</div>`;
    lastMonth = m;
    for (let d = 0; d < 7; d++) {
      const day = addDays(colStart, d);
      const style = `grid-column:${w + 1};grid-row:${d + 2}`;
      if (day > today) { html += `<div class="c out" style="${style}"></div>`; continue; }
      const t = map[day];
      html += t == null
        ? `<div class="c" style="${style}" title="${prettyDate(day)}: not played"></div>`
        : `<div class="c" style="${style};background:var(${heatVar(t)})" title="${prettyDate(day)}: ${t}"></div>`;
    }
  }
  $('#heat').innerHTML = html;
  $('#heatLegend').innerHTML = `<span>Not played</span><span class="c" style="background:var(--q0)"></span><span style="margin-left:10px">Score</span>` +
    HEAT_STEPS.map(([, v, l]) => `<span class="c" style="background:var(${v})" title="${l}"></span>`).join('') + '<span>900+</span>';
}

function renderRecords() {
  const all = data.games.map(g => ({ g, t: dayTotal(g.q) }));
  const who = id => { const p = playerById(id); return `<span class="swatch" style="background:${playerColor(id)}"></span>${esc(p?.name || '?')}`; };
  const recs = [];
  const best = all.reduce((m, x) => (!m || x.t > m.t ? x : m), null);
  if (best) recs.push(['Best single day', fmt(best.t), `${who(best.g.player)} · ${prettyDate(best.g.date, { month: 'short', day: 'numeric', year: 'numeric' })}`]);
  const stats = playerStats(data.games);
  const avgs = stats.filter(s => s.games >= 5).sort((a, b) => b.avg - a.avg);
  if (avgs[0]) recs.push(['Highest average', fmt1(avgs[0].avg), `${who(avgs[0].p.id)} · min 5 games`]);
  const st = data.players.map(p => ({ p, s: streaks(p.id).best })).sort((a, b) => b.s - a.s);
  if (st[0]?.s) recs.push(['Longest streak', `${st[0].s} days`, who(st[0].p.id)]);
  const perf = [...stats].sort((a, b) => b.perfect - a.perfect);
  if (perf[0]?.perfect) recs.push(['Most perfect taps', perf[0].perfect, who(perf[0].p.id)]);
  const wins = [...stats].sort((a, b) => b.wins - a.wins);
  if (wins[0]?.wins) recs.push(['Most daily wins', wins[0].wins, who(wins[0].p.id)]);
  // best rolling 7-day total
  let bw = null;
  data.players.forEach(p => {
    const map = {}; data.games.filter(g => g.player === p.id).forEach(g => (map[g.date] = dayTotal(g.q)));
    Object.keys(map).forEach(endD => {
      const sum = dateRange(addDays(endD, -6), endD).reduce((s, d) => s + (map[d] || 0), 0);
      if (!bw || sum > bw.sum) bw = { sum, p, endD };
    });
  });
  if (bw) recs.push(['Best 7-day stretch', fmt(bw.sum), `${who(bw.p.id)} · week ending ${prettyDate(bw.endD)}`]);
  $('#records').innerHTML = recs.map(([l, v, w]) => `<div class="rec"><div class="l">${l}</div><div class="v">${v}</div><div class="w">${w}</div></div>`).join('');
}

function renderLog() {
  const sel = $('#logPlayer');
  const prev = sel.value;
  sel.innerHTML = '<option value="">All players</option>' + data.players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  sel.value = prev && data.players.some(p => p.id === prev) ? prev : '';
  const list = data.games.filter(g => !sel.value || g.player === sel.value)
    .sort((a, b) => b.date.localeCompare(a.date) || dayTotal(b.q) - dayTotal(a.q));
  const rows = list.slice(0, logLimit).map(g => `<tr data-id="${g.id}">
    <td>${prettyDate(g.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
    <td style="text-align:left"><span class="pname"><span class="swatch" style="background:${playerColor(g.player)}"></span>${esc(playerById(g.player)?.name)}</span></td>
    <td><span class="dots">${g.q.map((s, i) => `<span class="dot" title="Q${i + 1}: ${s}" style="background:${css(tierOf(s).var)}"></span>`).join('')}</span></td>
    <td class="muted">${g.q.join(' · ')}</td>
    <td><strong>${fmt(dayTotal(g.q))}</strong></td>
    <td><button class="btn ghost icon edit" title="Edit">✎</button><button class="btn ghost icon del" title="Delete">🗑</button></td></tr>`).join('');
  $('#log').innerHTML = `<thead><tr><th>Date</th><th style="text-align:left">Player</th><th>Taps</th><th>Base scores</th><th>Total</th><th></th></tr></thead><tbody>${rows}</tbody>`;
  $('#moreLog').hidden = list.length <= logLimit;
}

/* ---------- add / edit dialog ---------- */
let editingId = null;
function buildQInputs() {
  $('#qInputs').innerHTML = WEIGHTS.map((w, i) => `<div class="q">
    <span class="qh">Q${i + 1}</span><span class="qm">×${w}</span>
    <input type="number" min="0" max="100" inputmode="numeric" data-q="${i}" placeholder="0" aria-label="Question ${i + 1} base score">
    <span class="qdot"></span><span class="qw">0</span></div>`).join('');
}
function readQ() { return [...document.querySelectorAll('#qInputs input')].map(i => i.value === '' ? null : Math.max(0, Math.min(100, Math.round(Number(i.value))))); }
function updateTotal() {
  const q = readQ();
  document.querySelectorAll('#qInputs .q').forEach((el, i) => {
    el.querySelector('.qdot').style.background = q[i] == null ? 'var(--q0)' : css(tierOf(q[i]).var);
    el.querySelector('.qw').textContent = q[i] == null ? '–' : q[i] * WEIGHTS[i];
  });
  $('#fTotal').textContent = fmt(dayTotal(q.map(v => v ?? 0)));
}
function openAdd(game) {
  if (!data.players.length) { openSettings(); toast('Add a player first'); return; }
  editingId = game?.id || null;
  $('#addTitle').textContent = game ? 'Edit score' : 'Add score';
  $('#fPlayer').innerHTML = data.players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('#fPlayer').value = game?.player || store.get('gst-last-player', data.players[0].id);
  if (!$('#fPlayer').value) $('#fPlayer').value = data.players[0].id;
  $('#fDate').value = game?.date || todayET();
  $('#fDate').max = todayET();
  $('#fPaste').value = '';
  document.querySelectorAll('#qInputs input').forEach((inp, i) => (inp.value = game ? game.q[i] : ''));
  $('#formMsg').textContent = ''; $('#formMsg').className = 'form-msg';
  updateTotal();
  $('#addDlg').showModal();
  setTimeout(() => document.querySelector('#qInputs input').focus(), 50);
}
function parsePaste(text) {
  const nums = (text.match(/\d+/g) || []).map(Number);
  const windows = [];
  for (let i = 0; i + 5 <= nums.length; i++) { const w = nums.slice(i, i + 5); if (w.every(n => n <= 100)) windows.push(w); }
  if (!windows.length) return null;
  const totals = new Set(nums.filter(n => n > 100 && n <= 1000));
  return windows.find(w => totals.has(dayTotal(w))) || windows[windows.length - 1];
}
function submitScore(e) {
  e.preventDefault();
  const q = readQ();
  const msg = $('#formMsg');
  if (q.some(v => v == null)) { msg.textContent = 'Enter all 5 base scores (0–100).'; msg.className = 'form-msg err'; return; }
  const player = $('#fPlayer').value, date = $('#fDate').value;
  if (!date) { msg.textContent = 'Pick a date.'; msg.className = 'form-msg err'; return; }
  let clearedDemo = false;
  if (data.games.some(g => g.demo) && !(editingId && data.games.find(g => g.id === editingId)?.demo)) {
    data.games = data.games.filter(g => !g.demo); clearedDemo = true; editingId = null;
  }
  const dup = data.games.find(g => g.player === player && g.date === date && g.id !== editingId);
  if (editingId) {
    const g = data.games.find(x => x.id === editingId);
    Object.assign(g, { player, date, q }); delete g.demo;
    if (dup) data.games = data.games.filter(x => x !== dup);
  } else if (dup) {
    dup.q = q;
  } else {
    data.games.push({ id: uid(), date, player, q });
  }
  store.set('gst-last-player', player);
  $('#addDlg').close();
  save();
  toast(`${dup && !editingId ? 'Updated' : 'Saved'} ${playerById(player).name}: ${fmt(dayTotal(q))} pts${clearedDemo ? ' · demo data cleared' : ''}`);
}

/* ---------- settings ---------- */
function openSettings() {
  renderPlayers();
  const gh = store.get(LS_GH, {});
  $('#ghOwner').value = gh.owner || ''; $('#ghRepo').value = gh.repo || ''; $('#ghBranch').value = gh.branch || '';
  $('#ghToken').value = gh.token || ''; $('#ghAuto').checked = !!gh.auto;
  $('#ghMsg').textContent = '';
  if (!$('#setDlg').open) $('#setDlg').showModal();
}
function renderPlayers() {
  $('#playerList').innerHTML = data.players.map(p => {
    const n = data.games.filter(g => g.player === p.id).length;
    return `<li data-id="${p.id}"><span class="swatch" style="background:${playerColor(p.id)}"></span>
      <input type="text" value="${esc(p.name)}" maxlength="20" aria-label="Player name">
      <span class="muted small">${n} games</span>
      <button class="btn ghost icon rm" type="button" title="Remove player">✕</button></li>`;
  }).join('') || '<li class="muted small">No players yet</li>';
}
function addPlayer() {
  const name = $('#newPlayer').value.trim();
  if (!name) return;
  if (data.players.some(p => p.name.toLowerCase() === name.toLowerCase())) { toast('That player already exists'); return; }
  data.players.push({ id: uid(), name });
  $('#newPlayer').value = '';
  save({ push: false }); renderPlayers();
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- GitHub sync ---------- */
const DATA_PATH = 'data/scores.json';
const b64enc = s => btoa(unescape(encodeURIComponent(s)));
const b64dec = s => decodeURIComponent(escape(atob(s.replace(/\n/g, ''))));
function ghCfg() {
  const gh = store.get(LS_GH, {});
  if (!gh.owner || !gh.repo || !gh.token) throw new Error('Fill in owner, repo and token first.');
  return { ...gh, branch: gh.branch || 'main' };
}
async function ghReq(method, cfg, body) {
  const url = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${DATA_PATH}` + (method === 'GET' ? `?ref=${encodeURIComponent(cfg.branch)}` : '');
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json' }, body: body && JSON.stringify(body), cache: 'no-store' });
  if (!r.ok && !(method === 'GET' && r.status === 404)) throw new Error(`GitHub ${r.status}: ${(await r.json().catch(() => ({}))).message || r.statusText}`);
  return r.status === 404 ? null : r.json();
}
async function ghPush(silent) {
  const msg = $('#ghMsg');
  try {
    const cfg = ghCfg();
    if (!silent) msg.textContent = 'Pushing…';
    const cur = await ghReq('GET', cfg);
    await ghReq('PUT', cfg, {
      message: `Update scores ${todayET()}`, branch: cfg.branch, sha: cur?.sha,
      content: b64enc(JSON.stringify(data, null, 2) + '\n'),
    });
    repoUpdatedAt = data.updatedAt; renderBadge();
    msg.textContent = '✓ Pushed to repo. GitHub Pages updates in about a minute.'; msg.className = 'form-msg';
    if (silent) toast('Pushed to GitHub');
  } catch (e) {
    msg.textContent = e.message; msg.className = 'form-msg err';
    if (silent) toast('GitHub push failed. Check Settings.');
  }
}
async function ghPull() {
  const msg = $('#ghMsg');
  try {
    const cfg = ghCfg();
    msg.textContent = 'Pulling…';
    const cur = await ghReq('GET', cfg);
    if (!cur) throw new Error(`No ${DATA_PATH} in that repo yet. Push first.`);
    data = normalize(JSON.parse(b64dec(cur.content)));
    repoUpdatedAt = data.updatedAt;
    store.set(LS_DATA, data); render(); renderPlayers();
    msg.textContent = `✓ Loaded ${data.games.length} games from repo.`; msg.className = 'form-msg';
  } catch (e) { msg.textContent = e.message; msg.className = 'form-msg err'; }
}

/* ---------- demo data ---------- */
function demoData() {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const names = [['Pedro', 0.78], ['Kaner', 0.74], ['Mitchell', 0.70]];
  const players = data.players.length ? data.players.slice(0, 3) : names.map(([name]) => ({ id: uid(), name }));
  const today = todayET(); const games = [];
  for (let d = 120; d >= 0; d--) {
    const date = addDays(today, -d);
    const hard = rnd() * 0.25; // day difficulty, shared by everyone
    players.forEach((p, i) => {
      if (rnd() < 0.12) return; // skipped a day
      const skill = (names[i] || names[2])[1] + (i === 2 ? (120 - d) / 900 : 0); // Mitchell improves over time
      const q = WEIGHTS.map((_, qi) => {
        const r = rnd();
        if (r < 0.03) return 0;
        const v = 100 * Math.pow(Math.min(1, Math.max(0, skill - hard - qi * 0.03 + (rnd() - 0.5) * 0.55)), 0.75);
        return v > 97 ? 100 : Math.round(v);
      });
      games.push({ id: uid(), date, player: p.id, q, demo: true });
    });
  }
  return { version: 1, updatedAt: new Date().toISOString(), players: data.players.length ? data.players : players, games: [...data.games.filter(g => !g.demo), ...games] };
}

/* ---------- theme ---------- */
function applyTheme(t) {
  if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
}
function toggleTheme() {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  store.set(LS_THEME, next); applyTheme(next); render();
}

/* ---------- wire up ---------- */
function init() {
  applyTheme(store.get(LS_THEME, null));
  if (window.Chart) Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  buildQInputs();

  $('#addBtn').onclick = () => openAdd();
  $('#emptyAdd').onclick = () => openAdd();
  $('#settingsBtn').onclick = openSettings;
  $('#themeBtn').onclick = toggleTheme;
  const removeDemo = () => { data.games = data.games.filter(g => !g.demo); save(); toast('Demo data removed'); };
  $('#removeDemo').onclick = removeDemo;
  $('#removeDemo2').onclick = removeDemo;
  $('#demoBtn').onclick = () => { data = demoData(); save({ push: false }); toast('Demo data loaded. Clear it in Settings.'); };
  $('#rangeSeg').onclick = e => { const r = e.target.dataset.range; if (r) { range = r; store.set(LS_RANGE, r); render(); } };
  $('#rollToggle').onchange = () => { const { start, end } = rangeBounds(); renderDaily(start, end); };
  $('#heatPlayer').onchange = renderHeat;
  $('#logPlayer').onchange = () => { logLimit = 15; renderLog(); };
  $('#moreLog').onclick = () => { logLimit += 30; renderLog(); };
  $('#log').onclick = e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const g = data.games.find(x => x.id === tr.dataset.id);
    if (e.target.closest('.del')) {
      data.games = data.games.filter(x => x !== g); save();
      toast(`Deleted ${playerById(g.player)?.name} · ${prettyDate(g.date)}`);
    } else if (e.target.closest('.edit')) openAdd(g);
  };

  $('#qInputs').addEventListener('input', updateTotal);
  $('#qInputs').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); const ins = [...document.querySelectorAll('#qInputs input')]; const i = ins.indexOf(e.target); i < 4 ? ins[i + 1].focus() : $('#saveScore').click(); }
  });
  $('#fPaste').addEventListener('input', e => {
    const q = parsePaste(e.target.value);
    const msg = $('#formMsg');
    if (!q) { msg.textContent = e.target.value.trim() ? 'Couldn’t find 5 scores (0–100) in that text.' : ''; msg.className = 'form-msg err'; return; }
    document.querySelectorAll('#qInputs input').forEach((inp, i) => (inp.value = q[i]));
    msg.textContent = `Pulled ${q.join(', ')}`; msg.className = 'form-msg';
    updateTotal();
  });
  $('#addForm').addEventListener('submit', e => { if (e.submitter?.value === 'cancel') return; submitScore(e); });

  $('#addPlayer').onclick = addPlayer;
  $('#newPlayer').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addPlayer(); } });
  $('#playerList').addEventListener('change', e => {
    const li = e.target.closest('li[data-id]'); if (!li || e.target.tagName !== 'INPUT') return;
    const p = playerById(li.dataset.id); const v = e.target.value.trim();
    if (v) { p.name = v; save({ push: false }); } else e.target.value = p.name;
  });
  $('#playerList').addEventListener('click', e => {
    if (!e.target.closest('.rm')) return;
    const li = e.target.closest('li[data-id]'); const p = playerById(li.dataset.id);
    const n = data.games.filter(g => g.player === p.id).length;
    if (n && !confirm(`Remove ${p.name} and their ${n} games?`)) return;
    data.players = data.players.filter(x => x !== p); data.games = data.games.filter(g => g.player !== p.id);
    save({ push: false }); renderPlayers();
  });
  $('#exportBtn').onclick = () => { download('scores.json', JSON.stringify(data, null, 2) + '\n'); toast('Downloaded scores.json. Commit it to data/ in the repo.'); };
  $('#importFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { data = normalize(JSON.parse(await f.text())); save({ push: false }); renderPlayers(); toast(`Imported ${data.games.length} games`); }
    catch { toast('That file isn’t valid JSON'); }
    e.target.value = '';
  };
  $('#reloadRepo').onclick = async () => {
    try {
      const r = await fetch('data/scores.json', { cache: 'no-store' });
      if (!r.ok) throw 0;
      data = normalize(await r.json()); repoUpdatedAt = data.updatedAt; store.set(LS_DATA, data);
      render(); renderPlayers(); toast(`Loaded ${data.games.length} games from repo file`);
    } catch { toast('Couldn’t load data/scores.json'); }
  };
  $('#clearBtn').onclick = () => {
    if (!confirm('Clear all players and scores from this browser?')) return;
    data = emptyData(); save({ push: false }); renderPlayers();
  };
  $('#ghSave').onclick = () => {
    store.set(LS_GH, { owner: $('#ghOwner').value.trim(), repo: $('#ghRepo').value.trim(), branch: $('#ghBranch').value.trim(), token: $('#ghToken').value.trim(), auto: $('#ghAuto').checked });
    $('#ghMsg').textContent = '✓ Saved in this browser.'; $('#ghMsg').className = 'form-msg';
  };
  $('#ghAuto').onchange = () => $('#ghSave').click();
  $('#ghPush').onclick = () => { $('#ghSave').click(); ghPush(false); };
  $('#ghPull').onclick = () => { $('#ghSave').click(); ghPull(); };

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!document.documentElement.dataset.theme) render(); });
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => renderBadge(), 150); });

  load();
}
document.addEventListener('DOMContentLoaded', init);
