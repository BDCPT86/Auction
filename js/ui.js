/*
 * Draft Day: shared UI helpers
 * ----------------------------
 * Loaded first. Small pieces every screen uses:
 *  - html``     a template tag that escapes every value, so names can't break the markup
 *  - askConfirm / askText   in-app dialogs (the browser's own confirm/prompt freeze the whole
 *                           page, including timers and the projector, while they're open)
 *  - icon()     the bundled line icons
 */

// ── Escaped HTML templates ──
// html`<b>${name}</b>` escapes `name`. Wrap trusted markup in raw() to pass it through,
// and arrays are joined (each item escaped unless it's raw).
const _RAW = Symbol('raw');
function raw(s) {
  const v = String(s ?? '');
  const r = new String(v);
  r[_RAW] = true;
  r.s = v;
  return r;
}
function escHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
// The result is a String object marked as safe, so it can go straight into innerHTML or a
// template literal, and nesting html`` inside html`` doesn't escape twice.
function html(strings, ...vals) {
  const part = v => (v && v[_RAW] ? v.s : Array.isArray(v) ? v.map(part).join('') : escHtml(v));
  const out = strings.reduce((acc, s, i) => acc + s + (i < vals.length ? part(vals[i]) : ''), '');
  const r = new String(out);
  r[_RAW] = true;
  r.s = out;
  return r;
}

// D7: the visitor's "reduce motion" setting. Spins and reveals get short, confetti is skipped
const reduceMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

// ── Dialogs ──
// await askConfirm('Remove X?')            → true / false
// await askText('Name?', 'default')        → text, or null if cancelled ({ multiline: true } for a big box)
// await askForm('Edit player', [fields])   → { key: value }, or null. Field: { key, label, value, type: 'text'|'select', options: [[value, label]] }
// Enter confirms (Ctrl+Enter in a big box), Esc cancels. Automated tests can set window.DLG_AUTO = true
// to accept at once, and queue answers in window.DLG_ANSWERS.
function _dialog({
  message,
  okLabel = 'OK',
  cancelLabel = 'Cancel',
  danger = false,
  input = null,
  multiline = false,
  fields = null,
  hint = '',
}) {
  if (window.DLG_AUTO) {
    const ans = (window.DLG_ANSWERS || []).length ? window.DLG_ANSWERS.shift() : undefined;
    if (fields) return Promise.resolve(ans !== undefined ? ans : Object.fromEntries(fields.map(f => [f.key, f.value ?? ''])));
    return Promise.resolve(input === null ? (ans === undefined ? true : !!ans) : ans === undefined ? input : String(ans));
  }
  return new Promise(resolve => {
    let ov = document.getElementById('dlgOverlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'dlgOverlay';
      ov.className = 'dlg-overlay';
      document.body.appendChild(ov);
    }
    const fieldHtml = f =>
      `<label class="dlg-field"><span>${escHtml(f.label)}</span>${
        f.type === 'select'
          ? `<select data-key="${escHtml(f.key)}" class="dlg-input">${(f.options || []).map(([v, l]) => `<option value="${escHtml(v)}" ${String(v) === String(f.value ?? '') ? 'selected' : ''}>${escHtml(l)}</option>`).join('')}</select>`
          : `<input data-key="${escHtml(f.key)}" class="dlg-input" type="text" value="${escHtml(f.value ?? '')}" autocomplete="off"/>`
      }</label>`;
    ov.innerHTML = `<div class="dlg${multiline ? ' dlg-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="dlgMsg">
      <p id="dlgMsg" class="dlg-msg"></p>
      ${hint ? `<p class="dlg-hint">${escHtml(hint)}</p>` : ''}
      ${
        fields
          ? fields.map(fieldHtml).join('')
          : input === null
            ? ''
            : multiline
              ? '<textarea id="dlgInput" class="dlg-input dlg-area" rows="9" spellcheck="false"></textarea>'
              : '<input id="dlgInput" class="dlg-input" type="text" autocomplete="off"/>'
      }
      <div class="dlg-btns"><button type="button" id="dlgCancel" class="dlg-btn"></button><button type="button" id="dlgOk" class="dlg-btn dlg-ok"></button></div>
    </div>`;
    const msg = ov.querySelector('#dlgMsg'),
      inp = ov.querySelector('#dlgInput');
    const ok = ov.querySelector('#dlgOk'),
      cancel = ov.querySelector('#dlgCancel');
    const prevFocus = document.activeElement;
    msg.textContent = message;
    ok.textContent = okLabel;
    cancel.textContent = cancelLabel;
    ok.classList.toggle('danger', danger);
    if (inp) inp.value = input ?? '';
    const result = () =>
      fields
        ? Object.fromEntries([...ov.querySelectorAll('[data-key]')].map(el => [el.dataset.key, el.value]))
        : input === null
          ? true
          : inp.value;
    const done = val => {
      ov.classList.remove('open');
      ok.onclick = cancel.onclick = ov.onkeydown = ov.onclick = null;
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(val);
    };
    ok.onclick = () => done(result());
    cancel.onclick = () => done(input === null && !fields ? false : null);
    ov.onclick = e => {
      if (e.target === ov) cancel.onclick();
    };
    ov.onkeydown = e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancel.onclick();
      } else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        ok.onclick();
      } else e.stopPropagation(); // typing here never triggers the app's shortcuts
    };
    ov.classList.add('open');
    setTimeout(() => {
      const f = ov.querySelector('[data-key], #dlgInput') || ok;
      f.focus();
      if (f.select) f.select();
    }, 0);
  });
}
const askConfirm = (message, opts = {}) => _dialog({ message, ...opts });
const askText = (message, value = '', opts = {}) => _dialog({ message, input: String(value), okLabel: 'Save', ...opts });
const askForm = (message, fields, opts = {}) => _dialog({ message, fields, okLabel: 'Save', ...opts });

