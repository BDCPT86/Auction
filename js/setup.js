// ═══════════════════════════════════════════════════════════════════════════
//  Draft Day — event configuration, presets and the setup wizard
//  Loaded before the auction scripts. Everything the auction needs to know about the event
//  lives in EV (the "event"), built from event.config.js and the wizard.
// ═══════════════════════════════════════════════════════════════════════════

const esc = s =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const clone = o => JSON.parse(JSON.stringify(o));

// ── Colours ─────────────────────────────────────────────────────────────────
const COLORS = [
  '#00c8ff',
  '#f5b800',
  '#00e87a',
  '#ff4050',
  '#b060ff',
  '#ff8030',
  '#ff5fa2',
  '#5f8bff',
  '#c8e000',
  '#00d4b4',
  '#e07a5f',
  '#9aa5b1',
];
function hslHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = n => (n + h / 30) % 12,
    a = s * Math.min(l, 1 - l);
  const f = n =>
    Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))))
      .toString(16)
      .padStart(2, '0');
  return '#' + f(0) + f(8) + f(4);
}
// A distinct colour for team slot i (palette first, then golden-angle hues)
const autoColor = i => (i < COLORS.length ? COLORS[i] : hslHex((i * 137.5) % 360, 75, 58));
const hexRgb = hex => {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#888888';
  return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
};
const rgba = (hex, a) => `rgba(${hexRgb(hex).join(',')},${a})`;
const mix = (hex, toward, amt) => {
  const a = hexRgb(hex),
    b = hexRgb(toward);
  return (
    '#' +
    a
      .map((v, i) =>
        Math.round(v + (b[i] - v) * amt)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
};
// Relative luminance 0 (black) – 1 (white)
const colorLum = hex => {
  const [r, g, b] = hexRgb(hex).map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
// D4: a colour dark enough to read as text on a light surface (at least ~4.5:1 on white)
function inkOn(hex) {
  let c = hex,
    k = 0;
  while (colorLum(c) > 0.18 && k < 12) {
    c = mix(hex, '#000000', ++k * 0.07);
  }
  return c;
}
// …and the same on a dark surface (light enough to read on near-black)
function inkOnDark(hex) {
  let c = hex,
    k = 0;
  while (colorLum(c) < 0.32 && k < 12) {
    c = mix(hex, '#ffffff', ++k * 0.07);
  }
  return c;
}
const isDarkTheme = () => document.documentElement.dataset.theme === 'dark';
// Team and tier colours used as text on screen, readable in either theme
const teamInk = hex => (isDarkTheme() ? inkOnDark(hex) : inkOn(hex));
const isLight = hex => {
  const [r, g, b] = hexRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
};

// ── Event model ─────────────────────────────────────────────────────────────
const DRAW_MODES = {
  wheel: { label: 'Spin the wheel', button: 'SPIN THE WHEEL', desc: 'A wheel of every unsold player picks who is next.' },
  random: { label: 'Random draw', button: 'DRAW A PLAYER', desc: 'A quick shuffle picks a random unsold player. No wheel.' },
  order: { label: 'In list order', button: 'NEXT PLAYER', desc: 'Players come up in the order of your CSV or list.' },
  manual: { label: 'Auctioneer picks', button: 'PICK FROM THE LIST', desc: 'Press ▶ next to any player in the list to put them up.' },
};
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const str = (v, d) => (typeof v === 'string' ? v : d);
const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : d);

// Fill gaps and fix types so the rest of the app can trust EV
function normalizeEvent(src) {
  src = src || {};
  const b = src.bidding || {},
    br = src.branding || {},
    u = src.unsold || {},
    ra = src.random || {},
    dr = src.draft || {},
    sp = br.sponsor || {};
  const teams = (Array.isArray(src.teams) ? src.teams : []).map((t, i) => ({
    name: str(t && t.name, 'Team ' + (i + 1)),
    captain: str(t && t.captain, ''),
    color: hex(t && t.color, autoColor(i)),
    logo: str(t && t.logo, '').trim(),
  }));
  return {
    name: str(src.name, 'Draft Day'),
    format: ['random', 'draft'].includes(src.format) ? src.format : 'auction', // 'auction' | 'random' (draw, no bidding) | 'draft' (captains pick in turn)
    draft: { order: dr.order === 'straight' ? 'straight' : 'snake' },
    random: {
      balance: bool(ra.balance, true), // deal one tier at a time so every team gets the same mix
      reveal: ra.reveal === 'instant' ? 'instant' : 'live', // live: one player at a time · instant: deal everyone at once
      teamPick: ['spin', 'flip', 'straight'].includes(ra.teamPick) ? ra.teamPick : 'spin',
    },
    currency: str(src.currency, 'R'),
    budget: Math.max(0, num(src.budget, 10000000)),
    squadSize: Math.max(0, Math.round(num(src.squadSize, 5))),
    captains: bool(src.captains, true),
    draw: DRAW_MODES[src.draw] ? src.draw : 'wheel',
    wheelIcon: str(src.wheelIcon, '🏏'),
    spin: ['quick', 'normal', 'dramatic'].includes(src.spin) ? src.spin : 'normal',
    teams,
    rounds: (Array.isArray(src.rounds) ? src.rounds : []).map((r, i) => ({
      name: str(r && r.name, 'Round ' + (i + 1)),
      picks: Math.max(1, Math.round(num(r && r.picks, 1))),
      order: (r && r.order) === 'straight' ? 'straight' : 'snake',
      cost: (r && r.cost) === 'price' ? 'price' : 'free',
      countsTowardSquad: bool(r && r.countsTowardSquad, false),
      countsTowardTiers: bool(r && r.countsTowardTiers, true),
    })),
    tiers: (Array.isArray(src.tiers) ? src.tiers : []).map((t, i) => ({
      name: str(t && t.name, 'Tier ' + (i + 1)),
      color: hex(t && t.color, autoColor(i + 3)),
      minBid: Math.max(0, num(t && t.minBid, 0)),
      limit: Math.max(0, Math.round(num(t && t.limit, 0))),
    })),
    bidding: {
      increment: Math.max(1, num(b.increment, 10000)),
      enforceIncrement: bool(b.enforceIncrement, true),
      prefill: bool(b.prefill, true),
      timer: Math.max(0, Math.round(num(b.timer, 0))),
      timerResetsOnBid: bool(b.timerResetsOnBid, true),
      autoSell: bool(b.autoSell, false),
      reserve: bool(b.reserve, true),
      inThousands: bool(b.inThousands, false),
    },
    unsold: {
      enabled: bool(u.enabled, true),
      discount: Math.max(0, Math.min(90, Math.round(num(u.discount, 50)))),
    },
    branding: {
      exportTitle: str(br.exportTitle, str(src.name, 'Draft Day').toUpperCase()),
      exportSubtitle: str(br.exportSubtitle, 'OFFICIAL TEAM ROSTERS'),
      hashtags: str(br.hashtags, ''),
      sponsor: { name: str(sp.name, ''), line: str(sp.line, 'Presented by'), logo: str(sp.logo, '').trim() },
    },
  };
}

const isDraft = () => EV.format === 'draft';
const noMoney = () => EV.format !== 'auction'; // random draws and drafts have no budgets or prices
// The rounds that run on the pick screen: pre-auction rounds, then the draft itself in a captains' draft
function allRounds() {
  if (!isDraft()) return EV.rounds;
  return [
    ...EV.rounds,
    {
      name: 'Draft',
      picks: Math.max(1, EV.squadSize || 1),
      order: EV.draft.order,
      cost: 'free',
      countsTowardSquad: true,
      countsTowardTiers: true,
      isDraft: true,
    },
  ];
}

// Older setups only had teams.config.js; still honour it if it is loaded
const FILE_EVENT = normalizeEvent(window.DRAFT_DAY_EVENT || (window.DRAFT_DAY_TEAMS ? { teams: window.DRAFT_DAY_TEAMS } : {}));
const FILE_SIG = JSON.stringify(FILE_EVENT);
const WORK_KEY = 'draftday.working.v2',
  PRESETS_KEY = 'draftday.presets.v1';

function storeGet(k) {
  try {
    return JSON.parse(localStorage.getItem(k) || 'null');
  } catch (e) {
    return null;
  }
}
function storeSet(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch (e) {
    return false;
  }
}

// The working copy: what the wizard is editing. Dropped when event.config.js changes.
function loadWorking() {
  const w = storeGet(WORK_KEY);
  if (w && w.sig === FILE_SIG && w.event) return { ev: normalizeEvent(w.event), preset: w.preset || '' };
  return { ev: clone(FILE_EVENT), preset: '' };
}
let _work = loadWorking();
let EV = _work.ev; // the event — read everywhere
let currentPreset = _work.preset; // name of the preset last applied/saved ('' = from file / unsaved)
let _saveT;
const flushWorking = () => {
  clearTimeout(_saveT);
  _saveT = null;
  storeSet(WORK_KEY, { sig: FILE_SIG, event: EV, preset: currentPreset });
};
function saveWorking() {
  clearTimeout(_saveT);
  _saveT = setTimeout(flushWorking, 250);
}
window.addEventListener('pagehide', () => {
  if (_saveT) flushWorking();
});

// ── Formatting (uses the event's currency) ──────────────────────────────────
const fmtNum = v => Number(v || 0).toLocaleString('en-ZA', { maximumFractionDigits: 0 });
const zarFmt = v => EV.currency + ' ' + fmtNum(v);
const zarS = v => {
  v = Number(v) || 0;
  const c = EV.currency,
    a = Math.abs(v),
    s = v < 0 ? '-' : '';
  return a >= 1e6 ? s + c + (a / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : a >= 1000 ? s + c + Math.round(a / 1000) + 'K' : s + c + a;
};
// Amounts from CSVs and forms: "R 250 000", "250,000", "250k", "1.2m"
function parseMoney(s) {
  const t = String(s ?? '')
    .toLowerCase()
    .replace(/[^0-9.km-]/g, '');
  const m = t.match(/^(-?[0-9]*\.?[0-9]+)([km])?$/);
  if (m) return Math.round(parseFloat(m[1]) * (m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1));
  return parseFloat(t.replace(/[km]/g, ''));
}
// Bid boxes: "350k", "1.2m", "350 000"; in thousands mode a bare "350" means 350 000
function parseAmount(s) {
  const t = String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u00a0,]/g, '');
  const m = t.match(/^(-?[0-9]*\.?[0-9]+)\s*([km]?)$/);
  if (!m) return parseMoney(t);
  const n = parseFloat(m[1]);
  return Math.round(m[2] === 'm' ? n * 1e6 : m[2] === 'k' ? n * 1e3 : EV.bidding.inThousands ? n * 1e3 : n);
}
const fmtBid = v => (EV.bidding.inThousands ? String(+(v / 1000).toFixed(3)) : fmtNum(v));
// Live grouping while typing digits (leaves k/m shortcuts alone)
function liveFormat(el) {
  if (EV.bidding.inThousands || /[a-z.]/i.test(el.value)) return;
  const digits = el.value.replace(/\D/g, '');
  el.value = digits ? fmtNum(+digits) : '';
}
const slugify = s =>
  String(s || 'event')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'event';

// ── Tiers ───────────────────────────────────────────────────────────────────
const tierSlug = name => 't-' + slugify(name);
const tierDef = name => (name ? EV.tiers.find(t => t.name.toLowerCase() === String(name).trim().toLowerCase()) : null);
const normTier = s => (tierDef(s) || {}).name || '';
const tierIndex = name => {
  const i = EV.tiers.findIndex(t => t.name.toLowerCase() === String(name || '').toLowerCase());
  return i < 0 ? 99 : i;
};
const tierMin = name => (tierDef(name) || {}).minBid || 0;
const tierLimit = name => (tierDef(name) || {}).limit || 0;
const tierColor = name => (tierDef(name) || {}).color || '#8899aa';
const tierPill = name => (tierDef(name) ? `<span class="tier-pill tp-${tierSlug(name)}">${esc(tierDef(name).name)}</span>` : '');
const tierClass = name => (tierDef(name) ? 'tier-' + tierSlug(name) : '');

// Tier colours are data, so their CSS is generated
function applyTierStyles() {
  let el = document.getElementById('tierStyles');
  if (!el) {
    el = document.createElement('style');
    el.id = 'tierStyles';
    document.head.appendChild(el);
  }
  el.textContent = EV.tiers
    .map(t => {
      const s = tierSlug(t.name),
        c = t.color,
        hi = mix(c, '#ffffff', 0.35),
        lo = mix(c, '#000000', 0.25);
      const ink = isLight(mix(c, '#ffffff', 0.15)) ? mix(c, '#000000', 0.8) : '#ffffff';
      return (
        `.tp-${s}{background:${rgba(c, 0.14)};color:${inkOn(c)};border:1px solid ${rgba(c, 0.45)}}` +
        `:root[data-theme='dark'] .tp-${s}{background:${rgba(c, 0.18)};color:${inkOnDark(c)};border-color:${rgba(c, 0.5)}}` +
        `.tier-${s}{background:linear-gradient(135deg,${hi},${c});color:${ink};border:1px solid ${lo}}` +
        `.tier-banner.tier-${s}{background:linear-gradient(135deg,${hi},${c});color:${ink};border:1px solid ${lo};box-shadow:0 0 20px ${rgba(c, 0.3)}}`
      );
    })
    .join('\n');
}

// ── Logos ───────────────────────────────────────────────────────────────────
function initialsBadge(name, color) {
  const initials =
    (name || '?')
      .replace(/[^A-Za-z0-9 ]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(w => w && !/^(the|and|of)$/i.test(w))
      .slice(0, 2)
      .map(w => w[0].toUpperCase())
      .join('') || '?';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#111"/>` +
    `<circle cx="32" cy="32" r="29" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="3"/>` +
    `<text x="32" y="34" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-weight="700" font-size="24" fill="${color}">${initials}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
const brokenLogos = new Set();
function checkLogos() {
  const paths = [...new Set(EV.teams.map(c => c.logo).filter(l => l && !l.startsWith('data:') && !brokenLogos.has(l)))];
  paths.forEach(src => {
    const img = new Image();
    img.onerror = () => {
      brokenLogos.add(src);
      console.warn('Team logo not found:', src);
      if (!teams.length) renderWizard();
      teams.forEach(t => {
        if (t.logo === src) t.logo = initialsBadge(t.name, t.color);
      });
      if (teams.length) renderTeamsBar();
    };
    img.src = src;
  });
}
const cfgName = i => (EV.teams[i].name || '').trim() || 'Team ' + (i + 1);
const cfgLogo = i => {
  const c = EV.teams[i];
  return c.logo && !brokenLogos.has(c.logo) ? c.logo : initialsBadge(cfgName(i), c.color);
};

// Captain names currently in play — captains never go on the wheel
function getCaptainNames() {
  const names = teams.length
    ? teams.flatMap(t => t.players.filter(p => p.isCaptain).map(p => p.name))
    : EV.captains
      ? EV.teams.map(c => c.captain)
      : [];
  return names.map(n => (n || '').trim().toLowerCase()).filter(Boolean);
}

// ── Presets ─────────────────────────────────────────────────────────────────
const FILE_PRESET = '__file__';
const loadPresets = () => storeGet(PRESETS_KEY) || {};
async function renderPresetBar() {
  const presets = loadPresets(),
    names = Object.keys(presets).sort((a, b) => a.localeCompare(b));
  const sel = document.getElementById('presetSelect');
  sel.innerHTML =
    `<option value="${FILE_PRESET}">event.config.js (default)</option>` +
    names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  sel.value = currentPreset && presets[currentPreset] ? currentPreset : FILE_PRESET;
  document.getElementById('presetDeleteBtn').disabled = !(currentPreset && presets[currentPreset]);
}
async function onPresetSelect(name) {
  const presets = loadPresets();
  const target = name === FILE_PRESET ? FILE_EVENT : presets[name];
  if (!target) return;
  if (
    !(await askConfirm(`Load "${name === FILE_PRESET ? 'event.config.js' : name}"? Unsaved changes in the wizard will be replaced.`, {
      okLabel: 'Load',
    }))
  ) {
    renderPresetBar();
    return;
  }
  EV = normalizeEvent(clone(target));
  currentPreset = name === FILE_PRESET ? '' : name;
  pickOrder = EV.teams.map((_, i) => i);
  afterEventChange();
  showToast('Loaded ' + (currentPreset || 'event.config.js'));
}
async function savePresetAs() {
  const name = ((await askText('Save these settings as a preset called:', currentPreset || EV.name)) || '').trim();
  if (!name) return;
  const presets = loadPresets();
  if (presets[name] && name !== currentPreset && !(await askConfirm(`Replace the existing preset "${name}"?`, { okLabel: 'Replace' })))
    return;
  presets[name] = clone(EV);
  if (!storeSet(PRESETS_KEY, presets)) {
    showToast('Could not save — browser storage is full or blocked. Use Export instead.');
    return;
  }
  currentPreset = name;
  flushWorking();
  renderPresetBar();
  showToast(`Saved preset "${name}"`);
}
async function deletePreset() {
  const presets = loadPresets();
  if (!currentPreset || !presets[currentPreset]) return;
  if (
    !(await askConfirm(`Delete the preset "${currentPreset}"? The settings in the wizard stay as they are.`, {
      okLabel: 'Delete',
      danger: true,
    }))
  )
    return;
  delete presets[currentPreset];
  storeSet(PRESETS_KEY, presets);
  currentPreset = '';
  saveWorking();
  renderPresetBar();
  showToast('Preset deleted');
}
function exportEventJSON() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(EV, null, 2)], { type: 'application/json' }));
  a.download = slugify(EV.name) + '-event.json';
  a.click();
  showToast('Event settings exported');
}
function importEventJSON(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      let data = JSON.parse(ev.target.result);
      if (data && data.event && data.version) data = data.event; // a save file also works
      EV = normalizeEvent(data);
      currentPreset = '';
      pickOrder = EV.teams.map((_, i) => i);
      afterEventChange();
      showToast(`Imported "${EV.name}" — Save as preset to keep it`);
    } catch (err) {
      showToast('That file is not an event JSON');
    }
  };
  r.readAsText(f);
}

// ── Wizard ──────────────────────────────────────────────────────────────────
const WIZ_ALL = [
  { id: 'format', label: 'Format' },
  { id: 'event', label: 'Event' },
  { id: 'teams', label: 'Teams' },
  { id: 'rounds', label: 'Pre-auction' },
  { id: 'tiers', label: 'Tiers' },
  { id: 'bidding', label: 'Bidding' },
  { id: 'review', label: 'Review' },
];
// Only an auction has bidding, so that step drops out for a draw or a draft
let WIZ_STEPS = WIZ_ALL;
const syncWizSteps = () => {
  WIZ_STEPS = WIZ_ALL.filter(s => !(s.id === 'bidding' && noMoney()));
};
const stageWord = () => ({ random: 'draw', draft: 'draft' })[EV.format] || 'auction';
const stepIdx = id => WIZ_STEPS.findIndex(s => s.id === id);
const stepLabel = s => (s.id === 'rounds' ? 'Pre-' + stageWord() : s.label);
let wizStep = 0;
let pickOrder = EV.teams.map((_, i) => i); // team slots, in pick order for pre-auction rounds

function afterEventChange() {
  syncPickOrder();
  applyTierStyles();
  saveWorking();
  renderPresetBar();
  renderWizard();
  checkLogos();
}
function syncPickOrder() {
  const n = EV.teams.length;
  pickOrder = pickOrder.filter(i => i < n);
  for (let i = 0; i < n; i++) if (!pickOrder.includes(i)) pickOrder.push(i);
}
function setEV(path, value, rerender) {
  const keys = path.split('.');
  let o = EV;
  keys.slice(0, -1).forEach(k => {
    o = o[k];
  });
  o[keys.at(-1)] = value;
  if (path.startsWith('tiers')) applyTierStyles();
  saveWorking();
  if (rerender) renderWizard();
  else renderWizSteps();
}
function wizPrev() {
  goStep(wizStep - 1);
}
function wizNext() {
  goStep(wizStep + 1);
}
function goStep(i) {
  syncWizSteps();
  wizStep = Math.max(0, Math.min(WIZ_STEPS.length - 1, i));
  renderWizard();
  document.getElementById('wizBody').scrollTop = 0;
}

// Small field builders (all reuse the admin-panel look)
const fRow = (label, desc, control) =>
  `<div class="admin-rule-row"><div class="admin-rule-info"><div class="admin-rule-label">${label}</div>${desc ? `<div class="admin-rule-desc">${desc}</div>` : ''}</div><div class="admin-rule-control">${control}</div></div>`;
const fMoney = (path, val, step) =>
  `<span class="admin-inp-prefix">${esc(EV.currency)}</span><input type="number" class="admin-inp" value="${val}" min="0" step="${step || 1000}" oninput="setEV('${path}', Math.max(0, +this.value || 0))"/>`;
const fNum = (path, val, min, max, suffix, rerender) =>
  `<input type="number" class="admin-inp admin-inp-sm" value="${val}" min="${min}" ${max != null ? `max="${max}"` : ''} oninput="setEV('${path}', Math.max(${min}, Math.round(+this.value || 0)))" ${rerender ? `onchange="renderWizard()"` : ''}/>${suffix ? `<span class="admin-inp-suffix">${suffix}</span>` : ''}`;
const fText = (path, val, ph, w) =>
  `<input type="text" class="admin-inp" style="width:${w || 220}px;text-align:left" value="${esc(val)}" placeholder="${esc(ph || '')}" oninput="setEV('${path}', this.value)"/>`;
const fToggle = (path, val, rerender) =>
  `<label class="admin-toggle"><input type="checkbox" ${val ? 'checked' : ''} onchange="setEV('${path}', this.checked, ${!!rerender})"/><span class="admin-toggle-slider"></span></label>`;
const fSeg = (path, val, opts) =>
  `<div class="wiz-seg">${opts.map(([v, l]) => `<button type="button" class="${v === val ? 'on' : ''}" data-action="setEV" data-args='["${path}","${v}",true]'>${l}</button>`).join('')}</div>`;

function renderWizSteps() {
  syncWizSteps();
  wizStep = Math.min(wizStep, WIZ_STEPS.length - 1);
  const v = validateEvent(EV);
  document.getElementById('wizSteps').innerHTML = WIZ_STEPS.map((s, i) => {
    const bad = v.errors.some(e => e.step === s.id);
    return `<button type="button" class="wiz-step ${i === wizStep ? 'on' : ''} ${i < wizStep ? 'done' : ''} ${bad ? 'bad' : ''}" data-action="goStep" data-args='[${i}]'><span class="wiz-step-n">${bad ? '!' : i + 1}</span>${stepLabel(s)}</button>`;
  }).join('');
  document.getElementById('wizTitle').textContent = (EV.name || 'Draft Day').toUpperCase();
  document.getElementById('wizBack').style.visibility = wizStep === 0 ? 'hidden' : 'visible';
  const last = wizStep === WIZ_STEPS.length - 1,
    next = document.getElementById('wizNext');
  next.textContent = last ? 'LAUNCH →' : 'NEXT: ' + stepLabel(WIZ_STEPS[wizStep + 1]).toUpperCase() + ' →';
  next.className = last ? 'btn-launch wiz-launch' : 'btn btn-accent wiz-next';
  next.dataset.action = last ? 'launchAuction' : 'wizNext';
}

function renderWizard() {
  if (teams.length) return; // the auction is live; the wizard is hidden
  renderWizSteps();
  const id = WIZ_STEPS[wizStep].id;
  document.getElementById('wizBody').innerHTML = {
    format: wizFormat,
    event: wizEvent,
    teams: wizTeams,
    rounds: wizRounds,
    tiers: wizTiers,
    bidding: wizBidding,
    review: wizReview,
  }[id]();
}

// N6: starting points. A template sets the format and rules; teams and the event name stay
const TEMPLATES = {
  sixAside: {
    label: '6-a-side auction',
    desc: 'Budget, three tiers, 5 bought per team, wheel draw',
    ev: {
      format: 'auction',
      budget: 10000000,
      squadSize: 5,
      captains: true,
      draw: 'wheel',
      rounds: [],
      tiers: [
        { name: 'Gold', color: '#c8960c', minBid: 1000000, limit: 2 },
        { name: 'Silver', color: '#7f8c9a', minBid: 500000, limit: 2 },
        { name: 'Bronze', color: '#a0612a', minBid: 0, limit: 0 },
      ],
      bidding: {
        increment: 100000,
        enforceIncrement: true,
        prefill: true,
        timer: 0,
        timerResetsOnBid: true,
        autoSell: false,
        reserve: true,
        inThousands: false,
      },
      unsold: { enabled: true, discount: 50 },
    },
  },
  socialDraw: {
    label: 'Social league draw',
    desc: 'Random draw, balanced by tier, live reveal',
    ev: {
      format: 'random',
      squadSize: 0,
      captains: true,
      rounds: [],
      random: { balance: true, reveal: 'live', teamPick: 'spin' },
      tiers: [
        { name: 'A', color: '#2f7d4f', minBid: 0, limit: 0 },
        { name: 'B', color: '#2f6fb0', minBid: 0, limit: 0 },
        { name: 'C', color: '#8a5cb8', minBid: 0, limit: 0 },
      ],
    },
  },
  clubDraft: {
    label: 'Club draft',
    desc: 'Captains pick in snake order, 10 each, no tiers',
    ev: {
      format: 'draft',
      squadSize: 10,
      captains: true,
      rounds: [],
      tiers: [],
      draft: { order: 'snake' },
    },
  },
};
async function applyTemplate(key) {
  const t = TEMPLATES[key];
  if (!t) return;
  if (
    !(await askConfirm(`Use the "${t.label}" template? It replaces the format, rounds, tiers and rules. Your teams and event name stay.`, {
      okLabel: 'Use template',
    }))
  )
    return;
  EV = normalizeEvent({ ...EV, ...clone(t.ev), teams: EV.teams, name: EV.name, branding: EV.branding });
  currentPreset = '';
  afterEventChange();
  showToast(`${t.label} applied`);
}

function wizFormat() {
  const f = EV.format,
    ra = EV.random;
  const card = (k, t, d) =>
    `<button type="button" class="wiz-card ${f === k ? 'on' : ''}" data-action="setEV" data-args='["format","${k}",true]' aria-pressed="${f === k}"><div class="wiz-card-t">${t}</div><div class="wiz-card-d">${d}</div></button>`;
  const randomRows =
    f === 'random'
      ? `<div class="admin-section-label wiz-gap">Random allocation</div><div class="admin-rules-grid">
    ${fRow('Balance by tier', ra.balance ? 'Deal one tier at a time, so every team gets the same mix. Pre-draw picks count' : 'Everyone in one hat. Squads stay even in size, but the tier mix is pure luck', fToggle('random.balance', ra.balance, true))}
    ${fRow(
      "How it's revealed",
      ra.reveal === 'live' ? 'Live: player, then team, one at a time' : 'Instant: deal everyone with one button, then show the squads',
      fSeg('random.reveal', ra.reveal, [
        ['live', 'Live'],
        ['instant', 'Instant'],
      ]),
    )}
    ${
      ra.reveal === 'live'
        ? fRow(
            'Team pick',
            'How the team appears for each player',
            fSeg('random.teamPick', ra.teamPick, [
              ['spin', 'Second spin'],
              ['flip', 'Card flip'],
              ['straight', 'Straight in'],
            ]),
          )
        : ''
    }
    ${
      ra.reveal === 'live' && ra.teamPick !== 'straight'
        ? fRow(
            'Reveal length',
            'Press Reveal again during the pick to skip to the result',
            fSeg('spin', EV.spin, [
              ['quick', 'Quick'],
              ['normal', 'Normal'],
              ['dramatic', 'Dramatic'],
            ]),
          )
        : ''
    }
  </div>`
      : '';
  const draftRows =
    f === 'draft'
      ? `<div class="admin-section-label wiz-gap">Draft</div><div class="admin-rules-grid">
    ${fRow(
      'Pick order',
      EV.draft.order === 'snake' ? `Order reverses each pass: 1→${EV.teams.length}, then ${EV.teams.length}→1` : 'Same order every pass',
      fSeg('draft.order', EV.draft.order, [
        ['snake', 'Snake'],
        ['straight', 'Straight'],
      ]),
    )}
  </div><div class="wiz-hint">Each team picks until its squad is full (set the squad size on the next step). The pick order is set on the Review step.</div>`
      : '';
  return `<div class="wiz-lead">How players are shared out. Start from a template, or pick a format and adjust it.</div>
  <div class="admin-section-label">Start from a template</div>
  <div class="wiz-templates">${Object.entries(TEMPLATES)
    .map(
      ([k, t]) =>
        `<button type="button" class="wiz-tpl" data-action="applyTemplate" data-args='["${k}"]'><strong>${t.label}</strong><span>${t.desc}</span></button>`,
    )
    .join('')}</div>
  <div class="admin-section-label wiz-gap">Format</div>
  <div class="wiz-cards">
    ${card('auction', 'Auction', 'Teams bid on each player with a budget.')}
    ${card('random', 'Random allocation', 'No money, no bidding. The draw decides who goes where, live in the room or all at once.')}
    ${card('draft', 'Captains’ draft', 'Captains take turns choosing players from the pool, in snake or straight order.')}
  </div>
  ${randomRows}${draftRows}
  ${f !== 'auction' ? `<div class="wiz-hint wiz-gap-sm">Budget, bidding and unsold settings aren't used. Tiers, squad size, captains and pre-${stageWord()} rounds all still apply.</div>` : ''}`;
}

function wizEvent() {
  const A = EV.format === 'auction',
    R = EV.format === 'random',
    D = isDraft();
  return `<div class="wiz-lead">The basics: what the event is called and the size of each squad.</div>
  <div class="admin-section-label">Event</div><div class="admin-rules-grid">
    ${fRow('Event name', 'Shown in the header, PDF and results image', fText('name', EV.name, 'Draft Day'))}
    ${A ? fRow('Currency symbol', 'Put in front of every amount', `<input type="text" class="admin-inp admin-inp-sm" maxlength="4" value="${esc(EV.currency)}" aria-label="Currency symbol" oninput="setEV('currency', this.value || 'R')" onchange="renderWizard()"/>`) : ''}
    ${A ? fRow('Budget per team', 'Every team starts with this', fMoney('budget', EV.budget, 100000)) : ''}
    ${fRow(
      R ? 'Players drawn per team' : D ? 'Players picked per team' : 'Players bought per team',
      D
        ? 'How many players each captain drafts, not counting the captain and any earlier rounds'
        : `${R ? 'Squad size from the draw' : 'Auction squad size'}, not counting captains and pre-${stageWord()} picks. 0 = no limit${R ? ' (everyone is shared out evenly)' : ''}`,
      fNum('squadSize', EV.squadSize, D ? 1 : 0, 99),
    )}
    ${fRow('Teams have captains', `Captains join their team for free and never ${D ? 'get picked' : 'go on the wheel'}`, fToggle('captains', EV.captains))}
  </div>
  ${
    A
      ? `<div class="admin-section-label wiz-gap">How players come up</div>
  <div class="wiz-cards">${Object.entries(DRAW_MODES)
    .map(
      ([k, m]) => `
    <button type="button" class="wiz-card ${EV.draw === k ? 'on' : ''}" data-action="setEV" data-args='["draw","${k}",true]' aria-pressed="${EV.draw === k}">
      <div class="wiz-card-t">${m.label}</div><div class="wiz-card-d">${m.desc}</div></button>`,
    )
    .join('')}
  </div>
  ${
    EV.draw === 'wheel' || EV.draw === 'random'
      ? `<div class="admin-rules-grid wiz-gap-sm">
    ${fRow(
      EV.draw === 'wheel' ? 'Spin length' : 'Shuffle length',
      'Press the button again during a spin to skip to the result',
      fSeg('spin', EV.spin, [
        ['quick', 'Quick ~2s'],
        ['normal', 'Normal ~5s'],
        ['dramatic', 'Dramatic ~8s'],
      ]),
    )}
    ${EV.draw === 'wheel' ? fRow('Wheel centre icon', 'Any emoji', `<input type="text" class="admin-inp admin-inp-sm" maxlength="4" value="${esc(EV.wheelIcon)}" aria-label="Wheel centre icon" oninput="setEV('wheelIcon', this.value)"/>`) : ''}</div>`
      : ''
  }`
      : ''
  }`;
}

function wizTeams() {
  const rows = EV.teams
    .map(
      (c, i) => `
    <div class="team-edit-row" style="--team-col:${c.color}">
      <button type="button" class="team-edit-logo" data-action="pickTeamLogo" data-args='[${i}]' title="Upload a logo">
        <img src="${cfgLogo(i)}" alt=""/>
      </button>
      <div class="team-edit-fields">
        <input class="team-edit-name" value="${esc(c.name)}" placeholder="Team ${i + 1}" maxlength="32" aria-label="Team ${i + 1} name" oninput="setEV('teams.${i}.name', this.value)"/>
        ${
          EV.captains
            ? `<label class="team-edit-captain-wrap"><span>👑</span>
          <input class="team-edit-captain" value="${esc(c.captain)}" placeholder="Captain name" maxlength="40" aria-label="Team ${i + 1} captain" oninput="setEV('teams.${i}.captain', this.value)"/></label>`
            : ''
        }
        <input class="team-edit-captain team-edit-logo-path" value="${esc(c.logo.startsWith('data:') ? '(uploaded image)' : c.logo)}" placeholder="logos/file.png — or click the logo to upload" aria-label="Team ${i + 1} logo path"
          onchange="setEV('teams.${i}.logo', this.value.trim() === '(uploaded image)' ? EV.teams[${i}].logo : this.value.trim(), true); checkLogos()"/>
      </div>
      <div class="team-edit-side">
        <label class="team-edit-color" style="background:${c.color}" title="Team colour">
          <input type="color" value="${c.color}" aria-label="Team ${i + 1} colour" oninput="setEV('teams.${i}.color', this.value); this.parentNode.style.background=this.value; this.closest('.team-edit-row').style.setProperty('--team-col', this.value)" onchange="renderWizard()"/>
        </label>
        <button type="button" class="wiz-x" title="Remove team" data-action="removeTeam" data-args='[${i}]' ${EV.teams.length <= 2 ? 'disabled' : ''}>✕</button>
      </div>
    </div>`,
    )
    .join('');
  return `<div class="wiz-lead"><strong>${EV.teams.length} teams.</strong> Add as many as you need. Click a logo to upload one, or type a path from the <code>logos/</code> folder.</div>
    <div class="team-edit-list wiz-team-grid">${rows}</div>
    <div class="wiz-add-row">
      <button type="button" class="btn btn-ghost" data-action="addTeam">+ Add team</button>
      <button type="button" class="btn btn-ghost" data-action="addTeams">+ Add several…</button>
    </div>`;
}
async function addTeam() {
  const i = EV.teams.length,
    used = new Set(EV.teams.map(t => t.color));
  let k = i;
  while (used.has(autoColor(k)) && k < i + 40) k++;
  EV.teams.push({ name: 'Team ' + (i + 1), captain: '', color: autoColor(k), logo: '' });
  afterEventChange();
}
async function addTeams() {
  const n = parseInt(await askText('How many teams should the event have in total?', String(EV.teams.length), { okLabel: 'Set' }), 10);
  if (!(n >= 2)) return;
  if (n < EV.teams.length) {
    if (!(await askConfirm(`Remove the last ${EV.teams.length - n} team(s)?`, { okLabel: 'Remove', danger: true }))) return;
    EV.teams.length = n;
    afterEventChange();
    return;
  }
  while (EV.teams.length < n) {
    const i = EV.teams.length;
    EV.teams.push({ name: 'Team ' + (i + 1), captain: '', color: autoColor(i), logo: '' });
  }
  afterEventChange();
}
async function removeTeam(i) {
  if (EV.teams.length <= 2) return;
  if (!(await askConfirm(`Remove ${cfgName(i)}?`, { okLabel: 'Remove', danger: true }))) return;
  EV.teams.splice(i, 1);
  pickOrder = pickOrder.filter(x => x !== i).map(x => (x > i ? x - 1 : x));
  afterEventChange();
}

function wizRounds() {
  const rounds = EV.rounds
    .map(
      (r, i) => `
    <div class="wiz-round">
      <div class="wiz-round-head">
        <span class="wiz-round-n">${i + 1}</span>
        <input class="team-edit-name" value="${esc(r.name)}" placeholder="Round name" maxlength="40" oninput="setEV('rounds.${i}.name', this.value)"/>
        <div class="wiz-round-btns">
          <button type="button" class="pick-order-btn" data-action="moveItem" data-args='["rounds",${i},-1]' ${i === 0 ? 'disabled' : ''} title="Move up">▲</button>
          <button type="button" class="pick-order-btn" data-action="moveItem" data-args='["rounds",${i},1]' ${i === EV.rounds.length - 1 ? 'disabled' : ''} title="Move down">▼</button>
          <button type="button" class="wiz-x" data-action="removeItem" data-args='["rounds",${i}]' title="Remove round">✕</button>
        </div>
      </div>
      <div class="admin-rules-grid">
        ${fRow('Picks per team', `${r.picks * EV.teams.length} picks in total`, fNum(`rounds.${i}.picks`, r.picks, 1, 20, '', true))}
        ${fRow(
          'Pick order',
          r.order === 'snake'
            ? 'Order reverses each pass: 1→' + EV.teams.length + ', then ' + EV.teams.length + '→1'
            : 'Same order every pass',
          fSeg(`rounds.${i}.order`, r.order, [
            ['snake', 'Snake'],
            ['straight', 'Straight'],
          ]),
        )}
        ${
          noMoney()
            ? ''
            : fRow(
                'Cost',
                r.cost === 'free' ? 'Picks cost nothing' : 'The price in the CSV comes off the team’s budget',
                fSeg(`rounds.${i}.cost`, r.cost, [
                  ['free', 'Free'],
                  ['price', 'Listed price'],
                ]),
              )
        }
        ${fRow('Uses squad slots', 'Picks count toward the players-bought limit', fToggle(`rounds.${i}.countsTowardSquad`, r.countsTowardSquad))}
        ${EV.tiers.length ? fRow('Counts toward tier limits', 'A pick in a full tier is blocked, and it uses up that tier for the auction', fToggle(`rounds.${i}.countsTowardTiers`, r.countsTowardTiers)) : ''}
      </div>
    </div>`,
    )
    .join('');
  const order = EV.rounds.length
    ? `
    <div class="admin-section-label wiz-gap">Pick order</div>
    <div class="wiz-hint">Pick 1 goes first in every round. Drag or use the arrows.</div>
    <div class="pick-order-list" id="pickOrderList">${pickOrderHtml()}</div>`
    : '';
  return `<div class="wiz-lead">Rounds where teams pick players for free (or at a set price) before the ${stageWord()}, such as former or retained players. Each round loads its own player list. ${EV.rounds.length ? '' : `<strong>No rounds: the ${stageWord()} starts straight after launch.</strong>`}</div>
    ${rounds}
    <div class="wiz-add-row"><button type="button" class="btn btn-ghost" data-action="addRound">+ Add a pre-${stageWord()} round</button></div>
    ${order}`;
}
function addRound() {
  EV.rounds.push({
    name: EV.rounds.length ? 'Round ' + (EV.rounds.length + 1) : 'Former players',
    picks: 1,
    order: 'snake',
    cost: 'free',
    countsTowardSquad: false,
    countsTowardTiers: true,
  });
  afterEventChange();
}
function moveItem(list, i, d) {
  const a = EV[list],
    j = i + d;
  if (j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]];
  afterEventChange();
}
async function removeItem(list, i) {
  const a = EV[list];
  if (!(await askConfirm(`Remove "${a[i].name}"?`, { okLabel: 'Remove', danger: true }))) return;
  a.splice(i, 1);
  afterEventChange();
}

function pickOrderHtml() {
  return pickOrder
    .map(
      (idx, pos) => `<div class="pick-order-row" id="por-${idx}" draggable="true"
      ondragstart="pickDragStart(event,${idx})" ondragover="pickDragOver(event,${idx})" ondragleave="pickDragLeave(event,${idx})" ondrop="pickDrop(event,${idx})">
    <span class="pick-order-drag-handle">⠿</span>
    <div class="pick-order-num">${pos + 1}</div>
    <img src="${cfgLogo(idx)}" class="team-logo-sm" alt=""/>
    <div class="pick-order-name">${esc(cfgName(idx))}</div>
    <div class="pick-order-btns">
      <button class="pick-order-btn" ${pos === 0 ? 'disabled' : ''} data-action="pickMove" data-args='[${idx},-1]' title="Move up">▲</button>
      <button class="pick-order-btn" ${pos === pickOrder.length - 1 ? 'disabled' : ''} data-action="pickMove" data-args='[${idx},1]' title="Move down">▼</button>
    </div></div>`,
    )
    .join('');
}
let _dragIdx = null;
function pickDragStart(e, idx) {
  _dragIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
}
function pickDragOver(e, idx) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.getElementById('por-' + idx)?.classList.add('drag-over');
}
function pickDragLeave(e, idx) {
  document.getElementById('por-' + idx)?.classList.remove('drag-over');
}
function pickDrop(e, idx) {
  e.preventDefault();
  document.getElementById('por-' + idx)?.classList.remove('drag-over');
  if (_dragIdx === null || _dragIdx === idx) return;
  const from = pickOrder.indexOf(_dragIdx),
    to = pickOrder.indexOf(idx);
  pickOrder.splice(from, 1);
  pickOrder.splice(to, 0, _dragIdx);
  _dragIdx = null;
  renderWizard();
}
function pickMove(idx, d) {
  const i = pickOrder.indexOf(idx),
    j = i + d;
  if (j < 0 || j >= pickOrder.length) return;
  [pickOrder[i], pickOrder[j]] = [pickOrder[j], pickOrder[i]];
  renderWizard();
}

function wizTiers() {
  const rows = EV.tiers
    .map(
      (t, i) => `
    <div class="wiz-tier">
      <label class="team-edit-color" style="background:${t.color}" title="Tier colour">
        <input type="color" value="${t.color}" oninput="setEV('tiers.${i}.color', this.value); this.parentNode.style.background=this.value" onchange="renderWizard()"/>
      </label>
      <input class="team-edit-name wiz-tier-name" value="${esc(t.name)}" placeholder="Tier name" maxlength="20" oninput="setEV('tiers.${i}.name', this.value)" onchange="renderWizard()"/>
      <label class="wiz-tier-f"><span>Min opening bid</span><span class="wiz-money"><em>${esc(EV.currency)}</em><input type="number" class="admin-inp" value="${t.minBid}" min="0" step="10000" oninput="setEV('tiers.${i}.minBid', Math.max(0, +this.value || 0))"/></span></label>
      <label class="wiz-tier-f"><span>Max per team</span><input type="number" class="admin-inp admin-inp-sm" value="${t.limit}" min="0" max="99" oninput="setEV('tiers.${i}.limit', Math.max(0, Math.round(+this.value || 0)))"/></label>
      <div class="wiz-round-btns">
        <button type="button" class="pick-order-btn" data-action="moveItem" data-args='["tiers",${i},-1]' ${i === 0 ? 'disabled' : ''} title="Move up">▲</button>
        <button type="button" class="pick-order-btn" data-action="moveItem" data-args='["tiers",${i},1]' ${i === EV.tiers.length - 1 ? 'disabled' : ''} title="Move down">▼</button>
        <button type="button" class="wiz-x" data-action="removeItem" data-args='["tiers",${i}]' title="Remove tier">✕</button>
      </div>
    </div>`,
    )
    .join('');
  return `<div class="wiz-lead">Tiers group players by value. The CSV's third column must match a tier name (any case). ${EV.tiers.length ? '"Max per team" of 0 means no limit.' : '<strong>No tiers: the tier column is ignored and only each player’s base price applies.</strong>'}</div>
    ${
      EV.tiers.length
        ? `<div class="wiz-tier-list">${rows}</div>
    <div class="wiz-hint wiz-gap-sm">Preview: ${EV.tiers.map(t => tierPill(t.name)).join(' ')}</div>`
        : ''
    }
    <div class="wiz-add-row">
      <button type="button" class="btn btn-ghost" data-action="addTier">+ Add tier</button>
      ${
        EV.tiers.length
          ? `<button type="button" class="btn btn-ghost" data-action="clearTiers">Use no tiers</button>`
          : `<button type="button" class="btn btn-ghost" data-action="useDefaultTiers">Start from the default tiers</button>`
      }
    </div>`;
}
function addTier() {
  const i = EV.tiers.length;
  EV.tiers.push({ name: 'Tier ' + (i + 1), color: autoColor(i + 6), minBid: 0, limit: 0 });
  afterEventChange();
}

function wizBidding() {
  const b = EV.bidding;
  return `<div class="wiz-lead">How a bidding round runs once a player is up.</div>
  <div class="admin-rules-grid">
    ${fRow('Bid increment', 'The step between bids', fMoney('bidding.increment', b.increment, 1000))}
    ${fRow('Enforce the increment', b.enforceIncrement ? `A bid must beat the leader by at least ${zarFmt(b.increment)}` : 'Any amount above the leader is accepted', fToggle('bidding.enforceIncrement', b.enforceIncrement, true))}
    ${fRow('Pre-fill bid boxes', 'Each team’s box shows the next valid amount', fToggle('bidding.prefill', b.prefill))}
    ${fRow('Purse reserve', b.reserve ? 'A team must keep enough to fill its empty squad slots at the cheapest opening bid. Its row shows its max bid' : 'Teams can spend their whole budget on one player', fToggle('bidding.reserve', b.reserve, true))}
    ${fRow('Type bids in thousands', b.inThousands ? `Type 350 for ${zarFmt(350000)}` : `Type full amounts. Shortcuts like 350k or 1.2m always work`, fToggle('bidding.inThousands', b.inThousands, true))}
    ${fRow('Auto-sell', b.autoSell ? 'Sold as soon as every other team has passed' : 'The auctioneer clicks Declare Winner', fToggle('bidding.autoSell', b.autoSell, true))}
    ${fRow('Timer', 'Seconds per player. 0 = no timer', fNum('bidding.timer', b.timer, 0, 600, 'sec', true))}
    ${b.timer > 0 ? fRow('New bid restarts the timer', b.timerResetsOnBid ? '"Going once, going twice": the clock resets on every bid' : 'One countdown for the whole player', fToggle('bidding.timerResetsOnBid', b.timerResetsOnBid, true)) : ''}
  </div>
  <div class="admin-section-label wiz-gap">Unsold players</div>
  <div class="admin-rules-grid">
    ${fRow('Unsold queue and round', EV.unsold.enabled ? 'Players nobody buys wait in a queue, then get a second auction once the main pool is empty. Only teams with squad space and budget can bid' : 'Players nobody buys go straight back into the pool', fToggle('unsold.enabled', EV.unsold.enabled, true))}
    ${EV.unsold.enabled ? fRow('Price cut in the unsold round', `Opening bids drop by this much (e.g. ${zarS(200000)} → ${zarS(Math.round(200000 * (1 - EV.unsold.discount / 100)))}). 0 = no cut`, fNum('unsold.discount', EV.unsold.discount, 0, 90, '% off', true)) : ''}
  </div>
  <div class="wiz-hint mt-md">The opening bid is the higher of the player's base price and their tier's minimum. These settings can still be changed during the auction under Admin.</div>`;
}

function validateEvent(ev) {
  const errors = [],
    warnings = [];
  const E = (step, msg) => errors.push({ step, msg }),
    W = (step, msg) => warnings.push({ step, msg });
  if (ev.teams.length < 2) E('teams', 'Add at least 2 teams.');
  const names = ev.teams.map((t, i) => (t.name.trim() || 'Team ' + (i + 1)).toLowerCase());
  const dupN = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupN.length) E('teams', 'Two teams share the name "' + dupN[0] + '".');
  if (ev.captains) {
    const caps = ev.teams.map(t => t.captain.trim().toLowerCase()).filter(Boolean);
    const dupC = caps.filter((n, i) => caps.indexOf(n) !== i);
    if (dupC.length) E('teams', 'Two teams share the captain "' + dupC[0] + '".');
    const none = ev.teams.filter(t => !t.captain.trim()).length;
    if (none) W('teams', `${none} team${none > 1 ? 's have' : ' has'} no captain.`);
  }
  const tn = ev.tiers.map(t => t.name.trim().toLowerCase());
  if (tn.some(n => !n)) E('tiers', 'Every tier needs a name.');
  const dupT = tn.filter((n, i) => n && tn.indexOf(n) !== i);
  if (dupT.length) E('tiers', 'Two tiers share the name "' + dupT[0] + '".');
  if (ev.format === 'draft' && !(ev.squadSize >= 1)) E('event', 'Set how many players each captain picks (at least 1).');
  if (ev.format === 'auction') {
    if (!(ev.budget > 0)) E('event', 'Set a budget above zero.');
    ev.tiers.forEach(t => {
      if (t.minBid > ev.budget) W('tiers', `${t.name}'s minimum bid is more than a team's whole budget.`);
    });
  }
  ev.rounds.forEach(r => {
    if (!r.name.trim()) W('rounds', 'A pre-round has no name.');
  });
  // D4: pale colours vanish on the light screens and the white PDF
  ev.teams.forEach((t, i) => {
    if (colorLum(t.color) > 0.72)
      W(
        'teams',
        `${t.name || 'Team ' + (i + 1)}'s colour is very pale and will be hard to see on the light screens and the PDF. Pick a darker one.`,
      );
  });
  ev.tiers.forEach(t => {
    if (colorLum(t.color) > 0.72) W('tiers', `Tier ${t.name}'s colour is very pale and will be hard to see.`);
  });
  if (ev.squadSize && ev.tiers.length) {
    const cap = ev.tiers.reduce((s, t) => s + (t.limit || Infinity), 0);
    if (cap < ev.squadSize)
      W(
        'tiers',
        `Tier limits add up to ${cap}, fewer than the ${ev.squadSize} players each team ${{ random: 'is dealt', draft: 'picks' }[ev.format] || 'buys'}. Untiered players fill the gap.`,
      );
  }
  return { errors, warnings };
}

