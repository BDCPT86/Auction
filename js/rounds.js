/*
 * Draft Day: Pre-rounds and the captains' draft
 * ---------------------------------------------
 * Teams take turns picking from a round's list. A captains' draft runs on the same
 * screen, with the draft itself as the last round.
 */

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
  refresh();
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
      const past = pastLine(p.name);
      return `<div class="sel-player-card${taken ? ' taken' : ''}${why ? ' blocked' : ''}" ${why || past ? `title="${esc(why || 'Last time · ' + past)}"` : ''} data-action="selPickPlayer" data-args='["${p.id}"]'>
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
  commit(`${team.name} picked ${p.name}`, () => {
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
  });
}

function selSkipTurn() {
  const s = SR();
  if (s.done) return;
  commit(`skipped ${(selCurrentTeam() || {}).name}'s pick`, () => {
    s.picks[s.pickIdx] = null;
    s.pickIdx++;
    selAfterTurn();
  });
}

async function selResetPicks() {
  if (!(await askConfirm(`Clear every pick in "${RD().name}" and start this round again?`, { okLabel: 'Reset round', danger: true })))
    return;
  const s = SR();
  commit(`reset of ${RD().name}`, () => {
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
  });
  showToast('Picks reset — starting from pick 1');
}

function selPrevRound() {
  if (selRoundIdx > 0) selectionRoundInit(selRoundIdx - 1);
}

const selMake = row => ({ id: nextId(), name: row.name, price: row.price, tier: row.tier, pickedBy: null });
function loadRoundText(i, text, quiet) {
  loadRowsInto(selRounds[i].players, text, selMake, () => commit(), quiet);
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
