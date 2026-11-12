/*
 * Draft Day: The auction
 * ----------------------
 * The teams strip, the player pool, bringing a player up, the bidding round,
 * selling, the unsold queue and round, and the Signed list.
 */

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
  restoreSidebar();
  refresh();
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

// D2: the player list can fold away to give the player card and bid rows the whole width
const SIDE_KEY = 'draftday.sidebar.v1';
function setSidebar(collapsed) {
  document.getElementById('appScreen').classList.toggle('side-collapsed', collapsed);
  const b = document.getElementById('sideToggle');
  if (b) {
    b.setAttribute('aria-expanded', String(!collapsed));
    b.title = collapsed ? 'Show the player list (L)' : 'Hide the player list (L)';
    b.setAttribute('aria-label', b.title);
  }
  try {
    localStorage.setItem(SIDE_KEY, collapsed ? '1' : '0');
  } catch (e) {}
  if (!spinning) drawWheel();
}
function toggleSidebar() {
  setSidebar(!document.getElementById('appScreen').classList.contains('side-collapsed'));
}
function restoreSidebar() {
  let c = false;
  try {
    c = localStorage.getItem(SIDE_KEY) === '1';
  } catch (e) {}
  setSidebar(c);
}

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
  return loadRowsInto(players, text, poolMake, () => commit(), quiet);
}

// U5: paste a list straight from a spreadsheet or a message
const PASTE_HINT = 'One player per line: Name, Price, Tier. Price and tier are optional. Columns copied from a spreadsheet work too.';
async function pastePlayers(where) {
  const text = await askText('Paste players', '', { multiline: true, okLabel: 'Add players', hint: PASTE_HINT });
  if (!text || !text.trim()) return;
  if (where === 'round') loadRoundText(selRoundIdx, text);
  else {
    loadPoolText(text);
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
  commit(`edited ${p.name}`, () => {
    p.name = name;
    p.price = price;
    if (r.tier !== undefined) p.tier = normTier(r.tier);
  });
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
  commit(`added ${name}`, () => players.push(setStatus({ id: nextId(), name, price, tier, teamId: null }, 'pool')));
  nE.value = '';
  pE.value = '';
  tE.value = '';
  nE.focus();
}

function removePlayer(id) {
  const p = players.find(x => x.id === id);
  if (!p) return;
  commit(`removed ${p.name}`, () => (players = players.filter(x => x.id !== id)));
}

function renderPlayersList() {
  const el = document.getElementById('playersList');
  const captainNames = getCaptainNames();
  const active = activePool();
  document.getElementById('playerBadge').textContent = players.length;
  const sc = document.getElementById('sideCount');
  if (sc) sc.textContent = active.length;
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
      return `<div class="player-row${isSold ? ' sold' : ''}${queued && !(auctionPhase === 'unsold' && !p.unsoldFinal) ? ' queued' : ''}" id="pr-${p.id}"${pastLine(p.name) ? ` title="Last time · ${esc(pastLine(p.name))}"` : ''}>
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
  function save() {
    if (committed) return;
    committed = true;
    const val = parseMoney(inp.value);
    if (!isNaN(val) && val >= 0 && val !== p.price) commit(`price of ${p.name}`, () => (p.price = val));
    else renderPlayersList();
  }
  inp.addEventListener('blur', save);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
    if (e.key === 'Escape') {
      committed = true;
      renderPlayersList();
    }
  });
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
  commit(`${p.name} unsold`, () => {
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
  });
}
// Put the player back without marking them unsold (wrong player came up, etc.)
function backToPool() {
  commit(bidRound.player && `${bidRound.player.name} back to pool`, () => dismissWinner());
}
function returnFromQueue(id) {
  const p = players.find(x => x.id === id);
  if (!p) return;
  commit(`${p.name} back from the queue`, () => setStatus(p, 'pool'));
  showToast(`${p.name} is back in the pool`);
}
function startUnsoldRound() {
  const q = unsoldQueue();
  if (!q.length) return;
  commit('start of the unsold round', () => (auctionPhase = 'unsold'));
  const n = teamsThatCanBuy(q).length;
  showToast(
    `Unsold round: ${q.length} player${q.length !== 1 ? 's' : ''}, ${EV.unsold.discount}% off · ${n} team${n !== 1 ? 's' : ''} can bid`,
  );
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
  projectorTick();
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

  // N8: what happened to this player at the last event
  const past = pastLine(player.name),
    pe = document.getElementById('winnerPast');
  pe.hidden = !past;
  pe.textContent = past ? 'Last time · ' + past : '';

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
  document.getElementById('appScreen').classList.add('bidding');
  document.getElementById('spinBtn').disabled = true;
  setTimeout(() => p.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);

  startBidTimer();
  refresh();
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

      // D2: each row carries what the team strip showed (purse bar and squad), so the strip can hide while bidding
      return `<div class="${rowClass}" id="tbr-${t.id}" style="--tc:${t.color}">
      ${isLeader || (!hasPassed && !blocked) ? '<div class="tbr-turn-indicator"></div>' : ''}
      <img src="${t.logo}" class="team-logo-sm shrink-0" alt=""/>
      <div class="tbr-logo-name">
        <div class="min-w-0 flex-1">
          <div class="tbr-name-row"><span class="tbr-name">${esc(t.name)}</span><span class="tbr-squad" title="Squad">${squadIcons(t)} ${squadText(t)}</span></div>
          ${statusHtml}
          <div class="tbr-bar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>
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

  commit(`${team.name} bid ${zarS(amount)}`, () => {
    clearBidError();
    bidRound.bids.push({ teamId, amount, timestamp: new Date(), isNewHigh: true });
    bidRound.leaderId = teamId;
    bidRound.leaderBid = amount;
    if (EV.bidding.timer > 0 && EV.bidding.timerResetsOnBid) startBidTimer();
  });
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
  commit(`${(teams.find(t => t.id === teamId) || {}).name} passed`, () => {
    bidRound.passed.add(teamId);
    bidRound.bids.push({ teamId, amount: null, timestamp: new Date(), isPast: true });
    // The leader passing gives up the lead only if nobody else is left — they stay the high bid
    clearBidError();
  });

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

// Everything in the bidding panel that changes with a bid or a pass
function renderBidPanel() {
  if (!bidRound.player) return;
  document.getElementById('declareWinnerBtn').disabled = bidRound.leaderId === null;
  renderBidRoundTeams();
  renderBidTrail();
  updateLeaderDisplay();
  renderBidRoundTitle();
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
    <div class="bid-round-leader-name" style="color:${teamInk(team.color)}">${esc(team.name)}</div>
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
  const team = teams.find(t => t.id === bidRound.leaderId);
  const finalPrice = bidRound.leaderBid;
  commit(`sale of ${player.name}`, () => {
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

    dismissWinner();
    currentPlayer = null;
  });
  showToast(`🏆 ${player.name} → ${team.name} for ${zarFmt(finalPrice)}`);
  setTimeout(projectorTick, 8100); // the projector's SOLD! screen times out
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
  document.getElementById('appScreen').classList.remove('bidding');
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
