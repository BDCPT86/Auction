/*
 * Draft Day: Keyboard and clicks
 * ------------------------------
 * The keyboard shortcuts (one keymap per screen), the data-action click handler and the header menus.
 */

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
