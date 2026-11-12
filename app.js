// ═══════════════════════════════════════════════════════════════════════════
//  Draft Day — pre-auction rounds and the auction
//  Reads the event from EV (setup.js). Nothing about team count, rounds,
//  tiers, squad size or bidding rules is fixed in this file.
// ═══════════════════════════════════════════════════════════════════════════

let teams = [],
  players = [],
  auctionLog = [],
  spinning = false,
  currentPlayer = null,
  selectedTeamId = null,
  spinAngle = 0;
let _pid = 0;
const nextId = () => String(++_pid);

// ── Squad & tier rules ──────────────────────────────────────────────────────
// p.isFormer = picked in a pre-auction round (kept for older save files)
const countsSquad = p => !p.isCaptain && (!p.isFormer || !!p.countsSquad);
const squadCount = t => t.players.filter(countsSquad).length;
const boughtCount = t => t.players.filter(p => !p.isCaptain && !p.isFormer).length;
const pickCount = t => t.players.filter(p => p.isFormer).length;
const squadFull = t => EV.squadSize > 0 && squadCount(t) >= EV.squadSize;
const slotsLeft = t => (EV.squadSize > 0 ? Math.max(0, EV.squadSize - squadCount(t)) : Infinity);
const startBudget = t => t.startBudget || EV.budget;
const squadIcons = t => (t.players.some(p => p.isCaptain) ? '👑' : '') + '🏅'.repeat(pickCount(t));
const squadText = t => (EV.squadSize ? `${squadCount(t)}/${EV.squadSize}` : `${boughtCount(t)}`);
// "2 Platinum · 1 Gold …" for a team (random allocation shows this instead of money)
const tierMix = t =>
  EV.tiers
    .map(x => [x.name, t.players.filter(p => !p.isCaptain && (p.tier || '').toLowerCase() === x.name.toLowerCase()).length])
    .filter(([, n]) => n)
    .map(([k, n]) => `${n} ${k}`)
    .join(' · ');
function tierCount(team, tier) {
  if (!tier) return 0;
  const k = tier.toLowerCase();
  return team.players.filter(p => !p.isCaptain && (!p.isFormer || p.countsTiers !== false) && (p.tier || '').toLowerCase() === k).length;
}
const tierFull = (team, tier) => {
  const L = tierLimit(tier);
  return !!tier && L > 0 && tierCount(team, tier) >= L;
};
// ── Player status ───────────────────────────────────────────────────────────
// Every pool player and roster entry has one `status`, and it's only ever changed through
// setStatus(). The older true/false flags (sold, unsold, unsoldFinal, isCaptain, isFormer,
// drawn) are kept in step here because the rest of the code reads them.
//   pool → in the draw · queued → unsold, waiting for the unsold round · unsold → unsold twice
//   sold → bought · drawn → placed by a random draw · picked → pre-auction pick · captain
const STATUSES = ['pool', 'queued', 'unsold', 'sold', 'drawn', 'picked', 'captain'];
function setStatus(p, st) {
  if (!STATUSES.includes(st)) throw new Error('Unknown player status: ' + st);
  p.status = st;
  p.sold = ['sold', 'drawn', 'picked', 'captain'].includes(st);
  p.unsold = st === 'queued' || st === 'unsold';
  p.unsoldFinal = st === 'unsold';
  p.drawn = st === 'drawn';
  p.isFormer = st === 'picked';
  p.isCaptain = st === 'captain';
  return p;
}
// Older saves only have the flags: work the status out from them
function statusFromFlags(p) {
  return p.isCaptain
    ? 'captain'
    : p.isFormer
      ? 'picked'
      : p.drawn
        ? 'drawn'
        : p.sold
          ? 'sold'
          : p.unsoldFinal
            ? 'unsold'
            : p.unsold
              ? 'queued'
              : 'pool';
}

// ── Unsold queue ────────────────────────────────────────────────────────────
// p.unsold      = nobody bought them in the main draw → waiting in the queue
// p.unsoldFinal = not bought in the unsold round either → stays unsold
let auctionPhase = 'main'; // 'main' | 'unsold'
const inUnsoldRound = p => auctionPhase === 'unsold' && !!p.unsold;
const openingMin = player => {
  const base = Math.max(player.price || 0, tierMin(player.tier));
  return inUnsoldRound(player) ? Math.round(base * (1 - EV.unsold.discount / 100)) : base;
};
const roundLabel = p => p.roundName || 'Pre-auction';

// ── CSV (Name, Price, Tier — quoted values allowed) ─────────────────────────
function csvCells(line) {
  const out = [];
  let cur = '',
    q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map(c => c.trim());
}
// Returns {rows:[{name,price,tier}], unknownTiers:Set}
function parsePlayerRows(text) {
  const rows = [],
    unknownTiers = new Set();
  text
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (!line.trim()) return;
      // Commas (CSV) or tabs (pasted from a spreadsheet). Price is optional; "Name, Tier" also works
      const c = line.includes('\t') ? line.split('\t').map(x => x.trim()) : csvCells(line);
      if (i === 0 && c[0].toLowerCase() === 'name') return;
      const name = c[0];
      let price = c[1] ? parseMoney(c[1]) : 0,
        tierCell = c[2];
      if (c[1] && isNaN(price) && normTier(c[1])) {
        price = 0;
        tierCell = c[1];
      }
      if (!name || isNaN(price)) return;
      const tier = normTier(tierCell);
      if (tierCell && !tier && EV.tiers.length) unknownTiers.add(tierCell);
      rows.push({ name, price, tier });
    });
  return { rows, unknownTiers };
}
// Which team already has a player of this name (captain, pick or signing)
function heldBy(name) {
  const n = String(name).trim().toLowerCase();
  return teams.find(t => t.players.some(p => p.name.toLowerCase() === n)) || null;
}
// Players nobody has: the draft's unpicked list, or the pool's unsold/undrawn
function notPlaced() {
  if (isDraft()) {
    const d = selRounds[allRounds().length - 1];
    return d ? d.players.filter(p => p.pickedBy === null && !heldBy(p.name)) : [];
  }
  return players.filter(p => !p.sold);
}
function loadRowsInto(list, text, make, onDone, quiet) {
  const { rows, unknownTiers } = parsePlayerRows(text);
  let added = 0,
    skipped = 0,
    held = 0;
  rows.forEach(r => {
    if (list.some(x => x.name.toLowerCase() === r.name.toLowerCase())) {
      skipped++;
      return;
    }
    if (heldBy(r.name)) {
      held++;
      return;
    } // a captain or an earlier pick can't come up again
    list.push(make(r));
    added++;
  });
  onDone();
  let msg = added
    ? `Loaded ${added} player${added > 1 ? 's' : ''}`
    : skipped || held
      ? 'All of those players are already loaded or on a team'
      : 'No valid rows found';
  if (added && skipped) msg += ` · ${skipped} duplicate${skipped > 1 ? 's' : ''} skipped`;
  if (held) msg += ` · ${held} already on a team left out`;
  if (unknownTiers.size) msg += ` · unknown tier: ${[...unknownTiers].slice(0, 3).join(', ')}`;
  if (!quiet) showToast(msg);
  return added;
}

// ── PRE-AUCTION ROUNDS ──────────────────────────────────────────────────────
// One state object per round in EV.rounds
let selRounds = []; // [{players:[], pickIdx, turnOrder:[teamId], picks:[name|null], done}]
let selRoundIdx = 0;
const SR = () => selRounds[selRoundIdx];
const RD = () => allRounds()[selRoundIdx];

function buildTurnOrder(round) {
  const out = [];
  for (let pass = 0; pass < round.picks; pass++) {
    const fwd = round.order === 'straight' || pass % 2 === 0;
    out.push(...(fwd ? pickOrder : [...pickOrder].reverse()));
  }
  return out;
}

function selectionRoundInit(idx) {
  if (selRounds.length !== allRounds().length)
    selRounds = allRounds().map(() => ({ players: [], pickIdx: 0, turnOrder: [], picks: [], done: false }));
  selRoundIdx = idx;
  const s = SR();
  if (!s.turnOrder.length) s.turnOrder = buildTurnOrder(RD());
  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('selectionScreen').classList.add('open');
  selRenderAll();
}

function selRenderAll() {
  selRenderHeader();
  selRenderOrderList();
  selRenderTurnCard();
  selRenderPlayerGrid();
}

function selRenderHeader() {
  const r = RD(),
    n = allRounds().length;
  document.getElementById('selTitle').textContent = r.name.toUpperCase();
  document.getElementById('selSub').textContent =
    `Each team picks ${r.picks} · ${r.cost === 'free' ? 'free' : 'listed price comes off the budget'} · ${r.order === 'snake' ? 'snake order' : 'same order every pass'}`;
  document.getElementById('selCsvTitle').textContent = 'LOAD PLAYERS: ' + r.name.toUpperCase();
  document.getElementById('selPrevBtn').style.display = selRoundIdx > 0 ? '' : 'none';
  const s = SR(),
    pass = Math.min(r.picks, Math.floor(s.pickIdx / teams.length) + 1);
  document.querySelector('.sel-phase-badge').textContent =
    (r.isDraft ? 'DRAFT' : n > 1 ? `ROUND ${selRoundIdx + 1} OF ${n}` : 'PRE-AUCTION') + (r.picks > 1 && !s.done ? ` · PASS ${pass}` : '');
}

const selCurrentTeam = () => teams.find(t => t.id === SR().turnOrder[SR().pickIdx]);

// Why the team on the clock can't take this player ('' = it can)
function selBlockReason(p, team) {
  const r = RD();
  if (!team) return '';
  const h = p.pickedBy === null && heldBy(p.name);
  if (h) return `Already with ${h.name}`;
  if (r.countsTowardTiers && p.tier && tierFull(team, p.tier)) return `${team.name} already has ${tierLimit(p.tier)} ${p.tier}`;
  if (r.countsTowardSquad && squadFull(team)) return `${team.name}'s squad is full`;
  if (r.cost === 'price' && p.price > team.budget) return `${team.name} can't afford ${zarFmt(p.price)}`;
  return '';
}

function selRenderOrderList() {
  const s = SR(),
    r = RD(),
    n = teams.length;
  let html = '';
  s.turnOrder.forEach((teamId, i) => {
    const t = teams.find(x => x.id === teamId),
      pass = Math.floor(i / n);
    if (i % n === 0 && r.picks > 1) {
      const rev = r.order === 'snake' && pass % 2 === 1;
      html += `<div class="sel-pass-lbl" style="color:${rev ? 'var(--gold)' : 'var(--accent)'}">Pass ${pass + 1}${rev ? ' — reversed' : ''}</div>`;
    }
    const isDone = i < s.pickIdx,
      isCurrent = i === s.pickIdx && !s.done;
    const pick = s.picks[i];
    html += `<div class="sel-order-row${isCurrent ? ' current' : ''}${isDone ? ' done' : ''}">
      <div class="sel-order-num">${(i % n) + 1}</div>
      <div class="sel-order-dot" style="background:${t.color}"></div>
      <div class="sel-order-name">${esc(t.name)}</div>
      <div class="sel-order-pick">${pick ? esc(pick) : isDone ? 'Skipped' : '—'}</div>
    </div>`;
  });
  document.getElementById('selOrderList').innerHTML = html;
  const cur = document.querySelector('#selOrderList .sel-order-row.current');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

function selRenderTurnCard() {
  const s = SR(),
    r = RD();
  const el = document.getElementById('selTurnTeam'),
    logoEl = document.getElementById('selTurnLogo');
  const banner = document.getElementById('selCompleteBanner');
  if (s.done || s.pickIdx >= s.turnOrder.length) {
    s.done = true;
    el.textContent = 'All picks done!';
    el.style.color = 'var(--green)';
    logoEl.style.display = 'none';
    const next = allRounds()[selRoundIdx + 1];
    const stage = isRandom() ? 'draw' : 'auction',
      fin = !next && isDraft();
    document.getElementById('selTurnSub').textContent = next
      ? `Next up: ${next.name}.`
      : fin
        ? 'The draft is complete. Export the squads below.'
        : `Click "Start ${stage}" to continue.`;
    document.getElementById('selCompleteTxt').textContent = next
      ? `✓ ${r.name} complete. Next: ${next.name}.`
      : fin
        ? '✓ Draft complete! Every pick is in.'
        : `✓ All teams have picked! Ready to start the ${stage}.`;
    const btn = document.getElementById('selCompleteBtn');
    btn.textContent = next ? 'NEXT ROUND →' : fin ? 'SEE ALL SQUADS' : `START ${stage.toUpperCase()} →`;
    btn.dataset.action = next ? 'selNextRound' : fin ? 'showAllRosters' : 'startAuction';
    document.getElementById('selExports').hidden = !fin;
    banner.classList.add('visible');
    selRenderHeader();
    return;
  }
  banner.classList.remove('visible');
  const t = selCurrentTeam(),
    pass = Math.floor(s.pickIdx / teams.length);
  el.textContent = t.name;
  el.style.color = t.color;
  logoEl.src = t.logo;
  logoEl.style.display = 'inline-block';
  document.getElementById('selTurnSub').textContent = s.players.length
    ? `Pick ${pass + 1} of ${r.picks} for ${t.name}${r.cost === 'price' ? ` · ${zarS(t.budget)} left` : ''}`
    : `Load a CSV of players for ${r.name} to pick from.`;
  selRenderHeader();
}

function selRenderPlayerGrid() {
  const s = SR(),
    r = RD(),
    grid = document.getElementById('selPlayerGrid');
  if (!s.players.length) {
    grid.innerHTML = '<div class="sel-empty">Load players via the CSV panel →</div>';
    return;
  }
  const team = s.done ? null : selCurrentTeam();
  grid.innerHTML = s.players
    .map(p => {
      const taken = p.pickedBy !== null,
        by = taken ? teams.find(t => t.id === p.pickedBy) : null;
      const why = taken ? '' : selBlockReason(p, team);
      const price = r.cost === 'free' ? '<span class="t-free">Free</span>' : `<span class="t-price-sm">${zarS(p.price)}</span>`;
      return `<div class="sel-player-card${taken ? ' taken' : ''}${why ? ' blocked' : ''}" ${why ? `title="${esc(why)}"` : ''} data-action="selPickPlayer" data-args='["${p.id}"]'>
      <div class="spc-name">${esc(p.name)}</div>
      ${tierPill(p.tier)}
      <div class="spc-team">${
        taken
          ? `<div class="spc-taken-dot" style="background:${by?.color || '#555'}"></div><span>${esc(by?.name || '')}</span>`
          : why
            ? `<span class="c-red fs-xs">${esc(why.replace(team.name + ' ', ''))}</span>`
            : price
      }</div>
    </div>`;
    })
    .join('');
}

function selAfterTurn() {
  const s = SR();
  if (s.pickIdx >= s.turnOrder.length) s.done = true;
  selRenderAll();
}

function selPickPlayer(id) {
  const s = SR(),
    r = RD();
  if (s.done) return;
  const p = s.players.find(x => x.id === id);
  if (!p || p.pickedBy !== null) return;
  const team = selCurrentTeam(),
    why = selBlockReason(p, team);
  if (why) {
    showToast(why);
    return;
  }
  const cost = r.cost === 'price' ? p.price : 0;
  snap(`${team.name} picked ${p.name}`);
  p.pickedBy = team.id;
  team.budget -= cost;
  team.players.push(
    setStatus(
      {
        id: nextId(),
        name: p.name,
        price: p.price,
        tier: p.tier,
        finalPrice: cost,
        teamId: team.id,
        roundIdx: selRoundIdx,
        roundName: r.name,
        countsSquad: r.countsTowardSquad,
        countsTiers: r.countsTowardTiers,
      },
      'picked',
    ),
  );
  s.picks[s.pickIdx] = p.name;
  s.pickIdx++;
  selAfterTurn();
}

function selSkipTurn() {
  const s = SR();
  if (s.done) return;
  snap(`skipped ${(selCurrentTeam() || {}).name}'s pick`);
  s.picks[s.pickIdx] = null;
  s.pickIdx++;
  selAfterTurn();
}

async function selResetPicks() {
  if (!(await askConfirm(`Clear every pick in "${RD().name}" and start this round again?`, { okLabel: 'Reset round', danger: true })))
    return;
  const s = SR();
  s.players.forEach(p => (p.pickedBy = null));
  teams.forEach(t => {
    t.players
      .filter(p => p.isFormer && p.roundIdx === selRoundIdx)
      .forEach(p => {
        t.budget += p.finalPrice || 0;
      });
    t.players = t.players.filter(p => !(p.isFormer && p.roundIdx === selRoundIdx));
  });
  s.pickIdx = 0;
  s.picks = [];
  s.done = false;
  selRenderAll();
  showToast('Picks reset — starting from pick 1');
}

function selPrevRound() {
  if (selRoundIdx > 0) selectionRoundInit(selRoundIdx - 1);
}

const selMake = row => ({ id: nextId(), name: row.name, price: row.price, tier: row.tier, pickedBy: null });
function loadRoundText(i, text, quiet) {
  loadRowsInto(
    selRounds[i].players,
    text,
    selMake,
    () => {
      if (i === selRoundIdx && selOpen()) selRenderAll();
    },
    quiet,
  );
}
const selOpen = () => document.getElementById('selectionScreen').classList.contains('open');
function handleSelCSV(e) {
  const f = e.target.files[0];
  if (f) parseSelCSV(f);
  e.target.value = '';
}
function parseSelCSV(file) {
  const r = new FileReader();
  r.onload = e => loadRoundText(selRoundIdx, e.target.result);
  r.readAsText(file);
}

// Players loaded before the pre-auction rounds may since have been picked: take them out of the pool
function dropHeldFromPool() {
  const before = players.length;
  players = players.filter(p => p.sold || !heldBy(p.name));
  const n = before - players.length;
  if (n) showToast(`${n} player${n !== 1 ? 's' : ''} already on a team taken out of the pool`);
}

function selNextRound() {
  selectionRoundInit(selRoundIdx + 1);
}

function startAuction() {
  dropHeldFromPool();
  if (isRandom()) {
    startAllocation();
    return;
  }
  undoStack.length = 0;
  renderUndoBtn();
  document.getElementById('selectionScreen').classList.remove('open');
  document.getElementById('appScreen').style.display = 'flex';
  document.getElementById('appScreen').style.flexDirection = 'column';
  applyAuctionChrome();
  renderTeamsBar();
  renderPlayersList();
  drawWheel();
  renderLog();
  updateStats();
}

// Bits of the auction screen that depend on the event settings
function applyAuctionChrome() {
  document.querySelectorAll('.event-name').forEach(el => (el.textContent = EV.name.toUpperCase()));
  document.querySelectorAll('.cur-sym').forEach(el => (el.textContent = EV.currency));
  const tierSel = document.getElementById('newTier');
  tierSel.innerHTML =
    '<option value="">— Tier —</option>' + EV.tiers.map(t => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('');
  tierSel.style.display = EV.tiers.length ? '' : 'none';
  document.getElementById('newPrice').placeholder = EV.currency + ' 0';
  document.getElementById('spinBtn').textContent = DRAW_MODES[EV.draw].button;
  document.getElementById('unsoldBtn').textContent = EV.unsold.enabled ? '✕ Unsold' : '✕ Skip Player';
  document.getElementById('backToPoolBtn').style.display = EV.unsold.enabled ? '' : 'none';
  const tabTier = document.getElementById('bhTabTier');
  if (tabTier) tabTier.style.display = EV.tiers.length ? '' : 'none';
}

// Wire up sel dropzone
document.getElementById('selDropzone').addEventListener('dragover', e => {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
});
document.getElementById('selDropzone').addEventListener('dragleave', e => {
  e.currentTarget.classList.remove('drag-over');
});
document.getElementById('selDropzone').addEventListener('drop', e => {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f?.name.endsWith('.csv')) parseSelCSV(f);
  else showToast('Drop a .csv file');
});

function renderTeamsBar() {
  document.getElementById('teamsBar').innerHTML = teams
    .map(t => {
      const pct = Math.max(0, Math.min(100, (t.budget / startBudget(t)) * 100));
      const cls = pct < 20 ? 'low' : pct < 50 ? 'mid' : 'ok';
      return `<div class="team-card" data-action="showTeamRoster" data-args='[${t.id}]' title="${esc(t.name)} roster">
      <div class="team-card-top">
        <img src="${t.logo}" class="team-logo-sm" alt="${esc(t.name)}"/>
        <div class="team-card-name">${esc(t.name)}</div>
      </div>
      <div class="team-budget-bar-wrap">
        <div class="team-budget-bar" style="width:${pct}%;background:${t.color}"></div>
      </div>
      <div class="team-budget-nums">
        <div class="team-budget-left ${cls}">${zarS(t.budget)}</div>
        <div class="team-player-count">${squadIcons(t)}${squadIcons(t) ? ' + ' : ''}${squadText(t)} signed</div>
      </div>
    </div>`;
    })
    .join('');
}

// CSV
document.getElementById('dropzone').addEventListener('dragover', e => {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
});
document.getElementById('dropzone').addEventListener('dragleave', e => {
  e.currentTarget.classList.remove('drag-over');
});
document.getElementById('dropzone').addEventListener('drop', e => {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f?.name.endsWith('.csv')) parseCSV(f);
  else showToast('Drop a .csv file');
});

function handleCSV(e) {
  const f = e.target.files[0];
  if (f) parseCSV(f);
  e.target.value = '';
}

function parseCSV(file) {
  const r = new FileReader();
  r.onload = e => loadPoolText(e.target.result);
  r.readAsText(file);
}
const poolMake = row => setStatus({ id: nextId(), name: row.name, price: row.price, tier: row.tier, teamId: null }, 'pool');
function loadPoolText(text, quiet) {
  return loadRowsInto(
    players,
    text,
    poolMake,
    () => {
      renderPlayersList();
      drawWheel();
    },
    quiet,
  );
}

// U5: paste a list straight from a spreadsheet or a message
const PASTE_HINT = 'One player per line: Name, Price, Tier. Price and tier are optional. Columns copied from a spreadsheet work too.';
async function pastePlayers(where) {
  const text = await askText('Paste players', '', { multiline: true, okLabel: 'Add players', hint: PASTE_HINT });
  if (!text || !text.trim()) return;
  if (where === 'round') loadRoundText(selRoundIdx, text);
  else {
    loadPoolText(text);
    if (typeof allocOpen === 'function' && allocOpen()) {
      renderAlloc();
    }
    autosave();
  }
}

// U4: fix a typo, tier or price in the pool without removing the player
async function editPoolPlayer(id) {
  const p = players.find(x => x.id === id);
  if (!p || p.sold) return;
  if (bidRound.player && bidRound.player.id === p.id) {
    showToast(`${p.name} is up for bid. Edit them after this round`);
    return;
  }
  const fields = [{ key: 'name', label: 'Name', value: p.name }];
  if (EV.tiers.length)
    fields.push({
      key: 'tier',
      label: 'Tier',
      type: 'select',
      value: p.tier || '',
      options: [['', 'No tier'], ...EV.tiers.map(t => [t.name, t.name])],
    });
  if (!noMoney()) fields.push({ key: 'price', label: `Base price (${EV.currency})`, value: String(p.price || 0) });
  const r = await askForm('Edit player', fields);
  if (!r) return;
  const name = String(r.name || '').trim(),
    price = r.price === undefined ? p.price : parseMoney(r.price);
  if (!name) {
    showToast('A player needs a name');
    return;
  }
  if (players.some(x => x !== p && x.name.toLowerCase() === name.toLowerCase())) {
    showToast(`"${name}" is already in the list`);
    return;
  }
  if (isNaN(price) || price < 0) {
    showToast('Enter a valid price');
    return;
  }
  snap(`edited ${p.name}`);
  p.name = name;
  p.price = price;
  if (r.tier !== undefined) p.tier = normTier(r.tier);
  renderPlayersList();
  drawWheel();
  autosave();
  if (typeof allocOpen === 'function' && allocOpen()) renderAlloc();
  showToast(`Updated ${p.name}`);
}

function addPlayer() {
  const nE = document.getElementById('newName'),
    pE = document.getElementById('newPrice'),
    tE = document.getElementById('newTier');
  const name = nE.value.trim(),
    price = parseMoney(pE.value),
    tier = normTier(tE.value);
  if (!name) {
    showToast('Enter a player name');
    return;
  }
  if (isNaN(price) || price < 0) {
    showToast('Enter a valid price');
    return;
  }
  if (players.some(x => x.name.toLowerCase() === name.toLowerCase())) {
    showToast(`"${name}" is already in the list`);
    return;
  }
  players.push(setStatus({ id: nextId(), name, price, tier, teamId: null }, 'pool'));
  nE.value = '';
  pE.value = '';
  tE.value = '';
  nE.focus();
  renderPlayersList();
  drawWheel();
}

function removePlayer(id) {
  players = players.filter(p => p.id !== id);
  renderPlayersList();
  drawWheel();
}

