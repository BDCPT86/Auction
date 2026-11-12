/*
 * Draft Day: Admin
 * ----------------
 * The Admin panel for a live event: team names, colours, budgets, captains and the rules.
 */

// ── ADMIN PANEL (during the event) ──────────────────────────────────────────
// Setup happens in the wizard; Admin adjusts a live event.
function openAdmin() {
  if (!teams.length) return;
  const overlay = document.getElementById('adminOverlay');
  overlay.classList.remove('hidden');
  overlay.style.display = 'flex';
  switchAdminTab('teams');
  renderAdminTeams();
  renderAdminRules();
}
function closeAdmin() {
  document.getElementById('adminOverlay').style.display = 'none';
}
function switchAdminTab(tab) {
  document.getElementById('adminTabTeams').style.display = tab === 'teams' ? 'block' : 'none';
  document.getElementById('adminTabRules').style.display = tab === 'rules' ? 'block' : 'none';
  document.getElementById('tabTeams').classList.toggle('active', tab === 'teams');
  document.getElementById('tabRules').classList.toggle('active', tab === 'rules');
}

function renderAdminTeams() {
  const showCap = EV.captains || teams.some(t => t.players.some(p => p.isCaptain));
  document.getElementById('adminTeamsGrid').innerHTML = teams
    .map(t => {
      const cap = (t.players.find(p => p.isCaptain) || {}).name || '';
      return `<div class="admin-team-row" id="adminTeamRow${t.id}">
      <div class="rel shrink-0">
        <div class="admin-team-color-swatch" style="background:${t.color}" data-action="clickEl" data-args='["acp${t.id}"]' title="Change colour"></div>
        <input type="color" class="admin-color-picker" id="acp${t.id}" value="${t.color}" onchange="previewTeamColor(${t.id},this.value)"/>
      </div>
      <div class="col-stack">
        <input class="admin-team-name-inp" id="atn${t.id}" value="${esc(t.name)}" placeholder="Team ${t.id + 1}" maxlength="32"/>
        ${showCap ? `<input class="admin-team-name-inp fs-sm fw-500" id="atc${t.id}" value="${esc(cap)}" placeholder="👑 Captain" maxlength="40"/>` : ''}
      </div>
      <div class="admin-team-budget-wrap" title="Budget left" ${isRandom() ? 'hidden' : ''}>
        <input type="number" class="admin-team-budget-inp" id="atb${t.id}" value="${t.budget}" min="0" step="${EV.bidding.increment}"/>
      </div>
    </div>`;
    })
    .join('');
}
function previewTeamColor(teamId, hexVal) {
  const sw = document.querySelector(`#adminTeamRow${teamId} .admin-team-color-swatch`);
  if (sw) sw.style.background = hexVal;
}

function renderAdminRules() {
  const b = EV.bidding;
  const row = (label, desc, ctl) =>
    `<div class="admin-rule-row"><div class="admin-rule-info"><div class="admin-rule-label">${label}</div><div class="admin-rule-desc">${desc}</div></div><div class="admin-rule-control">${ctl}</div></div>`;
  const money = (id, v) =>
    `<span class="admin-inp-prefix">${esc(EV.currency)}</span><input type="number" class="admin-inp" id="${id}" value="${v}" min="0"/>`;
  const tog = (id, v) =>
    `<label class="admin-toggle"><input type="checkbox" id="${id}" ${v ? 'checked' : ''}/><span class="admin-toggle-slider"></span></label>`;
  const n = (id, v, suf) =>
    `<input type="number" class="admin-inp admin-inp-sm" id="${id}" value="${v}" min="0"/>${suf ? `<span class="admin-inp-suffix">${suf}</span>` : ''}`;
  const R = isRandom();
  // In a random draw the money rules don't apply: they stay in the page (hidden) so Apply keeps them as they were
  document.getElementById('adminRulesBody').innerHTML = `
    ${R ? `<div class="admin-section-label">Squads</div><div class="admin-rules-grid">${row('Players drawn per team', '0 = no limit', n('ruleSquadR', EV.squadSize))}</div>` : ''}
    <div ${R ? 'hidden' : ''}>
    <div class="admin-section-label">Bidding</div><div class="admin-rules-grid">
      ${row('Bid increment', 'The step between bids', money('ruleIncrement', b.increment))}
      ${row('Enforce the increment', 'Bids must beat the leader by at least the increment', tog('ruleEnforce', b.enforceIncrement))}
      ${row('Pre-fill bid boxes', 'Show the next valid amount in each box', tog('rulePrefill', b.prefill))}
      ${row('Auto-sell', 'Sell once every other team has passed', tog('ruleAutoSell', b.autoSell))}
      ${row('Purse reserve', 'Teams must keep enough to fill their squad', tog('ruleReserve', b.reserve))}
      ${row('Type bids in thousands', 'Type 350 for 350 000', tog('ruleThousands', b.inThousands))}
      ${row('Timer', 'Seconds per player (0 = off). Applies from the next player', n('ruleTimer', b.timer, 'sec'))}
      ${row('New bid restarts the timer', '', tog('ruleTimerReset', b.timerResetsOnBid))}
      ${row('Players bought per team', '0 = no limit', n('ruleSquad', EV.squadSize))}
      ${row('Unsold queue and round', 'Unsold players wait for a second, discounted round', tog('ruleUnsold', EV.unsold.enabled))}
      ${row('Price cut in the unsold round', '% off opening bids', n('ruleUnsoldDiscount', EV.unsold.discount, '% off'))}
    </div></div>
    ${
      EV.tiers.length
        ? `<div class="admin-section-label wiz-gap">Tiers</div><div class="admin-rules-grid">
      ${EV.tiers
        .map((t, i) =>
          row(
            `${tierPill(t.name)} ${esc(t.name)}`,
            R ? 'Max per team (0 = no limit)' : 'Min opening bid · max per team (0 = no limit)',
            `<span ${R ? 'hidden' : ''}><span class="admin-inp-prefix">${esc(EV.currency)}</span><input type="number" class="admin-inp" id="ruleTierMin${i}" value="${t.minBid}" min="0"/></span>
         <input type="number" class="admin-inp admin-inp-sm ml-xs" id="ruleTierLimit${i}" value="${t.limit}" min="0"/>`,
          ),
        )
        .join('')}
    </div>`
        : ''
    }
    <div class="admin-rule-desc mt-lg">Team count, rounds and tier names are set in the setup wizard before launch.</div>`;
}

