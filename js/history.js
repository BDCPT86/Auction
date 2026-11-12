/*
 * Draft Day: Bid History
 * ----------------------
 * The Bid History panel: chronological, by team, by tier and the summary.
 */

// ── BID HISTORY ──────────────────────────────────────────────────────────────
let _bhTab = 'feed';

function openBidHistory() {
  const overlay = document.getElementById('bhOverlay');
  overlay.classList.add('open');
  const total = auctionLog.length;
  const totalSpend = auctionLog.reduce((s, e) => s + e.finalPrice, 0);
  document.getElementById('bhSub').textContent = total
    ? `${total} player${total !== 1 ? 's' : ''} signed · ${zarFmt(totalSpend)} total spent`
    : 'No bids yet';
  renderBhTab(_bhTab);
}

function closeBidHistory() {
  document.getElementById('bhOverlay').classList.remove('open');
}

function switchBhTab(tab) {
  _bhTab = tab;
  ['feed', 'team', 'tier', 'stats'].forEach(t => {
    document.getElementById('bhTab' + t.charAt(0).toUpperCase() + t.slice(1)).classList.toggle('active', t === tab);
  });
  renderBhTab(tab);
}

function renderBhTab(tab) {
  const body = document.getElementById('bhBody');
  if (!auctionLog.length) {
    body.innerHTML =
      '<div class="bh-empty">🎯 No bids recorded yet.<br><span class="fs-sm">Sign players during the auction to see history here.</span></div>';
    return;
  }
  if (tab === 'feed') body.innerHTML = renderBhFeed();
  if (tab === 'team') body.innerHTML = renderBhByTeam();
  if (tab === 'tier') body.innerHTML = renderBhByTier();
  if (tab === 'stats') body.innerHTML = renderBhStats();
  // Animate bars after render
  requestAnimationFrame(() => {
    body.querySelectorAll('[data-w]').forEach(el => {
      el.style.width = el.dataset.w + '%';
    });
  });
}

function markupLabel(basePrice, finalPrice) {
  if (!basePrice || basePrice === 0) return '';
  const pct = Math.round(((finalPrice - basePrice) / basePrice) * 100);
  if (pct > 0) return `<span class="bh-feed-markup bh-markup-up">+${pct}%</span>`;
  if (pct < 0) return `<span class="bh-feed-markup bh-markup-under">${pct}%</span>`;
  return `<span class="bh-feed-markup bh-markup-base">Base</span>`;
}

function renderBhFeed() {
  const rows = [...auctionLog]
    .reverse()
    .map((e, ri) => {
      const pick = auctionLog.length - ri;
      const tierHtml = tierPill(e.tier);
      const markup = markupLabel(e.basePrice, e.finalPrice);
      const trailCount = e.bidTrail ? e.bidTrail.filter(b => !b.isPast).length : 0;
      const trailHtml =
        e.bidTrail && e.bidTrail.length
          ? `
      <div class="bh-trail-expand" id="bhtrail-${pick}" style="display:none">
        <div class="bh-mini-trail">
          ${e.bidTrail
            .map(b =>
              b.isPast
                ? `<div class="bh-mini-trail-row pass"><span class="trail-dot" style="background:${b.teamColor}"></span><span class="bh-mini-team">${esc(b.teamName)}</span><span class="bh-mini-action pass">Passed</span></div>`
                : `<div class="bh-mini-trail-row"><span class="trail-dot" style="background:${b.teamColor}"></span><span class="bh-mini-team">${esc(b.teamName)}</span><span class="bh-mini-action bid">${zarS(b.amount)}</span>${b.isNewHigh ? '<span class="trail-new-high">↑</span>' : ''}</div>`,
            )
            .join('')}
        </div>
      </div>`
          : '';
      const trailToggle =
        e.bidTrail && e.bidTrail.length
          ? `<button class="bh-trail-toggle" data-action="toggleBhTrail" data-args='[${pick}]' data-el>${trailCount} bid${trailCount !== 1 ? 's' : ''} ▾</button>`
          : '';
      return `<div class="bh-feed-row">
      <div class="bh-feed-num">#${pick}</div>
      <div class="bh-feed-dot" style="background:${e.teamColor}"></div>
      <div class="flex-1 min-w-0">
        <div class="row gap-xs wrap">
          <span class="bh-feed-player">${esc(e.player)}</span>
          ${tierHtml}
          ${e.unsoldRound ? '<span class="unsold-tag" title="Bought in the unsold round">2ND ROUND</span>' : ''}
          ${trailToggle}
        </div>
        <div class="bh-feed-meta">→ <strong style="color:${e.teamColor}">${esc(e.team)}</strong></div>
        ${trailHtml}
      </div>
      <div class="ta-right shrink-0">
        <div class="bh-feed-price">${zarS(e.finalPrice)}</div>
        <div class="mt-2xs">${markup}</div>
      </div>
    </div>`;
    })
    .join('');
  return `<div class="bh-feed">${rows}</div>`;
}