function renderPlayersList() {
  const el = document.getElementById('playersList');
  const captainNames = getCaptainNames();
  const active = activePool();
  document.getElementById('playerBadge').textContent = players.length;
  document.getElementById('spinBtn').disabled = spinning ? false : !active.length || EV.draw === 'manual' || !!bidRound.player;
  renderDrawStage(active);
  if (!players.length) {
    el.innerHTML = '<div class="empty-state">No players yet.</div>';
    return;
  }
  const manual = EV.draw === 'manual';
  el.innerHTML = players
    .map((p, i) => {
      const t = p.teamId !== null ? teams.find(x => x.id === p.teamId) : null;
      const isCaptainPlayer = captainNames.includes(p.name.toLowerCase());
      const isSold = p.sold || isCaptainPlayer;
      const queued = !isSold && EV.unsold.enabled && (p.unsold || p.unsoldFinal);
      const priceHtml = isSold
        ? `<div class="player-price">${p.finalPrice ? zarS(p.finalPrice) : zarS(p.price)}</div>`
        : inUnsoldRound(p) && !p.unsoldFinal && EV.unsold.discount
          ? `<div class="player-price" title="Unsold round price"><s class="dim">${zarS(Math.max(p.price, tierMin(p.tier)))}</s> <span class="c-gold">${zarS(openingMin(p))}</span></div>`
          : `<div class="player-price-wrap" id="price-wrap-${p.id}"><div class="player-price-edit" title="Click to edit price">${zarS(p.price)}</div></div>`;
      const queueTag = queued
        ? `<span class="unsold-tag${p.unsoldFinal ? ' final' : ''}" title="${p.unsoldFinal ? 'Not bought in the unsold round either' : 'Waiting for the unsold round'}">${p.unsoldFinal ? 'UNSOLD' : auctionPhase === 'unsold' ? '2ND ROUND' : 'QUEUE'}</span>`
        : '';
      const queueBtn =
        queued && auctionPhase === 'main'
          ? `<button class="player-up" data-action="returnFromQueue" data-args='["${p.id}"]' title="Back into the main pool">↩</button>`
          : '';
      return `<div class="player-row${isSold ? ' sold' : ''}${queued && !(auctionPhase === 'unsold' && !p.unsoldFinal) ? ' queued' : ''}" id="pr-${p.id}">
      <div class="player-idx">${i + 1}</div>
      <div class="player-team-dot" style="background:${t ? t.color : 'transparent'}"></div>
      <div class="player-name">${esc(p.name)}</div>
      ${tierPill(p.tier)}
      ${queueTag}
      ${priceHtml}
      ${queueBtn}
      ${!isSold && manual && active.includes(p) ? `<button class="player-up" data-action="putUpForBid" data-args='["${p.id}"]' title="Put up for bid" ${bidRound.player || spinning ? 'disabled' : ''}>▶</button>` : ''}
      ${!isSold ? `<button class="player-edit" data-action="editPoolPlayer" data-args='["${p.id}"]' title="Edit name, tier or price" aria-label="Edit ${esc(p.name)}">✎</button><button class="player-remove" data-action="removePlayer" data-args='["${p.id}"]' title="Remove from the pool" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}
    </div>`;
    })
    .join('');
  players.forEach(p => {
    const wrap = document.getElementById('price-wrap-' + p.id);
    if (wrap) wrap.querySelector('.player-price-edit').addEventListener('click', () => startEditPrice(p.id));
  });
}

// The stage shown instead of the wheel in random / order / manual modes
function renderDrawStage(active) {
  const el = document.getElementById('drawStage');
  if (!el) return;
  if (spinning) return;
  const q = EV.unsold.enabled ? unsoldQueue() : [];
  const ended = players.length && !active.length;
  const wheelMode = EV.draw === 'wheel' && !ended;
  document.querySelector('.wheel-wrap').style.display = wheelMode ? '' : 'none';
  document.querySelector('.spin-controls').style.display = ended ? 'none' : '';
  el.style.display = wheelMode ? 'none' : '';
  const queueLine = q.length && auctionPhase === 'main' ? `<div class="draw-stage-sub">${q.length} in the unsold queue</div>` : '';
  if (!wheelMode && ended) {
    if (auctionPhase === 'main' && q.length) {
      const can = teamsThatCanBuy(q);
      el.innerHTML = `<div class="draw-stage-lbl">Main draw done</div>
        <div class="draw-stage-big">${q.length} unsold player${q.length !== 1 ? 's' : ''}</div>
        ${
          can.length
            ? `<div class="draw-stage-sub">${can.length} team${can.length !== 1 ? 's have' : ' has'} squad space and budget · opening bids ${EV.unsold.discount}% off</div>
             <button class="btn-spin wiz-gap-sm" data-action="startUnsoldRound">START UNSOLD ROUND</button>`
            : `<div class="draw-stage-sub">No team has both squad space and budget left, so the event is complete.</div>`
        }`;
    } else {
      const left = stillUnsold().length;
      el.innerHTML = `<div class="draw-stage-lbl">${auctionPhase === 'unsold' ? 'Unsold round complete' : 'Draw complete'}</div>
        <div class="draw-stage-big">All done!</div>
        ${left ? `<div class="draw-stage-sub">${left} player${left !== 1 ? 's' : ''} unsold</div>` : ''}`;
    }
    return;
  }
  if (wheelMode) {
    return;
  }
  const next = EV.draw === 'order' && active.length ? active[0] : null;
  el.innerHTML = !players.length
    ? '<div class="draw-stage-big">Load players to begin</div>'
    : `<div class="draw-stage-lbl">${auctionPhase === 'unsold' ? 'Unsold round · ' : ''}${DRAW_MODES[EV.draw].label}</div>
       <div class="draw-stage-big">${active.length} player${active.length !== 1 ? 's' : ''} left</div>
       ${next ? `<div class="draw-stage-sub">Up next: <strong>${esc(next.name)}</strong> ${tierPill(next.tier)}</div>` : ''}
       ${EV.draw === 'manual' ? '<div class="draw-stage-sub">Press ▶ next to a player in the list to put them up.</div>' : ''}
       ${queueLine}`;
}

function startEditPrice(id) {
  const p = players.find(x => x.id === id);
  if (!p || p.sold) return;
  const wrap = document.getElementById('price-wrap-' + id);
  if (!wrap) return;
  wrap.innerHTML = `<input class="player-price-inp" type="number" value="${p.price}" min="0" step="10000"/>`;
  const inp = wrap.querySelector('input');
  inp.focus();
  inp.select();
  let committed = false;
  function commit() {
    if (committed) return;
    committed = true;
    const val = parseFloat(inp.value);
    if (!isNaN(val) && val >= 0) p.price = val;
    renderPlayersList();
    drawWheel();
  }
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
    if (e.key === 'Escape') {
      committed = true;
      renderPlayersList();
    }
  });
}

// WHEEL
const canvas = document.getElementById('wheelCanvas');
const ctx = canvas.getContext('2d');
function getWheelSize() {
  return Math.min(560, window.innerWidth - 40);
}
function resizeCanvas() {
  const sz = getWheelSize();
  canvas.width = sz;
  canvas.height = sz;
  const halo = document.getElementById('wheelHalo');
  if (halo) {
    halo.style.width = sz + 20 + 'px';
    halo.style.height = sz + 20 + 'px';
  }
}
resizeCanvas();
window.addEventListener('resize', () => {
  resizeCanvas();
  drawWheel();
});
function getCX() {
  return canvas.width / 2;
}
function getCY() {
  return canvas.height / 2;
}
function getR() {
  return getCX() - 12;
}
const SLICECOLS = [
  '#0e2236',
  '#0e3620',
  '#2a0e3a',
  '#3a2208',
  '#0e1e3a',
  '#3a0e14',
  '#082a3a',
  '#083a18',
  '#220836',
  '#3a1e06',
  '#08163a',
  '#3a0810',
];

function drawWheel(rotation) {
  if (rotation === undefined) rotation = spinAngle;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const active = activePool();
  if (!active.length) {
    ctx.beginPath();
    ctx.arc(getCX(), getCY(), getR(), 0, Math.PI * 2);
    ctx.fillStyle = '#111820';
    ctx.fill();
    ctx.strokeStyle = '#1e2a38';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#5a7080';
    ctx.font = '600 13px Barlow,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      !players.length ? 'Load players to spin' : unsoldQueue().length && auctionPhase === 'main' ? 'Main draw done' : 'All done!',
      getCX(),
      getCY(),
    );
    return;
  }
  const sl = (Math.PI * 2) / active.length;
  active.forEach((p, i) => {
    const s = rotation + i * sl,
      e = s + sl;
    ctx.beginPath();
    ctx.moveTo(getCX(), getCY());
    ctx.arc(getCX(), getCY(), getR(), s, e);
    ctx.closePath();
    ctx.fillStyle = SLICECOLS[i % SLICECOLS.length];
    ctx.fill();
    ctx.strokeStyle = '#060810';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const g = ctx.createRadialGradient(getCX(), getCY(), 0, getCX(), getCY(), getR());
    g.addColorStop(0, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.moveTo(getCX(), getCY());
    ctx.arc(getCX(), getCY(), getR(), s, e);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    if (tierDef(p.tier)) {
      // tier colour on the rim, so the room sees what's coming
      ctx.save();
      ctx.beginPath();
      ctx.arc(getCX(), getCY(), getR() - 4, s + 0.012, e - 0.012);
      ctx.strokeStyle = tierColor(p.tier);
      ctx.lineWidth = 7;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.restore();
    }
    drawSliceLabel(p, s + sl / 2, sl, active.length);
  });
  ctx.beginPath();
  ctx.arc(getCX(), getCY(), getR(), 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,200,255,0.3)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(getCX(), getCY(), 26, 0, Math.PI * 2);
  const cg = ctx.createRadialGradient(getCX() - 5, getCY() - 5, 0, getCX(), getCY(), 26);
  cg.addColorStop(0, '#18202c');
  cg.addColorStop(1, '#0d1218');
  ctx.fillStyle = cg;
  ctx.fill();
  ctx.strokeStyle = '#00c8ff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = '15px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(EV.wheelIcon || '', getCX(), getCY());
}

// Few players: label across the slice. Many: label along the slice (rim → hub),
// sized to the slice's width, kept upright, and the price dropped when it won't fit.
function drawSliceLabel(p, mid, sl, n) {
  const cx = getCX(),
    cy = getCY(),
    R = getR();
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 5;
  ctx.textBaseline = 'middle';
  if (n <= 8) {
    const lr = R * 0.62;
    ctx.translate(cx + Math.cos(mid) * lr, cy + Math.sin(mid) * lr);
    ctx.rotate(mid + Math.PI / 2);
    const fs = n > 6 ? 14 : 16;
    ctx.font = `700 ${fs}px Barlow,sans-serif`;
    ctx.fillStyle = '#dde8f0';
    ctx.textAlign = 'center';
    ctx.fillText(trunc(p.name, Math.min(140, 2 * lr * Math.sin(sl / 2) - 12), ctx), 0, -fs * 0.45);
    ctx.font = `500 ${fs - 2}px Barlow,sans-serif`;
    ctx.fillStyle = '#f5b800';
    ctx.shadowBlur = 0;
    ctx.fillText(zarS(p.price), 0, fs * 0.65);
    ctx.restore();
    return;
  }
  const ro = R - 12,
    ri = 36,
    len = ro - ri - 6;
  const thick = ro * 0.6 * sl; // slice width where the text sits
  const fs = Math.max(8, Math.min(15, Math.floor(thick * 0.55)));
  const two = thick >= fs * 2.5;
  // keep text upright: slices on the left half are flipped
  let a = mid % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  const flip = a > Math.PI / 2 && a < Math.PI * 1.5;
  ctx.translate(cx, cy);
  ctx.rotate(flip ? mid + Math.PI : mid);
  const x = flip ? -ro : ro;
  ctx.textAlign = flip ? 'left' : 'right';
  ctx.font = `700 ${fs}px Barlow,sans-serif`;
  ctx.fillStyle = '#dde8f0';
  if (two) {
    ctx.fillText(trunc(p.name, len, ctx), x, -fs * 0.5);
    ctx.font = `500 ${Math.max(8, fs - 2)}px Barlow,sans-serif`;
    ctx.fillStyle = '#f5b800';
    ctx.shadowBlur = 0;
    ctx.fillText(zarS(p.price), x, fs * 0.62);
  } else {
    ctx.font = `600 ${Math.max(8, fs - 2)}px Barlow,sans-serif`;
    const price = zarS(p.price),
      pw = ctx.measureText(price + '  ').width;
    const withPrice = len - pw >= 60; // only if the name still gets room
    ctx.font = `700 ${fs}px Barlow,sans-serif`;
    const name = trunc(p.name, withPrice ? len - pw : len, ctx);
    if (withPrice) {
      ctx.fillText(name, flip ? x + pw : x - pw, 0); // name sits inside the price, which hugs the rim
      ctx.font = `600 ${Math.max(8, fs - 2)}px Barlow,sans-serif`;
      ctx.fillStyle = '#f5b800';
      ctx.shadowBlur = 0;
      ctx.fillText(price, x, 0);
    } else ctx.fillText(name, x, 0);
  }
  ctx.restore();
}

function trunc(t, mx, c) {
  if (c.measureText(t).width <= mx) return t;
  while (t.length > 1 && c.measureText(t + '…').width > mx) t = t.slice(0, -1);
  return t + '…';
}

// ── AUDIO ───────────────────────────────────────────────────────────────────
let audioCtx = null,
  jingleNodes = [];

// Sound: 'on' (this laptop), 'projector' (only from the projector window, e.g. on the venue's
// speakers) or 'off'. Remembered on this device; S cycles it.
const SOUND_KEY = 'draftday.sound.v1';
let soundMode = (() => {
  try {
    return localStorage.getItem(SOUND_KEY) || 'on';
  } catch (e) {
    return 'on';
  }
})();
const SOUND_LABEL = { on: 'Sound on', projector: 'Sound on the projector only', off: 'Sound off' };
function setSound(mode) {
  soundMode = SOUND_LABEL[mode] ? mode : 'on';
  try {
    localStorage.setItem(SOUND_KEY, soundMode);
  } catch (e) {}
  if (soundMode === 'off') stopJingle();
  renderSoundBtn();
}
function cycleSound() {
  const next = { on: 'projector', projector: 'off', off: 'on' }[soundMode];
  setSound(next);
  showToast(
    SOUND_LABEL[soundMode] +
      (soundMode === 'projector' && !(typeof _proj !== 'undefined' && _proj && !_proj.closed)
        ? ' (open the projector window to hear it)'
        : ''),
  );
}
function renderSoundBtn() {
  document.querySelectorAll('.sound-btn').forEach(b => {
    b.innerHTML = icon(soundMode === 'off' ? 'mute' : 'sound') + (soundMode === 'projector' ? '<span class="sound-tag">TV</span>' : '');
    b.title = SOUND_LABEL[soundMode] + ' (S to change)';
    b.setAttribute('aria-label', SOUND_LABEL[soundMode]);
    b.classList.toggle('is-off', soundMode === 'off');
  });
}
function getAC() {
  if (soundMode === 'off') return null;
  if (soundMode === 'projector') {
    if (typeof _proj === 'undefined' || !_proj || _proj.closed) return null;
    const W = _proj;
    W._ac = W._ac || new (W.AudioContext || W.webkitAudioContext)();
    if (W._ac.state === 'suspended') W._ac.resume();
    return W._ac;
  }
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function stopJingle() {
  jingleNodes.forEach(n => {
    try {
      n.stop();
    } catch (e) {}
  });
  jingleNodes = [];
}

function playSpinJingle(duration) {
  stopJingle();
  const ac = getAC();
  if (!ac) return;
  const now = ac.currentTime;

  const master = ac.createGain();
  master.gain.setValueAtTime(0.28, now);
  master.connect(ac.destination);

  // Upbeat repeating carnival-style arpeggio
  // C major pentatonic: C4 E4 G4 A4 C5
  const notes = [261.63, 329.63, 392.0, 440.0, 523.25];
  const step = 0.13; // seconds per note
  const totalNotes = Math.floor(duration / 1000 / step);

  for (let i = 0; i < totalNotes; i++) {
    const freq = notes[i % notes.length];
    const t = now + i * step;

    // Bell-like tone: sine + triangle blend
    ['sine', 'triangle'].forEach((type, ti) => {
      const osc = ac.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq * (ti === 1 ? 2 : 1), t);

      const g = ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(ti === 0 ? 0.9 : 0.3, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + step * 0.85);

      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + step);
      jingleNodes.push(osc);
    });

    // Add a subtle bounce bass note every 5 notes
    if (i % 5 === 0) {
      const bass = ac.createOscillator();
      bass.type = 'sine';
      bass.frequency.setValueAtTime(freq * 0.5, t);
      const bg = ac.createGain();
      bg.gain.setValueAtTime(0, t);
      bg.gain.linearRampToValueAtTime(0.5, t + 0.02);
      bg.gain.exponentialRampToValueAtTime(0.001, t + step * 1.8);
      bass.connect(bg);
      bg.connect(master);
      bass.start(t);
      bass.stop(t + step * 2);
      jingleNodes.push(bass);
    }
  }

  // Speed up slightly as wheel slows (pitch bend up on last 20%)
  // Fade out at very end
  master.gain.setValueAtTime(0.28, now + duration / 1000 - 0.4);
  master.gain.linearRampToValueAtTime(0, now + duration / 1000);
}

function playVictorySting() {
  const ac = getAC();
  if (!ac) return;
  const now = ac.currentTime;
  const master = ac.createGain();
  master.gain.value = 0.4;
  master.connect(ac.destination);
  // Rising fanfare: C4 E4 G4 C5 — staggered
  [
    [261.63, 0],
    [329.63, 0.1],
    [392.0, 0.2],
    [523.25, 0.3],
  ].forEach(([freq, delay]) => {
    const o = ac.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, now + delay);
    g.gain.linearRampToValueAtTime(1.0, now + delay + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.9);
    o.connect(g);
    g.connect(master);
    o.start(now + delay);
    o.stop(now + delay + 1.0);
    // Octave shimmer
    const o2 = ac.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2;
    const g2 = ac.createGain();
    g2.gain.setValueAtTime(0, now + delay);
    g2.gain.linearRampToValueAtTime(0.3, now + delay + 0.02);
    g2.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.7);
    o2.connect(g2);
    g2.connect(master);
    o2.start(now + delay);
    o2.stop(now + delay + 0.8);
  });
}

const SPIN_MS = { quick: [1500, 2500], normal: [4000, 6000], dramatic: [7000, 9000] };
let _skipSpin = false;
function setSpinButton(spinningNow) {
  const b = document.getElementById('spinBtn');
  b.textContent = spinningNow ? 'SKIP ▶▶' : DRAW_MODES[EV.draw].button;
  if (spinningNow) b.disabled = false;
}
function spinWheel() {
  if (spinning) {
    _skipSpin = true;
    return;
  } // second press skips to the result
  if (EV.draw === 'random') return drawRandom();
  if (EV.draw === 'order') return drawInOrder();
  if (EV.draw === 'manual') return;
  const active = activePool();
  if (!active.length || bidRound.player) return;
  dismissWinner();
  spinning = true;
  _skipSpin = false;
  setSpinButton(true);
  canvas.classList.add('spinning');
  document.getElementById('wheelHalo').classList.add('active');
  const [lo, hi] = reduceMotion() ? [600, 800] : SPIN_MS[EV.spin] || SPIN_MS.normal;
  const turns = EV.spin === 'quick' ? 3 : EV.spin === 'dramatic' ? 9 : 5;
  const target = spinAngle + (turns + Math.random() * turns) * Math.PI * 2 + Math.random() * Math.PI * 2;
  const dur = lo + Math.random() * (hi - lo),
    s0 = spinAngle,
    t0 = performance.now();
  playSpinJingle(dur);
  const ease = t => 1 - Math.pow(1 - t, 4);
  (function f(now) {
    const t = _skipSpin ? 1 : Math.min((now - t0) / dur, 1);
    spinAngle = s0 + (target - s0) * ease(t);
    drawWheel(spinAngle);
    if (t < 1) {
      requestAnimationFrame(f);
    } else {
      spinAngle = target % (Math.PI * 2);
      drawWheel(spinAngle);
      spinning = false;
      canvas.classList.remove('spinning');
      document.getElementById('wheelHalo').classList.remove('active');
      setSpinButton(false);
      stopJingle();
      playVictorySting();
      resolveWinner(spinAngle);
    }
  })(t0);
}

// Everyone not on a team (for roster add)
function availablePlayers() {
  const c = getCaptainNames();
  return players.filter(p => !p.sold && !c.includes(p.name.toLowerCase()));
}
// Who can come up next: the main pool, or the unsold queue during the unsold round
function activePool() {
  return availablePlayers().filter(p => (auctionPhase === 'unsold' ? !p.unsoldFinal : !EV.unsold.enabled || !p.unsold));
}
const unsoldQueue = () => availablePlayers().filter(p => p.unsold && !p.unsoldFinal);
const stillUnsold = () => availablePlayers().filter(p => p.unsoldFinal || (auctionPhase === 'main' && p.unsold));
// Teams that could still take any queued player
function teamsThatCanBuy(list) {
  const cheapest = Math.min(...list.map(p => Math.round(Math.max(p.price || 0, tierMin(p.tier)) * (1 - EV.unsold.discount / 100))));
  return teams.filter(t => !squadFull(t) && t.budget >= cheapest);
}

// No sale: into the unsold queue (or, in the unsold round, unsold for good)
function markUnsold() {
  const p = bidRound.player;
  if (!p) return;
  snap(`${p.name} unsold`);
  if (EV.unsold.enabled) {
    if (auctionPhase === 'unsold') {
      setStatus(p, 'unsold');
      showToast(`${p.name} stays unsold`);
    } else {
      setStatus(p, 'queued');
      showToast(`${p.name} → unsold queue (${unsoldQueue().length} waiting)`);
    }
  }
  dismissWinner();
  drawWheel();
  updateStats();
}
// Put the player back without marking them unsold (wrong player came up, etc.)
function backToPool() {
  if (bidRound.player) snap(`${bidRound.player.name} back to pool`);
  dismissWinner();
  drawWheel();
}
function returnFromQueue(id) {
  const p = players.find(x => x.id === id);
  if (!p) return;
  snap(`${p.name} back from the queue`);
  setStatus(p, 'pool');
  renderPlayersList();
  drawWheel();
  updateStats();
  showToast(`${p.name} is back in the pool`);
}
function startUnsoldRound() {
  const q = unsoldQueue();
  if (!q.length) return;
  snap('start of the unsold round');
  auctionPhase = 'unsold';
  const n = teamsThatCanBuy(q).length;
  showToast(
    `Unsold round: ${q.length} player${q.length !== 1 ? 's' : ''}, ${EV.unsold.discount}% off · ${n} team${n !== 1 ? 's' : ''} can bid`,
  );
  renderPlayersList();
  drawWheel();
  updateStats();
}
function putUpForBid(id) {
  if (spinning || bidRound.player) return;
  const p = players.find(x => x.id === id);
  if (!p || p.sold) return;
  currentPlayer = p;
  showWinnerPanel(p);
  playVictorySting();
}
function drawInOrder() {
  const a = activePool();
  if (a.length) putUpForBid(a[0].id);
}
function drawRandom() {
  const a = activePool();
  if (!a.length || spinning || bidRound.player) return;
  spinning = true;
  _skipSpin = false;
  setSpinButton(true);
  const el = document.getElementById('drawStage'),
    pick = a[Math.floor(Math.random() * a.length)];
  const base = EV.spin === 'quick' ? 700 : EV.spin === 'dramatic' ? 4500 : Math.min(2200, 900 + a.length * 40);
  const dur = base,
    t0 = performance.now();
  playSpinJingle(dur);
  let last = 0;
  (function f(now) {
    const t = _skipSpin ? 1 : (now - t0) / dur;
    if (t < 1) {
      if (now - last > 60 + t * 180) {
        last = now;
        const r = a[Math.floor(Math.random() * a.length)];
        el.innerHTML = `<div class="draw-stage-lbl">Drawing…</div><div class="draw-stage-big draw-stage-flick">${esc(r.name)}</div>`;
      }
      requestAnimationFrame(f);
    } else {
      spinning = false;
      setSpinButton(false);
      stopJingle();
      playVictorySting();
      currentPlayer = pick;
      showWinnerPanel(pick);
      launchConfetti();
    }
  })(t0);
}

function resolveWinner(angle) {
  const active = activePool();
  if (!active.length) return;
  const sl = (Math.PI * 2) / active.length;
  const pa = ((-angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  currentPlayer = active[Math.floor(pa / sl) % active.length];
  showWinnerPanel(currentPlayer);
  launchConfetti();
}

// ── CRICKET PLAYER SVG GENERATOR ────────────────────────────────────────────
function hashName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function generatePlayerSVG(name) {
  const h = hashName(name);
  const pick = arr => arr[h % arr.length];
  const pick2 = (arr, seed) => arr[seed % arr.length];

  // Skin tones
  const skins = ['#FDBCB4', '#F1C27D', '#E0AC69', '#C68642', '#8D5524', '#5C3317'];
  const skin = pick(skins);

  // Kit colours — unique combos
  const kits = [
    { shirt: '#1a3a8f', pant: '#ffffff', trim: '#f5b800' },
    { shirt: '#8f1a1a', pant: '#f0f0f0', trim: '#00c8ff' },
    { shirt: '#1a7a1a', pant: '#fffde0', trim: '#ff6030' },
    { shirt: '#7a1a7a', pant: '#e8e8ff', trim: '#00e87a' },
    { shirt: '#0d2a40', pant: '#d0e8ff', trim: '#ff4050' },
    { shirt: '#403010', pant: '#f5e8c0', trim: '#00c8ff' },
    { shirt: '#1a4a3a', pant: '#ffffff', trim: '#f5b800' },
    { shirt: '#2a2a6a', pant: '#ffeedd', trim: '#00e87a' },
  ];
  const kit = pick(kits);

  // Helmet colours
  const helmets = ['#cc2200', '#003399', '#006622', '#552200', '#444444', '#880066', '#1a5a7a'];
  const helmetCol = pick2(helmets, Math.floor(h / kits.length));

  // Stances: 0=cover drive, 1=pull shot, 2=defensive, 3=sweep
  const stance = h % 4;

  // Glove colour
  const gloveCol = '#f0f0e0';

  // Bat colour
  const batCol = '#d4a84b';
  const batHandle = '#4a2a0a';

  // Build SVG based on stance

  // Common elements generator
  const head = (cx, cy, r) => `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 1.05}" fill="${skin}"/>`;
  const helmet = (cx, cy, r, col) => `
    <ellipse cx="${cx}" cy="${cy - r * 0.3}" rx="${r * 1.15}" ry="${r * 0.8}" fill="${col}"/>
    <rect x="${cx - r * 1.15}" y="${cy - r * 0.3}" width="${r * 2.3}" height="${r * 0.55}" rx="3" fill="${col}"/>
    <rect x="${cx - r * 0.9}" y="${cy + r * 0.25}" width="${r * 1.8}" height="${r * 0.22}" rx="2" fill="${col}" opacity="0.8"/>
    <line x1="${cx - r}" y1="${cy + r * 0.18}" x2="${cx + r}" y2="${cy + r * 0.18}" stroke="#ffffff22" stroke-width="1"/>`;
  const face = (cx, cy, r) => `
    <ellipse cx="${cx - r * 0.28}" cy="${cy + r * 0.1}" rx="1.5" ry="1.8" fill="#00000033"/>
    <ellipse cx="${cx + r * 0.28}" cy="${cy + r * 0.1}" rx="1.5" ry="1.8" fill="#00000033"/>
    <path d="M${cx - r * 0.2} ${cy + r * 0.45} q${r * 0.2} ${r * 0.2} ${r * 0.4} 0" stroke="#00000055" stroke-width="1.2" fill="none"/>`;

  let svg = '';

  if (stance === 0) {
    // Cover drive — leaning forward, bat extended right
    svg = `
      <g transform="translate(5,4)">
        ${helmet(50, 28, 14, helmetCol)}
        ${head(50, 32, 13)}
        ${face(50, 32, 13)}
        <!-- body -->
        <rect x="38" y="55" width="24" height="36" rx="6" fill="${kit.shirt}"/>
        <rect x="40" y="55" width="4" height="36" rx="2" fill="${kit.trim}" opacity="0.6"/>
        <!-- back arm -->
        <line x1="38" y1="62" x2="18" y2="78" stroke="${skin}" stroke-width="7" stroke-linecap="round"/>
        <line x1="18" y1="78" x2="12" y2="88" stroke="${skin}" stroke-width="6" stroke-linecap="round"/>
        <!-- glove back -->
        <ellipse cx="12" cy="89" rx="6" ry="5" fill="${gloveCol}"/>
        <!-- front arm -->
        <line x1="62" y1="62" x2="80" y2="72" stroke="${skin}" stroke-width="7" stroke-linecap="round"/>
        <line x1="80" y1="72" x2="90" y2="80" stroke="${skin}" stroke-width="6" stroke-linecap="round"/>
        <!-- glove front -->
        <ellipse cx="90" cy="81" rx="6" ry="5" fill="${gloveCol}"/>
        <!-- bat -->
        <rect x="85" y="70" width="10" height="42" rx="3" fill="${batCol}" transform="rotate(30,90,80)"/>
        <rect x="87" y="68" width="4" height="12" rx="2" fill="${batHandle}" transform="rotate(30,90,80)"/>
        <!-- legs/pads -->
        <rect x="36" y="88" width="12" height="32" rx="4" fill="${kit.pant}"/>
        <rect x="52" y="88" width="12" height="32" rx="4" fill="${kit.pant}"/>
        <!-- pad straps -->
        <line x1="36" y1="96" x2="48" y2="96" stroke="#cccccc" stroke-width="1.5"/>
        <line x1="52" y1="96" x2="64" y2="96" stroke="#cccccc" stroke-width="1.5"/>
        <line x1="36" y1="106" x2="48" y2="106" stroke="#cccccc" stroke-width="1.5"/>
        <line x1="52" y1="106" x2="64" y2="106" stroke="#cccccc" stroke-width="1.5"/>
        <!-- shoes -->
        <ellipse cx="42" cy="121" rx="9" ry="4" fill="#222"/>
        <ellipse cx="58" cy="121" rx="9" ry="4" fill="#222"/>
      </g>`;
  } else if (stance === 1) {
    // Pull shot — upright, bat raised high left
    svg = `
      <g transform="translate(5,4)">
        ${helmet(52, 24, 14, helmetCol)}
        ${head(52, 28, 13)}
        ${face(52, 28, 13)}
        <!-- body -->
        <rect x="40" y="50" width="24" height="36" rx="6" fill="${kit.shirt}"/>
        <rect x="56" y="50" width="4" height="36" rx="2" fill="${kit.trim}" opacity="0.6"/>
        <!-- raised arm (bat side) -->
        <line x1="40" y1="56" x2="18" y2="36" stroke="${skin}" stroke-width="7" stroke-linecap="round"/>
        <line x1="18" y1="36" x2="14" y2="22" stroke="${skin}" stroke-width="6" stroke-linecap="round"/>
        <ellipse cx="14" cy="21" rx="6" ry="5" fill="${gloveCol}"/>
        <!-- bat up -->
        <rect x="6" y="4" width="10" height="44" rx="3" fill="${batCol}" transform="rotate(-15,14,22)"/>
        <rect x="8" y="2" width="4" height="12" rx="2" fill="${batHandle}" transform="rotate(-15,14,22)"/>
        <!-- other arm -->
        <line x1="64" y1="56" x2="82" y2="68" stroke="${skin}" stroke-width="7" stroke-linecap="round"/>
        <line x1="82" y1="68" x2="88" y2="78" stroke="${skin}" stroke-width="6" stroke-linecap="round"/>
        <ellipse cx="88" cy="79" rx="6" ry="5" fill="${gloveCol}"/>
        <!-- legs -->
        <rect x="38" y="84" width="12" height="32" rx="4" fill="${kit.pant}"/>
        <rect x="54" y="84" width="12" height="32" rx="4" fill="${kit.pant}"/>
        <line x1="38" y1="92" x2="50" y2="92" stroke="#cccccc" stroke-width="1.5"/>
        <line x1="54" y1="92" x2="66" y2="92" stroke="#cccccc" stroke-width="1.5"/>
        <line x1="38" y1="102" x2="50" y2="102" stroke="#cccccc" stroke-width="1.5"/>
        <line x1="54" y1="102" x2="66" y2="102" stroke="#cccccc" stroke-width="1.5"/>
        <ellipse cx="44" cy="117" rx="9" ry="4" fill="#222"/>
        <ellipse cx="60" cy="117" rx="9" ry="4" fill="#222"/>
      </g>`;
  } else if (stance === 2) {
    // Defensive — crouched, bat straight down
    svg = `
      <g transform="translate(5,8)">
        ${helmet(50, 20, 13, helmetCol)}
        ${head(50, 24, 12)}
        ${face(50, 24, 12)}
        <!-- body crouched -->
        <rect x="38" y="44" width="24" height="30" rx="6" fill="${kit.shirt}"/>
        <rect x="40" y="44" width="4" height="30" rx="2" fill="${kit.trim}" opacity="0.6"/>
        <!-- arms down on bat -->
        <line x1="38" y1="52" x2="24" y2="66" stroke="${skin}" stroke-width="7" stroke-linecap="round"/>
        <line x1="24" y1="66" x2="20" y2="78" stroke="${skin}" stroke-width="6" stroke-linecap="round"/>
        <ellipse cx="20" cy="79" rx="6" ry="5" fill="${gloveCol}"/>
        <line x1="62" y1="52" x2="72" y2="64" stroke="${skin}" stroke-width="7" stroke-linecap="round"/>
        <line x1="72" y1="64" x2="76" y2="76" stroke="${skin}" stroke-width="6" stroke-linecap="round"/>
        <ellipse cx="76" cy="77" rx="6" ry="5" fill="${gloveCol}"/>
        <!-- bat vertical -->
        <rect x="44" y="72" width="10" height="44" rx="3" fill="${batCol}"/>
        <rect x="46" y="70" width="4" height="12" rx="2" fill="${batHandle}"/>
        <!-- legs wide -->
        <rect x="30" y="72" width="14" height="34" rx="4" fill="${kit.pant}" transform="rotate(-8,37,88)"/>
        <rect x="56" y="72" width="14" height="34" rx="4" fill="${kit.pant}" transform="rotate(8,63,88)"/>
        <line x1="31" y1="82" x2="43" y2="80" stroke="#cccccc" stroke-width="1.5"/>
        <line x1="57" y1="80" x2="69" y2="82" stroke="#cccccc" stroke-width="1.5"/>
        <ellipse cx="37" cy="107" rx="10" ry="4" fill="#222"/>
        <ellipse cx="63" cy="107" rx="10" ry="4" fill="#222"/>
      </g>`;
  } else {
    // Sweep shot — low crouch, bat sweeping left
    svg = `
      <g transform="translate(5,6)">
        ${helmet(54, 22, 13, helmetCol)}
        ${head(54, 26, 12)}
        ${face(54, 26, 12)}
        <!-- body low -->
        <rect x="40" y="46" width="24" height="28" rx="6" fill="${kit.shirt}"/>
        <rect x="42" y="46" width="4" height="28" rx="2" fill="${kit.trim}" opacity="0.6"/>
        <!-- sweeping arms -->
        <line x1="40" y1="54" x2="20" y2="68" stroke="${skin}" stroke-width="7" stroke-linecap="round"/>
        <line x1="20" y1="68" x2="8"  y2="78" stroke="${skin}" stroke-width="6" stroke-linecap="round"/>
        <ellipse cx="8" cy="79" rx="6" ry="5" fill="${gloveCol}"/>
        <line x1="64" y1="54" x2="80" y2="64" stroke="${skin}" stroke-width="7" stroke-linecap="round"/>
        <line x1="80" y1="64" x2="92" y2="72" stroke="${skin}" stroke-width="6" stroke-linecap="round"/>
        <ellipse cx="92" cy="73" rx="6" ry="5" fill="${gloveCol}"/>
        <!-- bat sweep low diagonal -->
        <rect x="2" y="72" width="42" height="9" rx="3" fill="${batCol}" transform="rotate(-10,24,76)"/>
        <rect x="2" y="70" width="10" height="4" rx="2" fill="${batHandle}" transform="rotate(-10,8,72)"/>
        <!-- front knee down -->
        <rect x="36" y="73" width="14" height="38" rx="4" fill="${kit.pant}" transform="rotate(-20,43,90)"/>
        <rect x="56" y="70" width="14" height="36" rx="4" fill="${kit.pant}"/>
        <line x1="37" y1="84" x2="47" y2="80" stroke="#cccccc" stroke-width="1.5"/>
        <line x1="56" y1="80" x2="70" y2="80" stroke="#cccccc" stroke-width="1.5"/>
        <ellipse cx="40" cy="110" rx="10" ry="4" fill="#222" transform="rotate(-20,40,110)"/>
        <ellipse cx="63" cy="107" rx="10" ry="4" fill="#222"/>
      </g>`;
  }

  // Wrap in styled SVG with ground shadow
  return `<svg viewBox="0 0 110 130" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="shadow_${h}" cx="50%" cy="100%" rx="40%" ry="8%">
        <stop offset="0%" stop-color="#000000" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <ellipse cx="55" cy="126" rx="38" ry="6" fill="url(#shadow_${h})"/>
    ${svg}
  </svg>`;
}

