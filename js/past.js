/*
 * Draft Day: player history across events
 * ----------------------------------------
 * Every event remembers where each player went and for how much, in this browser.
 * The next time a player comes up, the card (and the projector) shows their last
 * event: "Nov 2025 (Draft Day): R420K to MI Tygers". Rehearsals are never recorded.
 *
 * Each launch gets a run id. The run's results are rebuilt from the rosters on every
 * autosave, so undo, roster fixes and reloading a save keep history in step.
 */
const HIST_KEY = 'draftday.history.v1';
let runId = '';
const newRunId = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const normName = n =>
  String(n || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

function histLoad() {
  try {
    const h = JSON.parse(localStorage.getItem(HIST_KEY) || 'null');
    return h && Array.isArray(h.runs) ? h : { runs: [] };
  } catch (e) {
    return { runs: [] };
  }
}
let HIST = histLoad();
function histSave() {
  try {
    localStorage.setItem(HIST_KEY, JSON.stringify(HIST));
  } catch (e) {}
}

// This event's results, as history keeps them
function histSnapshot() {
  const results = {};
  teams.forEach(t =>
    t.players.forEach(p => {
      if (p.isCaptain) return;
      results[normName(p.name)] = {
        name: p.name,
        team: t.name,
        price: p.finalPrice || 0,
        tier: p.tier || '',
        how: p.isFormer ? p.roundName || 'Pick' : p.drawn ? 'Drawn' : 'Bought',
      };
    }),
  );
  return { id: runId, event: EV.name, format: EV.format, currency: EV.currency, date: new Date().toISOString().slice(0, 10), results };
}
function histRecord() {
  if (!runId || rehearsal || !teams.length) return;
  const snap = histSnapshot(),
    i = HIST.runs.findIndex(r => r.id === runId);
  if (!Object.keys(snap.results).length) {
    if (i >= 0) {
      HIST.runs.splice(i, 1);
      histSave();
    }
    return;
  }
  if (i >= 0) {
    snap.date = HIST.runs[i].date;
    HIST.runs[i] = snap;
  } else HIST.runs.push(snap);
  histSave();
}

// Every earlier appearance of a player, newest first
function pastFor(name) {
  const k = normName(name),
    out = [];
  HIST.runs.forEach(r => {
    if (r.id === runId) return;
    const x = r.results[k];
    if (x) out.push({ ...x, event: r.event, date: r.date, format: r.format, currency: r.currency });
  });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function pastMoney(v, cur) {
  const a = Math.abs(v || 0);
  return (cur || '') + (a >= 1e6 ? (a / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : a >= 1000 ? Math.round(a / 1000) + 'K' : a);
}
// One line about a player's last event, or '' if they're new
function pastLine(name) {
  const p = pastFor(name)[0];
  if (!p) return '';
  const [y, m] = p.date.split('-');
  const what =
    p.how === 'Bought'
      ? `${pastMoney(p.price, p.currency)} to ${p.team}`
      : p.how === 'Drawn'
        ? `drawn to ${p.team}`
        : `${p.how} pick for ${p.team}${p.price ? ' (' + pastMoney(p.price, p.currency) + ')' : ''}`;
  return `${MONTHS[+m - 1]} ${y} (${p.event}): ${what}`;
}

// ── Managing history (Review step) ──
function wizHistory() {
  const runs = [...HIST.runs].sort((a, b) => b.date.localeCompare(a.date));
  const n = new Set(runs.flatMap(r => Object.keys(r.results))).size;
  return html`<div class="admin-section-label wiz-gap">Player history</div>
    <div class="wiz-hint">
      ${
        runs.length
          ? `${runs.length} earlier event${runs.length !== 1 ? 's' : ''} · ${n} player${n !== 1 ? 's' : ''}. A returning player's last price and team show on their card.`
          : 'Nothing yet. After this event, each returning player’s last price and team will show on their card.'
      }
    </div>
    ${
      runs.length
        ? html`<div class="wiz-hist">
            ${runs.map(
              r =>
                html`<div class="wiz-hist-row">
                  <span class="wiz-hist-date">${r.date}</span><strong>${r.event}</strong>
                  <span class="wiz-sum-small"
                    >${Object.keys(r.results).length} player${Object.keys(r.results).length !== 1 ? 's' : ''} ·
                    ${{ random: 'draw', draft: 'draft' }[r.format] || 'auction'}</span
                  >
                  <button
                    type="button"
                    class="wiz-x"
                    data-action="histRemove"
                    data-args="${JSON.stringify([r.id])}"
                    aria-label="Remove ${r.event} from history"
                  >
                    ✕
                  </button>
                </div>`,
            )}
          </div>`
        : ''
    }
    <div class="wiz-list-btns wiz-gap-sm">
      ${runs.length ? raw('<button type="button" class="btn btn-ghost btn-sm" data-action="histExport">⬇ Export history</button>') : ''}
      <button type="button" class="btn btn-ghost btn-sm" data-action="clickEl" data-args='["histImportInput"]'>⬆ Import history</button>
    </div>
    <input type="file" id="histImportInput" accept=".json" hidden onchange="histImport(event)" />`;
}
async function histRemove(id) {
  const r = HIST.runs.find(x => x.id === id);
  if (!r || !(await askConfirm(`Remove "${r.event}" (${r.date}) from player history?`, { okLabel: 'Remove', danger: true }))) return;
  HIST.runs = HIST.runs.filter(x => x.id !== id);
  histSave();
  renderWizard();
}
function histExport() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(HIST, null, 1)], { type: 'application/json' }));
  a.download = 'draftday-player-history.json';
  a.click();
  showToast('Player history exported');
}
function histImport(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const rd = new FileReader();
  rd.onload = ev => {
    try {
      const h = JSON.parse(ev.target.result);
      if (!h || !Array.isArray(h.runs)) throw new Error('not history');
      let added = 0;
      h.runs.forEach(r => {
        if (r && r.id && r.results && !HIST.runs.some(x => x.id === r.id)) {
          HIST.runs.push(r);
          added++;
        }
      });
      histSave();
      renderWizard();
      showToast(added ? `${added} event${added !== 1 ? 's' : ''} added to player history` : 'Those events are already in history');
    } catch (err) {
      showToast('That file isn’t a player history export');
    }
  };
  rd.readAsText(f);
}