function wizReview() {
  const v = validateEvent(EV),
    n = EV.teams.length,
    F = EV.format,
    st = stageWord();
  const freePicks = EV.rounds.filter(r => !r.countsTowardSquad).reduce((s, r) => s + r.picks, 0);
  const slotRounds = EV.rounds.filter(r => r.countsTowardSquad).map(r => r.name);
  const squad = [
    EV.captains ? '1 captain' : '',
    freePicks ? `${freePicks} pre-${st} pick${freePicks > 1 ? 's' : ''}` : '',
    EV.squadSize
      ? `${EV.squadSize} ${{ random: 'drawn', draft: 'drafted' }[F] || 'squad slots'}${slotRounds.length ? ` (incl. ${slotRounds.join(', ')} picks)` : ''}`
      : F === 'random'
        ? 'everyone shared out'
        : 'any number bought',
  ]
    .filter(Boolean)
    .join(' + ');
  const b = EV.bidding;
  const card = (title, id, body) =>
    `<div class="wiz-sum"><div class="wiz-sum-h"><span>${title}</span><button type="button" class="setup-link" data-action="goStep" data-args='[${stepIdx(id)}]'>Edit</button></div>${body}</div>`;
  const fmtLine =
    F === 'random'
      ? `Random allocation · ${EV.random.balance ? 'tier-balanced' : 'one hat'} · ${EV.random.reveal === 'live' ? 'live reveal' + { spin: ', second spin', flip: ', card flip', straight: '' }[EV.random.teamPick] : 'instant deal'}`
      : F === 'draft'
        ? `Captains’ draft · ${EV.draft.order} order`
        : `Auction · ${zarFmt(EV.budget)} per team · ${DRAW_MODES[EV.draw].label.toLowerCase()}`;
  return `
    ${v.errors.length ? `<div class="wiz-alert bad" role="alert">${v.errors.map(e => `<div>✕ ${esc(e.msg)} <button type="button" class="setup-link" data-action="goStep" data-args='[${stepIdx(e.step)}]'>Fix</button></div>`).join('')}</div>` : ''}
    ${v.warnings.length ? `<div class="wiz-alert warn">${v.warnings.map(e => `<div>⚠ ${esc(e.msg)}</div>`).join('')}</div>` : ''}
    <div class="wiz-sum-grid">
      ${card('Event', 'event', `<div class="wiz-sum-big">${esc(EV.name)}</div><div>${fmtLine}</div><div>Squad: ${squad}</div>`)}
      ${card(`${n} teams`, 'teams', `<div class="wiz-chips">${EV.teams.map((t, i) => `<span class="wiz-chip"><i style="background:${t.color}"></i>${esc(cfgName(i))}</span>`).join('')}</div>`)}
      ${card('Pre-' + st, 'rounds', EV.rounds.length ? EV.rounds.map((r, i) => `<div>${i + 1}. <strong>${esc(r.name)}</strong>: ${r.picks} per team, ${r.order}${noMoney() ? '' : ', ' + (r.cost === 'free' ? 'free' : 'listed price')}</div>`).join('') : `<div>None: straight to the ${st}</div>`)}
      ${card('Tiers', 'tiers', EV.tiers.length ? `<div class="wiz-chips">${EV.tiers.map(t => `<span class="wiz-tier-sum">${tierPill(t.name)}<span class="wiz-sum-small">${!noMoney() && t.minBid ? zarS(t.minBid) + ' min' : ''}${t.limit ? (!noMoney() && t.minBid ? ' · ' : '') + 'max ' + t.limit : ''}</span></span>`).join('')}</div>` : '<div>No tiers</div>')}
      ${noMoney() ? '' : card('Bidding', 'bidding', `<div>Steps of ${zarFmt(b.increment)}${b.enforceIncrement ? ' (enforced)' : ''}${b.reserve ? ' · purse reserve on' : ''}</div><div>${b.autoSell ? 'Auto-sell when others pass' : 'Auctioneer declares the winner'}</div><div>${b.timer ? `${b.timer}s timer${b.timerResetsOnBid ? ', resets on each bid' : ''}` : 'No timer'}</div><div>${EV.unsold.enabled ? `Unsold round at ${EV.unsold.discount}% off` : 'Unsold players go back in the pool'}</div>`)}
    </div>
    ${EV.rounds.length || F === 'draft' ? `<div class="admin-section-label wiz-gap">Pick order${F === 'draft' ? '' : ' for pre-' + st + ' rounds'}</div><div class="pick-order-list" id="pickOrderList">${pickOrderHtml()}</div>` : ''}
    ${wizPlayers()}
    ${wizHistory()}
    ${wizOutputs()}
    <div class="wiz-rehearse">
      <div><strong>Rehearse first?</strong> Runs the whole event with ${listsHaveAny() ? 'the lists above' : 'made-up players'}. Nothing is saved, and Reset brings you back here.</div>
      <button type="button" class="btn btn-ghost" data-action="launchRehearsal" ${v.errors.length ? 'disabled' : ''}>▶ Rehearse</button>
    </div>
    <div class="wiz-hint wiz-gap-sm">Save these settings with <strong>Save as preset</strong> at the top to reuse them next time.</div>`;
}