// ── LIVE BIDDING ROUND ───────────────────────────────────────────────────────
// State for the current bidding round
let bidRound = {
  player: null, // currentPlayer reference
  bids: [], // [{teamId, amount, timestamp}] — per-action log
  passed: new Set(), // teamIds that have passed
  leaderId: null, // teamId of current highest bidder
  leaderBid: 0,
  startTime: null,
};

function showWinnerPanel(player) {
  // Init bid round state
  bidRound = {
    player,
    bids: [],
    passed: new Set(),
    leaderId: null,
    leaderBid: 0,
    startTime: new Date(),
  };

  document.getElementById('winnerName').textContent = player.name;
  const open = openingMin(player);
  document.getElementById('winnerBase').textContent =
    zarFmt(player.price) +
    (open !== player.price
      ? ` · opening bid ${zarFmt(open)}${inUnsoldRound(player) ? ` (unsold round, ${EV.unsold.discount}% off)` : ''}`
      : '');

  // Tier badge
  const tb = document.getElementById('winnerTier');
  const bn = document.getElementById('winnerTierBanner');
  if (tierDef(player.tier)) {
    tb.textContent = player.tier;
    tb.className = 'tier-badge tier-badge-inline ' + tierClass(player.tier);
    bn.textContent = '⭐ ' + player.tier + ' Tier';
    bn.className = 'tier-banner ' + tierClass(player.tier);
  } else {
    tb.textContent = '';
    tb.className = 'tier-badge tier-badge-inline';
    bn.textContent = '';
    bn.className = 'tier-banner';
  }

  // Player graphic
  document.getElementById('playerGraphic').innerHTML = generatePlayerSVG(player.name);

  renderBidRoundTitle();
  renderBidRoundTeams();
  renderBidTrail();
  updateLeaderDisplay();

  document.getElementById('declareWinnerBtn').disabled = true;
  clearBidError();

  const p = document.getElementById('winnerPanel');
  p.classList.remove('visible');
  void p.offsetWidth;
  p.classList.add('visible');
  document.querySelector('.wheel-area').classList.add('bidding');
  document.getElementById('spinBtn').disabled = true;
  setTimeout(() => p.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);

  startBidTimer();
  renderPlayersList();
  if (!teams.some(t => !isTeamBlocked(t)))
    showBidError('No team can bid on this player (budgets, squad or tier limits). Skip them to put them back in the pool.');
}

function renderBidRoundTitle() {
  const activeBidders = teams.filter(t => !bidRound.passed.has(t.id) && (!isTeamBlocked(t) || t.id === bidRound.leaderId));
  document.getElementById('bidRoundTitle').textContent = 'BIDDING ROUND';
  document.getElementById('bidRoundTurn').innerHTML = activeBidders.length
    ? `<strong>${activeBidders.length}</strong> team${activeBidders.length !== 1 ? 's' : ''} still bidding`
    : 'All teams have passed or are blocked';
}

// Why a team can't bid on the player up ('' = it can)
// Purse reserve: keep enough to fill the remaining squad slots at the cheapest opening bid
function cheapestOpening(excludeId) {
  const pool = availablePlayers().filter(p => p.id !== excludeId && !p.unsoldFinal);
  return pool.length ? Math.min(...pool.map(openingMin)) : 0;
}
function reserveFor(t, excludeId) {
  if (!EV.bidding.reserve || !EV.squadSize) return 0;
  const left = slotsLeft(t);
  return left === Infinity || left <= 1 ? 0 : (left - 1) * cheapestOpening(excludeId);
}
const maxBid = t => Math.max(0, t.budget - reserveFor(t, bidRound.player && bidRound.player.id));

function blockReason(t) {
  const p = bidRound.player;
  if (!p) return 'No player';
  const minRequired =
    bidRound.leaderBid > 0 ? bidRound.leaderBid + (EV.bidding.enforceIncrement ? EV.bidding.increment : 1) : openingMin(p);
  if (squadFull(t)) return 'Squad full';
  if (p.tier && tierFull(t, p.tier)) return `${tierLimit(p.tier)} ${p.tier} already`;
  if (t.budget < openingMin(p)) return 'Insufficient funds';
  if (maxBid(t) < openingMin(p)) return `Keeping ${zarS(reserveFor(t, p.id))} to fill the squad`;
  if (t.id !== bidRound.leaderId && maxBid(t) < minRequired) return "Can't beat the leader";
  return '';
}
function isTeamBlocked(t) {
  return !!blockReason(t);
}

function renderBidRoundTeams() {
  const player = bidRound.player;
  const html = teams
    .map(t => {
      const blocked = isTeamBlocked(t);
      const hasPassed = bidRound.passed.has(t.id);
      const isLeader = t.id === bidRound.leaderId;
      const teamBids = bidRound.bids.filter(b => b.teamId === t.id);
      const latestBid = teamBids.length ? teamBids[teamBids.length - 1].amount : null;
      const pct = (t.budget / startBudget(t)) * 100;
      const budgetCls = pct < 20 ? 'low' : pct < 50 ? 'mid' : 'ok';
      const left = slotsLeft(t);

      let statusHtml = '';
      if (blocked && !hasPassed && !isLeader) {
        statusHtml = `<div class="tbr-status c-red">${esc(blockReason(t))}</div>`;
      } else if (hasPassed) {
        statusHtml = `<div class="tbr-status t-muted italic">Passed</div>`;
      } else if (isLeader) {
        statusHtml = `<div class="tbr-status c-gold fw-700">🏆 Leading — ${zarS(latestBid)}</div>`;
      } else if (latestBid) {
        statusHtml = `<div class="tbr-status t-muted">Last bid: ${zarS(latestBid)} · <span class="${budgetCls}">${zarS(t.budget)} left</span>${maxBid(t) < t.budget ? ` · max ${zarS(maxBid(t))}` : ''}</div>`;
      } else {
        statusHtml = `<div class="tbr-status"><span class="${budgetCls}">${zarS(t.budget)}</span>${maxBid(t) < t.budget ? ` · <span title="Purse reserve: keeps enough to fill the squad">max ${zarS(maxBid(t))}</span>` : ''}${left === Infinity ? '' : ` · ${left} slot${left !== 1 ? 's' : ''}`}</div>`;
      }

      const rowClass = ['team-bid-row', isLeader ? 'winner-row' : '', hasPassed ? 'passed' : '', blocked && !hasPassed ? 'broke' : '']
        .filter(Boolean)
        .join(' ');

      const disabled = (blocked && !isLeader) || hasPassed || isLeader;
      const suggestedBid = bidRound.leaderBid > 0 ? bidRound.leaderBid + EV.bidding.increment : openingMin(player);

      return `<div class="${rowClass}" id="tbr-${t.id}">
      ${isLeader || (!hasPassed && !blocked) ? '<div class="tbr-turn-indicator"></div>' : ''}
      <img src="${t.logo}" class="team-logo-sm shrink-0" alt=""/>
      <div class="tbr-logo-name">
        <div class="min-w-0">
          <div class="tbr-name">${esc(t.name)}</div>
          ${statusHtml}
        </div>
      </div>
      <div class="tbr-inp-wrap">
        <span class="tbr-inp-prefix">${esc(EV.currency)}</span>
        <input type="text" inputmode="decimal" autocomplete="off" class="tbr-bid-inp${EV.bidding.inThousands ? ' in-k' : ''}" id="tbrinp-${t.id}"
          value="${disabled || !EV.bidding.prefill ? '' : fmtBid(suggestedBid)}" placeholder="${disabled ? '' : fmtBid(suggestedBid)}"
          ${disabled ? 'disabled' : ''} oninput="liveFormat(this)"
          onkeydown="if(event.key==='Enter')placeBid(${t.id})"/>
        ${EV.bidding.inThousands ? '<span class="tbr-inp-suffix">K</span>' : ''}
      </div>
      <div class="tbr-quick">${[1, 2, 5]
        .map(k => {
          const amt = quickAmount(k);
          return `<button class="tbr-btn tbr-btn-q" data-action="quickBid" data-args='[${t.id},${k}]' ${disabled || amt > maxBid(t) ? 'disabled' : ''} title="Bid ${zarFmt(amt)}">+${zarS(k * EV.bidding.increment).replace(EV.currency, '')}</button>`;
        })
        .join('')}</div>
      <div class="tbr-actions">
        <button class="tbr-btn tbr-btn-bid" data-action="placeBid" data-args='[${t.id}]' ${disabled ? 'disabled' : ''}>Bid</button>
        <button class="tbr-btn tbr-btn-pass" data-action="passTeam" data-args='[${t.id}]' ${(blocked && !isLeader) || hasPassed ? 'disabled' : ''}>Pass</button>
      </div>
    </div>`;
    })
    .join('');
  document.getElementById('teamBidList').innerHTML = html;
}

// Quick bids: +1, +2 or +5 increments over the leader (or from the opening bid)
function quickAmount(k) {
  if (!bidRound.player) return 0;
  return bidRound.leaderBid > 0
    ? bidRound.leaderBid + k * EV.bidding.increment
    : openingMin(bidRound.player) + (k - 1) * EV.bidding.increment;
}
function quickBid(teamId, k) {
  const inp = document.getElementById('tbrinp-' + teamId);
  if (!inp || inp.disabled) return;
  inp.value = fmtBid(quickAmount(k));
  placeBid(teamId);
}

function placeBid(teamId) {
  cancelGoing(_going ? 'New bid: back to bidding' : '');
  const player = bidRound.player;
  if (!player) return;
  const team = teams.find(t => t.id === teamId);
  if (!team || bidRound.passed.has(teamId) || teamId === bidRound.leaderId) return;
  const why = blockReason(team);
  if (why) {
    showBidError(`${team.name}: ${why}.`);
    return;
  }

  const inp = document.getElementById('tbrinp-' + teamId);
  const amount = parseAmount(inp?.value) || 0;
  if (amount <= 0) {
    showBidError('Enter a valid bid amount.');
    shakeBidInput();
    return;
  }

  const minBid = openingMin(player);
  if (amount < minBid) {
    showBidError(`Opening bid is at least ${zarFmt(minBid)}.`);
    return;
  }
  if (bidRound.leaderBid > 0) {
    const need = bidRound.leaderBid + (EV.bidding.enforceIncrement ? EV.bidding.increment : 1);
    if (amount < need) {
      showBidError(
        EV.bidding.enforceIncrement
          ? `Bid at least ${zarFmt(need)} (leader ${zarFmt(bidRound.leaderBid)} + ${zarFmt(EV.bidding.increment)}).`
          : `Bid must be higher than the leader (${zarFmt(bidRound.leaderBid)}).`,
      );
      return;
    }
  }
  if (amount > team.budget) {
    showBidError(`${team.name} only has ${zarFmt(team.budget)} — can't bid ${zarFmt(amount)}.`);
    return;
  }
  if (amount > maxBid(team)) {
    showBidError(
      `${team.name} can bid up to ${zarFmt(maxBid(team))}: it must keep ${zarFmt(reserveFor(team, player.id))} to fill ${slotsLeft(team) - 1} more squad slot${slotsLeft(team) - 1 !== 1 ? 's' : ''}.`,
    );
    return;
  }

  snap(`${team.name} bid ${zarS(amount)}`);
  clearBidError();
  bidRound.bids.push({ teamId, amount, timestamp: new Date(), isNewHigh: true });
  bidRound.leaderId = teamId;
  bidRound.leaderBid = amount;
  document.getElementById('declareWinnerBtn').disabled = false;
  if (EV.bidding.timer > 0 && EV.bidding.timerResetsOnBid) startBidTimer();

  renderBidRoundTeams();
  renderBidTrail();
  updateLeaderDisplay();
  renderBidRoundTitle();
  maybeAutoSell();
}

// Sell once nobody but the leader can still bid (when auto-sell is on)
function maybeAutoSell() {
  if (!EV.bidding.autoSell || bidRound.leaderId === null || !bidRound.player) return;
  const others = teams.filter(t => t.id !== bidRound.leaderId && !bidRound.passed.has(t.id) && !isTeamBlocked(t));
  if (!others.length) {
    const p = bidRound.player;
    showToast('No one else can bid — sold!');
    setTimeout(() => {
      if (bidRound.player === p) declareWinner();
    }, 700);
  }
}

function passTeam(teamId) {
  if (!teams.some(t => t.id === teamId) || bidRound.passed.has(teamId)) return;
  snap(`${(teams.find(t => t.id === teamId) || {}).name} passed`);
  bidRound.passed.add(teamId);
  bidRound.bids.push({ teamId, amount: null, timestamp: new Date(), isPast: true });
  // The leader passing gives up the lead only if nobody else is left — they stay the high bid
  clearBidError();
  renderBidRoundTeams();
  renderBidTrail();
  renderBidRoundTitle();

  const stillIn = teams.filter(t => !bidRound.passed.has(t.id) && !isTeamBlocked(t) && t.id !== bidRound.leaderId);
  if (bidRound.leaderId !== null && (EV.bidding.autoSell ? !stillIn.length : !stillIn.length && bidRound.passed.has(bidRound.leaderId))) {
    const p = bidRound.player;
    showToast('Everyone else passed — sold!');
    setTimeout(() => {
      if (bidRound.player === p) declareWinner();
    }, 600);
  } else if (bidRound.leaderId === null && !teams.some(t => !bidRound.passed.has(t.id) && !isTeamBlocked(t))) {
    const p = bidRound.player;
    setTimeout(() => {
      if (bidRound.player === p) markUnsold();
    }, 700);
  }
}

function updateLeaderDisplay() {
  const el = document.getElementById('bidRoundLeader');
  if (bidRound.leaderId === null) {
    el.classList.remove('visible');
    return;
  }
  const team = teams.find(t => t.id === bidRound.leaderId);
  el.classList.add('visible');
  el.innerHTML = `
    <div class="bid-round-leader-lbl">🏆 Current Leader</div>
    <div class="bid-round-leader-name" style="color:${team.color}">${esc(team.name)}</div>
    <div class="bid-round-leader-amt">${zarFmt(bidRound.leaderBid)}</div>`;
}

const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

function renderBidTrail() {
  const el = document.getElementById('bidTrail');
  if (!bidRound.bids.length) {
    el.innerHTML = '<div class="bid-trail-empty">No bids yet — waiting for first bid</div>';
    return;
  }
  let n = 0;
  const nums = bidRound.bids.map(b => (b.amount === null ? '' : ordinal(++n) + ' bid'));
  el.innerHTML = [...bidRound.bids]
    .map((b, i) => [b, nums[i]])
    .reverse()
    .map(([b, time]) => {
      const team = teams.find(t => t.id === b.teamId);
      if (b.amount === null) {
        return `<div class="bid-trail-entry pass-entry">
        <div class="trail-dot" style="background:${team.color}"></div>
        <div class="trail-team">${esc(team.name)}</div>
        <div class="trail-action trail-pass">Passed</div>
        <div class="trail-time">${time}</div>
      </div>`;
      }
      const newHighHtml = b.isNewHigh ? '<span class="trail-new-high">↑ NEW HIGH</span>' : '';
      return `<div class="bid-trail-entry">
      <div class="trail-dot" style="background:${team.color}"></div>
      <div class="trail-team">${esc(team.name)}</div>
      <div class="trail-action trail-bid">${zarS(b.amount)}</div>
      ${newHighHtml}
      <div class="trail-time">${time}</div>
    </div>`;
    })
    .join('');
  el.scrollTop = 0;
}

function declareWinner() {
  const player = bidRound.player;
  if (!player) return;
  if (bidRound.leaderId === null) {
    showBidError('No bids placed — select a winner or skip.');
    return;
  }
  snap(`sale of ${player.name}`);

  const team = teams.find(t => t.id === bidRound.leaderId);
  const finalPrice = bidRound.leaderBid;

  clearBidTimer();

  // Build bid trail summary for history
  const trailSummary = bidRound.bids.map(b => ({
    teamId: b.teamId,
    teamName: teams.find(t => t.id === b.teamId)?.name || '',
    teamColor: teams.find(t => t.id === b.teamId)?.color || '#888',
    amount: b.amount,
    timestamp: b.timestamp.toISOString(),
    isNewHigh: b.isNewHigh || false,
    isPast: b.amount === null,
  }));

  team.budget -= finalPrice;
  const secondRound = inUnsoldRound(player); // read before the status changes
  team.players.push(setStatus({ ...player, finalPrice, teamId: team.id }, 'sold'));
  setStatus(player, 'sold');
  player.teamId = bidRound.leaderId;
  player.finalPrice = finalPrice;

  auctionLog.push({
    player: player.name,
    tier: player.tier || '',
    team: team.name,
    teamColor: team.color,
    basePrice: player.price,
    finalPrice,
    unsoldRound: secondRound,
    bidTrail: trailSummary,
    startTime: bidRound.startTime?.toISOString(),
    endTime: new Date().toISOString(),
  });

  const pName = player.name,
    tName = team.name;
  dismissWinner();
  renderTeamsBar();
  renderPlayersList();
  renderLog();
  updateStats();
  showToast(`🏆 ${pName} → ${tName} for ${zarFmt(finalPrice)}`);
  currentPlayer = null;
}

function shakeBidInput() {
  // Shake all active bid inputs
  document.querySelectorAll('.tbr-bid-inp:not(:disabled)').forEach(e => {
    e.classList.add('error');
    setTimeout(() => e.classList.remove('error'), 500);
  });
}
function dismissWinner() {
  cancelGoing();
  clearBidTimer();
  bidRound = { player: null, bids: [], passed: new Set(), leaderId: null, leaderBid: 0, startTime: null };
  document.getElementById('winnerPanel').classList.remove('visible');
  document.querySelector('.wheel-area').classList.remove('bidding');
  document.getElementById('bidRoundLeader').classList.remove('visible');
  clearBidError();
  if (teams.length) renderPlayersList();
}
function showBidError(m) {
  const e = document.getElementById('bidError');
  e.textContent = m;
  e.classList.add('visible');
}
function clearBidError() {
  document.getElementById('bidError').classList.remove('visible');
}

