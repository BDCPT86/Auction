/*
 * Draft Day: random allocation
 * ----------------------------
 * The "Random allocation" format: no money, no bidding. Each reveal draws a
 * player and a team for them.
 *
 * The draw is worked out fresh for every reveal from the draw code plus the
 * number of players dealt so far, so the same code with the same teams,
 * players and picks always gives the same result. Nothing is planned ahead,
 * which keeps undo, roster fixes and reloading a saved event in step.
 *
 * Balanced (default): one tier at a time, highest first. Each player goes to a
 * team with the fewest of that tier so far, then the fewest players, then by
 * the draw. Tier limits and squad size always apply.
 */
const isRandom = () => EV.format === 'random';
let alloc = { seed: '', locked: false, last: null };
let _anim = null; // the team pick on screen: { start, dur, ids, target, mode }

// ── Seeded randomness ──
function hashStr(s) {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function seededRng(s) {
  let a = hashStr(s)();
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newDrawCode() {
  const r = new Uint32Array(9);
  (window.crypto || {}).getRandomValues ? crypto.getRandomValues(r) : r.forEach((_, i) => (r[i] = Math.random() * 1e9));
  return [...r].map(v => CODE_CHARS[v % CODE_CHARS.length]).join('');
}
// While a team pick is rolling, the drawn player is kept out of view so nothing gives the result away
const hiddenNo = () => (_anim && alloc.last ? alloc.last.n : null);
const teamView = t => {
  const n = hiddenNo();
  return n && t.players.some(p => p.drawNo === n) ? { ...t, players: t.players.filter(p => p.drawNo !== n) } : t;
};
const fmtCode = c => (c || '').replace(/(.{3})(?=.)/g, '$1·');

// ── The draw ──
const tierKey = p => (tierDef(p.tier) ? tierDef(p.tier).name : '');
const canTake = (t, p) => !squadFull(t) && !tierFull(t, p.tier);
const drawnCount = () => auctionLog.filter(e => e.drawn).length;
function allocPool() {
  const caps = getCaptainNames();
  return players.filter(p => !p.sold && !caps.includes(p.name.toLowerCase()));
}
const placeable = () => allocPool().filter(p => teams.some(t => canTake(t, p)));
const tierOrder = () => [...EV.tiers.map(t => t.name), ''];

// Which tier is being dealt now ('' = untiered or no tiers); null when nothing can be placed
function currentGroup() {
  const pool = placeable();
  if (!pool.length) return null;
  if (!EV.random.balance) return '*';
  return tierOrder().find(k => pool.some(p => tierKey(p) === k));
}

// The teams a player could go to, after balancing
function teamOptions(p) {
  let ts = teams.filter(t => canTake(t, p));
  if (!ts.length) return [];
  if (EV.random.balance && tierKey(p)) {
    const m = Math.min(...ts.map(t => tierCount(t, p.tier)));
    ts = ts.filter(t => tierCount(t, p.tier) === m);
  }
  const sm = Math.min(...ts.map(squadCount));
  return ts.filter(t => squadCount(t) === sm);
}

function nextDraw() {
  const g = currentGroup();
  if (g === null) return null;
  const rng = seededRng(alloc.seed + '|' + drawnCount());
  const group = placeable()
    .filter(p => g === '*' || tierKey(p) === g)
    .sort((a, b) => a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
  const p = group[Math.floor(rng() * group.length)];
  const opts = teamOptions(p).sort((a, b) => a.id - b.id);
  const team = opts[Math.floor(rng() * opts.length)];
  return { p, team, options: opts.map(t => t.id) };
}

function applyDraw(d) {
  const n = drawnCount() + 1;
  d.team.players.push(setStatus({ ...d.p, finalPrice: 0, drawNo: n, teamId: d.team.id }, 'drawn'));
  setStatus(d.p, 'drawn');
  d.p.teamId = d.team.id;
  d.p.finalPrice = 0;
  d.p.drawNo = n;
  auctionLog.push({
    player: d.p.name,
    tier: d.p.tier || '',
    team: d.team.name,
    teamColor: d.team.color,
    basePrice: d.p.price,
    finalPrice: 0,
    drawn: true,
    drawNo: n,
    options: d.options.length,
    group: EV.random.balance ? tierKey(d.p) : '',
    endTime: new Date().toISOString(),
  });
  alloc.last = {
    player: d.p.name,
    tier: d.p.tier || '',
    teamId: d.team.id,
    options: d.options,
    n,
    group: EV.random.balance ? tierKey(d.p) : '',
  };
}

// ── Actions ──
const ANIM_MS = { quick: 1300, normal: 2600, dramatic: 4400 };
function allocReveal() {
  if (_anim) {
    finishAnim();
    return;
  }
  if (!alloc.seed) alloc.seed = newDrawCode();
  const d = nextDraw();
  if (!d) {
    showToast(allocPool().length ? 'No team can take the players left' : 'Everyone has been drawn');
    renderAlloc();
    return;
  }
  commit(`draw: ${d.p.name} → ${d.team.name}`, () => {
    applyDraw(d);
    reconcileSold();
    const mode = EV.random.teamPick;
    if (mode !== 'straight' && d.options.length > 1) {
      _anim = { start: performance.now(), dur: reduceMotion() ? 500 : ANIM_MS[EV.spin] || 2600, ids: d.options, target: d.team.id, mode };
      requestAnimationFrame(tickAnim);
    }
  });
}

function allocDealRest(all) {
  if (_anim) finishAnim();
  if (!alloc.seed) alloc.seed = newDrawCode();
  const g = currentGroup();
  if (g === null) {
    showToast('Everyone has been drawn');
    return;
  }
  let n = 0;
  commit(all ? 'deal everyone' : `deal the rest${g && g !== '*' ? ' of ' + g : ''}`, () => {
    let d;
    while ((d = nextDraw()) && (all || currentGroup() === g)) {
      applyDraw(d);
      n++;
    }
    reconcileSold();
  });
  showToast(`Dealt ${n} player${n !== 1 ? 's' : ''}`);
}

// Back to an empty hat (keeps captains and pre-auction picks)
function clearDraws() {
  teams.forEach(t => {
    t.players = t.players.filter(p => p.isCaptain || p.isFormer);
  });
  players.forEach(p => {
    setStatus(p, 'pool');
    p.teamId = null;
    p.finalPrice = 0;
    delete p.drawNo;
  });
  auctionLog = auctionLog.filter(e => !e.drawn);
  alloc.last = null;
  _anim = null;
}
async function allocRedraw() {
  if (alloc.locked) {
    showToast('The draw is locked');
    return;
  }
  if (
    drawnCount() &&
    !(await askConfirm(
      'Redraw? Everyone drawn so far goes back in the hat and a new draw code is made. Captains and pre-auction picks stay.',
      { okLabel: 'Redraw', danger: true },
    ))
  )
    return;
  commit('redraw', () => {
    clearDraws();
    alloc.seed = newDrawCode();
    reconcileSold();
  });
  showToast('New draw code: ' + fmtCode(alloc.seed));
}
async function allocUndoAll() {
  if (!drawnCount()) {
    showToast('Nothing drawn yet');
    return;
  }
  if (
    !(await askConfirm('Undo every draw? All drawn players go back in the hat (same draw code). Captains and pre-auction picks stay.', {
      okLabel: 'Undo all draws',
      danger: true,
    }))
  )
    return;
  commit('undo all draws', () => {
    clearDraws();
    reconcileSold();
  });
  showToast('All draws undone');
}
async function allocToggleLock() {
  if (alloc.locked) {
    if (!(await askConfirm('Unlock the draw? Redraw and changing the code become possible again.', { okLabel: 'Unlock' }))) return;
    alloc.locked = false;
  } else {
    alloc.locked = true;
    showToast('Draw locked · code ' + fmtCode(alloc.seed));
  }
  commit();
}
async function allocEnterCode() {
  if (alloc.locked || drawnCount()) {
    showToast(alloc.locked ? 'The draw is locked' : 'Codes can only be changed before the first draw (or use Redraw)');
    return;
  }
  const c = ((await askText('Enter a draw code (to repeat a draw exactly):', alloc.seed, { okLabel: 'Use code' })) || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!c) return;
  commit(null, () => (alloc.seed = c));
  showToast('Draw code set: ' + fmtCode(c));
}

// ── Team-pick animation ──
// Switch times slow down towards the end; the last one is always the drawn team
function animFrame(a, now) {
  const el = Math.min(now - a.start, a.dur),
    n = a.ids.length;
  if (a.mode === 'flip') return { done: el >= a.dur, id: el >= a.dur ? a.target : null };
  let t = 0,
    k = 0;
  while (true) {
    const step = 70 + 460 * Math.pow(t / a.dur, 2);
    if (t + step > el) break;
    t += step;
    k++;
  }
  let total = 0,
    tt = 0;
  while (true) {
    const step = 70 + 460 * Math.pow(tt / a.dur, 2);
    if (tt + step > a.dur) break;
    tt += step;
    total++;
  }
  const ti = a.ids.indexOf(a.target),
    off = (((ti - total) % n) + n) % n;
  return { done: el >= a.dur, id: a.ids[(off + k) % n] };
}
function tickAnim(now) {
  if (!_anim) return;
  const f = animFrame(_anim, now);
  const ring = document.getElementById('alRing');
  if (ring) paintRing(ring, f.id, !f.done);
  projectorTick();
  if (f.done) {
    finishAnim();
    return;
  }
  requestAnimationFrame(tickAnim);
}
function finishAnim() {
  _anim = null;
  renderAlloc();
  projectorTick();
}
function paintRing(ring, id, rolling) {
  const t = teams.find(x => x.id === id);
  const nm = document.getElementById('alTeamName');
  if (!t) {
    ring.className = 'al-ring back';
    ring.style.setProperty('--c', '#c9cfd8');
    ring.innerHTML = '<span>?</span>';
    if (nm) nm.innerHTML = '&nbsp;';
    return;
  }
  ring.className = 'al-ring' + (rolling ? ' rolling' : ' landed');
  ring.style.setProperty('--c', t.color);
  ring.innerHTML = `<img src="${esc(t.logo)}" alt=""/>`;
  if (nm) {
    nm.textContent = t.name;
    nm.style.color = teamInk(t.color);
    nm.classList.toggle('rolling', rolling);
  }
}

// ── Screen ──
function startAllocation() {
  undoStack.length = 0;
  renderUndoBtn();
  if (!alloc.seed) alloc.seed = newDrawCode();
  document.getElementById('selectionScreen').classList.remove('open');
  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('allocScreen').style.display = 'flex';
  document.querySelectorAll('.event-name').forEach(el => (el.textContent = EV.name.toUpperCase()));
  refresh();
}
const allocOpen = () => document.getElementById('allocScreen').style.display === 'flex';

function groupStats(k) {
  const pool = allocPool().filter(p => k === '*' || tierKey(p) === k);
  const done = auctionLog.filter(e => e.drawn && (k === '*' || (e.group || '') === k)).length;
  return { done, total: done + pool.length, left: pool };
}

function renderAlloc() {
  if (!allocOpen()) return;
  const live = EV.random.reveal === 'live',
    bal = EV.random.balance;
  const g = currentGroup(),
    drawn = drawnCount(),
    poolN = allocPool().length;
  document.getElementById('alProg').innerHTML =
    `<b>${drawn} / ${drawn + poolN}</b> ${live ? 'drawn' : 'dealt'} · ${bal ? 'tier-balanced draw' : 'one-hat draw'}`;

  // tier strip
  let strip = '';
  if (bal && EV.tiers.length) {
    const ks = tierOrder().filter(k => groupStats(k).total > 0);
    strip = `<div class="al-tiers">${ks
      .map((k, i) => {
        const st = groupStats(k),
          now = k === g,
          done = !st.left.some(p => teams.some(t => canTake(t, p)));
        return `${i ? '<i>›</i>' : ''}<span class="${now ? 'now' : done ? 'done' : ''}" ${now && k ? `style="--tc:${mix(tierColor(k), '#000000', 0.2)}"` : ''}>${done && !now ? '✓ ' : ''}${esc(k || 'Untiered')}${now ? ` · ${st.done} of ${st.total}` : ''}</span>`;
      })
      .join('')}</div>`;
  }

  // centre
  let centre = '';
  const last = alloc.last && teams.find(t => t.id === alloc.last.teamId) ? alloc.last : null;
  if (!players.length) {
    centre = `<div class="al-empty"><div class="al-big">LOAD THE PLAYERS</div>
      <p>A CSV with Name, Price and Tier columns, the same file as for an auction. Price isn't used in a random draw.</p>
      <button class="al-go" data-action="clickEl" data-args='["alCsv"]'>⬆ LOAD PLAYER CSV</button>
      <button class="al-ghost" data-action="pastePlayers" data-args='["pool"]'>📋 Paste a list</button></div>`;
  } else if (g === null && !_anim) {
    const left = allocPool();
    centre = `<div class="al-empty"><div class="al-kick">${drawn} player${drawn !== 1 ? 's' : ''} ${live ? 'drawn' : 'dealt'}</div><div class="al-big">DRAW COMPLETE</div>
      ${
        left.length
          ? `<p>${left.length} player${left.length !== 1 ? 's' : ''} didn't fit (squads full or tier limits): ${left
              .slice(0, 8)
              .map(p => esc(p.name))
              .join(', ')}${left.length > 8 ? '…' : ''}</p>`
          : '<p>Every player has a team.</p>'
      }
      <div class="al-row"><button class="al-ghost" data-action="exportRosters">${icon('download')}Rosters PDF</button><button class="al-ghost" data-action="showExportCard" data-args='["results"]'>${icon('image')}Results image</button><button class="al-ghost" data-action="showExportCard" data-args='["team"]'>${icon('card')}Team cards</button></div></div>`;
  } else if (last && live) {
    const dueTxt = last.group ? `still due a ${last.group}` : 'with the fewest players';
    centre = `<div class="al-kick">${last.group ? esc(last.group) + ' round · ' : ''}${{ spin: 'the wheel picks a team', flip: 'the card decides', straight: 'straight in' }[EV.random.teamPick]}</div>
      <div class="al-reveal">
        <div class="al-pc"><div class="al-art">${generatePlayerSVG(last.player)}</div><div class="al-pname">${esc(last.player)}</div>${tierDef(last.tier) ? `<span class="al-pill" style="--t:${mix(tierColor(last.tier), '#000000', 0.25)}">${esc(last.tier)}</span>` : ''}</div>
        <div class="al-arrow">→</div>
        <div class="al-slot"><div class="al-joins">JOINS</div><div class="al-ring" id="alRing"></div><div class="al-tname" id="alTeamName"></div>
          <div class="al-odds">${last.options.length > 1 ? `1 of ${last.options.length} teams ${dueTxt}` : `The only team ${dueTxt}`}</div></div>
      </div>`;
  } else {
    centre = `<div class="al-empty"><div class="al-kick">${live ? 'Ready' : 'Instant deal'}</div><div class="al-big">${poolN} TO ${live ? 'DRAW' : 'DEAL'}</div>
      <p>${live ? 'Press Reveal (or Space) to draw the first player.' : 'One press deals everyone, then the squads appear on the right.'} Draw code <b>${fmtCode(alloc.seed)}</b>.</p></div>`;
  }

  // controls
  const gs = g !== null && g !== '*' ? groupStats(g) : null;
  const restLabel = bal && g && g !== '*' ? `⚡ Deal rest of ${esc(g)}` : '⚡ Deal the rest';
  const ctrl = !players.length
    ? ''
    : `<div class="al-ctrl">
    ${
      g === null && !_anim
        ? ''
        : live
          ? `<button class="al-go" data-action="allocReveal">${_anim ? '▶▶ SKIP' : '▶ REVEAL NEXT'} <small>Space</small></button>
      ${g !== null ? `<button class="al-ghost" data-action="allocDealRest" data-args='[false]'>${restLabel}</button>` : ''}`
          : `<button class="al-go" data-action="allocDealRest" data-args='[true]'>⚡ DEAL EVERYONE</button>`
    }
    ${!alloc.locked && drawn ? `<button class="al-ghost" data-action="allocRedraw">${icon('shuffle')}Redraw</button>` : ''}
    <button class="al-ghost al-small" data-action="clickEl" data-args='["alCsv"]' title="Load more players from a CSV">+ Players</button>
    <button class="al-ghost al-small" data-action="pastePlayers" data-args='["pool"]' title="Paste more players">📋 Paste</button>
    ${
      gs && live
        ? `<div class="al-left"><b>Still to draw · ${esc(g || 'Untiered')}</b>${gs.left
            .slice(0, 6)
            .map(p => `<span class="al-chip">${esc(p.name)}</span>`)
            .join('')}${gs.left.length > 6 ? `<span class="al-chip">+${gs.left.length - 6} more</span>` : ''}</div>`
        : ''
    }
  </div>`;
  document.getElementById('alStage').innerHTML = strip + `<div class="al-centre">${centre}</div>` + ctrl;
  if (last && live && document.getElementById('alRing')) {
    if (_anim) paintRing(document.getElementById('alRing'), animFrame(_anim, performance.now()).id, true);
    else paintRing(document.getElementById('alRing'), last.teamId, false);
  }

  // squads
  const nxt = !_anim && g !== null ? nextGroupTeams(g) : null;
  document.getElementById('alHint').textContent = _anim
    ? 'Outlined = in the hat for this player'
    : nxt && g && g !== '*'
      ? `Dimmed = already has its ${g}`
      : nxt
        ? "Dimmed = can't take another player"
        : '';
  document.getElementById('alSquads').innerHTML = teams
    .map(t => {
      const tv = teamView(t),
        rows = tv.players.filter(p => !p.isCaptain);
      let cls = '',
        badge = '';
      if (_anim) {
        if (_anim.ids.includes(t.id)) {
          cls = 'hat';
          badge = '<span class="st hat">In the hat</span>';
        } else cls = 'dim';
      } else if (last && live && t.id === last.teamId && !nxt?.has(t.id)) {
        cls = 'joined';
        badge = '<span class="st joined">Joined</span>';
      } else if (nxt) {
        if (nxt.has(t.id)) badge = `<span class="st open">${g && g !== '*' ? 'Can get ' + esc(g) : 'Next up'}</span>`;
        else {
          cls = 'dim';
          badge = squadFull(t) ? '<span class="st">Full</span>' : g && g !== '*' ? `<span class="st">Has ${esc(g)}</span>` : '';
        }
        if (last && live && t.id === last.teamId) cls += ' joined';
      } else if (squadFull(t)) badge = '<span class="st">Full</span>';
      const cap = t.players.find(p => p.isCaptain);
      const li = p =>
        html`<li class="${p.isFormer ? 'pick' : ''}${alloc.last && !_anim && p.drawNo === alloc.last.n ? ' new' : ''}">
          <span>${p.name}${p.isFormer ? raw('<em> · pick</em>') : ''}</span
          >${tierDef(p.tier) ? html`<span class="al-pill sm" style="--t:${teamInk(tierColor(p.tier))}">${p.tier}</span>` : ''}
        </li>`;
      return html`<div
        class="al-team ${cls}"
        style="--c:${t.color};--cd:${teamInk(t.color)}"
        data-action="showTeamRoster"
        data-args="[${t.id}]"
      >
        <div class="al-th">
          <img src="${t.logo}" alt="" />
          <div class="al-tn"><b>${t.name}</b>${cap ? html`<span>${cap.name}</span>` : ''}</div>
          ${raw(badge)}
        </div>
        <ul>
          ${rows.length ? rows.map(li) : raw('<li class="none">No players yet</li>')}
        </ul>
        <div class="al-tf">${squadText(tv)}${EV.squadSize ? '' : ' drawn'}</div>
      </div>`;
    })
    .join('');

  document.getElementById('alCode').innerHTML = `<span>Draw code · same code, same draw</span>
    <b data-action="allocEnterCode" title="${drawn || alloc.locked ? '' : 'Click to enter a code'}">${fmtCode(alloc.seed)}</b>
    <button class="al-ghost al-small" data-action="allocToggleLock">${alloc.locked ? icon('lock') + 'Locked' : icon('unlock') + 'Lock draw'}</button>`;
  renderUndoBtn();
}

// Teams the next player of this group could go to (before the team is drawn)
function nextGroupTeams(g) {
  const pool = placeable().filter(p => g === '*' || tierKey(p) === g);
  if (!pool.length) return new Set();
  const s = new Set();
  // the set is the same for every player in a tier group when balancing; use the first as the sample
  teamOptions(pool[0]).forEach(t => s.add(t.id));
  return s;
}

// ── Projector view while drawing ──
function allocProjectorState() {
  if (!allocOpen()) return null;
  const now = performance.now();
  const f = _anim ? animFrame(_anim, now) : null;
  return {
    last: alloc.last,
    rolling: !!_anim,
    shown: f ? f.id : alloc.last && alloc.last.teamId,
    drawn: drawnCount(),
    left: allocPool().length,
    done: currentGroup() === null,
    sigTick: f ? f.id : -1,
  };
}

// ── Wiring ──
document.getElementById('alCsv').addEventListener('change', e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  parseCSV(f); // loading goes through commit(), which redraws this screen
});