// ── U1: player lists loaded in setup, applied at launch ──
const LISTS_KEY = 'draftday.lists.v1';
let LISTS = (() => {
  const l = storeGet(LISTS_KEY) || {};
  return { pool: str(l.pool, ''), rounds: l.rounds && typeof l.rounds === 'object' ? l.rounds : {} };
})();
const saveLists = () => {
  if (!storeSet(LISTS_KEY, LISTS)) showToast('Browser storage is full: the list will only last until you close this page');
};
const listText = key => (key === 'pool' ? LISTS.pool : str(LISTS.rounds[key], ''));
const listsHaveAny = () => !!(LISTS.pool.trim() || EV.rounds.some((_, i) => listText(i).trim()));
function setListText(key, text) {
  if (key === 'pool') LISTS.pool = text;
  else LISTS.rounds[key] = text;
  saveLists();
  renderWizard();
}

function listPreview(text) {
  if (!text.trim()) return '<span class="wiz-list-empty">No list yet. You can also load it after launch.</span>';
  const { rows, unknownTiers } = parsePlayerRows(text);
  const byTier = EV.tiers.map(t => [t.name, rows.filter(r => r.tier === t.name).length]).filter(([, c]) => c);
  const untiered = rows.filter(r => !r.tier).length;
  return `<span class="wiz-list-n">${rows.length} player${rows.length !== 1 ? 's' : ''}</span>
    ${byTier.map(([t, c]) => `${tierPill(t)}<span class="wiz-sum-small">${c}</span>`).join(' ')}${untiered && EV.tiers.length ? ` <span class="wiz-sum-small">${untiered} untiered</span>` : ''}
    ${unknownTiers.size ? `<div class="wiz-list-warn">⚠ Unknown tier: ${esc([...unknownTiers].slice(0, 3).join(', '))}</div>` : ''}
    <div class="wiz-list-names">${esc(
      rows
        .slice(0, 6)
        .map(r => r.name)
        .join(', '),
    )}${rows.length > 6 ? `, +${rows.length - 6} more` : ''}</div>`;
}
function wizPlayers() {
  const row = (key, title) => `<div class="wiz-list">
    <div class="wiz-list-h"><strong>${esc(title)}</strong>
      <div class="wiz-list-btns">
        <button type="button" class="btn btn-ghost btn-sm" data-action="pickListFile" data-args='["${key}"]'>⬆ CSV</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="pasteList" data-args='["${key}"]'>📋 Paste</button>
        ${listText(key).trim() ? `<button type="button" class="btn btn-ghost btn-sm" data-action="clearList" data-args='["${key}"]' aria-label="Clear ${esc(title)} list">✕</button>` : ''}
      </div></div>
    <div class="wiz-list-body">${listPreview(listText(key))}</div></div>`;
  return `<div class="admin-section-label wiz-gap">Players</div>
    <div class="wiz-hint">Load the lists now so launch goes straight to the first pick. Name, Price, Tier per line.</div>
    <div class="wiz-lists">
      ${EV.rounds.map((r, i) => row(String(i), r.name || 'Round ' + (i + 1))).join('')}
      ${row('pool', isDraft() ? 'Draft pool' : EV.format === 'random' ? 'Players to draw' : 'Auction pool')}
    </div>
    <input type="file" id="listFileInput" accept=".csv,.txt" hidden onchange="handleListFile(event)"/>`;
}
let _listKey = null;
function pickListFile(key) {
  _listKey = key;
  document.getElementById('listFileInput').click();
}
function handleListFile(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f || _listKey === null) return;
  const key = _listKey,
    r = new FileReader();
  r.onload = ev => setListText(key, ev.target.result.replace(/^\uFEFF/, ''));
  r.readAsText(f);
}
async function pasteList(key) {
  const text = await askText('Paste players', listText(key), { multiline: true, okLabel: 'Use this list', hint: PASTE_HINT });
  if (text !== null) setListText(key, text);
}
async function clearList(key) {
  if (await askConfirm('Clear this list?', { okLabel: 'Clear', danger: true })) setListText(key, '');
}