function renderLog() {
  const el = document.getElementById('logList');
  document.getElementById('logBadge').textContent = auctionLog.length;
  if (!auctionLog.length) {
    el.innerHTML = '<div class="empty-state">No players signed yet.</div>';
    return;
  }
  el.innerHTML = [...auctionLog]
    .reverse()
    .map(
      (e, i) => `
    <div class="log-row">
      <div class="log-num">${auctionLog.length - i}</div>
      <div class="log-dot" style="background:${e.teamColor}"></div>
      <div class="log-player">${esc(e.player)}</div>
      ${tierPill(e.tier)}
      <div class="log-team">${esc(e.team)}</div>
      <div class="log-price">${zarS(e.finalPrice)}</div>
    </div>`,
    )
    .join('');
  el.scrollTop = 0;
}

function updateStats() {
  const sold = players.filter(p => p.sold).length;
  const badge = document.getElementById('roundBadge');
  const done =
    players.length &&
    !activePool().length &&
    !(auctionPhase === 'main' && EV.unsold.enabled && unsoldQueue().length && teamsThatCanBuy(unsoldQueue()).length);
  if (!players.length) badge.innerHTML = '<span class="live-dot"></span>AUCTION LIVE';
  else if (done) badge.innerHTML = `✓ COMPLETE · ${sold} SIGNED`;
  else if (auctionPhase === 'unsold') badge.innerHTML = `<span class="live-dot"></span>UNSOLD ROUND · ${activePool().length} LEFT`;
  else badge.innerHTML = `<span class="live-dot"></span>${sold} / ${players.length} SIGNED`;
  const bhBtn = document.getElementById('bidHistoryBtn');
  if (bhBtn) bhBtn.style.opacity = auctionLog.length ? '1' : '0.5';
}

// ── BID HISTORY ──────────────────────────────────────────────────────────────
let _bhTab = 'feed';

function openBidHistory() {
  const overlay = document.getElementById('bhOverlay');
  overlay.classList.add('open');
  const total = auctionLog.length;
  const totalSpend = auctionLog.reduce((s, e) => s + e.finalPrice, 0);
  document.getElementById('bhSub').textContent = total
    ? `${total} player${total !== 1 ? 's' : ''} signed · ${zarFmt(totalSpend)} total spent`
    : 'No bids yet';
  renderBhTab(_bhTab);
}

function closeBidHistory() {
  document.getElementById('bhOverlay').classList.remove('open');
}

function switchBhTab(tab) {
  _bhTab = tab;
  ['feed', 'team', 'tier', 'stats'].forEach(t => {
    document.getElementById('bhTab' + t.charAt(0).toUpperCase() + t.slice(1)).classList.toggle('active', t === tab);
  });
  renderBhTab(tab);
}

function renderBhTab(tab) {
  const body = document.getElementById('bhBody');
  if (!auctionLog.length) {
    body.innerHTML =
      '<div class="bh-empty">🎯 No bids recorded yet.<br><span class="fs-sm">Sign players during the auction to see history here.</span></div>';
    return;
  }
  if (tab === 'feed') body.innerHTML = renderBhFeed();
  if (tab === 'team') body.innerHTML = renderBhByTeam();
  if (tab === 'tier') body.innerHTML = renderBhByTier();
  if (tab === 'stats') body.innerHTML = renderBhStats();
  // Animate bars after render
  requestAnimationFrame(() => {
    body.querySelectorAll('[data-w]').forEach(el => {
      el.style.width = el.dataset.w + '%';
    });
  });
}

function markupLabel(basePrice, finalPrice) {
  if (!basePrice || basePrice === 0) return '';
  const pct = Math.round(((finalPrice - basePrice) / basePrice) * 100);
  if (pct > 0) return `<span class="bh-feed-markup bh-markup-up">+${pct}%</span>`;
  if (pct < 0) return `<span class="bh-feed-markup bh-markup-under">${pct}%</span>`;
  return `<span class="bh-feed-markup bh-markup-base">Base</span>`;
}

function renderBhFeed() {
  const rows = [...auctionLog]
    .reverse()
    .map((e, ri) => {
      const pick = auctionLog.length - ri;
      const tierHtml = tierPill(e.tier);
      const markup = markupLabel(e.basePrice, e.finalPrice);
      const trailCount = e.bidTrail ? e.bidTrail.filter(b => !b.isPast).length : 0;
      const trailHtml =
        e.bidTrail && e.bidTrail.length
          ? `
      <div class="bh-trail-expand" id="bhtrail-${pick}" style="display:none">
        <div class="bh-mini-trail">
          ${e.bidTrail
            .map(b =>
              b.isPast
                ? `<div class="bh-mini-trail-row pass"><span class="trail-dot" style="background:${b.teamColor}"></span><span class="bh-mini-team">${esc(b.teamName)}</span><span class="bh-mini-action pass">Passed</span></div>`
                : `<div class="bh-mini-trail-row"><span class="trail-dot" style="background:${b.teamColor}"></span><span class="bh-mini-team">${esc(b.teamName)}</span><span class="bh-mini-action bid">${zarS(b.amount)}</span>${b.isNewHigh ? '<span class="trail-new-high">↑</span>' : ''}</div>`,
            )
            .join('')}
        </div>
      </div>`
          : '';
      const trailToggle =
        e.bidTrail && e.bidTrail.length
          ? `<button class="bh-trail-toggle" data-action="toggleBhTrail" data-args='[${pick}]' data-el>${trailCount} bid${trailCount !== 1 ? 's' : ''} ▾</button>`
          : '';
      return `<div class="bh-feed-row">
      <div class="bh-feed-num">#${pick}</div>
      <div class="bh-feed-dot" style="background:${e.teamColor}"></div>
      <div class="flex-1 min-w-0">
        <div class="row gap-xs wrap">
          <span class="bh-feed-player">${esc(e.player)}</span>
          ${tierHtml}
          ${e.unsoldRound ? '<span class="unsold-tag" title="Bought in the unsold round">2ND ROUND</span>' : ''}
          ${trailToggle}
        </div>
        <div class="bh-feed-meta">→ <strong style="color:${e.teamColor}">${esc(e.team)}</strong></div>
        ${trailHtml}
      </div>
      <div class="ta-right shrink-0">
        <div class="bh-feed-price">${zarS(e.finalPrice)}</div>
        <div class="mt-2xs">${markup}</div>
      </div>
    </div>`;
    })
    .join('');
  return `<div class="bh-feed">${rows}</div>`;
}

function toggleBhTrail(pick, btn) {
  const el = document.getElementById('bhtrail-' + pick);
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  btn.textContent = btn.textContent.replace(open ? '▴' : '▾', open ? '▾' : '▴');
}

function renderBhByTeam() {
  if (!teams.length) return '<div class="bh-empty">No teams loaded.</div>';
  const sections = teams
    .map(t => {
      const totalBudget = startBudget(t);
      const entries = auctionLog.filter(e => e.team === t.name);
      if (!entries.length)
        return `
      <div class="bh-team-section">
        <div class="bh-team-hdr">
          <div class="bh-team-hdr-dot" style="background:${t.color}"></div>
          <div class="bh-team-hdr-name">${esc(t.name)}</div>
          <div class="t-muted fs-sm">No signed players</div>
        </div>
      </div>`;
      const totalSpend = entries.reduce((s, e) => s + e.finalPrice, 0);
      const spentPct = Math.min(100, Math.round((totalSpend / totalBudget) * 100));
      const rows = entries
        .map((e, i) => {
          const markup = markupLabel(e.basePrice, e.finalPrice);
          const tierHtml = tierPill(e.tier);
          return `<div class="bh-team-row">
        <div>
          <span class="fw-600">${esc(e.player)}</span>
          <span class="ml-xs">${tierHtml}</span>
        </div>
        <div>${markup}</div>
        <div class="t-display-gold">${zarS(e.finalPrice)}</div>
      </div>`;
        })
        .join('');
      return `
      <div class="bh-team-section">
        <div class="bh-team-hdr" style="border-left:3px solid ${t.color}">
          <div class="bh-team-hdr-dot" style="background:${t.color}"></div>
          <div class="bh-team-hdr-name">${esc(t.name)}</div>
          <div class="ta-right">
            <div class="bh-team-hdr-spend">${zarS(totalSpend)}</div>
            <div class="bh-team-hdr-budget">${zarS(t.budget)} remaining · ${entries.length} player${entries.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <div class="bh-team-bar-wrap"><div class="bh-team-bar" style="background:${t.color};width:0" data-w="${spentPct}"></div></div>
        <div class="bh-team-rows">${rows}</div>
      </div>`;
    })
    .join('');
  return `<div class="bh-team-sections">${sections}</div>`;
}

function renderBhByTier() {
  const tiers = [...EV.tiers.map(t => t.name), ''];
  const sections = tiers
    .map(tier => {
      const entries = auctionLog.filter(e => (normTier(e.tier) || '') === tier);
      if (!entries.length) return '';
      const total = entries.reduce((s, e) => s + e.finalPrice, 0);
      const tierCls = tierClass(tier);
      const rows = entries
        .map((e, i) => {
          const markup = markupLabel(e.basePrice, e.finalPrice);
          return `<div class="bh-tier-row">
        <div class="row gap-sm">
          <div style="width:8px;height:8px;border-radius:50%;background:${e.teamColor};flex-shrink:0"></div>
          <span class="fw-600">${esc(e.player)}</span>
          <span class="t-muted fs-xs">→ ${esc(e.team)}</span>
        </div>
        <div>${markup}</div>
        <div class="t-display-gold">${zarS(e.finalPrice)}</div>
      </div>`;
        })
        .join('');
      return `
      <div class="bh-tier-section">
        <div class="bh-tier-hdr">
          ${tier ? `<span class="tier-badge ${tierCls}">${tier}</span>` : `<span class="t-muted fs-sm">Untiered</span>`}
          <span class="t-muted fs-sm ml-auto">${entries.length} player${entries.length !== 1 ? 's' : ''} · ${zarS(total)} total</span>
        </div>
        <div class="bh-tier-rows">${rows}</div>
      </div>`;
    })
    .join('');
  return `<div class="bh-tier-sections">${sections}</div>`;
}

function renderBhStats() {
  const total = auctionLog.length;
  const totalSpend = auctionLog.reduce((s, e) => s + e.finalPrice, 0);
  const avg = total ? Math.round(totalSpend / total) : 0;
  const topBid = total ? auctionLog.reduce((a, b) => (b.finalPrice > a.finalPrice ? b : a)) : null;
  const mostExpTeam = teams.length
    ? teams.reduce((a, b) => {
        const spendA = auctionLog.filter(e => e.team === a.name).reduce((s, e) => s + e.finalPrice, 0);
        const spendB = auctionLog.filter(e => e.team === b.name).reduce((s, e) => s + e.finalPrice, 0);
        return spendB > spendA ? b : a;
      })
    : null;
  const mostExpSpend = mostExpTeam ? auctionLog.filter(e => e.team === mostExpTeam.name).reduce((s, e) => s + e.finalPrice, 0) : 0;
  const bestValue = total
    ? auctionLog
        .filter(e => e.basePrice > 0)
        .reduce((best, e) => {
          const ratio = e.finalPrice / e.basePrice;
          return !best || ratio < best.ratio ? { ...e, ratio } : best;
        }, null)
    : null;
  const mostOverbid = total
    ? auctionLog
        .filter(e => e.basePrice > 0)
        .reduce((best, e) => {
          const over = e.finalPrice - e.basePrice;
          return !best || over > best.over ? { ...e, over } : best;
        }, null)
    : null;

  // Team spend bars
  const maxSpend = Math.max(...teams.map(t => auctionLog.filter(e => e.team === t.name).reduce((s, e) => s + e.finalPrice, 0)), 1);
  const spendBars = teams
    .map(t => {
      const spend = auctionLog.filter(e => e.team === t.name).reduce((s, e) => s + e.finalPrice, 0);
      const pct = Math.round((spend / maxSpend) * 100);
      return `<div class="bh-spend-bar-row">
      <div class="bh-spend-bar-name">
        <div style="width:9px;height:9px;border-radius:50%;background:${t.color};flex-shrink:0"></div>
        ${esc(t.name)}
      </div>
      <div class="bh-spend-bar-track">
        <div class="bh-spend-bar-fill" style="background:${t.color};width:0" data-w="${pct}"></div>
      </div>
      <div class="bh-spend-bar-amt">${zarS(spend)}</div>
    </div>`;
    })
    .join('');

  return `
    <div class="bh-stats-grid">
      <div class="bh-stat-card">
        <div class="bh-stat-label">Total Players Signed</div>
        <div class="bh-stat-val c-accent">${total}</div>
        <div class="bh-stat-sub">${players.filter(p => !p.sold).length} still available</div>
      </div>
      <div class="bh-stat-card">
        <div class="bh-stat-label">Total Spend</div>
        <div class="bh-stat-val c-gold">${zarS(totalSpend)}</div>
        <div class="bh-stat-sub">Avg ${zarS(avg)} per player</div>
      </div>
      <div class="bh-stat-card">
        <div class="bh-stat-label">Highest Bid</div>
        <div class="bh-stat-val c-green">${topBid ? zarS(topBid.finalPrice) : '—'}</div>
        <div class="bh-stat-sub">${topBid ? `${esc(topBid.player)} → ${esc(topBid.team)}` : '—'}</div>
      </div>
      <div class="bh-stat-card">
        <div class="bh-stat-label">Biggest Spender</div>
        <div class="bh-stat-val" style="color:${mostExpTeam?.color || 'var(--text)'};font-size:1.1rem">${mostExpTeam ? esc(mostExpTeam.name) : '—'}</div>
        <div class="bh-stat-sub">${mostExpTeam ? zarS(mostExpSpend) + ' spent' : ''}</div>
      </div>
    </div>
    ${
      bestValue
        ? `
    <div class="bh-stats-grid mb-lg">
      <div class="bh-stat-card">
        <div class="bh-stat-label">Best Value Pick</div>
        <div class="bh-stat-val c-green fs-lg">${esc(bestValue.player)}</div>
        <div class="bh-stat-sub">${zarS(bestValue.finalPrice)} (base ${zarS(bestValue.basePrice)}) · ${esc(bestValue.team)}</div>
      </div>
      <div class="bh-stat-card">
        <div class="bh-stat-label">Most Overbid</div>
        <div class="bh-stat-val c-red fs-lg">${esc(mostOverbid.player)}</div>
        <div class="bh-stat-sub">+${zarS(mostOverbid.over)} over base · ${esc(mostOverbid.team)}</div>
      </div>
    </div>`
        : ''
    }
    <div class="bh-section-title">SPEND BY TEAM</div>
    <div class="bh-spend-bars">${spendBars}</div>
  `;
}

function rosterItemHtml(p, teamId) {
  const isCap = p.isCaptain,
    isFormer = p.isFormer;
  const kind = isCap ? 'ri-captain' : isFormer ? 'ri-former' : 'ri-plain';
  const icon = isCap ? '👑' : isFormer ? '🏅' : '';
  const priceHtml = isCap
    ? html`<span class="t-muted fs-xs italic">Captain</span>`
    : isFormer
      ? html`<span class="t-former-tag" title="${roundLabel(p)}">${p.finalPrice ? zarS(p.finalPrice) + ' · ' : ''}${roundLabel(p)}</span>`
      : noMoney()
        ? html`<span class="roster-item-price t-muted fw-600">${p.drawNo ? 'Draw #' + p.drawNo : 'Added'}</span>`
        : html`<span class="roster-item-price">${zarFmt(p.finalPrice)}</span>`;
  const actions =
    !isCap && !isFormer && teamId != null
      ? html` <div class="roster-item-actions">
          <button class="roster-btn roster-btn-remove ri-action-remove">✕ Remove</button>
        </div>`
      : isFormer && teamId != null && auctionOpen()
        ? html` <div class="roster-item-actions">
            <button class="roster-btn roster-btn-swap ri-action-repick">⇄ Replace</button>
            <button class="roster-btn roster-btn-remove ri-action-unpick">✕ Remove</button>
          </div>`
        : '';
  return html`<div class="roster-item ${kind}" data-team-id="${teamId}" data-player-name="${p.name}">
    <div class="roster-item-top">
      ${icon ? html`<span class="fs-md shrink-0" aria-hidden="true">${icon}</span>` : ''}
      <div class="roster-item-name" title="${p.name}">${p.name}</div>
      ${raw(isCap ? '' : tierPill(p.tier))} ${priceHtml}
    </div>
    ${actions}
  </div>`;
}

let _rosterViewMode = null; // 'all' | teamId number

function showAllRosters() {
  _rosterViewMode = 'all';
  const exb = document.getElementById('exportRosterBtn');
  exb.style.display = 'block';
  exb.textContent = '📸 Export Image';
  exb.dataset.action = 'showExportCard';
  exb.dataset.args = '["results"]';
  document.getElementById('modalTitle').textContent = 'All Team Rosters';
  document.getElementById('modalBody').innerHTML = `
    <div class="all-rosters-grid">
      ${teams
        .map(t => {
          return `<div class="team-roster-col">
          <div class="team-roster-col-header">
            <img src="${t.logo}" class="team-logo-sm" alt=""/>
            <div class="team-roster-col-name">${esc(t.name)}</div>
            <div class="team-roster-col-meta">${noMoney() ? '' : zarS(t.budget) + ' left · '}${squadIcons(t)} +${squadText(t)}</div>
          </div>
          ${t.players.map(p => rosterItemHtml(p, t.id)).join('')}
        </div>`;
        })
        .join('')}
    </div>`;
  wireRosterButtons();
  document.getElementById('rosterModal').classList.add('open');
}

function showTeamRoster(id) {
  _rosterViewMode = id;
  const exb = document.getElementById('exportRosterBtn');
  exb.style.display = 'block';
  exb.textContent = '📸 Team card';
  exb.dataset.action = 'openTeamCard';
  exb.dataset.args = JSON.stringify([id]);
  const t = teams.find(x => x.id === id);
  if (!t) return;
  const pct = Math.round((t.budget / startBudget(t)) * 100);
  const available = availablePlayers();
  const left = slotsLeft(t);

  // Build available options grouped by tier
  const sortedAvailable = [...available].sort((a, b) => tierIndex(a.tier) - tierIndex(b.tier) || a.name.localeCompare(b.name));

  const optionsHtml = sortedAvailable.length
    ? sortedAvailable
        .map(
          p =>
            `<option value="${p.name.replace(/"/g, '&quot;')}" data-price="${p.price}">${esc(p.name)}${p.tier ? ' (' + p.tier + ')' : ''} — ${zarS(p.price)}</option>`,
        )
        .join('')
    : '<option disabled>No available players</option>';

  const addSection = `<div class="add-to-roster" id="addToRosterSection" data-team-id="${id}">
    <div class="add-to-roster-title">+ Add Player to Roster</div>
    <div class="add-to-roster-row">
      <select class="add-to-roster-select" id="atrSelect">
        <option value="">— Select player —</option>
        ${optionsHtml}
      </select>
      <div class="add-to-roster-price-wrap" ${noMoney() ? 'hidden' : ''}>
        <span class="add-to-roster-prefix">${esc(EV.currency)}</span>
        <input type="number" class="add-to-roster-price" id="atrPrice" placeholder="Price" min="0" step="${EV.bidding.increment}"/>
      </div>
      <button class="btn btn-green btn-compact" id="atrConfirmBtn">✓ Add</button>
    </div>
    <div class="add-to-roster-error" id="atrError"></div>
  </div>`;

  document.getElementById('modalTitle').innerHTML = `<img src="${t.logo}" class="team-logo-sm va-mid mr-md"/>${esc(t.name)}`;
  document.getElementById('modalBody').innerHTML = `
    <div class="stat-grid">
      ${
        noMoney()
          ? `<div>
        <div class="stat-label">Tier mix</div>
        <div class="stat-text">${tierMix(t) || '—'}</div>
      </div>`
          : `<div>
        <div class="stat-label">Budget Remaining</div>
        <div style="font-family:'Anton',sans-serif;font-size:1.5rem;color:${t.color}">${zarFmt(t.budget)}</div>
        <div class="t-muted fs-xs">${pct}% · ${zarFmt(startBudget(t) - t.budget)} spent</div>
      </div>`
      }
      <div>
        <div class="stat-label">Squad</div>
        <div class="stat-big">${squadIcons(t)}${squadIcons(t) ? ' + ' : ''}${squadCount(t)}${EV.squadSize ? `<span class="t-muted fs-md">/${EV.squadSize}</span>` : ''}</div>
        <div class="t-muted fs-xs">${left === Infinity ? 'No squad limit' : `${left} squad slot${left !== 1 ? 's' : ''} remaining`}</div>
      </div>
    </div>
    <div class="roster-list">${t.players.map(p => rosterItemHtml(p, t.id)).join('')}</div>
    ${addSection}`;
  wireRosterButtons();
  document.getElementById('rosterModal').classList.add('open');
}

function closeModal() {
  document.getElementById('rosterModal').classList.remove('open');
  _rosterViewMode = null;
  closeSwapPicker();
}

function closeExport() {
  document.getElementById('exportOverlay').style.display = 'none';
}

// ── Results image: sizes and pages ──
const EXPORT_SIZES = {
  tall: { label: 'Full (one tall image)', w: 0, h: 0, per: 0 },
  square: { label: 'Square · 1080×1080', w: 1080, h: 1080, per: 4 },
  portrait: { label: 'Portrait · 1080×1350', w: 1080, h: 1350, per: 6 },
  story: { label: 'Story · 1080×1920', w: 1080, h: 1920, per: 8 },
};
let _exportSize = 'tall',
  _exportPage = 0,
  _exportType = 'results';

function resultsPages() {
  const s = EXPORT_SIZES[_exportSize] || EXPORT_SIZES.tall;
  if (!s.per || teams.length <= s.per) return [teams.slice()];
  const pages = [];
  for (let i = 0; i < teams.length; i += s.per) pages.push(teams.slice(i, i + s.per));
  return pages;
}

function renderResultsPage(canvas, pageIdx) {
  const s = EXPORT_SIZES[_exportSize] || EXPORT_SIZES.tall;
  const pages = resultsPages();
  const idx = Math.max(0, Math.min(pageIdx, pages.length - 1));
  const opts = {
    teams: pages[idx],
    unsold: idx === pages.length - 1,
    pageLabel: pages.length > 1 ? `${idx + 1} / ${pages.length}` : '',
  };
  if (!s.w) {
    renderExportCanvas(canvas, opts);
    return;
  }
  // Fixed size: try a few column layouts off-screen, keep the one that fills the frame best
  let off = null,
    best = -1;
  for (let c = 1; c <= Math.min(4, opts.teams.length); c++) {
    const cand = document.createElement('canvas');
    // Height doesn't depend on width, so measure once, then widen/narrow the cards to match the frame's shape
    renderExportCanvas(cand, { ...opts, cols: c, width: 80 + c * 460 + (c - 1) * 20 });
    const gaps = 80 + (c - 1) * 20;
    const w = Math.round(Math.max(gaps + c * 340, Math.min(gaps + c * 600, (cand.height * s.w) / s.h)));
    renderExportCanvas(cand, { ...opts, cols: c, width: w });
    const k = Math.min(s.w / cand.width, s.h / cand.height);
    if (k > best * 1.04) {
      best = k;
      off = cand;
    }
  }
  canvas.width = s.w;
  canvas.height = s.h;
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, s.w, s.h);
  bg.addColorStop(0, '#05080f');
  bg.addColorStop(0.5, '#0a1020');
  bg.addColorStop(1, '#040710');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, s.w, s.h);
  const k = Math.min(s.w / off.width, s.h / off.height);
  const dw = off.width * k,
    dh = off.height * k;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(off, (s.w - dw) / 2, (s.h - dh) / 2, dw, dh);
  ctx.fillStyle = '#f5b800';
  ctx.fillRect(0, 0, s.w, 5);
  ctx.fillRect(0, s.h - 5, s.w, 5);
}

// ── Social cards: one per team, one per signing (1080×1350) ──
const CARD_W = 1080,
  CARD_H = 1350;