function toggleBhTrail(pick, btn) {
  const el = document.getElementById('bhtrail-' + pick);
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  btn.textContent = btn.textContent.replace(open ? '▴' : '▾', open ? '▾' : '▴');
}

function renderBhByTeam() {
  if (!teams.length) return '<div class="bh-empty">No teams loaded.</div>';
  const sections = teams
    .map(t => {
      const totalBudget = startBudget(t);
      const entries = auctionLog.filter(e => e.team === t.name);
      if (!entries.length)
        return `
      <div class="bh-team-section">
        <div class="bh-team-hdr">
          <div class="bh-team-hdr-dot" style="background:${t.color}"></div>
          <div class="bh-team-hdr-name">${esc(t.name)}</div>
          <div class="t-muted fs-sm">No signed players</div>
        </div>
      </div>`;
      const totalSpend = entries.reduce((s, e) => s + e.finalPrice, 0);
      const spentPct = Math.min(100, Math.round((totalSpend / totalBudget) * 100));
      const rows = entries
        .map((e, i) => {
          const markup = markupLabel(e.basePrice, e.finalPrice);
          const tierHtml = tierPill(e.tier);
          return `<div class="bh-team-row">
        <div>
          <span class="fw-600">${esc(e.player)}</span>
          <span class="ml-xs">${tierHtml}</span>
        </div>
        <div>${markup}</div>
        <div class="t-display-gold">${zarS(e.finalPrice)}</div>
      </div>`;
        })
        .join('');
      return `
      <div class="bh-team-section">
        <div class="bh-team-hdr" style="border-left:3px solid ${t.color}">
          <div class="bh-team-hdr-dot" style="background:${t.color}"></div>
          <div class="bh-team-hdr-name">${esc(t.name)}</div>
          <div class="ta-right">
            <div class="bh-team-hdr-spend">${zarS(totalSpend)}</div>
            <div class="bh-team-hdr-budget">${zarS(t.budget)} remaining · ${entries.length} player${entries.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <div class="bh-team-bar-wrap"><div class="bh-team-bar" style="background:${t.color};width:0" data-w="${spentPct}"></div></div>
        <div class="bh-team-rows">${rows}</div>
      </div>`;
    })
    .join('');
  return `<div class="bh-team-sections">${sections}</div>`;
}

function renderBhByTier() {
  const tiers = [...EV.tiers.map(t => t.name), ''];
  const sections = tiers
    .map(tier => {
      const entries = auctionLog.filter(e => (normTier(e.tier) || '') === tier);
      if (!entries.length) return '';
      const total = entries.reduce((s, e) => s + e.finalPrice, 0);
      const tierCls = tierClass(tier);
      const rows = entries
        .map((e, i) => {
          const markup = markupLabel(e.basePrice, e.finalPrice);
          return `<div class="bh-tier-row">
        <div class="row gap-sm">
          <div style="width:8px;height:8px;border-radius:50%;background:${e.teamColor};flex-shrink:0"></div>
          <span class="fw-600">${esc(e.player)}</span>
          <span class="t-muted fs-xs">→ ${esc(e.team)}</span>
        </div>
        <div>${markup}</div>
        <div class="t-display-gold">${zarS(e.finalPrice)}</div>
      </div>`;
        })
        .join('');
      return `
      <div class="bh-tier-section">
        <div class="bh-tier-hdr">
          ${tier ? `<span class="tier-badge ${tierCls}">${tier}</span>` : `<span class="t-muted fs-sm">Untiered</span>`}
          <span class="t-muted fs-sm ml-auto">${entries.length} player${entries.length !== 1 ? 's' : ''} · ${zarS(total)} total</span>
        </div>
        <div class="bh-tier-rows">${rows}</div>
      </div>`;
    })
    .join('');
  return `<div class="bh-tier-sections">${sections}</div>`;
}