// ── Icons ──
// Simple 24×24 line icons (drawn for Draft Day), used as icon('undo').
const ICONS = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  rosters: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  projector: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  break: '<path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 2v3M12 2v3"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8M7 21v-7h10v7"/>',
  open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  card: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 7h6M9 17h6"/><circle cx="12" cy="12" r="2"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  reset: '<path d="M3 12a9 9 0 1 0 9-9 9.7 9.7 0 0 0-6.7 2.7L3 8"/><path d="M3 3v5h5"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  sound: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  mute: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 6 6M22 9l-6 6"/>',
  hammer: '<path d="m14 13-8.5 8.5a2.1 2.1 0 0 1-3-3L11 10"/><path d="m16 16 6-6M8 8l6-6M9 7l8 8"/>',
  paste:
    '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
};
function icon(name, label) {
  const p = ICONS[name];
  if (!p) return '';
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${label ? `role="img" aria-label="${escHtml(label)}"` : 'aria-hidden="true"'}>${p}</svg>`;
}
// Static markup can ask for an icon with <i data-icon="undo"></i>; this fills them in.
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]:empty').forEach(el => {
    el.outerHTML = icon(el.dataset.icon);
  });
}

// ── U8: accessibility helpers ──
// Icon-only buttons (✕, ▲, ⏸…) get their title as an accessible name, wherever they're rendered.
function labelIconButtons(root) {
  (root || document).querySelectorAll('button:not([aria-label])[title]').forEach(b => {
    if (!/[A-Za-z0-9]{2}/.test(b.textContent)) b.setAttribute('aria-label', b.title);
  });
}
// Overlays: focus moves in when one opens, and back to where it was when it closes.
const A11Y_OVERLAYS = ['rosterModal', 'exportOverlay', 'breakOverlay', 'shortcutsOverlay', 'bhOverlay', 'adminOverlay'];
const _overlayFocus = {};
const overlayShown = el =>
  getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && !el.classList.contains('hidden');
function watchOverlays() {
  A11Y_OVERLAYS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    let was = overlayShown(el);
    new MutationObserver(() => {
      const now = overlayShown(el);
      if (now === was) return;
      was = now;
      if (now) {
        _overlayFocus[id] = document.activeElement;
        const f = el.querySelector('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (f) setTimeout(() => f.focus({ preventScroll: true }), 30);
      } else if (_overlayFocus[id] && document.contains(_overlayFocus[id])) _overlayFocus[id].focus({ preventScroll: true });
    }).observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
  });
  let t = 0;
  new MutationObserver(() => {
    clearTimeout(t);
    t = setTimeout(() => labelIconButtons(), 60);
  }).observe(document.body, { childList: true, subtree: true });
  labelIconButtons();
}

// ── Toasts and confetti ──
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