const _cardImgs = {};
// Load an image for a canvas; null if it fails or would taint the canvas (some browsers, file://)
function cardImage(src) {
  if (!src) return Promise.resolve(null);
  if (_cardImgs[src] !== undefined) return Promise.resolve(_cardImgs[src]);
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      try {
        const t = document.createElement('canvas');
        t.width = t.height = 1;
        const g = t.getContext('2d');
        g.drawImage(img, 0, 0, 1, 1);
        g.getImageData(0, 0, 1, 1);
        _cardImgs[src] = img;
      } catch (e) {
        _cardImgs[src] = null;
      }
      res(_cardImgs[src]);
    };
    img.onerror = () => {
      _cardImgs[src] = null;
      res(null);
    };
    img.src = src;
  });
}
const svgSrc = svg =>
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(svg.includes('xmlns') ? svg : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'));

function cardBackdrop(ctx, color) {
  const bg = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  bg.addColorStop(0, '#05080f');
  bg.addColorStop(0.5, '#0a1020');
  bg.addColorStop(1, '#040710');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const glow = ctx.createRadialGradient(CARD_W / 2, 260, 0, CARD_W / 2, 260, 700);
  glow.addColorStop(0, rgba(color, 0.3));
  glow.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.strokeStyle = '#fff';
  for (let x = 0; x < CARD_W; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CARD_H);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = '#f5b800';
  ctx.fillRect(0, 0, CARD_W, 8);
  ctx.fillRect(0, CARD_H - 8, CARD_W, 8);
  ctx.letterSpacing = '0px';
}
function cardText(ctx, text, x, y, font, color, align, maxW, spacing) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align || 'center';
  ctx.letterSpacing = spacing || '0px';
  ctx.fillText(maxW ? truncate(ctx, text, maxW) : text, x, y);
  ctx.letterSpacing = '0px';
}
function cardFooter(ctx) {
  if (hasSponsor()) {
    // N5: sponsor on the left, hashtags on the right
    const img = sponsorImg();
    let x = 80;
    cardText(
      ctx,
      (EV.branding.sponsor.line || '').toUpperCase(),
      x,
      CARD_H - 58,
      '700 16px Barlow, sans-serif',
      'rgba(255,255,255,0.4)',
      'left',
      360,
      '3px',
    );
    if (img) {
      const h = 36,
        w = Math.min(220, (h * img.naturalWidth) / img.naturalHeight);
      roundRect(ctx, x - 6, CARD_H - 50, w + 12, h + 8, 6);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.drawImage(img, x, CARD_H - 46, w, (w * img.naturalHeight) / img.naturalWidth);
      x += w + 20;
    }
    cardText(ctx, EV.branding.sponsor.name.trim(), x, CARD_H - 22, '700 24px Barlow, sans-serif', 'rgba(255,255,255,0.75)', 'left', 360);
    cardText(
      ctx,
      (EV.branding.hashtags || EV.name).trim(),
      CARD_W - 80,
      CARD_H - 30,
      '500 22px Barlow, sans-serif',
      'rgba(255,255,255,0.38)',
      'right',
      CARD_W / 2 - 100,
    );
    return;
  }
  cardText(
    ctx,
    (EV.branding.hashtags || EV.name).trim(),
    CARD_W / 2,
    CARD_H - 46,
    '500 26px Barlow, sans-serif',
    'rgba(255,255,255,0.38)',
    'center',
    CARD_W - 120,
  );
}
async function cardLogo(ctx, team, cx, cy, r) {
  const img = (await cardImage(team.logo)) || (await cardImage(initialsBadge(team.name, team.color)));
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = '#111';
  ctx.fill();
  ctx.clip();
  if (img) {
    const side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height) || 1;
    ctx.drawImage(
      img,
      ((img.naturalWidth || img.width) - side) / 2,
      ((img.naturalHeight || img.height) - side) / 2,
      side,
      side,
      cx - r,
      cy - r,
      r * 2,
      r * 2,
    );
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 6;
  ctx.strokeStyle = team.color;
  ctx.stroke();
}
function cardTierPill(ctx, tier, x, y, h, align) {
  if (!tierDef(tier)) return 0;
  const label = tier.toUpperCase();
  ctx.font = `bold ${Math.round(h * 0.5)}px Barlow, sans-serif`;
  ctx.letterSpacing = '2px';
  const w = ctx.measureText(label).width + h * 0.9,
    x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  roundRect(ctx, x0, y, w, h, 6);
  ctx.fillStyle = rgba(tierColor(tier), 0.2);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = rgba(tierColor(tier), 0.6);
  ctx.stroke();
  ctx.fillStyle = mix(tierColor(tier), '#ffffff', 0.3);
  ctx.textAlign = 'center';
  ctx.fillText(label, x0 + w / 2, y + h * 0.68);
  ctx.letterSpacing = '0px';
  return w;
}

async function renderTeamCard(canvas, team) {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  cardBackdrop(ctx, team.color);
  cardText(
    ctx,
    (EV.branding.exportTitle || EV.name).toUpperCase(),
    CARD_W / 2,
    84,
    'bold 34px Anton, Impact, sans-serif',
    'rgba(255,255,255,0.55)',
    'center',
    CARD_W - 120,
    '4px',
  );
  await cardLogo(ctx, team, CARD_W / 2, 250, 120);
  cardText(ctx, team.name.toUpperCase(), CARD_W / 2, 452, 'bold 72px Anton, Impact, sans-serif', '#ffffff', 'center', CARD_W - 100, '2px');
  const cap = team.players.find(p => p.isCaptain);
  cardText(
    ctx,
    cap ? `CAPTAIN · ${cap.name.toUpperCase()}` : 'OFFICIAL SQUAD',
    CARD_W / 2,
    500,
    '700 26px Barlow, sans-serif',
    team.color,
    'center',
    CARD_W - 120,
    '4px',
  );

  const squad = team.players.filter(p => !p.isCaptain);
  const top = 548,
    bottom = CARD_H - 230;
  const rowH = squad.length ? Math.max(40, Math.min(70, (bottom - top) / squad.length)) : 70;
  const fs = Math.round(rowH * 0.46);
  squad.slice(0, Math.floor((bottom - top) / rowH)).forEach((p, i) => {
    const y = top + i * rowH;
    if (i % 2 === 0) {
      roundRect(ctx, 80, y, CARD_W - 160, rowH - 6, 10);
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.fill();
    }
    const mid = y + (rowH - 6) / 2;
    let x = 110;
    if (p.isFormer) {
      cardText(ctx, '🏅', x, mid + fs * 0.36, `${fs}px serif`, '#fff', 'left');
      x += fs * 1.35;
    }
    const priceTxt = p.isFormer
      ? p.finalPrice
        ? zarS(p.finalPrice)
        : (p.roundName || 'Pick').toUpperCase()
      : isRandom()
        ? p.drawNo
          ? '#' + p.drawNo
          : ''
        : zarS(p.finalPrice || 0);
    ctx.font = `bold ${fs}px Barlow, sans-serif`;
    const priceW = ctx.measureText(priceTxt).width;
    const pillW = tierDef(p.tier)
      ? (() => {
          ctx.font = `bold ${Math.round(rowH * 0.42 * 0.5)}px Barlow, sans-serif`;
          ctx.letterSpacing = '2px';
          const w = ctx.measureText(p.tier.toUpperCase()).width + rowH * 0.42 * 0.9;
          ctx.letterSpacing = '0px';
          return w;
        })()
      : 0;
    cardText(
      ctx,
      p.name,
      x,
      mid + fs * 0.36,
      `600 ${fs}px Barlow, sans-serif`,
      p.isFormer ? '#e0a878' : '#eef2f7',
      'left',
      CARD_W - 110 - x - priceW - pillW - 60,
    );
    cardText(
      ctx,
      priceTxt,
      CARD_W - 110,
      mid + fs * 0.36,
      `bold ${fs}px Barlow, sans-serif`,
      p.isFormer && !p.finalPrice ? '#c07840' : '#f5b800',
      'right',
    );
    if (pillW) cardTierPill(ctx, p.tier, CARD_W - 110 - priceW - 24, mid - rowH * 0.21, rowH * 0.42, 'right');
  });
  if (!squad.length)
    cardText(ctx, 'Squad to be announced', CARD_W / 2, top + 80, 'italic 32px Barlow, sans-serif', 'rgba(255,255,255,0.4)');

  const spent = startBudget(team) - team.budget;
  const stats = isDraft()
    ? [
        ['SQUAD', squadText(team)],
        ['PICKED', String(team.players.filter(p => p.isFormer).length)],
        ['FORMAT', 'DRAFT'],
      ]
    : isRandom()
      ? [
          ['SQUAD', squadText(team)],
          ['DRAWN', String(team.players.filter(p => p.drawn).length)],
          ['DRAW CODE', fmtCode(alloc.seed)],
        ]
      : [
          ['SPENT', zarS(spent)],
          ['LEFT', zarS(team.budget)],
          ['SQUAD', squadText(team)],
        ];
  const sw = (CARD_W - 160) / 3;
  stats.forEach(([k, v], i) => {
    const x = 80 + sw * i + sw / 2;
    cardText(ctx, v, x, CARD_H - 140, 'bold 50px Anton, Impact, sans-serif', i === 0 ? '#f5b800' : '#ffffff');
    cardText(ctx, k, x, CARD_H - 104, '700 20px Barlow, sans-serif', 'rgba(255,255,255,0.45)', 'center', 0, '4px');
  });
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(80, CARD_H - 200);
  ctx.lineTo(CARD_W - 80, CARD_H - 200);
  ctx.stroke();
  cardFooter(ctx);
}

async function renderSoldCard(canvas, sale) {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!sale) {
    cardBackdrop(ctx, '#00c8ff');
    cardText(
      ctx,
      isRandom() ? 'NOTHING DRAWN YET' : 'NO SIGNINGS YET',
      CARD_W / 2,
      CARD_H / 2,
      'bold 80px Anton, Impact, sans-serif',
      'rgba(255,255,255,0.5)',
    );
    return;
  }
  const team = teams.find(t => t.name === sale.team) || { name: sale.team, color: sale.teamColor || '#00c8ff', logo: '' };
  cardBackdrop(ctx, team.color);
  cardText(
    ctx,
    (EV.branding.exportTitle || EV.name).toUpperCase(),
    CARD_W / 2,
    84,
    'bold 34px Anton, Impact, sans-serif',
    'rgba(255,255,255,0.55)',
    'center',
    CARD_W - 120,
    '4px',
  );
  cardText(ctx, isRandom() ? 'DRAWN!' : 'SOLD!', CARD_W / 2, 286, 'bold 170px Anton, Impact, sans-serif', '#f5b800', 'center', 0, '6px');
  const art = await cardImage(svgSrc(generatePlayerSVG(sale.player)));
  if (art) ctx.drawImage(art, CARD_W / 2 - 130, 312, 260, 260);
  cardText(
    ctx,
    sale.player.toUpperCase(),
    CARD_W / 2,
    650,
    'bold 92px Anton, Impact, sans-serif',
    '#ffffff',
    'center',
    CARD_W - 100,
    '2px',
  );
  let y = 680;
  if (tierDef(sale.tier)) {
    cardTierPill(ctx, sale.tier, CARD_W / 2, y, 46, 'center');
    y += 46;
  }
  cardText(
    ctx,
    isRandom() ? 'JOINS' : 'SIGNS FOR',
    CARD_W / 2,
    y + 62,
    '700 26px Barlow, sans-serif',
    'rgba(255,255,255,0.5)',
    'center',
    0,
    '6px',
  );
  await cardLogo(ctx, team, CARD_W / 2, y + 146, 64);
  cardText(
    ctx,
    team.name.toUpperCase(),
    CARD_W / 2,
    y + 268,
    'bold 56px Anton, Impact, sans-serif',
    team.color,
    'center',
    CARD_W - 120,
    '2px',
  );
  if (sale.drawn) {
    cardText(ctx, `DRAW #${sale.drawNo}`, CARD_W / 2, CARD_H - 140, 'bold 92px Anton, Impact, sans-serif', '#f5b800');
    cardText(
      ctx,
      `DRAW CODE ${fmtCode(alloc.seed)}${sale.options > 1 ? ` · 1 OF ${sale.options} TEAMS` : ''}`,
      CARD_W / 2,
      CARD_H - 92,
      '700 22px Barlow, sans-serif',
      'rgba(255,255,255,0.45)',
      'center',
      0,
      '4px',
    );
    cardFooter(ctx);
    return;
  }
  cardText(ctx, zarS(sale.finalPrice), CARD_W / 2, CARD_H - 140, 'bold 104px Anton, Impact, sans-serif', '#f5b800');
  const bids = (sale.bidTrail || []).filter(b => !b.isPast).length;
  cardText(
    ctx,
    `BASE ${zarS(sale.basePrice)}${bids ? ` · ${bids} BID${bids !== 1 ? 'S' : ''}` : ''}${sale.unsoldRound ? ' · UNSOLD ROUND' : ''}`,
    CARD_W / 2,
    CARD_H - 92,
    '700 22px Barlow, sans-serif',
    'rgba(255,255,255,0.45)',
    'center',
    0,
    '4px',
  );
  cardFooter(ctx);
}

// ── N4: recap — the headline numbers and a few highlights, for a card and a PDF page ──
const sponsorText = () => `${(EV.branding.sponsor.line || '').trim()} ${EV.branding.sponsor.name.trim()}`.trim();
function recapData() {
  const placed = teams.flatMap(t => t.players.filter(p => !p.isCaptain).map(p => ({ ...p, team: t })));
  const H = [],
    stats = [[String(teams.length), 'Teams']];
  if (isDraft()) {
    const picks = selRounds[allRounds().length - 1] || { picks: [] };
    const order = (picks.turnOrder || []).map((id, i) => ({ id, name: picks.picks[i] })).filter(x => x.name);
    stats.push([String(order.length), 'Players drafted'], [EV.draft.order === 'snake' ? 'SNAKE' : 'STRAIGHT', 'Pick order']);
    const tm = id => teams.find(t => t.id === id) || {};
    if (order[0]) H.push({ label: 'First pick', title: order[0].name, sub: tm(order[0].id).name, color: tm(order[0].id).color });
    if (order.length > 1) {
      const l = order[order.length - 1];
      H.push({ label: 'Last pick', title: l.name, sub: tm(l.id).name, color: tm(l.id).color });
    }
  } else if (isRandom()) {
    const log = auctionLog.filter(e => e.drawn);
    stats.push([String(log.length), 'Players drawn'], [fmtCode(alloc.seed) || '—', 'Draw code']);
    if (log[0]) H.push({ label: 'First out of the hat', title: log[0].player, sub: log[0].team, color: log[0].teamColor, value: '#1' });
    if (log.length > 1) {
      const l = log[log.length - 1];
      H.push({ label: 'Last one drawn', title: l.player, sub: l.team, color: l.teamColor, value: '#' + l.drawNo });
    }
    if (EV.tiers.length && log.length)
      H.push({
        label: 'Balance',
        title: EV.random.balance ? 'Tier-balanced draw' : 'One hat',
        sub: teams.map(t => `${t.name}: ${tierMix(t) || '—'}`).join(' · '),
      });
  } else {
    const sales = auctionLog.filter(e => !e.drawn);
    const spent = teams.reduce((a, t) => a + startBudget(t) - t.budget, 0);
    stats.push(
      [String(sales.length), 'Players sold'],
      [zarS(spent), 'Total spent'],
      [sales.length ? zarS(Math.round(spent / Math.max(1, placed.filter(p => !p.isFormer).length))) : '—', 'Average buy'],
    );
    const bids = e => (e.bidTrail || []).filter(b => !b.isPast).length;
    const top = [...sales].sort((a, b) => b.finalPrice - a.finalPrice)[0];
    if (top) H.push({ label: 'Top buy', title: top.player, sub: top.team, color: top.teamColor, value: zarS(top.finalPrice) });
    const war = [...sales].sort((a, b) => bids(b) - bids(a))[0];
    if (war && bids(war) > 2 && war !== top)
      H.push({
        label: 'Biggest bidding war',
        title: war.player,
        sub: `${bids(war)} bids · ${war.team}`,
        color: war.teamColor,
        value: zarS(war.finalPrice),
      });
    const steal = sales.filter(e => e.basePrice > 0 && e.finalPrice <= e.basePrice).sort((a, b) => b.basePrice - a.basePrice)[0];
    if (steal && steal !== top)
      H.push({
        label: 'Bargain of the day',
        title: steal.player,
        sub: `${steal.team} · base ${zarS(steal.basePrice)}`,
        color: steal.teamColor,
        value: zarS(steal.finalPrice),
      });
    const bySpend = [...teams].sort((a, b) => startBudget(b) - b.budget - (startBudget(a) - a.budget));
    if (sales.length && bySpend.length > 1) {
      H.push({
        label: 'Biggest spenders',
        title: bySpend[0].name,
        color: bySpend[0].color,
        value: zarS(startBudget(bySpend[0]) - bySpend[0].budget),
      });
      const thrift = bySpend[bySpend.length - 1];
      H.push({ label: 'Most left in the bank', title: thrift.name, color: thrift.color, value: zarS(thrift.budget) });
    }
  }
  return { stats, highlights: H.slice(0, 5) };
}
function renderRecapCard(canvas) {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d'),
    r = recapData();
  cardBackdrop(ctx, '#f5b800');
  cardText(
    ctx,
    (EV.branding.exportTitle || EV.name).toUpperCase(),
    CARD_W / 2,
    84,
    'bold 34px Anton, Impact, sans-serif',
    'rgba(255,255,255,0.55)',
    'center',
    CARD_W - 120,
    '4px',
  );
  cardText(ctx, 'THE DAY IN NUMBERS', CARD_W / 2, 200, 'bold 96px Anton, Impact, sans-serif', '#ffffff', 'center', CARD_W - 100, '2px');
  const sw = (CARD_W - 160) / r.stats.length;
  r.stats.forEach(([v, k], i) => {
    const x = 80 + sw * i + sw / 2;
    cardText(ctx, v, x, 330, 'bold 60px Anton, Impact, sans-serif', i === 1 ? '#f5b800' : '#ffffff', 'center', sw - 16);
    cardText(ctx, k.toUpperCase(), x, 370, '700 20px Barlow, sans-serif', 'rgba(255,255,255,0.45)', 'center', sw - 16, '3px');
  });
  let y = 430;
  if (!r.highlights.length)
    cardText(
      ctx,
      'Highlights appear once the first players are placed',
      CARD_W / 2,
      y + 80,
      'italic 30px Barlow, sans-serif',
      'rgba(255,255,255,0.4)',
    );
  r.highlights.forEach(h => {
    const c = h.color || '#f5b800';
    roundRect(ctx, 80, y, CARD_W - 160, 140, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    ctx.fill();
    ctx.fillStyle = c;
    ctx.fillRect(80, y + 14, 8, 112);
    cardText(ctx, h.label.toUpperCase(), 116, y + 42, '700 20px Barlow, sans-serif', 'rgba(255,255,255,0.5)', 'left', 0, '4px');
    cardText(
      ctx,
      h.title.toUpperCase(),
      116,
      y + 94,
      'bold 46px Anton, Impact, sans-serif',
      '#ffffff',
      'left',
      h.value ? 560 : CARD_W - 240,
      '1px',
    );
    if (h.sub)
      cardText(ctx, h.sub, 116, y + 124, '500 22px Barlow, sans-serif', mix(c, '#ffffff', 0.35), 'left', h.value ? 560 : CARD_W - 240);
    if (h.value) cardText(ctx, h.value, CARD_W - 116, y + 94, 'bold 52px Anton, Impact, sans-serif', '#f5b800', 'right', 300);
    y += 158;
  });
  cardFooter(ctx);
}

// ── Image export: results / team cards / sold cards / recap ──
const EXPORT_TYPES = { results: 'Results', team: 'Team cards', sold: 'Sold cards', recap: 'Recap' };
const exportTypeLabel = k => (k === 'sold' && isRandom() ? 'Drawn cards' : EXPORT_TYPES[k]);
const exportTypesNow = () => Object.keys(EXPORT_TYPES).filter(k => !(k === 'sold' && isDraft()));
function exportPages() {
  if (_exportType === 'team') return teams.map(t => [t]);
  if (_exportType === 'sold') return auctionLog.length ? auctionLog.map(e => [e]) : [[null]];
  if (_exportType === 'recap') return [[null]];
  return resultsPages();
}
async function renderExportPage(canvas, i) {
  if (_exportType === 'team') return renderTeamCard(canvas, teams[i]);
  if (_exportType === 'sold') return renderSoldCard(canvas, auctionLog[i]);
  if (_exportType === 'recap') return renderRecapCard(canvas);
  renderResultsPage(canvas, i);
}
function renderExportControls() {
  const pages = exportPages();
  _exportPage = Math.max(0, Math.min(_exportPage, pages.length - 1));
  const tsel = document.getElementById('exportType');
  if (tsel)
    tsel.innerHTML = exportTypesNow()
      .map(k => `<option value="${k}">${exportTypeLabel(k)}</option>`)
      .join('');
  if (tsel) tsel.value = _exportType;
  const sel = document.getElementById('exportSize');
  if (sel && !sel.options.length) {
    sel.innerHTML = Object.entries(EXPORT_SIZES)
      .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
      .join('');
  }
  if (sel) sel.value = _exportSize;
  const sw = document.getElementById('exportSizeWrap');
  if (sw) sw.style.display = _exportType === 'results' ? '' : 'none';
  const nav = document.getElementById('exportPager');
  if (nav) {
    nav.style.display = pages.length > 1 ? 'flex' : 'none';
    const what =
      _exportType === 'team'
        ? (teams[_exportPage] || {}).name
        : _exportType === 'sold'
          ? `${isRandom() ? 'Draw' : 'Sale'} ${_exportPage + 1} of ${pages.length}`
          : `Page ${_exportPage + 1} of ${pages.length}`;
    document.getElementById('exportPageTxt').textContent = what || '';
    document.getElementById('exportPrev').disabled = _exportPage === 0;
    document.getElementById('exportNext').disabled = _exportPage >= pages.length - 1;
  }
  const noun = _exportType === 'results' ? 'pages' : 'cards';
  const dl = document.getElementById('exportDlBtn');
  if (dl) {
    dl.textContent = pages.length > 1 ? `⬇ Download all ${pages.length} ${noun}` : '⬇ Download PNG';
    dl.disabled = _exportType === 'sold' && !auctionLog.length;
  }
  const one = document.getElementById('exportDlOne');
  if (one) one.style.display = pages.length > 1 ? '' : 'none';
}

// Draw off-screen and copy only the newest request, so a slow (async) card can't paint over a later one
let _exportTok = 0;
async function redrawExport() {
  renderExportControls();
  const tok = ++_exportTok,
    off = document.createElement('canvas');
  await renderExportPage(off, _exportPage);
  if (tok !== _exportTok) return;
  const c = document.getElementById('exportCanvas');
  c.width = off.width;
  c.height = off.height;
  c.getContext('2d').drawImage(off, 0, 0);
}
function setExportSize(k) {
  _exportSize = EXPORT_SIZES[k] ? k : 'tall';
  _exportPage = 0;
  redrawExport();
}
function setExportType(k) {
  _exportType = EXPORT_TYPES[k] ? k : 'results';
  _exportPage = _exportType === 'sold' ? Math.max(0, auctionLog.length - 1) : 0; // newest signing first
  redrawExport();
}
function exportPageStep(d) {
  _exportPage += d;
  redrawExport();
}

function exportFileName(i, n) {
  const ev = slugify(EV.name);
  if (_exportType === 'team') return `${ev}-team-${slugify(teams[i].name)}.png`;
  if (_exportType === 'recap') return `${ev}-recap.png`;
  if (_exportType === 'sold')
    return `${ev}-${isRandom() ? 'drawn' : 'sold'}-${String(i + 1).padStart(2, '0')}-${slugify(auctionLog[i].player)}.png`;
  return ev + '-rosters' + (_exportSize === 'tall' ? '' : '-' + _exportSize) + (n > 1 ? `-${i + 1}of${n}` : '') + '.png';
}
async function savePage(i, n) {
  const c = document.createElement('canvas');
  await renderExportPage(c, i);
  const a = document.createElement('a');
  a.download = exportFileName(i, n);
  a.href = c.toDataURL('image/png');
  document.body.appendChild(a);
  a.click();
  a.remove();
}
async function downloadExport() {
  const n = exportPages().length;
  if (_exportType === 'sold' && !auctionLog.length) {
    showToast('No signings yet');
    return;
  }
  if (n > 1) showToast(`Downloading ${n} images — allow multiple downloads if your browser asks`);
  for (let i = 0; i < n; i++) {
    await savePage(i, n);
    if (i + 1 < n) await new Promise(r => setTimeout(r, 400));
  }
}
function downloadExportOne() {
  savePage(_exportPage, exportPages().length);
}

function showExportCard(type, page) {
  document.getElementById('exportOverlay').style.display = 'flex';
  if (type) {
    setExportType(type);
    if (page != null) {
      _exportPage = page;
      redrawExport();
    }
  } else {
    _exportPage = _exportType === 'sold' ? Math.max(0, auctionLog.length - 1) : 0;
    redrawExport();
  }
}

function renderExportCanvas(canvas, opts) {
  opts = opts || {};
  const teamList = opts.teams || teams;
  const COLS = opts.cols
    ? Math.min(opts.cols, teamList.length)
    : teamList.length <= 3
      ? teamList.length
      : teamList.length === 4
        ? 2
        : teamList.length <= 9
          ? 3
          : 4;
  const W = opts.width || 1200,
    HEADER_H = 140,
    FOOTER_H = 60;
  const COLS_N = COLS,
    ROWS = Math.ceil(teamList.length / COLS_N);
  const CARD_W = (W - 80 - (COLS_N - 1) * 20) / COLS_N;
  const MAX_PLAYERS = Math.max(1, ...teamList.map(t => t.players.length));
  const CARD_H = 52 + MAX_PLAYERS * 38 + 24;
  const teamsBottom = HEADER_H + ROWS * (CARD_H + 20);

  const captainNames = getCaptainNames();
  const unsold = opts.unsold === false ? [] : notPlaced().filter(p => !captainNames.includes(p.name.toLowerCase()));
  const UCOLS = 4;
  const UNSOLD_SECTION_H = unsold.length > 0 ? 20 + 36 + Math.ceil(unsold.length / UCOLS) * 28 + 16 : 0;

  const H = teamsBottom + UNSOLD_SECTION_H + FOOTER_H;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // ── Background ──
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, '#05080f');
  bgGrad.addColorStop(0.5, '#0a1020');
  bgGrad.addColorStop(1, '#040710');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Subtle pitch lines (cricket crease lines as atmosphere)
  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  for (let i = 0; i < W; i += 60) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, H);
    ctx.stroke();
  }
  ctx.restore();

  // Radial glow centre
  const glow = ctx.createRadialGradient(W / 2, HEADER_H / 2, 0, W / 2, HEADER_H / 2, 500);
  glow.addColorStop(0, 'rgba(0,200,255,0.12)');
  glow.addColorStop(1, 'rgba(0,200,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // ── Header ──
  // Gold top bar
  ctx.fillStyle = '#f5b800';
  ctx.fillRect(0, 0, W, 5);

  // Title
  ctx.font = 'bold 52px Anton, Impact, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.letterSpacing = '3px';
  ctx.textAlign = 'center';
  ctx.fillText(truncate(ctx, EV.branding.exportTitle || EV.name.toUpperCase(), W - 80), W / 2, 70);

  // Subtitle
  ctx.font = '600 20px Barlow, sans-serif';
  ctx.fillStyle = '#f5b800';
  ctx.fillText(EV.branding.exportSubtitle || '', W / 2, 100);
  if (opts.pageLabel) {
    ctx.font = '600 15px Barlow, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'right';
    ctx.fillText(opts.pageLabel, W - 40, 34);
    ctx.textAlign = 'center';
  }

  // Thin divider
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(40, HEADER_H - 12);
  ctx.lineTo(W - 40, HEADER_H - 12);
  ctx.stroke();

  // ── Team Cards ──

  teamList.forEach((team, ti) => {
    const col = ti % COLS_N;
    const row = Math.floor(ti / COLS_N);
    const cx = 40 + col * (CARD_W + 20);
    const cy = HEADER_H + row * (CARD_H + 20);

    // Card shadow
    ctx.save();
    ctx.shadowColor = team.color;
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;

    // Card background
    const cardBg = ctx.createLinearGradient(cx, cy, cx, cy + CARD_H);
    cardBg.addColorStop(0, 'rgba(255,255,255,0.07)');
    cardBg.addColorStop(1, 'rgba(255,255,255,0.02)');
    roundRect(ctx, cx, cy, CARD_W, CARD_H, 14);
    ctx.fillStyle = cardBg;
    ctx.fill();
    ctx.restore();

    // Card border with team colour
    ctx.save();
    roundRect(ctx, cx, cy, CARD_W, CARD_H, 14);
    ctx.strokeStyle = team.color;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // Team colour top bar on card
    ctx.save();
    roundRect(ctx, cx, cy, CARD_W, 6, { tl: 14, tr: 14, br: 0, bl: 0 });
    ctx.fillStyle = team.color;
    ctx.fill();
    ctx.restore();

    // Team name
    ctx.font = 'bold 17px Anton, Impact, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
    const nameY = cy + 34;
    ctx.fillText(truncate(ctx, team.name.toUpperCase(), CARD_W - 20), cx + 12, nameY);

    // Divider
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + 10, cy + 48);
    ctx.lineTo(cx + CARD_W - 10, cy + 48);
    ctx.stroke();

    // Players
    team.players.forEach((p, pi) => {
      const py = cy + 60 + pi * 38;
      const isCap = p.isCaptain;
      const isFormer = p.isFormer;

      // Row bg on hover-alternating style
      if (pi % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.025)';
        roundRect(ctx, cx + 6, py - 2, CARD_W - 12, 34, 6);
        ctx.fill();
      }

      // Icon
      const icon = isCap ? '👑' : isFormer ? '🏅' : '';
      if (icon) {
        ctx.font = '14px serif';
        ctx.textAlign = 'left';
        ctx.fillText(icon, cx + 12, py + 20);
      }
      const nameX = cx + (icon ? 30 : 12);

      // Player name
      ctx.font = isCap ? 'bold 13px Barlow, sans-serif' : '500 13px Barlow, sans-serif';
      ctx.fillStyle = isCap ? team.color : isFormer ? '#d4956a' : '#e8eaf0';
      ctx.textAlign = 'left';
      ctx.fillText(truncate(ctx, p.name, CARD_W - 110), nameX, py + 20);

      // Tier pill
      if (tierDef(p.tier) && !isCap) {
        const tc = mix(tierColor(p.tier), '#ffffff', 0.25);
        const tb = rgba(tierColor(p.tier), 0.16);
        ctx.font = 'bold 9px Barlow, sans-serif';
        const tw = ctx.measureText(p.tier.slice(0, 3).toUpperCase()).width + 10;
        const tx = cx + CARD_W - (p.finalPrice ? 65 : 15) - tw - 4;
        ctx.fillStyle = tb;
        roundRect(ctx, tx, py + 6, tw, 16, 3);
        ctx.fill();
        ctx.fillStyle = tc;
        ctx.textAlign = 'center';
        ctx.fillText(p.tier.slice(0, 3).toUpperCase(), tx + tw / 2, py + 18);
      }

      // Price
      if (p.finalPrice && !isCap) {
        ctx.font = 'bold 12px Barlow, sans-serif';
        ctx.fillStyle = '#f5b800';
        ctx.textAlign = 'right';
        ctx.fillText(zarS(p.finalPrice), cx + CARD_W - 10, py + 20);
      }
    });
  });

  // ── Unsold Players Section ──
  if (unsold.length > 0) {
    const uy = teamsBottom + 20;

    // Section header
    ctx.font = 'bold 13px Anton, Impact, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'left';
    ctx.letterSpacing = '2px';
    ctx.fillText(`${isRandom() ? 'NOT DRAWN' : isDraft() ? 'NOT PICKED' : 'UNSOLD PLAYERS'} (${unsold.length})`, 40, uy + 16);

    // Thin divider
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, uy + 24);
    ctx.lineTo(W - 40, uy + 24);
    ctx.stroke();

    // Players in 4 columns
    const UCOLS = 4;
    const UCOL_W = (W - 80 - (UCOLS - 1) * 16) / UCOLS;
    unsold.forEach((p, i) => {
      const col = i % UCOLS;
      const row = Math.floor(i / UCOLS);
      const px = 40 + col * (UCOL_W + 16);
      const py = uy + 36 + row * 28;

      // Subtle alternating row bg
      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.02)';
        roundRect(ctx, px, py - 2, UCOL_W, 22, 4);
        ctx.fill();
      }

      // Tier colour dot
      const dotColor = tierDef(p.tier) ? tierColor(p.tier) : 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.arc(px + 8, py + 9, 4, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();

      // Name
      ctx.font = '500 12px Barlow, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.textAlign = 'left';
      ctx.fillText(truncate(ctx, p.name, UCOL_W - 60), px + 18, py + 14);

      // Price
      ctx.font = '600 11px Barlow, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.textAlign = 'right';
      if (!noMoney()) ctx.fillText(zarS(p.price), px + UCOL_W - 4, py + 14);
    });
  }

  // ── Footer ──
  const fy = H - FOOTER_H + 20;
  ctx.font = '500 14px Barlow, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.textAlign = 'center';
  if (hasSponsor()) {
    const img = sponsorImg();
    ctx.textAlign = 'left';
    ctx.font = '700 13px Barlow, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    let x = 40;
    if (img) {
      const h = 24,
        w = Math.min(120, (h * img.naturalWidth) / img.naturalHeight);
      roundRect(ctx, x - 4, fy - 8, w + 8, h + 6, 4);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.drawImage(img, x, fy - 5, w, (w * img.naturalHeight) / img.naturalWidth);
      x += w + 12;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
    }
    ctx.fillText(sponsorText(), x, fy + 10);
    ctx.textAlign = 'right';
    ctx.font = '500 14px Barlow, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    if (EV.branding.hashtags) ctx.fillText(EV.branding.hashtags, W - 40, fy + 10);
  } else if (EV.branding.hashtags) ctx.fillText(EV.branding.hashtags, W / 2, fy + 10);

  // Bottom gold bar
  ctx.fillStyle = '#f5b800';
  ctx.fillRect(0, H - 5, W, 5);
}