// At launch: put the lists where they belong
function applyPreloads(useFake) {
  const rounds = allRounds();
  selRounds = rounds.map(() => ({ players: [], pickIdx: 0, turnOrder: [], picks: [], done: false }));
  const fake = useFake && !listsHaveAny();
  let n = 0;
  EV.rounds.forEach((r, i) => {
    const t = fake ? fakeList(EV.teams.length * r.picks + 2, 'Former') : listText(String(i));
    if (t.trim()) n += loadRoundText(i, t, true) || 0;
  });
  const pool = fake ? fakeList(EV.teams.length * Math.max(EV.squadSize || 5, 1) + 4, 'Player') : LISTS.pool;
  if (pool.trim()) n += (isDraft() ? loadRoundText(rounds.length - 1, pool, true) : loadPoolText(pool, true)) || 0;
  return n;
}

// ── U7: rehearsal with made-up players; nothing is saved ──
let rehearsal = false;
function setRehearsal(on) {
  rehearsal = !!on;
  document.body.classList.toggle('rehearsal', rehearsal);
}
function fakeList(count, prefix) {
  const tiers = EV.tiers.length ? EV.tiers : [{ name: '', minBid: 0 }];
  const step = EV.bidding.increment || 1;
  return Array.from({ length: count }, (_, i) => {
    const t = tiers[i % tiers.length];
    const price = noMoney() ? 0 : Math.max(t.minBid, step * (1 + ((i * 7) % 9)));
    return `${prefix} ${String(i + 1).padStart(2, '0')},${price},${t.name}`;
  }).join('\n');
}
function launchRehearsal() {
  launchAuction(true);
}