function applyAdmin() {
  let changes = 0;
  teams.forEach(t => {
    const oldName = t.name;
    const nameEl = document.getElementById('atn' + t.id),
      capEl = document.getElementById('atc' + t.id);
    const budgetEl = document.getElementById('atb' + t.id),
      colorEl = document.getElementById('acp' + t.id);
    if (capEl) {
      const newCap = capEl.value.trim(),
        cap = t.players.find(p => p.isCaptain);
      if (cap && newCap && newCap !== cap.name) {
        cap.name = newCap;
        changes++;
      } else if (cap && !newCap) {
        t.players = t.players.filter(p => !p.isCaptain);
        changes++;
      } else if (!cap && newCap) {
        t.players.unshift(setStatus({ id: nextId(), name: newCap, price: 0, tier: '', finalPrice: 0, teamId: t.id }, 'captain'));
        changes++;
      }
    }
    if (nameEl) {
      const newName = nameEl.value.trim() || t.name;
      if (newName !== t.name) {
        t.name = newName;
        changes++;
        auctionLog.forEach(e => {
          if (e.team === oldName) e.team = newName;
        }); // keep history attached
      }
    }
    if (budgetEl) {
      const v = Math.round(+budgetEl.value);
      if (Number.isFinite(v) && v !== t.budget) {
        t.budget = v;
        changes++;
      }
    }
    if (colorEl && colorEl.value !== t.color) {
      t.color = colorEl.value;
      changes++;
      auctionLog.forEach(e => {
        if (e.team === t.name) e.teamColor = t.color;
      });
    }
  });

  const val = id => document.getElementById(id);
  const before = JSON.stringify([EV.bidding, EV.squadSize, EV.tiers, EV.unsold]);
  EV.bidding = {
    increment: Math.max(1, +val('ruleIncrement').value || EV.bidding.increment),
    enforceIncrement: val('ruleEnforce').checked,
    prefill: val('rulePrefill').checked,
    autoSell: val('ruleAutoSell').checked,
    timer: Math.max(0, Math.round(+val('ruleTimer').value || 0)),
    timerResetsOnBid: val('ruleTimerReset').checked,
    reserve: val('ruleReserve').checked,
    inThousands: val('ruleThousands').checked,
  };
  EV.squadSize = Math.max(0, Math.round(+val(isRandom() ? 'ruleSquadR' : 'ruleSquad').value || 0));
  EV.tiers.forEach((t, i) => {
    t.minBid = Math.max(0, +val('ruleTierMin' + i).value || 0);
    t.limit = Math.max(0, Math.round(+val('ruleTierLimit' + i).value || 0));
  });
  EV.unsold = {
    enabled: val('ruleUnsold').checked,
    discount: Math.max(0, Math.min(90, Math.round(+val('ruleUnsoldDiscount').value || 0))),
  };
  if (JSON.stringify([EV.bidding, EV.squadSize, EV.tiers, EV.unsold]) !== before) {
    changes++;
    applyAuctionChrome();
  }
  EV.teams.forEach((c, i) => {
    const t = teams[i];
    if (!t) return;
    c.name = t.name;
    c.color = t.color;
    const cap = t.players.find(p => p.isCaptain);
    c.captain = cap ? cap.name : '';
  });
  saveWorking();

  if (changes > 0) refresh();
  closeAdmin();
  showToast(changes > 0 ? `✓ ${changes} change${changes > 1 ? 's' : ''} applied` : 'No changes made');
}
