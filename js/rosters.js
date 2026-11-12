/*
 * Draft Day: Rosters
 * ------------------
 * The roster pop-up, and fixing rosters after the fact: add, remove, replace or remove a pick.
 */

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
        <div style="font-family:'Anton',sans-serif;font-size:1.5rem;color:${teamInk(t.color)}">${zarFmt(t.budget)}</div>
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

  const price = noMoney() ? 0 : parseMoney(priceInp.value);
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
  const minRequired = noMoney() ? 0 : openingMin(mp);
  if (price < minRequired) {
    showErr(`Minimum price for this player is ${zarFmt(minRequired)}.`);
    return;
  }

  if (price > t.budget) {
    showErr(`${t.name} only has ${zarFmt(t.budget)} — can't afford ${zarFmt(price)}.`);
    return;
  }

  // Assign
  commit(`added ${mp.name} to ${t.name}`, () => {
    t.budget -= price;
    t.players.push(setStatus({ ...mp, finalPrice: price, teamId }, 'sold'));
    setStatus(mp, 'sold');
    mp.teamId = teamId;
    mp.finalPrice = price;
    auctionLog.push({ player: mp.name, tier: mp.tier || '', team: t.name, teamColor: t.color, basePrice: mp.price, finalPrice: price });
  });
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
  commit(`removed ${p.name} from ${t.name}`, () => {
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
  });
  showToast(`${playerName} removed — ${zarFmt(p.finalPrice || 0)} refunded to ${t.name}`);
}

// ── Editing pre-auction picks after launch ──
const auctionOpen = () => document.getElementById('appScreen').style.display === 'flex';
const samePlayer = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

function findPick(teamId, name) {
  const t = teams.find(x => x.id === teamId);
  const p = t && t.players.find(x => x.isFormer && x.name === name);
  return { t, p, round: p && selRounds[p.roundIdx], def: p && allRounds()[p.roundIdx] };
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
  commit(`removed pick ${name} from ${t.name}`, () => {
    t.budget += p.finalPrice || 0;
    t.players = t.players.filter(x => x !== p);
    if (round) {
      const rp = round.players.find(x => samePlayer(x.name, name));
      if (rp) rp.pickedBy = null;
      const i = round.picks.indexOf(name);
      if (i !== -1) round.picks[i] = null;
    }
  });
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
        return `<div class="swap-option${c.why ? ' broke dim-more no-click' : ''}" data-in-name="${c.rp.name.replace(/'/g, '&#39;')}"
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
  closeSwapPicker();
  commit(`replaced pick ${outName} with ${inName} (${t.name})`, () => {
    t.budget -= c.diff;
    const oldRp = round.players.find(x => samePlayer(x.name, outName));
    if (oldRp) oldRp.pickedBy = null;
    c.rp.pickedBy = t.id;
    const i = round.picks.indexOf(outName);
    if (i !== -1) round.picks[i] = inName;
    Object.assign(p, { name: c.rp.name, price: c.rp.price, tier: c.rp.tier, finalPrice: c.cost });
  });
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