// ── N5: outputs (results image text and sponsor) ──
function wizOutputs() {
  const sp = EV.branding.sponsor;
  return `<div class="admin-section-label wiz-gap">Outputs</div>
  <div class="admin-rules-grid">
    ${fRow('Image title', 'Big heading on the results image', fText('branding.exportTitle', EV.branding.exportTitle, '6-A-SIDE'))}
    ${fRow('Subtitle', '', fText('branding.exportSubtitle', EV.branding.exportSubtitle, 'OFFICIAL TEAM ROSTERS'))}
    ${fRow('Hashtags / footer', 'Leave blank for none', fText('branding.hashtags', EV.branding.hashtags, '#yourclub', 280))}
    ${fRow('Sponsor', 'Shown on the projector, cards, PDF and results image. Leave blank for none', fText('branding.sponsor.name', sp.name, 'Sponsor name'))}
    ${sp.name.trim() ? fRow('Sponsor line', 'The words before the name', fText('branding.sponsor.line', sp.line, 'Presented by')) : ''}
    ${sp.name.trim() ? fRow('Sponsor logo', sp.logo ? 'Click to change' : 'Optional', `<button type="button" class="wiz-sponsor-logo" data-action="pickSponsorLogo" aria-label="Upload a sponsor logo">${sp.logo ? `<img src="${esc(sp.logo)}" alt=""/>` : '+ Logo'}</button>${sp.logo ? `<button type="button" class="wiz-x" data-action="clearSponsorLogo" aria-label="Remove sponsor logo">✕</button>` : ''}`) : ''}
  </div>
  <input type="file" id="sponsorLogoInput" accept="image/*" hidden onchange="handleSponsorLogo(event)"/>`;
}
function pickSponsorLogo() {
  document.getElementById('sponsorLogoInput').click();
}
function clearSponsorLogo() {
  EV.branding.sponsor.logo = '';
  saveWorking();
  renderWizard();
}
function handleSponsorLogo(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const url = URL.createObjectURL(f),
    img = new Image();
  img.onload = () => {
    // Keep the shape (sponsor logos are often wide); fit inside 480×160 on a transparent canvas
    const sc = Math.min(480 / img.naturalWidth, 160 / img.naturalHeight, 1);
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * sc);
    c.height = Math.round(img.naturalHeight * sc);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    EV.branding.sponsor.logo = c.toDataURL('image/png');
    sponsorImg();
    saveWorking();
    renderWizard();
    showToast('Sponsor logo added');
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    showToast('Could not read that image');
  };
  img.src = url;
}
let _sponsorImg = null,
  _sponsorSrc = '';