function roundRect(ctx, x, y, w, h, r) {
  if (typeof r === 'number') r = { tl: r, tr: r, br: r, bl: r };
  ctx.beginPath();
  ctx.moveTo(x + r.tl, y);
  ctx.lineTo(x + w - r.tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r.tr);
  ctx.lineTo(x + w, y + h - r.br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
  ctx.lineTo(x + r.bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r.bl);
  ctx.lineTo(x, y + r.tl);
  ctx.quadraticCurveTo(x, y, x + r.tl, y);
  ctx.closePath();
}

function truncate(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
  return text + '…';
}

function wireRosterButtons() {
  document.querySelectorAll('#modalBody .roster-item').forEach(row => {
    const teamId = parseInt(row.dataset.teamId, 10);
    const playerName = row.dataset.playerName;
    if (isNaN(teamId) || !playerName) return;
    const removeBtn = row.querySelector('.ri-action-remove');
    if (removeBtn) removeBtn.addEventListener('click', () => removeFromRoster(teamId, playerName));
    const unpickBtn = row.querySelector('.ri-action-unpick');
    const repickBtn = row.querySelector('.ri-action-repick');
    if (unpickBtn) unpickBtn.addEventListener('click', () => removePick(teamId, playerName));
    if (repickBtn) repickBtn.addEventListener('click', () => openPickReplace(teamId, playerName));
  });

  // Wire add-to-roster section
  const atrSection = document.getElementById('addToRosterSection');
  if (!atrSection) return;
  const teamId = parseInt(atrSection.dataset.teamId, 10);
  const sel = document.getElementById('atrSelect');
  const price = document.getElementById('atrPrice');
  const btn = document.getElementById('atrConfirmBtn');
  if (sel)
    sel.addEventListener('change', () => {
      const opt = sel.options[sel.selectedIndex];
      if (opt && opt.dataset.price) price.value = opt.dataset.price;
      const err = document.getElementById('atrError');
      if (err) {
        err.textContent = '';
        err.classList.remove('visible');
      }
    });
  if (btn) btn.addEventListener('click', () => addToRoster(teamId));
}

function addToRoster(teamId) {
  const t = teams.find(x => x.id === teamId);
  if (!t) return;
  const sel = document.getElementById('atrSelect');
  const priceInp = document.getElementById('atrPrice');
  const err = document.getElementById('atrError');
  const showErr = msg => {
    err.textContent = msg;
    err.classList.add('visible');
  };
  err.classList.remove('visible');

  const playerName = sel.value;
  if (!playerName) {
    showErr('Select a player first.');
    return;
  }

  const mp = players.find(p => p.name === playerName);
  if (!mp || mp.sold) {
    showErr('Player is no longer available.');
    return;
  }

  const price = isRandom() ? 0 : parseFloat(priceInp.value);
  if (isNaN(price) || price < 0) {
    showErr('Enter a valid price.');
    return;
  }

  // Rules checks
  if (squadFull(t)) {
    showErr(`Squad full — ${EV.squadSize}/${EV.squadSize} slots used.`);
    return;
  }
  if (tierFull(t, mp.tier)) {
    showErr(`${t.name} already has ${tierLimit(mp.tier)} ${mp.tier} players.`);
    return;
  }
  const minRequired = isRandom() ? 0 : openingMin(mp);
  if (price < minRequired) {
    showErr(`Minimum price for this player is ${zarFmt(minRequired)}.`);
    return;
  }

  if (price > t.budget) {
    showErr(`${t.name} only has ${zarFmt(t.budget)} — can't afford ${zarFmt(price)}.`);
    return;
  }

  // Assign
  snap(`added ${mp.name} to ${t.name}`);
  t.budget -= price;
  t.players.push(setStatus({ ...mp, finalPrice: price, teamId }, 'sold'));
  setStatus(mp, 'sold');
  mp.teamId = teamId;
  mp.finalPrice = price;
  auctionLog.push({ player: mp.name, tier: mp.tier || '', team: t.name, teamColor: t.color, basePrice: mp.price, finalPrice: price });

  renderTeamsBar();
  renderPlayersList();
  renderLog();
  updateStats();
  drawWheel();
  showToast(`✓ ${mp.name} added to ${t.name} for ${zarFmt(price)}`);
  showTeamRoster(teamId); // refresh modal
}

function openTeamCard(id) {
  const i = teams.findIndex(x => x.id === id);
  closeModal();
  showExportCard('team', Math.max(0, i));
}

function refreshRosterModal() {
  if (!document.getElementById('rosterModal').classList.contains('open')) return;
  if (_rosterViewMode === 'all') showAllRosters();
  else if (_rosterViewMode != null) showTeamRoster(_rosterViewMode);
}

function removeFromRoster(teamId, playerName) {
  const t = teams.find(x => x.id === teamId);
  if (!t) {
    showToast('Team not found');
    return;
  }
  const idx = t.players.findIndex(p => p.name === playerName && !p.isCaptain && !p.isFormer);
  if (idx === -1) {
    showToast('Player not found on roster');
    return;
  }
  const p = t.players[idx];
  snap(`removed ${p.name} from ${t.name}`);
  t.budget += p.finalPrice || 0;
  t.players.splice(idx, 1);
  const mp = players.find(x => x.name === playerName);
  if (mp) {
    setStatus(mp, auctionPhase === 'unsold' ? 'queued' : 'pool');
    mp.teamId = null;
    mp.finalPrice = undefined;
  }
  const logIdx = auctionLog.findIndex(e => e.player === playerName && e.team === t.name);
  if (logIdx !== -1) auctionLog.splice(logIdx, 1);
  renderTeamsBar();
  renderPlayersList();
  renderLog();
  updateStats();
  drawWheel();
  showToast(`${playerName} removed — ${zarFmt(p.finalPrice || 0)} refunded to ${t.name}`);
  refreshRosterModal();
}

// ── Editing pre-auction picks after launch ──
const auctionOpen = () => document.getElementById('appScreen').style.display !== 'none';
const samePlayer = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

function findPick(teamId, name) {
  const t = teams.find(x => x.id === teamId);
  const p = t && t.players.find(x => x.isFormer && x.name === name);
  return { t, p, round: p && selRounds[p.roundIdx], def: p && allRounds()[p.roundIdx] };
}

function afterPickEdit() {
  renderTeamsBar();
  renderPlayersList();
  renderLog();
  updateStats();
  drawWheel();
  refreshRosterModal();
}

async function removePick(teamId, name) {
  const { t, p, round } = findPick(teamId, name);
  if (!p) {
    showToast('Pick not found');
    return;
  }
  if (
    !(await askConfirm(`Remove ${name} from ${t.name}? ${p.finalPrice ? zarFmt(p.finalPrice) + ' goes back to their budget.' : ''}`, {
      okLabel: 'Remove',
      danger: true,
    }))
  )
    return;
  snap(`removed pick ${name} from ${t.name}`);
  t.budget += p.finalPrice || 0;
  t.players = t.players.filter(x => x !== p);
  if (round) {
    const rp = round.players.find(x => samePlayer(x.name, name));
    if (rp) rp.pickedBy = null;
    const i = round.picks.indexOf(name);
    if (i !== -1) round.picks[i] = null;
  }
  afterPickEdit();
  showToast(`${name} removed from ${t.name}` + (p.finalPrice ? ` — ${zarFmt(p.finalPrice)} refunded` : ''));
}

// Players from the same round's list that nobody holds yet
function pickCandidates(teamId, name) {
  const { t, p, round, def } = findPick(teamId, name);
  if (!p || !round) return [];
  const held = n => teams.some(tm => tm.players.some(x => samePlayer(x.name, n)));
  const oldCost = p.finalPrice || 0;
  return round.players
    .filter(rp => rp.pickedBy === null && !held(rp.name))
    .map(rp => {
      const cost = def && def.cost === 'price' ? rp.price || 0 : 0;
      const diff = cost - oldCost;
      let why = '';
      if (def && def.countsTowardTiers !== false && rp.tier && !samePlayer(rp.tier, p.tier) && tierFull(t, rp.tier))
        why = `${t.name} already has ${tierLimit(rp.tier)} ${rp.tier}`;
      else if (diff > t.budget) why = `${t.name} can't afford the difference`;
      return { rp, cost, diff, why };
    });
}

function openPickReplace(teamId, name) {
  closeSwapPicker();
  const row = [...document.querySelectorAll('#modalBody .roster-item')].find(
    el => el.dataset.playerName === name && parseInt(el.dataset.teamId, 10) === teamId,
  );
  const { def } = findPick(teamId, name);
  const list = pickCandidates(teamId, name);
  if (!row) return;
  if (!list.length) {
    showToast(`No unpicked players left in "${def ? def.name : 'this round'}"`);
    return;
  }
  const charged = def && def.cost === 'price';
  const wrap = document.createElement('div');
  wrap.className = 'swap-picker-wrap';
  wrap.id = 'swap-picker-active';
  wrap.innerHTML = `
    <div class="swap-picker-label">Replace <strong>${esc(name)}</strong> with another ${esc(def ? def.name : '')} player:</div>
    <div class="swap-picker-list">${list
      .map(c => {
        const diffStr = !charged ? 'Free' : c.diff === 0 ? 'Same' : (c.diff > 0 ? '+' : '') + zarS(c.diff);
        const diffCls = c.diff > 0 ? 'swap-diff-neg' : c.diff < 0 ? 'swap-diff-pos' : 'swap-diff-neu';
        return `<div class="swap-option${c.why ? ' broke' : ''} dim-more no-click" data-in-name="${c.rp.name.replace(/'/g, '&#39;')}"
          ${c.why ? `title="${esc(c.why)}"` : ''}>
        <div class="swap-option-name">${esc(c.rp.name)}</div>
        ${tierPill(c.rp.tier)}
        ${charged ? `<span class="swap-option-price">${zarS(c.cost)}</span>` : ''}
        <span class="swap-option-diff ${diffCls}">${diffStr}</span>
      </div>`;
      })
      .join('')}</div>
    <div class="swap-picker-cancel">✕ Cancel</div>`;
  row.after(wrap);
  wrap
    .querySelectorAll('.swap-option:not(.broke)')
    .forEach(opt => opt.addEventListener('click', () => confirmPickReplace(teamId, name, opt.dataset.inName)));
  wrap.querySelectorAll('.swap-option.broke').forEach(opt => opt.addEventListener('click', () => showToast(opt.title)));
  wrap.querySelector('.swap-picker-cancel').addEventListener('click', closeSwapPicker);
}

function confirmPickReplace(teamId, outName, inName) {
  const { t, p, round, def } = findPick(teamId, outName);
  const c = pickCandidates(teamId, outName).find(x => x.rp.name === inName);
  if (!p || !c) {
    showToast('That player is no longer available');
    return;
  }
  if (c.why) {
    showToast(c.why);
    return;
  }
  snap(`replaced pick ${outName} with ${inName} (${t.name})`);
  t.budget -= c.diff;
  const oldRp = round.players.find(x => samePlayer(x.name, outName));
  if (oldRp) oldRp.pickedBy = null;
  c.rp.pickedBy = t.id;
  const i = round.picks.indexOf(outName);
  if (i !== -1) round.picks[i] = inName;
  Object.assign(p, { name: c.rp.name, price: c.rp.price, tier: c.rp.tier, finalPrice: c.cost });
  closeSwapPicker();
  afterPickEdit();
  showToast(
    `${t.name}: ${outName} → ${inName}` +
      (def && def.cost === 'price' && c.diff ? ` (${c.diff > 0 ? '−' : '+'}${zarFmt(Math.abs(c.diff))})` : ''),
  );
}

let _swapState = null;

function closeSwapPicker() {
  const el = document.getElementById('swap-picker-active');
  if (el) el.remove();
  _swapState = null;
}

// ── Roster PDF (light, print-friendly) ──
// Fonts come from vendor/pdf-fonts.js, loaded the first time a PDF is made; without them it falls back to Helvetica.
function loadPdfFonts() {
  if (window.DRAFT_DAY_PDF_FONTS) return Promise.resolve(true);
  return new Promise(res => {
    const sc = document.createElement('script');
    sc.src = 'vendor/pdf-fonts.js';
    sc.onload = () => res(!!window.DRAFT_DAY_PDF_FONTS);
    sc.onerror = () => res(false);
    document.head.appendChild(sc);
  });
}

// Round logo with a ring in the team colour, as a PNG with transparent corners
function pdfRoundLogo(t) {
  const draw = img => {
    const S = 240,
      R = S / 2,
      c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.beginPath();
    g.arc(R, R, R - 10, 0, Math.PI * 2);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.fill();
    if (img) {
      g.save();
      g.clip();
      const w = img.naturalWidth || img.width,
        h = img.naturalHeight || img.height,
        side = Math.min(w, h) || S;
      g.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 10, 10, S - 20, S - 20);
      g.restore();
    }
    g.beginPath();
    g.arc(R, R, R - 7, 0, Math.PI * 2);
    g.lineWidth = 14;
    g.strokeStyle = t.color;
    g.stroke();
    return c.toDataURL('image/png');
  };
  const tryLoad = src =>
    new Promise(res => {
      if (!src) return res(null);
      const img = new Image();
      img.onload = () => {
        try {
          res(draw(img));
        } catch (e) {
          res(null);
        }
      }; // tainted canvas (file://) → null
      img.onerror = () => res(null);
      img.src = src;
    });
  // No readable logo (none set, missing, or blocked when opened from disk): a drawn initials badge
  const badge = () => {
    const S = 240,
      R = S / 2,
      c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.beginPath();
    g.arc(R, R, R - 10, 0, Math.PI * 2);
    g.fillStyle = mix(t.color, '#ffffff', 0.82);
    g.fill();
    g.beginPath();
    g.arc(R, R, R - 7, 0, Math.PI * 2);
    g.lineWidth = 14;
    g.strokeStyle = t.color;
    g.stroke();
    const ini =
      t.name
        .replace(/[^A-Za-z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter(w => w && !/^(the|of|and)$/i.test(w))
        .slice(0, 2)
        .map(w => w[0].toUpperCase())
        .join('') || '?';
    g.fillStyle = inkOn(t.color);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold ${ini.length > 1 ? 92 : 110}px Barlow, Arial, sans-serif`;
    g.fillText(ini, R, R + 6);
    return c.toDataURL('image/png');
  };
  return tryLoad(t.logo).then(d => d || badge());
}

async function exportRosters() {
  if (typeof window.jspdf === 'undefined') {
    showToast('PDF library not loaded yet — try again in a moment');
    return;
  }
  showToast('Generating PDF…');
  const [hasFonts, logos] = await Promise.all([loadPdfFonts(), Promise.all(teams.map(pdfRoundLogo))]);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = 210,
    PH = 297,
    M = 16,
    CW = PW - M * 2;

  // Fonts: D = display (Anton), B = body (Barlow)
  let D = ['helvetica', 'bold'],
    B = w => ['helvetica', w >= 600 ? 'bold' : 'normal'];
  if (hasFonts) {
    const F = window.DRAFT_DAY_PDF_FONTS;
    [
      ['Anton', 'Anton', 'normal'],
      ['Barlow', 'Barlow', 'normal'],
      ['Barlow-SemiBold', 'Barlow', 'semibold'],
      ['Barlow-Bold', 'Barlow', 'bold'],
    ].forEach(([k, fam, st]) => {
      doc.addFileToVFS(k + '.ttf', F[k]);
      doc.addFont(k + '.ttf', fam, st);
    });
    D = ['Anton', 'normal'];
    B = w => ['Barlow', w >= 700 ? 'bold' : w >= 600 ? 'semibold' : 'normal'];
  }

  // Palette (light)
  const INK = [21, 26, 34],
    MUTED = [107, 118, 132],
    LINE = [228, 232, 238],
    SOFT = [245, 247, 250],
    GOLD = [201, 151, 0],
    BAR = [245, 184, 0];
  const dark = hex => hexRgb(inkOn(hex)); // team / tier colours readable on white
  const tint = (hex, k) => hexRgb(mix(hex, '#ffffff', k));

  const txt = (str, x, y, o = {}) => {
    doc.setFont(...(o.display ? D : B(o.w || 400)));
    doc.setFontSize(o.size || 9);
    doc.setTextColor(...(o.color || INK));
    doc.setCharSpace(o.space || 0);
    let t = String(str);
    if (o.max) {
      while (t.length > 1 && doc.getTextWidth(t) > o.max) t = t.slice(0, -1);
      if (t !== String(str)) t = t.trimEnd() + '…';
    }
    doc.text(t, x, y, { align: o.align || 'left' });
    doc.setCharSpace(0);
    return doc.getTextWidth(t);
  };
  const label = (str, x, y, o = {}) => txt(String(str).toUpperCase(), x, y, { size: 6, w: 700, color: MUTED, space: 0.35, ...o });

  const dateLong = new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const dateShort = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
  const title = (EV.branding.exportTitle || EV.name).trim();

  // ── Layout pass: which team blocks go on which page ──
  const ROW = 6.6,
    HEAD = 17,
    GAP = 6,
    TOP = 34,
    BOTTOM = PH - 22;
  const blockH = t => HEAD + Math.max(1, t.players.length) * ROW + 1;
  const captainNames = getCaptainNames();
  const notSigned = notPlaced().filter(p => !captainNames.includes(p.name.toLowerCase()));
  const recap = recapData();
  const blocks = teams.map((t, i) => ({ t, i, h: blockH(t) }));
  // The not-signed list goes on the cover when it fits there (decided below), otherwise after the teams
  const unsoldH = 14 + Math.ceil(notSigned.length / 3) * 5.6;
  const coverEnd = 168 + Math.max(6.5, Math.min(10, (PH - 180) / Math.max(1, teams.length))) * teams.length; // a little over the cover's real height
  const unsoldOnCover = notSigned.length && coverEnd + unsoldH < PH - 24;
  if (notSigned.length && !unsoldOnCover) blocks.push({ unsold: true, h: unsoldH });
  const pages = [[]];
  let y = TOP;
  blocks.forEach(bk => {
    if (y + bk.h > BOTTOM && pages[pages.length - 1].length) {
      pages.push([]);
      y = TOP;
    }
    pages[pages.length - 1].push(bk);
    y += bk.h + GAP;
  });
  const total = pages.length + 1 + (recap.highlights.length ? 1 : 0);

  const frame = n => {
    doc.setFillColor(...BAR);
    doc.rect(0, 0, PW, 2.2, 'F');
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.line(M, PH - 15, PW - M, PH - 15);
    txt(`${EV.name} · ${dateShort}${isRandom() && alloc.seed ? ' · Draw code ' + fmtCode(alloc.seed) : ''}`, M, PH - 10, {
      size: 7,
      color: MUTED,
    });
    if (hasSponsor()) txt(sponsorText(), PW / 2, PH - 10, { size: 7, w: 600, color: MUTED, align: 'center', max: CW / 3 });
    txt(`Page ${n} of ${total}`, PW - M, PH - 10, { size: 7, color: MUTED, align: 'right' });
  };

  function drawNotSigned(y) {
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.roundedRect(M, y, CW, unsoldH, 2, 2, 'S');
    label(`${isDraft() ? 'Not picked' : R ? 'Not drawn' : 'Not signed'} · ${notSigned.length}`, M + 5, y + 7, { size: 7, space: 0.6 });
    const cw = (CW - 10) / 3;
    notSigned.forEach((p, k) => {
      const x = M + 5 + (k % 3) * cw,
        yy = y + 13 + Math.floor(k / 3) * 5.6;
      txt(p.name, x, yy, { size: 8.5, w: 500, color: MUTED, max: cw - 4 });
    });
  }

  // ── Cover ──
  frame(1);
  label(`${EV.name} · Official team rosters`, M, 38, { size: 7.5, space: 0.9 });
  doc.setFont(...D);
  let ts = 60;
  doc.setFontSize(ts);
  while (ts > 26 && doc.getTextWidth(title.toUpperCase()) > CW) {
    ts -= 2;
    doc.setFontSize(ts);
  }
  txt(title.toUpperCase(), M, 38 + ts * 0.42, { display: true, size: ts, space: 0.3 });
  let cy = 38 + ts * 0.42;
  if (EV.branding.exportSubtitle) {
    cy += 11;
    txt(EV.branding.exportSubtitle.toUpperCase(), M, cy, { display: true, size: 17, color: GOLD, space: 0.9, max: CW });
  }
  cy += 8;
  txt(dateLong, M, cy, { size: 9.5, w: 600, color: MUTED });
  // N5: sponsor, top right of the cover
  if (hasSponsor()) {
    const sl = sponsorImg();
    let sy = 34;
    if (sl) {
      const h = 12,
        w = Math.min(46, (h * sl.naturalWidth) / sl.naturalHeight);
      try {
        doc.addImage(sl, 'PNG', PW - M - w, sy, w, (w * sl.naturalHeight) / sl.naturalWidth, '', 'FAST');
      } catch (e) {}
      sy += 16;
    }
    label(EV.branding.sponsor.line || 'Presented by', PW - M, sy, { align: 'right', size: 6 });
    txt(EV.branding.sponsor.name.trim(), PW - M, sy + 5, { size: 10, w: 700, align: 'right', max: CW * 0.35 });
  }

  // Key numbers
  cy += 12;
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.6);
  doc.line(M, cy, PW - M, cy);
  const sales = teams.flatMap(t => t.players.filter(p => !p.isCaptain && !p.isFormer));
  const top = sales.reduce((a, p) => ((p.finalPrice || 0) > (a ? a.finalPrice || 0 : -1) ? p : a), null);
  const spentAll = teams.reduce((s, t) => s + startBudget(t) - t.budget, 0);
  const R = noMoney();
  const stats = isDraft()
    ? [
        [String(teams.length), 'Teams'],
        [String(teams.reduce((s, t) => s + t.players.filter(p => p.isFormer).length, 0)), 'Players picked'],
        [EV.draft.order === 'snake' ? 'SNAKE' : 'STRAIGHT', 'Pick order'],
        [String(notPlaced().length), 'Not picked'],
      ]
    : isRandom()
      ? [
          [String(teams.length), 'Teams'],
          [String(drawnCount()), 'Players drawn'],
          [EV.random.balance ? 'BALANCED' : 'ONE HAT', EV.random.balance ? 'Tier-balanced draw' : 'Random draw'],
          [fmtCode(alloc.seed), 'Draw code'],
        ]
      : [
          [String(teams.length), 'Teams'],
          [String(teams.reduce((s, t) => s + t.players.filter(p => !p.isCaptain).length, 0)), 'Players signed'],
          [zarS(spentAll), 'Total spent'],
          top ? [zarS(top.finalPrice), 'Top buy · ' + top.name] : [zarS(teams.reduce((s, t) => s + t.budget, 0)), 'Total left'],
        ];
  const sw = CW / 4;
  stats.forEach(([v, k], i) => {
    txt(v, M + sw * i, cy + 12, { display: true, size: 20, max: sw - 4 });
    label(k, M + sw * i, cy + 18, { max: sw - 4 });
  });
  cy += 24;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(M, cy, PW - M, cy);

  // Teams table
  cy += 12;
  label('Teams', M, cy, { size: 7, space: 0.9 });
  cy += 7;
  const cols = { n: M + 2, logo: M + 9, name: M + 18, bought: M + CW * 0.6, spent: M + CW * 0.8, left: PW - M - 2 };
  label('Team', cols.name, cy);
  if (R) {
    label('Tier mix', cols.bought - 30, cy);
    label('Squad', cols.left, cy, { align: 'right' });
  } else {
    label(EV.squadSize ? 'Squad' : 'Bought', cols.bought, cy, { align: 'right' });
    label('Spent', cols.spent, cy, { align: 'right' });
    label('Left', cols.left, cy, { align: 'right' });
  }
  cy += 2.5;
  const rowH = Math.max(6.5, Math.min(10, (PH - 40 - cy) / Math.max(1, teams.length)));
  teams.forEach((t, i) => {
    if (cy + rowH > PH - 30) {
      return;
    } // very large events: the per-team pages still list everyone
    if (i % 2 === 0) {
      doc.setFillColor(...SOFT);
      doc.rect(M, cy, CW, rowH, 'F');
    }
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.line(M, cy, PW - M, cy);
    const mid = cy + rowH / 2;
    txt(String(i + 1), cols.n, mid + 1.2, { size: 8.5, w: 700, color: MUTED });
    const ls = Math.min(7, rowH - 1.5);
    doc.addImage(logos[i], 'PNG', cols.logo - ls / 2 + 2, mid - ls / 2, ls, ls, '', 'FAST');
    if (R) {
      txt(t.name, cols.name, mid + 1.2, { size: 9.5, w: 700, max: cols.bought - 30 - cols.name - 6 });
      txt(tierMix(t) || '—', cols.bought - 30, mid + 1.2, { size: 8.5, w: 500, color: MUTED, max: cols.left - cols.bought + 30 - 22 });
      txt(squadText(t), cols.left, mid + 1.2, { size: 9, w: 600, align: 'right' });
    } else {
      txt(t.name, cols.name, mid + 1.2, { size: 9.5, w: 700, max: cols.bought - cols.name - 18 });
      txt(squadText(t), cols.bought, mid + 1.2, { size: 9, w: 600, align: 'right' });
      txt(zarFmt(startBudget(t) - t.budget), cols.spent, mid + 1.2, { size: 9, w: 600, align: 'right' });
      txt(zarFmt(t.budget), cols.left, mid + 1.2, { size: 9, w: 600, align: 'right' });
    }
    cy += rowH;
  });
  doc.setDrawColor(...LINE);
  doc.line(M, cy, PW - M, cy);
  if (EV.branding.hashtags) {
    cy += 9;
    txt(EV.branding.hashtags.trim(), M, cy, { size: 8.5, w: 600, color: MUTED, max: CW });
  }
  if (unsoldOnCover) drawNotSigned(cy + 10);

  // ── Team pages ──
  pages.forEach((pg, pi) => {
    doc.addPage();
    frame(pi + 2);
    const ts2 = pg.filter(b => !b.unsold);
    txt(title.toUpperCase(), M, 22, { display: true, size: 15, space: 0.4, max: CW * 0.55 });
    label(
      ts2.length
        ? `Team rosters · ${ts2[0].i + 1}${ts2.length > 1 ? '–' + (ts2[ts2.length - 1].i + 1) : ''} of ${teams.length}`
        : 'Not signed',
      PW - M,
      22,
      { align: 'right', size: 6.5 },
    );
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.6);
    doc.line(M, 25.5, PW - M, 25.5);

    let y = TOP;
    pg.forEach(bk => {
      if (bk.unsold) {
        drawNotSigned(y);
        y += bk.h + GAP;
        return;
      }
      const t = bk.t,
        col = t.color,
        dk = dark(col);
      // card outline + header band (soft fade from the team colour)
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.3);
      doc.roundedRect(M, y, CW, bk.h, 2, 2, 'S');
      const steps = 90;
      for (let k = 0; k < steps; k++) {
        doc.setFillColor(...tint(col, 0.84 + 0.16 * (k / steps)));
        doc.rect(M + 0.15 + k * ((CW * 0.75) / steps), y + 0.15, (CW * 0.75) / steps + 0.2, HEAD - 0.3, 'F');
      }
      doc.setFillColor(255, 255, 255);
      doc.rect(M + 0.15 + CW * 0.75, y + 0.15, CW * 0.25 - 0.3, HEAD - 0.3, 'F');
      doc.setFillColor(...hexRgb(col));
      doc.rect(M, y, 1.8, HEAD, 'F');
      doc.addImage(logos[bk.i], 'PNG', M + 5, y + 2.5, 12, 12, '', 'FAST');
      const cap = t.players.find(p => p.isCaptain);
      txt(t.name.toUpperCase(), M + 20, y + 8.6, { display: true, size: 14, space: 0.15, max: CW * 0.48 });
      txt(cap ? 'Captain ' + cap.name : `${t.players.length} player${t.players.length !== 1 ? 's' : ''}`, M + 20, y + 13, {
        size: 7.5,
        w: 600,
        color: MUTED,
        max: CW * 0.48,
      });
      const st = isDraft()
        ? [
            ['Picked', String(t.players.filter(p => p.isFormer).length), GOLD],
            ['Squad', squadText(t), INK],
          ]
        : R
          ? [
              ['Drawn', String(t.players.filter(p => p.drawn).length), GOLD],
              ['Squad', squadText(t), INK],
            ]
          : [
              ['Spent', zarFmt(startBudget(t) - t.budget), GOLD],
              ['Left', zarFmt(t.budget), INK],
              [EV.squadSize ? 'Squad' : 'Bought', squadText(t), INK],
            ];
      let sx = PW - M - 5;
      [...st].reverse().forEach(([k, v, c]) => {
        doc.setFont(...D);
        doc.setFontSize(11.5);
        const w = Math.max(doc.getTextWidth(v), 10);
        txt(v, sx, y + 12.2, { display: true, size: 11.5, color: c, align: 'right' });
        label(k, sx, y + 6.6, { size: 5.5, align: 'right' });
        sx -= w + 7;
      });

      // player rows
      let ry = y + HEAD;
      const tagX = M + CW * 0.48,
        priceX = PW - M - 5;
      (t.players.length ? t.players : [null]).forEach((p, k) => {
        doc.setDrawColor(...LINE);
        doc.setLineWidth(0.2);
        doc.line(M, ry, PW - M, ry);
        if (k % 2 === 1) {
          doc.setFillColor(...SOFT);
          doc.rect(M + 0.15, ry + 0.1, CW - 0.3, ROW - 0.2, 'F');
        }
        const base = ry + ROW / 2 + 1.1;
        if (!p) {
          txt('No players yet', M + 5, base, { size: 8.5, color: MUTED });
          ry += ROW;
          return;
        }
        if (p.isCaptain) {
          txt(p.name, M + 5, base, { size: 8.8, w: 700, color: dk, max: tagX - M - 10 });
          label('Captain', tagX, base - 0.2, { size: 5.8, color: dk });
          txt('—', priceX, base, { size: 8.8, color: MUTED, align: 'right' });
        } else {
          txt(p.name, M + 5, base, { size: 8.8, w: p.isFormer ? 500 : 600, max: tagX - M - 10 });
          let tx = tagX;
          if (tierDef(p.tier)) {
            const tc = dark(tierColor(p.tier));
            doc.setFont(...B(700));
            doc.setFontSize(5.4);
            doc.setCharSpace(0.3);
            const w = doc.getTextWidth(p.tier.toUpperCase()) + 0.3 * p.tier.length + 3.4;
            doc.setCharSpace(0);
            doc.setDrawColor(...tc);
            doc.setLineWidth(0.25);
            doc.roundedRect(tx, base - 3.1, w, 4, 0.8, 0.8, 'S');
            txt(p.tier.toUpperCase(), tx + w / 2, base - 0.2, { size: 5.4, w: 700, color: tc, space: 0.3, align: 'center' });
            tx += w + 2.2;
          }
          if (p.isFormer) label(roundLabel(p), tx, base - 0.2, { size: 5.4, max: priceX - tx - 22 });
          if (p.isFormer && !p.finalPrice) txt('Pick', priceX, base, { size: 8.8, w: 600, color: MUTED, align: 'right' });
          else if (R) txt(p.drawNo ? 'Draw #' + p.drawNo : 'Added', priceX, base, { size: 8.5, w: 600, color: MUTED, align: 'right' });
          else txt(zarFmt(p.finalPrice || p.price), priceX, base, { size: 8.8, w: 700, align: 'right' });
        }
        ry += ROW;
      });
      y += bk.h + GAP;
    });
  });

  // ── N4: recap page ──
  if (recap.highlights.length) {
    doc.addPage();
    frame(total);
    txt(title.toUpperCase(), M, 22, { display: true, size: 15, space: 0.4, max: CW * 0.55 });
    label('Recap', PW - M, 22, { align: 'right', size: 6.5 });
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.6);
    doc.line(M, 25.5, PW - M, 25.5);
    let ry = 40;
    txt('THE DAY IN NUMBERS', M, ry, { display: true, size: 22 });
    ry += 6;
    const rw = CW / recap.stats.length;
    recap.stats.forEach(([v, k], i) => {
      txt(v, M + rw * i, ry + 13, { display: true, size: 20, color: i === 1 ? GOLD : INK, max: rw - 4 });
      label(k, M + rw * i, ry + 19, { max: rw - 4 });
    });
    ry += 30;
    recap.highlights.forEach(h => {
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.3);
      doc.roundedRect(M, ry, CW, 22, 2, 2, 'S');
      doc.setFillColor(...hexRgb(h.color || '#f5b800'));
      doc.rect(M, ry, 1.8, 22, 'F');
      label(h.label, M + 6, ry + 6.5, { size: 6.5 });
      txt(h.title, M + 6, ry + 14.5, { display: true, size: 15, max: CW * 0.62 });
      if (h.sub) txt(h.sub, M + 6, ry + 19, { size: 7.5, w: 500, color: MUTED, max: CW * 0.62 });
      if (h.value)
        txt(h.value, PW - M - 6, ry + 14.5, {
          display: true,
          size: 17,
          color: h.color ? dark(h.color) : GOLD,
          align: 'right',
          max: CW * 0.32,
        });
      ry += 26;
    });
  }

  doc.save(slugify(EV.name) + '-rosters.pdf');
  showToast('PDF exported!');
}

// Results CSV: one row per player on every team (captains, picks, buys or draws), then anyone not placed
function exportLog() {
  const R = noMoney(),
    q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const how = p => (p.isCaptain ? 'Captain' : p.isFormer ? roundLabel(p) || 'Pre-auction pick' : p.drawn ? 'Drawn' : 'Bought');
  const rows = [
    R ? 'Team,Player,Tier,How' + (isRandom() ? ',Draw #' : '') : `Team,Player,Tier,How,Base price (${EV.currency}),Paid (${EV.currency})`,
  ];
  teams.forEach(t =>
    t.players.forEach(p =>
      rows.push(
        (R
          ? [q(t.name), q(p.name), q(p.tier), q(how(p)), ...(isRandom() ? [p.drawNo || ''] : [])]
          : [q(t.name), q(p.name), q(p.tier), q(how(p)), p.isCaptain ? '' : p.price || 0, p.isCaptain ? '' : p.finalPrice || 0]
        ).join(','),
      ),
    ),
  );
  const caps = getCaptainNames();
  notPlaced()
    .filter(p => !caps.includes(p.name.toLowerCase()))
    .forEach(p =>
      rows.push(
        (R
          ? ['', q(p.name), q(p.tier), isDraft() ? 'Not picked' : 'Not drawn', ...(isRandom() ? [''] : [])]
          : ['', q(p.name), q(p.tier), 'Unsold', p.price || 0, '']
        ).join(','),
      ),
    );
  if (rows.length === 1) {
    showToast('Nothing to export yet');
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv' }));
  a.download = slugify(EV.name) + '-results.csv';
  a.click();
  showToast('Results CSV exported');
}

// ── STATE: save / load / autosave / undo ─────────────────────────────────────
function currentPhase() {
  return document.getElementById('selectionScreen').classList.contains('open')
    ? 'selection'
    : (document.getElementById('appScreen').style.display !== 'none' || document.getElementById('allocScreen').style.display === 'flex') &&
        teams.length
      ? 'auction'
      : 'setup';
}
function reconcileSold() {
  const assigned = new Set();
  teams.forEach(t => t.players.forEach(p => assigned.add(p.name.toLowerCase())));
  players.forEach(p => {
    if (assigned.has(p.name.toLowerCase()) && !p.sold) setStatus(p, 'sold');
  });
}
// ── The event's live data, in one place ──
// Save, autosave, undo and restore all go through storeRead / storeWrite, so a new piece of
// state is added once, here, and can't be forgotten by one of them.
function storeRead() {
  return {
    _pid,
    pickOrder,
    teams,
    players,
    auctionLog,
    spinAngle,
    selRounds,
    selRoundIdx,
    auctionPhase,
    alloc: { seed: alloc.seed, locked: alloc.locked, last: alloc.last },
  };
}
function storeWrite(s) {
  _pid = s._pid || 0;
  pickOrder = s.pickOrder || EV.teams.map((_, i) => i);
  teams = s.teams || [];
  players = s.players || [];
  auctionLog = s.auctionLog || [];
  spinAngle = s.spinAngle || 0;
  selRounds = s.selRounds || [];
  selRoundIdx = s.selRoundIdx || 0;
  auctionPhase = s.auctionPhase === 'unsold' ? 'unsold' : 'main';
  alloc = { seed: '', locked: false, last: null, ...(s.alloc || {}) };
  _anim = null;
}

// ── Save files ──
// Each step upgrades a save by one version; a save runs through every step it needs, in order.
const SAVE_VERSION = 3;
const SAVE_MIGRATIONS = {
  // v1 → v2: v1 was the fixed 6-team, 2-pick format; rebuild that event around it
  1: s => {
    s.event = {
      ...clone(FILE_EVENT),
      rounds: [{ name: 'Former players', picks: 2, order: 'snake', cost: 'free', countsTowardSquad: false, countsTowardTiers: true }],
    };
    s.selRounds = [
      { players: s.selPlayers || [], pickIdx: s.selPickIdx || 0, turnOrder: s.selTurnOrder || [], picks: [], done: !!s.selDone },
    ];
    s.selRoundIdx = 0;
  },
  // v2 → v3: one status per player instead of separate flags
  2: s => {
    (s.players || []).forEach(p => setStatus(p, statusFromFlags(p)));
    (s.teams || []).forEach(t => (t.players || []).forEach(p => setStatus(p, statusFromFlags(p))));
  },
};
function migrateSave(s) {
  if (!(s.version >= 1 && s.version <= SAVE_VERSION)) return null;
  while (s.version < SAVE_VERSION) {
    SAVE_MIGRATIONS[s.version](s);
    s.version++;
  }
  return s;
}

function buildState() {
  reconcileSold();
  return {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    phase: currentPhase(),
    event: EV, // every setting, so a save reopens exactly as it was run
    ...storeRead(),
  };
}
function saveState() {
  const blob = new Blob([JSON.stringify(buildState(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const ts = new Date()
    .toLocaleString('en-ZA')
    .replace(/[/:, ]/g, '-')
    .replace(/-+/g, '-');
  a.href = URL.createObjectURL(blob);
  a.download = `${slugify(EV.name)}-save-${ts}.json`;
  a.click();
  showToast('State saved!');
}

// Put a saved state (file, autosave) back on screen
function applyState(s) {
  if (!migrateSave(s)) {
    showToast('Unrecognised save file');
    return false;
  }
  clearBidTimer();
  stopJingle();
  setRehearsal(false);
  EV = normalizeEvent(s.event);
  sponsorImg();
  applyTierStyles();
  storeWrite(s);
  teams = teams.map(t => ({ ...t, startBudget: t.startBudget || EV.budget, logo: t.logo || initialsBadge(t.name, t.color) }));
  selRounds.forEach(sr => {
    if (!sr.picks) sr.picks = [];
  });
  reconcileSold();
  undoStack.length = 0;
  renderUndoBtn();

  document.getElementById('setupScreen').style.display = 'none';
  document.getElementById('selectionScreen').classList.remove('open');
  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('allocScreen').style.display = 'none';
  document.getElementById('selCompleteBanner').classList.remove('visible');
  document.title = EV.name + (isRandom() ? ' — Draw' : ' — Player Auction');
  document.querySelectorAll('.event-name').forEach(el => (el.textContent = EV.name.toUpperCase()));

  if (s.phase === 'selection' && teams.length && allRounds().length) {
    selectionRoundInit(Math.min(selRoundIdx, allRounds().length - 1));
  } else if (s.phase === 'auction' && teams.length) {
    startAuction();
    dismissWinner();
  } else {
    teams = [];
    document.getElementById('setupScreen').style.display = 'flex';
    currentPreset = '';
    afterEventChange();
  }
  return true;
}
function loadState(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const s = JSON.parse(ev.target.result);
      if (applyState(s)) {
        autosaveNow();
        showToast(`Resumed from ${new Date(s.savedAt).toLocaleString('en-ZA')}`);
      }
    } catch (err) {
      showToast('Failed to load save file');
      console.error(err);
    }
  };
  r.readAsText(file);
}

// Autosave: the whole event goes into this browser after every change, so a
// closed tab or crash never loses more than a moment. Resume is offered in the wizard.
const AUTOSAVE_KEY = 'draftday.autosave.v1';
let _asT = null;
function autosave() {
  if (!teams.length) return;
  clearTimeout(_asT);
  _asT = setTimeout(autosaveNow, 300);
}
function autosaveNow() {
  clearTimeout(_asT);
  _asT = null;
  if (!teams.length || rehearsal) return; // a rehearsal never touches the real autosave
  const st = buildState();
  st.autosave = true;
  if (!storeSet(AUTOSAVE_KEY, st)) {
    // Storage full (usually uploaded logos): keep the event, drop the uploaded images, and say so once
    const lite = JSON.parse(JSON.stringify(st));
    const dropLogo = t => {
      if ((t.logo || '').startsWith('data:image/') && !(t.logo || '').startsWith('data:image/svg')) t.logo = '';
    };
    lite.teams.forEach(dropLogo);
    lite.event.teams.forEach(dropLogo);
    const ok = storeSet(AUTOSAVE_KEY, lite);
    if (!_asWarned) {
      _asWarned = true;
      showToast(
        ok
          ? 'Browser storage is full: autosave is leaving out uploaded logos. Save State keeps everything.'
          : 'Autosave failed: browser storage is full. Use File ▾ → Save State to keep the event.',
      );
    }
  }
}
let _asWarned = false;
function clearAutosave() {
  clearTimeout(_asT);
  _asT = null;
  if (rehearsal) return;
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch (e) {}
  renderResumeBanner();
}
window.addEventListener('pagehide', () => {
  if (_asT) autosaveNow();
});
setInterval(() => {
  if (teams.length) autosaveNow();
}, 15000);

function renderResumeBanner() {
  const el = document.getElementById('resumeBanner');
  if (!el) return;
  const s = storeGet(AUTOSAVE_KEY);
  if (!s || !s.teams || !s.teams.length || teams.length) {
    el.style.display = 'none';
    return;
  }
  const sold = (s.auctionLog || []).length,
    when = new Date(s.savedAt);
  const where =
    s.phase === 'selection'
      ? `in ${((s.event.rounds || [])[s.selRoundIdx] || {}).name || 'a pre-auction round'}`
      : s.auctionPhase === 'unsold'
        ? 'in the unsold round'
        : `${sold} player${sold !== 1 ? 's' : ''} ${s.event.format === 'random' ? 'drawn' : 'signed'}`;
  el.style.display = '';
  el.innerHTML = `<div><strong>Event in progress:</strong> ${esc(s.event.name)} · ${s.teams.length} teams · ${where} · saved ${when.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })} ${when.toDateString() === new Date().toDateString() ? 'today' : when.toLocaleDateString('en-ZA')}</div>
    <div class="resume-btns"><button class="btn btn-accent" data-action="resumeAutosave">▶ Resume</button><button class="btn btn-ghost" data-action="discardAutosave">Discard</button></div>`;
}
function resumeAutosave() {
  const s = storeGet(AUTOSAVE_KEY);
  if (s && applyState(s)) showToast('Resumed the event in progress');
}
async function discardAutosave() {
  if (
    !(await askConfirm('Discard the event in progress? Its rosters, picks and sales are deleted from this browser.', {
      okLabel: 'Discard',
      danger: true,
    }))
  )
    return;
  clearAutosave();
}

// Undo: a snapshot before every action that changes the event
const undoStack = [];
function serBidRound() {
  return bidRound.player
    ? {
        pid: bidRound.player.id,
        bids: bidRound.bids,
        passed: [...bidRound.passed],
        leaderId: bidRound.leaderId,
        leaderBid: bidRound.leaderBid,
        startTime: bidRound.startTime,
      }
    : null;
}
function snap(label) {
  const st = storeRead();
  st.teams = teams.map(t => ({ ...t, logo: undefined })); // logos never change mid-event; keep snapshots small
  undoStack.push({ label, s: JSON.stringify({ ...st, br: serBidRound() }) });
  if (undoStack.length > 60) undoStack.shift();
  renderUndoBtn();
}
function renderUndoBtn() {
  const last = undoStack.at(-1);
  document.querySelectorAll('.undo-btn').forEach(b => {
    b.disabled = !last;
    b.title = last ? `Undo: ${last.label} (Ctrl+Z)` : 'Nothing to undo';
  });
}
function undoLast() {
  const u = undoStack.pop();
  if (!u) {
    showToast('Nothing to undo');
    return;
  }
  const s = JSON.parse(u.s);
  const logos = Object.fromEntries(teams.map(t => [t.id, t.logo])),
    locked = alloc.locked;
  storeWrite(s);
  teams = teams.map(t => ({ ...t, logo: logos[t.id] }));
  alloc.locked = locked; // undo never unlocks a locked draw
  clearBidTimer();
  if (document.getElementById('selectionScreen').classList.contains('open')) {
    selRenderAll();
  } else {
    if (s.br) {
      const p = players.find(x => x.id === s.br.pid);
      currentPlayer = p;
      showWinnerPanel(p);
      Object.assign(bidRound, {
        bids: s.br.bids.map(b => ({ ...b, timestamp: new Date(b.timestamp) })),
        passed: new Set(s.br.passed),
        leaderId: s.br.leaderId,
        leaderBid: s.br.leaderBid,
        startTime: s.br.startTime ? new Date(s.br.startTime) : new Date(),
      });
      clearBidError();
      document.getElementById('declareWinnerBtn').disabled = bidRound.leaderId === null;
      renderBidRoundTeams();
      renderBidTrail();
      updateLeaderDisplay();
      renderBidRoundTitle();
    } else dismissWinner();
    renderTeamsBar();
    renderPlayersList();
    renderLog();
    updateStats();
    drawWheel();
    if (document.getElementById('rosterModal').classList.contains('open')) refreshRosterModal();
  }
  renderUndoBtn();
  showToast('↶ Undone: ' + u.label);
}

async function confirmResetPicks() {
  if (!auctionLog.length && !teams.some(t => boughtCount(t))) {
    showToast('No sales to undo');
    return;
  }
  if (
    !(await askConfirm(
      'Undo ALL auction sales? Every bought player goes back in the pool, the unsold queue is cleared and budgets are refunded. Captains and pre-auction picks stay.',
      { okLabel: 'Undo all sales', danger: true },
    ))
  )
    return;
  snap('undo all sales');
  teams.forEach(t => {
    const spent = t.players.filter(p => !p.isCaptain && !p.isFormer).reduce((s, p) => s + (p.finalPrice || 0), 0);
    t.budget += spent;
    t.players = t.players.filter(p => p.isCaptain || p.isFormer);
  });
  players.forEach(p => {
    setStatus(p, 'pool');
    p.teamId = null;
    p.finalPrice = 0;
  });
  auctionPhase = 'main';
  auctionLog = [];
  currentPlayer = null;
  selectedTeamId = null;
  spinAngle = 0;
  dismissWinner();
  renderTeamsBar();
  renderPlayersList();
  renderLog();
  updateStats();
  drawWheel();
  showToast('All sales undone — pool reloaded');
}

async function confirmReset() {
  if (
    !(await askConfirm(
      'Reset the whole event and go back to setup? Rosters, picks and sales are lost (your settings stay). Save State first if you need them.',
      { okLabel: 'Reset event', danger: true },
    ))
  )
    return;
  clearBidTimer();
  players = [];
  auctionLog = [];
  currentPlayer = null;
  selectedTeamId = null;
  spinAngle = 0;
  spinning = false;
  _pid = 0;
  selRounds = [];
  selRoundIdx = 0;
  auctionPhase = 'main';
  alloc = { seed: '', locked: false, last: null };
  _anim = null;
  document.getElementById('allocScreen').style.display = 'none';
  undoStack.length = 0;
  renderUndoBtn();
  clearAutosave();
  setRehearsal(false);
  teams = []; // back to setup — the wizard edits EV again
  stopJingle();
  // Hide app and selection screens, go back to setup
  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('selectionScreen').classList.remove('open');
  document.getElementById('setupScreen').style.display = 'flex';
  document.getElementById('selCompleteBanner').classList.remove('visible');
  canvas.classList.remove('spinning');
  document.getElementById('wheelHalo').classList.remove('active');
  dismissWinner();
  goStep(WIZ_STEPS.length - 1);
  showToast('Event reset — back to setup');
}

function launchConfetti() {
  if (reduceMotion()) return;
  const cc = document.getElementById('confettiCanvas');
  cc.width = innerWidth;
  cc.height = innerHeight;
  const cx = cc.getContext('2d');
  const cols = ['#00c8ff', '#f5b800', '#00e87a', '#ff4050', '#b060ff', '#ff8030'];
  const ps = Array.from({ length: 100 }, () => ({
    x: Math.random() * cc.width,
    y: -10,
    vx: (Math.random() - 0.5) * 5,
    vy: 2 + Math.random() * 4,
    c: cols[Math.floor(Math.random() * cols.length)],
    w: 5 + Math.random() * 8,
    h: 3 + Math.random() * 5,
    r: Math.random() * Math.PI * 2,
    rv: (Math.random() - 0.5) * 0.12,
    life: 1,
  }));
  (function d() {
    cx.clearRect(0, 0, cc.width, cc.height);
    let alive = false;
    ps.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;
      p.r += p.rv;
      p.life -= 0.008;
      if (p.y < cc.height + 20 && p.life > 0) {
        alive = true;
        cx.save();
        cx.globalAlpha = Math.max(0, p.life);
        cx.translate(p.x, p.y);
        cx.rotate(p.r);
        cx.fillStyle = p.c;
        cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        cx.restore();
      }
    });
    if (alive) requestAnimationFrame(d);
    else cx.clearRect(0, 0, cc.width, cc.height);
  })();
}

let _tt;
function showToast(m) {
  const e = document.getElementById('toast');
  e.textContent = m;
  e.classList.add('show');
  clearTimeout(_tt);
  _tt = setTimeout(() => e.classList.remove('show'), 2600);
}

// ── ADMIN PANEL (during the event) ──────────────────────────────────────────
// Setup happens in the wizard; Admin adjusts a live event.
function openAdmin() {
  if (!teams.length) return;
  const overlay = document.getElementById('adminOverlay');
  overlay.classList.remove('hidden');
  overlay.style.display = 'flex';
  switchAdminTab('teams');
  renderAdminTeams();
  renderAdminRules();
}
function closeAdmin() {
  document.getElementById('adminOverlay').style.display = 'none';
}
function switchAdminTab(tab) {
  document.getElementById('adminTabTeams').style.display = tab === 'teams' ? 'block' : 'none';
  document.getElementById('adminTabRules').style.display = tab === 'rules' ? 'block' : 'none';
  document.getElementById('tabTeams').classList.toggle('active', tab === 'teams');
  document.getElementById('tabRules').classList.toggle('active', tab === 'rules');
}

function renderAdminTeams() {
  const showCap = EV.captains || teams.some(t => t.players.some(p => p.isCaptain));
  document.getElementById('adminTeamsGrid').innerHTML = teams
    .map(t => {
      const cap = (t.players.find(p => p.isCaptain) || {}).name || '';
      return `<div class="admin-team-row" id="adminTeamRow${t.id}">
      <div class="rel shrink-0">
        <div class="admin-team-color-swatch" style="background:${t.color}" data-action="clickEl" data-args='["acp${t.id}"]' title="Change colour"></div>
        <input type="color" class="admin-color-picker" id="acp${t.id}" value="${t.color}" onchange="previewTeamColor(${t.id},this.value)"/>
      </div>
      <div class="col-stack">
        <input class="admin-team-name-inp" id="atn${t.id}" value="${esc(t.name)}" placeholder="Team ${t.id + 1}" maxlength="32"/>
        ${showCap ? `<input class="admin-team-name-inp fs-sm fw-500" id="atc${t.id}" value="${esc(cap)}" placeholder="👑 Captain" maxlength="40"/>` : ''}
      </div>
      <div class="admin-team-budget-wrap" title="Budget left" ${isRandom() ? 'hidden' : ''}>
        <input type="number" class="admin-team-budget-inp" id="atb${t.id}" value="${t.budget}" min="0" step="${EV.bidding.increment}"/>
      </div>
    </div>`;
    })
    .join('');
}
function previewTeamColor(teamId, hexVal) {
  const sw = document.querySelector(`#adminTeamRow${teamId} .admin-team-color-swatch`);
  if (sw) sw.style.background = hexVal;
}

function renderAdminRules() {
  const b = EV.bidding;
  const row = (label, desc, ctl) =>
    `<div class="admin-rule-row"><div class="admin-rule-info"><div class="admin-rule-label">${label}</div><div class="admin-rule-desc">${desc}</div></div><div class="admin-rule-control">${ctl}</div></div>`;
  const money = (id, v) =>
    `<span class="admin-inp-prefix">${esc(EV.currency)}</span><input type="number" class="admin-inp" id="${id}" value="${v}" min="0"/>`;
  const tog = (id, v) =>
    `<label class="admin-toggle"><input type="checkbox" id="${id}" ${v ? 'checked' : ''}/><span class="admin-toggle-slider"></span></label>`;
  const n = (id, v, suf) =>
    `<input type="number" class="admin-inp admin-inp-sm" id="${id}" value="${v}" min="0"/>${suf ? `<span class="admin-inp-suffix">${suf}</span>` : ''}`;
  const R = isRandom();
  // In a random draw the money rules don't apply: they stay in the page (hidden) so Apply keeps them as they were
  document.getElementById('adminRulesBody').innerHTML = `
    ${R ? `<div class="admin-section-label">Squads</div><div class="admin-rules-grid">${row('Players drawn per team', '0 = no limit', n('ruleSquadR', EV.squadSize))}</div>` : ''}
    <div ${R ? 'hidden' : ''}>
    <div class="admin-section-label">Bidding</div><div class="admin-rules-grid">
      ${row('Bid increment', 'The step between bids', money('ruleIncrement', b.increment))}
      ${row('Enforce the increment', 'Bids must beat the leader by at least the increment', tog('ruleEnforce', b.enforceIncrement))}
      ${row('Pre-fill bid boxes', 'Show the next valid amount in each box', tog('rulePrefill', b.prefill))}
      ${row('Auto-sell', 'Sell once every other team has passed', tog('ruleAutoSell', b.autoSell))}
      ${row('Purse reserve', 'Teams must keep enough to fill their squad', tog('ruleReserve', b.reserve))}
      ${row('Type bids in thousands', 'Type 350 for 350 000', tog('ruleThousands', b.inThousands))}
      ${row('Timer', 'Seconds per player (0 = off). Applies from the next player', n('ruleTimer', b.timer, 'sec'))}
      ${row('New bid restarts the timer', '', tog('ruleTimerReset', b.timerResetsOnBid))}
      ${row('Players bought per team', '0 = no limit', n('ruleSquad', EV.squadSize))}
      ${row('Unsold queue and round', 'Unsold players wait for a second, discounted round', tog('ruleUnsold', EV.unsold.enabled))}
      ${row('Price cut in the unsold round', '% off opening bids', n('ruleUnsoldDiscount', EV.unsold.discount, '% off'))}
    </div></div>
    ${
      EV.tiers.length
        ? `<div class="admin-section-label wiz-gap">Tiers</div><div class="admin-rules-grid">
      ${EV.tiers
        .map((t, i) =>
          row(
            `${tierPill(t.name)} ${esc(t.name)}`,
            R ? 'Max per team (0 = no limit)' : 'Min opening bid · max per team (0 = no limit)',
            `<span ${R ? 'hidden' : ''}><span class="admin-inp-prefix">${esc(EV.currency)}</span><input type="number" class="admin-inp" id="ruleTierMin${i}" value="${t.minBid}" min="0"/></span>
         <input type="number" class="admin-inp admin-inp-sm ml-xs" id="ruleTierLimit${i}" value="${t.limit}" min="0"/>`,
          ),
        )
        .join('')}
    </div>`
        : ''
    }
    <div class="admin-rule-desc mt-lg">Team count, rounds and tier names are set in the setup wizard before launch.</div>`;
}

function applyAdmin() {
  let changes = 0;
  teams.forEach(t => {
    const oldName = t.name;
    const nameEl = document.getElementById('atn' + t.id),
      capEl = document.getElementById('atc' + t.id);
    const budgetEl = document.getElementById('atb' + t.id),
      colorEl = document.getElementById('acp' + t.id);
    if (capEl) {
      const newCap = capEl.value.trim(),
        cap = t.players.find(p => p.isCaptain);
      if (cap && newCap && newCap !== cap.name) {
        cap.name = newCap;
        changes++;
      } else if (cap && !newCap) {
        t.players = t.players.filter(p => !p.isCaptain);
        changes++;
      } else if (!cap && newCap) {
        t.players.unshift(setStatus({ id: nextId(), name: newCap, price: 0, tier: '', finalPrice: 0, teamId: t.id }, 'captain'));
        changes++;
      }
    }
    if (nameEl) {
      const newName = nameEl.value.trim() || t.name;
      if (newName !== t.name) {
        t.name = newName;
        changes++;
        auctionLog.forEach(e => {
          if (e.team === oldName) e.team = newName;
        }); // keep history attached
      }
    }
    if (budgetEl) {
      const v = Math.round(+budgetEl.value);
      if (Number.isFinite(v) && v !== t.budget) {
        t.budget = v;
        changes++;
      }
    }
    if (colorEl && colorEl.value !== t.color) {
      t.color = colorEl.value;
      changes++;
      auctionLog.forEach(e => {
        if (e.team === t.name) e.teamColor = t.color;
      });
    }
  });

  const val = id => document.getElementById(id);
  const before = JSON.stringify([EV.bidding, EV.squadSize, EV.tiers, EV.unsold]);
  EV.bidding = {
    increment: Math.max(1, +val('ruleIncrement').value || EV.bidding.increment),
    enforceIncrement: val('ruleEnforce').checked,
    prefill: val('rulePrefill').checked,
    autoSell: val('ruleAutoSell').checked,
    timer: Math.max(0, Math.round(+val('ruleTimer').value || 0)),
    timerResetsOnBid: val('ruleTimerReset').checked,
    reserve: val('ruleReserve').checked,
    inThousands: val('ruleThousands').checked,
  };
  EV.squadSize = Math.max(0, Math.round(+val(isRandom() ? 'ruleSquadR' : 'ruleSquad').value || 0));
  EV.tiers.forEach((t, i) => {
    t.minBid = Math.max(0, +val('ruleTierMin' + i).value || 0);
    t.limit = Math.max(0, Math.round(+val('ruleTierLimit' + i).value || 0));
  });
  EV.unsold = {
    enabled: val('ruleUnsold').checked,
    discount: Math.max(0, Math.min(90, Math.round(+val('ruleUnsoldDiscount').value || 0))),
  };
  if (JSON.stringify([EV.bidding, EV.squadSize, EV.tiers, EV.unsold]) !== before) {
    changes++;
    applyAuctionChrome();
  }
  EV.teams.forEach((c, i) => {
    const t = teams[i];
    if (!t) return;
    c.name = t.name;
    c.color = t.color;
    const cap = t.players.find(p => p.isCaptain);
    c.captain = cap ? cap.name : '';
  });
  saveWorking();

  if (changes > 0) {
    renderTeamsBar();
    renderPlayersList();
    drawWheel();
    renderLog();
    updateStats();
    if (bidRound.player) {
      renderBidRoundTeams();
      renderBidRoundTitle();
    }
  }
  closeAdmin();
  showToast(changes > 0 ? `✓ ${changes} change${changes > 1 ? 's' : ''} applied` : 'No changes made');
}

// ── BID TIMER ────────────────────────────────────────────────────────────────
// One countdown per player. It can be paused (by the auctioneer, or while the
// break screen is up) and extended; a new bid restarts it when that rule is on.
let bidTimerInterval = null;
let bidTimerRemaining = 0;
let bidTimerPaused = ''; // '' | 'manual' | 'break'

const bidTimerOn = () => EV.bidding.timer > 0 && !!bidRound.player;

function startBidTimer() {
  clearBidTimer();
  if (!bidTimerOn()) return;
  bidTimerRemaining = EV.bidding.timer;
  if (!bidTimerPaused) runBidTimer();
  renderBidTimerUI();
}

function runBidTimer() {
  clearInterval(bidTimerInterval);
  bidTimerInterval = setInterval(() => {
    bidTimerRemaining--;
    renderBidTimerUI();
    if (bidTimerRemaining <= 0) {
      clearBidTimer();
      if (bidRound.leaderId !== null) {
        showToast("⏱ Time's up — sold!");
        setTimeout(declareWinner, 400);
      } else markUnsold();
    }
  }, 1000);
}

function pauseBidTimer(why = 'manual') {
  if (!bidTimerOn() || bidTimerPaused) return;
  bidTimerPaused = why;
  clearInterval(bidTimerInterval);
  bidTimerInterval = null;
  renderBidTimerUI();
}
function resumeBidTimer(why) {
  if (!bidTimerPaused || (why && bidTimerPaused !== why)) return;
  bidTimerPaused = '';
  if (bidTimerOn() && bidTimerRemaining > 0) runBidTimer();
  renderBidTimerUI();
}
function toggleBidTimer() {
  if (!bidTimerOn()) {
    showToast('No bid timer running');
    return;
  }
  bidTimerPaused ? resumeBidTimer() : pauseBidTimer('manual');
}
function addBidTime(sec = 10) {
  if (!bidTimerOn()) {
    showToast('No bid timer running');
    return;
  }
  bidTimerRemaining += sec;
  renderBidTimerUI();
}

function clearBidTimer() {
  if (bidTimerInterval) {
    clearInterval(bidTimerInterval);
    bidTimerInterval = null;
  }
  bidTimerPaused = bidTimerPaused === 'break' ? 'break' : '';
  const el = document.getElementById('adminBidTimerDisplay');
  if (el) el.remove();
}

function renderBidTimerUI() {
  let el = document.getElementById('adminBidTimerDisplay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'adminBidTimerDisplay';
    el.className = 'bid-timer';
    const winnerTop = document.querySelector('.winner-top');
    if (winnerTop) {
      winnerTop.style.position = 'relative';
      winnerTop.appendChild(el);
    }
  }
  const urgent = bidTimerRemaining <= 5 && !bidTimerPaused;
  el.classList.toggle('urgent', urgent);
  el.classList.toggle('paused', !!bidTimerPaused);
  el.innerHTML = `<span class="bid-timer-t">${bidTimerPaused ? '⏸' : '⏱'} ${bidTimerRemaining}s</span>
    <button type="button" data-action="toggleBidTimer" title="${bidTimerPaused ? 'Resume' : 'Pause'} the timer (T)" aria-label="${bidTimerPaused ? 'Resume' : 'Pause'} timer">${bidTimerPaused ? '▶' : '⏸'}</button>
    <button type="button" data-action="addBidTime" title="Add 10 seconds (+)" aria-label="Add 10 seconds">+10</button>`;
}

// ── Break screen ──
let _breakEnd = 0,
  _breakInt = null;
function openBreak() {
  if (!teams.length) return;
  _breakEnd = Date.now() + 10 * 60000;
  renderBreak();
  pauseBidTimer('break');
  document.getElementById('breakOverlay').classList.add('open');
  clearInterval(_breakInt);
  _breakInt = setInterval(tickBreak, 1000);
  tickBreak();
}
function stopBreakTimer() {
  clearInterval(_breakInt);
  _breakInt = null;
}
function closeBreak() {
  stopBreakTimer();
  document.getElementById('breakOverlay').classList.remove('open');
  resumeBidTimer('break');
}
function breakAdd(min) {
  _breakEnd = Math.max(Date.now(), _breakEnd + min * 60000);
  tickBreak();
}
function tickBreak() {
  const ms = Math.max(0, _breakEnd - Date.now()),
    m = Math.floor(ms / 60000),
    s = Math.floor(ms / 1000) % 60;
  document.getElementById('breakClock').textContent = ms ? `${m}:${String(s).padStart(2, '0')}` : "WE'RE BACK";
  document.getElementById('breakLbl').textContent = ms ? 'BACK IN' : '';
}
function renderBreak() {
  document.getElementById('breakEvent').textContent = EV.name.toUpperCase();
  const sold = auctionLog.length,
    left = activePool().length,
    q = EV.unsold.enabled ? unsoldQueue().length : 0;
  document.getElementById('breakSub').textContent = isRandom()
    ? `${drawnCount()} drawn · ${allocPool().length} still in the hat`
    : `${sold} signed · ${left} still to come${q && auctionPhase === 'main' ? ` · ${q} in the unsold queue` : ''}`;
  document.getElementById('breakTeams').innerHTML = teams
    .map(t => {
      const buys = t.players.filter(p => !p.isCaptain && !p.isFormer).sort((a, b) => (b.finalPrice || 0) - (a.finalPrice || 0));
      const top = buys[0];
      return `<div class="break-team" style="--team-col:${t.color}">
      <img src="${t.logo}" alt=""/>
      <div class="break-team-main"><div class="break-team-name">${esc(t.name)}</div>
        <div class="break-team-sub">${isRandom() ? tierMix(t) || 'No players yet' : `${squadIcons(t)} ${squadText(t)} signed${top ? ` · top buy ${esc(top.name)} ${zarS(top.finalPrice)}` : ''}`}</div></div>
      <div class="break-team-purse">${isRandom() ? `${squadText(t)}<span>squad</span>` : `${zarS(t.budget)}<span>left</span>`}</div>
    </div>`;
    })
    .join('');
}

// ── Keyboard ──
// One keymap per screen. The shortcuts list (?) is built from the same maps, so it always
// matches what the keys do. Keys are ignored while typing in a box or with a panel open.
const kDigit = e => {
  const m = (e.code || '').match(/^Digit(\d)$/);
  return m ? (m[1] === '0' ? 9 : +m[1] - 1) : -1;
};
const KEYMAPS = {
  auction: [
    {
      label: 'Space',
      desc: 'Spin / draw the next player (press again to skip the spin)',
      test: e => e.key === ' ',
      run: () => {
        if (!bidRound.player) spinWheel();
      },
    },
    {
      label: '1 – 9, 0',
      desc: 'Quick bid (+1 increment) for team 1–10',
      test: e => !e.shiftKey && kDigit(e) >= 0,
      run: e => {
        const t = teams[kDigit(e)];
        if (t && bidRound.player) quickBid(t.id, 1);
      },
    },
    {
      label: 'Shift + 1 – 9, 0',
      desc: 'Pass for that team',
      test: e => e.shiftKey && kDigit(e) >= 0,
      run: e => {
        const t = teams[kDigit(e)];
        if (t && bidRound.player) passTeam(t.id);
      },
    },
    { label: 'G', desc: 'Going once, going twice… (press again to stop)', test: e => e.key.toLowerCase() === 'g', run: () => goingOnce() },
    {
      label: 'D',
      desc: 'Declare winner now',
      test: e => e.key.toLowerCase() === 'd',
      run: () => {
        if (bidRound.player) declareWinner();
      },
    },
    {
      label: 'U',
      desc: EV.unsold.enabled ? 'Unsold' : 'Skip player',
      test: e => e.key.toLowerCase() === 'u',
      run: () => {
        if (bidRound.player) markUnsold();
      },
    },
    {
      label: 'R',
      desc: 'Back to pool',
      test: e => e.key.toLowerCase() === 'r',
      run: () => {
        if (bidRound.player) backToPool();
      },
    },
    {
      label: 'T',
      desc: 'Pause / resume the bid timer',
      test: e => e.key.toLowerCase() === 't',
      run: () => toggleBidTimer(),
      when: () => EV.bidding.timer > 0,
    },
    {
      label: '+',
      desc: 'Add 10 seconds to the bid timer',
      test: e => e.key === '+' || e.key === '=',
      run: () => addBidTime(10),
      when: () => EV.bidding.timer > 0,
    },
  ],
  draw: [
    {
      label: 'Space',
      desc: () => (EV.random.reveal === 'live' ? 'Reveal the next player (press again to skip)' : 'Deal everyone'),
      test: e => e.key === ' ',
      run: () => (EV.random.reveal === 'live' ? allocReveal() : allocDealRest(true)),
    },
  ],
  selection: [],
  common: [
    { label: 'B', desc: 'Break screen', test: e => e.key.toLowerCase() === 'b', run: () => openBreak() },
    { label: 'P', desc: 'Projector window', test: e => e.key.toLowerCase() === 'p', run: () => openProjector() },
    { label: 'S', desc: 'Sound on / off', test: e => e.key.toLowerCase() === 's', run: () => cycleSound() },
    {
      label: 'Ctrl / ⌘ + Z',
      desc: 'Undo last action',
      mod: true,
      test: e => (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z',
      run: () => undoLast(),
    },
    { label: 'Esc', desc: 'Close the open panel', test: e => e.key === 'Escape', run: () => closeOverlays() },
    { label: '?', desc: 'This list', test: e => e.key === '?', run: () => showShortcuts() },
  ],
};
function currentScreen() {
  if (document.getElementById('allocScreen').style.display === 'flex') return 'draw';
  if (document.getElementById('appScreen').style.display !== 'none') return 'auction';
  if (document.getElementById('selectionScreen').classList.contains('open')) return 'selection';
  return '';
}
const activeKeys = () => [...(KEYMAPS[currentScreen()] || []), ...KEYMAPS.common].filter(k => !k.when || k.when());
const overlayOpen = () =>
  ['shortcutsOverlay', 'rosterModal', 'bhOverlay', 'breakOverlay', 'dlgOverlay'].some(id =>
    document.getElementById(id)?.classList.contains('open'),
  ) ||
  document.getElementById('adminOverlay').style.display === 'flex' ||
  document.getElementById('exportOverlay').style.display === 'flex';

function showShortcuts() {
  document.getElementById('shortcutsBody').innerHTML = activeKeys()
    .map(k => `<div class="kb-row"><kbd>${k.label}</kbd><span>${typeof k.desc === 'function' ? k.desc() : k.desc}</span></div>`)
    .join('');
  document.getElementById('shortcutsOverlay').classList.add('open');
}
function closeOverlays() {
  closeMenus();
  ['shortcutsOverlay', 'rosterModal', 'bhOverlay'].forEach(id => document.getElementById(id)?.classList.remove('open'));
  if (document.getElementById('breakOverlay').classList.contains('open')) closeBreak();
  closeAdmin();
  closeExport();
}
document.addEventListener('keydown', e => {
  if (!teams.length || !currentScreen()) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  const key = activeKeys().find(k => k.test(e));
  if (!key) return;
  if (key.label === 'Esc') {
    if (!document.getElementById('dlgOverlay')?.classList.contains('open')) closeOverlays();
    return;
  }
  if (typing) return;
  if (!key.mod && (e.ctrlKey || e.metaKey || e.altKey)) return;
  if (overlayOpen() && key.label !== '?' && !(key.label === 'B' && document.getElementById('breakOverlay').classList.contains('open')))
    return;
  e.preventDefault();
  key.run(e);
});

// ── Going once, going twice ──
// A short countdown before the sale; any bid (or pressing it again) stops it.
let _going = null; // { step: 1 | 2, timer }
function goingOnce() {
  if (_going) {
    cancelGoing('Stopped');
    return;
  }
  if (!bidRound.player) return;
  if (bidRound.leaderId === null) {
    showToast('No bids yet');
    return;
  }
  _going = { step: 1, timer: null };
  renderGoing();
  _going.timer = setTimeout(() => {
    if (!_going) return;
    _going.step = 2;
    renderGoing();
    _going.timer = setTimeout(() => {
      if (!_going) return;
      _going = null;
      renderGoing();
      declareWinner();
    }, 1500);
  }, 1500);
}
function cancelGoing(msg) {
  if (!_going) return;
  clearTimeout(_going.timer);
  _going = null;
  renderGoing();
  if (msg) showToast(msg);
}
function renderGoing() {
  const el = document.getElementById('goingBanner'),
    btn = document.getElementById('goingBtn');
  if (el) {
    el.textContent = _going ? (_going.step === 1 ? 'GOING ONCE…' : 'GOING TWICE…') : '';
    el.classList.toggle('show', !!_going);
  }
  if (btn) btn.textContent = _going ? '✋ Stop' : '🔨 Going once';
  if (typeof projectorTick === 'function') projectorTick();
}

// ── Click actions ──
// Buttons say what they do with data-action="functionName" and optional data-args='[json]';
// data-el passes the clicked element as the last argument. data-backdrop="fn" on an overlay
// runs fn when the backdrop itself (not its contents) is clicked. No inline onclick handlers.
document.addEventListener('click', e => {
  const bd = e.target.dataset && e.target.dataset.backdrop;
  if (bd && typeof window[bd] === 'function') {
    window[bd]();
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = window[el.dataset.action];
  if (typeof fn !== 'function') {
    console.warn('No action', el.dataset.action);
    return;
  }
  let args = [];
  if (el.dataset.args) {
    try {
      args = JSON.parse(el.dataset.args);
    } catch (err) {
      console.warn('Bad data-args', el.dataset.args);
    }
  }
  if (el.hasAttribute('data-el')) args.push(el);
  fn(...args);
});
function clickEl(id) {
  document.getElementById(id)?.click();
}
function closeShortcuts() {
  document.getElementById('shortcutsOverlay').classList.remove('open');
}

// ── Header menus ──
function closeMenus() {
  document.querySelectorAll('.menu.open').forEach(x => {
    x.classList.remove('open');
    x.firstElementChild.setAttribute('aria-expanded', 'false');
  });
}
function toggleMenu(btn) {
  const m = btn.parentElement,
    open = !m.classList.contains('open');
  closeMenus();
  if (open) {
    m.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    const f = m.querySelector('.menu-pop button');
    if (f) f.focus({ preventScroll: true });
  }
}
document.addEventListener('click', e => {
  if (!e.target.closest('.menu') || e.target.closest('.menu-pop button')) closeMenus();
});

// ── Boot ──
// Every screen refresh doubles as an autosave trigger (debounced)
['renderTeamsBar', 'renderPlayersList', 'selRenderAll', 'renderLog', 'updateStats'].forEach(n => {
  const f = window[n];
  window[n] = function (...a) {
    const r = f.apply(this, a);
    autosave();
    return r;
  };
});
initSetup();
renderSoundBtn();
hydrateIcons();
watchOverlays();
renderResumeBanner();
renderUndoBtn();