function renderBhStats() {
  const total = auctionLog.length;
  const totalSpend = auctionLog.reduce((s, e) => s + e.finalPrice, 0);
  const avg = total ? Math.round(totalSpend / total) : 0;
  const topBid = total ? auctionLog.reduce((a, b) => (b.finalPrice > a.finalPrice ? b : a)) : null;
  const mostExpTeam = teams.length
    ? teams.reduce((a, b) => {
        const spendA = auctionLog.filter(e => e.team === a.name).reduce((s, e) => s + e.finalPrice, 0);
        const spendB = auctionLog.filter(e => e.team === b.name).reduce((s, e) => s + e.finalPrice, 0);
        return spendB > spendA ? b : a;
      })
    : null;
  const mostExpSpend = mostExpTeam ? auctionLog.filter(e => e.team === mostExpTeam.name).reduce((s, e) => s + e.finalPrice, 0) : 0;
  const bestValue = total
    ? auctionLog
        .filter(e => e.basePrice > 0)
        .reduce((best, e) => {
          const ratio = e.finalPrice / e.basePrice;
          return !best || ratio < best.ratio ? { ...e, ratio } : best;
        }, null)
    : null;
  const mostOverbid = total
    ? auctionLog
        .filter(e => e.basePrice > 0)
        .reduce((best, e) => {
          const over = e.finalPrice - e.basePrice;
          return !best || over > best.over ? { ...e, over } : best;
        }, null)
    : null;

  // Team spend bars
  const maxSpend = Math.max(...teams.map(t => auctionLog.filter(e => e.team === t.name).reduce((s, e) => s + e.finalPrice, 0)), 1);
  const spendBars = teams
    .map(t => {
      const spend = auctionLog.filter(e => e.team === t.name).reduce((s, e) => s + e.finalPrice, 0);
      const pct = Math.round((spend / maxSpend) * 100);
      return `<div class="bh-spend-bar-row">
      <div class="bh-spend-bar-name">
        <div style="width:9px;height:9px;border-radius:50%;background:${t.color};flex-shrink:0"></div>
        ${esc(t.name)}
      </div>
      <div class="bh-spend-bar-track">
        <div class="bh-spend-bar-fill" style="background:${t.color};width:0" data-w="${pct}"></div>
      </div>
      <div class="bh-spend-bar-amt">${zarS(spend)}</div>
    </div>`;
    })
    .join('');

  return `
    <div class="bh-stats-grid">
      <div class="bh-stat-card">
        <div class="bh-stat-label">Total Players Signed</div>
        <div class="bh-stat-val c-accent">${total}</div>
        <div class="bh-stat-sub">${players.filter(p => !p.sold).length} still available</div>
      </div>
      <div class="bh-stat-card">
        <div class="bh-stat-label">Total Spend</div>
        <div class="bh-stat-val c-gold">${zarS(totalSpend)}</div>
        <div class="bh-stat-sub">Avg ${zarS(avg)} per player</div>
      </div>
      <div class="bh-stat-card">
        <div class="bh-stat-label">Highest Bid</div>
        <div class="bh-stat-val c-green">${topBid ? zarS(topBid.finalPrice) : '—'}</div>
        <div class="bh-stat-sub">${topBid ? `${esc(topBid.player)} → ${esc(topBid.team)}` : '—'}</div>
      </div>
      <div class="bh-stat-card">
        <div class="bh-stat-label">Biggest Spender</div>
        <div class="bh-stat-val" style="color:${mostExpTeam?.color || 'var(--text)'};font-size:1.1rem">${mostExpTeam ? esc(mostExpTeam.name) : '—'}</div>
        <div class="bh-stat-sub">${mostExpTeam ? zarS(mostExpSpend) + ' spent' : ''}</div>
      </div>
    </div>
    ${
      bestValue
        ? `
    <div class="bh-stats-grid mb-lg">
      <div class="bh-stat-card">
        <div class="bh-stat-label">Best Value Pick</div>
        <div class="bh-stat-val c-green fs-lg">${esc(bestValue.player)}</div>
        <div class="bh-stat-sub">${zarS(bestValue.finalPrice)} (base ${zarS(bestValue.basePrice)}) · ${esc(bestValue.team)}</div>
      </div>
      <div class="bh-stat-card">
        <div class="bh-stat-label">Most Overbid</div>
        <div class="bh-stat-val c-red fs-lg">${esc(mostOverbid.player)}</div>
        <div class="bh-stat-sub">+${zarS(mostOverbid.over)} over base · ${esc(mostOverbid.team)}</div>
      </div>
    </div>`
        : ''
    }
    <div class="bh-section-title">SPEND BY TEAM</div>
    <div class="bh-spend-bars">${spendBars}</div>
  `;
}
