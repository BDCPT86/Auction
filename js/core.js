/*
 * Draft Day: Shared state and rules
 * ---------------------------------
 * The live event data (teams, players, the log), squad and tier rules, player status,
 * and reading player lists (CSV or pasted). Everything else builds on these.
 */

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