// The sponsor logo as an <img> for canvas drawing (null until loaded or if there is none)
function sponsorImg() {
  const src = EV.branding.sponsor.logo;
  if (!src) return null;
  if (src !== _sponsorSrc) {
    _sponsorSrc = src;
    _sponsorImg = new Image();
    _sponsorImg.src = src;
  }
  return _sponsorImg.complete && _sponsorImg.naturalWidth ? _sponsorImg : null;
}
const hasSponsor = () => !!EV.branding.sponsor.name.trim();

// ── Logo upload ─────────────────────────────────────────────────────────────
let _logoSlot = null;
function pickTeamLogo(i) {
  _logoSlot = i;
  document.getElementById('teamLogoInput').click();
}
function handleTeamLogo(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f || _logoSlot === null) return;
  const slot = _logoSlot;
  _logoSlot = null;
  const url = URL.createObjectURL(f),
    img = new Image();
  img.onload = () => {
    const S = 160,
      c = document.createElement('canvas');
    c.width = c.height = S;
    const side = Math.min(img.naturalWidth, img.naturalHeight),
      g = c.getContext('2d');
    g.fillStyle = '#111';
    g.fillRect(0, 0, S, S);
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, S, S);
    URL.revokeObjectURL(url);
    EV.teams[slot].logo = c.toDataURL('image/jpeg', 0.9);
    saveWorking();
    renderWizard();
    showToast(`Logo updated for ${cfgName(slot)}`);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    showToast('Could not read that image');
  };
  img.src = url;
}

