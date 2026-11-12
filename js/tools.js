/*
 * Draft Day: Tools for the night
 * ------------------------------
 * The bid timer, the break screen and "going once, going twice".
 */

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
  projectorTick();
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
  projectorTick();
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
  projectorTick();
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
  projectorTick();
}
