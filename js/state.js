/*
 * Draft Day: Saving, undo and the change path
 * -------------------------------------------
 * Save files and their migrations, autosave and resume, undo, the resets, and commit():
 * the one path every change goes through (snapshot, change, redraw, autosave, projector).
 */

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
    runId,
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
  // Saves from before player history get a run id from when they were saved
  runId = s.runId || (s.savedAt ? 'r' + Date.parse(s.savedAt).toString(36) : runId);
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
  document.title = EV.name + ({ random: ' — Draw', draft: ' — Draft' }[EV.format] || ' — Player Auction');
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
  histRecord();
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
// ── K2: one path for every change ──
// commit(label, change): take the undo snapshot (when there's a label), make the change, then refresh().
// refresh(): redraw whatever is on screen, autosave, and bring the projector up to date.
// Every action goes through here, so nothing needs to patch render functions or poll for changes.
function commit(label, change) {
  if (label) snap(label);
  const r = change ? change() : undefined;
  refresh();
  return r;
}
function refresh() {
  if (!teams.length) return;
  if (selOpen()) selRenderAll();
  if (auctionOpen()) {
    renderTeamsBar();
    renderPlayersList();
    renderLog();
    updateStats();
    if (!spinning) drawWheel();
    renderBidPanel();
  }
  if (allocOpen()) renderAlloc();
  refreshRosterModal();
  renderUndoBtn();
  autosave();
  projectorTick();
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
  if (!selOpen()) {
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
    } else dismissWinner();
  }
  refresh();
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
  commit('undo all sales', () => {
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
  });
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
  runId = '';
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