function useDefaultTiers() {
  EV.tiers = clone(
    FILE_EVENT.tiers.length
      ? FILE_EVENT.tiers
      : [
          { name: 'Gold', color: '#e0a020', minBid: 0, limit: 0 },
          { name: 'Silver', color: '#98a8b8', minBid: 0, limit: 0 },
        ],
  );
  afterEventChange();
}
async function clearTiers() {
  if (await askConfirm('Remove all tiers?', { okLabel: 'Remove', danger: true })) {
    EV.tiers = [];
    afterEventChange();
  }
}

// ── Launch ──────────────────────────────────────────────────────────────────
function launchAuction(rehearse) {
  rehearse = rehearse === true;
  const v = validateEvent(EV);
  if (v.errors.length) {
    goStep(WIZ_STEPS.length - 1);
    showToast(v.errors[0].msg);
    return;
  }
  EV.teams.forEach((t, i) => {
    if (!t.name.trim()) t.name = 'Team ' + (i + 1);
  });
  saveWorking();
  teams = EV.teams.map((c, i) => {
    const captain = EV.captains ? c.captain.trim() : '';
    return {
      id: i,
      name: cfgName(i),
      color: c.color,
      logo: cfgLogo(i),
      budget: EV.budget,
      startBudget: EV.budget,
      players: captain ? [setStatus({ id: nextId(), name: captain, price: 0, tier: '', finalPrice: 0, teamId: i }, 'captain')] : [],
    };
  });
  setRehearsal(rehearse);
  runId = rehearse ? '' : newRunId();
  sponsorImg();
  document.title = EV.name + ({ random: ' — Draw', draft: ' — Draft' }[EV.format] || ' — Player Auction');
  document.querySelectorAll('.event-name').forEach(el => (el.textContent = EV.name.toUpperCase()));
  document.getElementById('setupScreen').style.display = 'none';
  const n = applyPreloads(rehearse);
  if (allRounds().length) selectionRoundInit(0);
  else startAuction();
  if (rehearse) showToast('Rehearsal: nothing is saved. Reset to go back to setup');
  else if (n) showToast(`${n} player${n !== 1 ? 's' : ''} loaded from setup`);
}

function initSetup() {
  applyTierStyles();
  syncPickOrder();
  renderPresetBar();
  renderWizard();
  checkLogos();
}
