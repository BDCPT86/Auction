/*
 * Draft Day: Image exports
 * ------------------------
 * The results image, team cards, sold/drawn cards, the recap card and the export window.
 */

function closeExport() {
  document.getElementById('exportOverlay').style.display = 'none';
}

// ── Results image: sizes and pages ──
const EXPORT_SIZES = {
  tall: { label: 'Full (one tall image)', w: 0, h: 0, per: 0 },
  square: { label: 'Square · 1080×1080', w: 1080, h: 1080, per: 4 },
  portrait: { label: 'Portrait · 1080×1350', w: 1080, h: 1350, per: 6 },
  story: { label: 'Story · 1080×1920', w: 1080, h: 1920, per: 8 },
};
let _exportSize = 'tall',
  _exportPage = 0,
  _exportType = 'results';

function resultsPages() {
  const s = EXPORT_SIZES[_exportSize] || EXPORT_SIZES.tall;
  if (!s.per || teams.length <= s.per) return [teams.slice()];
  const pages = [];
  for (let i = 0; i < teams.length; i += s.per) pages.push(teams.slice(i, i + s.per));
  return pages;
}

function renderResultsPage(canvas, pageIdx) {
  const s = EXPORT_SIZES[_exportSize] || EXPORT_SIZES.tall;
  const pages = resultsPages();
  const idx = Math.max(0, Math.min(pageIdx, pages.length - 1));
  const opts = {
    teams: pages[idx],
    unsold: idx === pages.length - 1,
    pageLabel: pages.length > 1 ? `${idx + 1} / ${pages.length}` : '',
  };
  if (!s.w) {
    renderExportCanvas(canvas, opts);
    return;
  }
  // Fixed size: try a few column layouts off-screen, keep the one that fills the frame best
  let off = null,
    best = -1;
  for (let c = 1; c <= Math.min(4, opts.teams.length); c++) {
    const cand = document.createElement('canvas');
    // Height doesn't depend on width, so measure once, then widen/narrow the cards to match the frame's shape
    renderExportCanvas(cand, { ...opts, cols: c, width: 80 + c * 460 + (c - 1) * 20 });
    const gaps = 80 + (c - 1) * 20;
    const w = Math.round(Math.max(gaps + c * 340, Math.min(gaps + c * 600, (cand.height * s.w) / s.h)));
    renderExportCanvas(cand, { ...opts, cols: c, width: w });
    const k = Math.min(s.w / cand.width, s.h / cand.height);
    if (k > best * 1.04) {
      best = k;
      off = cand;
    }
  }
  canvas.width = s.w;
  canvas.height = s.h;
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, s.w, s.h);
  bg.addColorStop(0, '#05080f');
  bg.addColorStop(0.5, '#0a1020');
  bg.addColorStop(1, '#040710');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, s.w, s.h);
  const k = Math.min(s.w / off.width, s.h / off.height);
  const dw = off.width * k,
    dh = off.height * k;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(off, (s.w - dw) / 2, (s.h - dh) / 2, dw, dh);
  ctx.fillStyle = '#f5b800';
  ctx.fillRect(0, 0, s.w, 5);
  ctx.fillRect(0, s.h - 5, s.w, 5);
}

// ── Social cards: one per team, one per signing (1080×1350) ──
const CARD_W = 1080,
  CARD_H = 1350;
const _cardImgs = {};
// Load an image for a canvas; null if it fails or would taint the canvas (some browsers, file://)
function cardImage(src) {
  if (!src) return Promise.resolve(null);
  if (_cardImgs[src] !== undefined) return Promise.resolve(_cardImgs[src]);
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      try {
        const t = document.createElement('canvas');
        t.width = t.height = 1;
        const g = t.getContext('2d');
        g.drawImage(img, 0, 0, 1, 1);
        g.getImageData(0, 0, 1, 1);
        _cardImgs[src] = img;
      } catch (e) {
        _cardImgs[src] = null;
      }
      res(_cardImgs[src]);
    };
    img.onerror = () => {
      _cardImgs[src] = null;
      res(null);
    };
    img.src = src;
  });
}
const svgSrc = svg =>
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(svg.includes('xmlns') ? svg : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'));

function cardBackdrop(ctx, color) {
  const bg = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  bg.addColorStop(0, '#05080f');
  bg.addColorStop(0.5, '#0a1020');
  bg.addColorStop(1, '#040710');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const glow = ctx.createRadialGradient(CARD_W / 2, 260, 0, CARD_W / 2, 260, 700);
  glow.addColorStop(0, rgba(color, 0.3));
  glow.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.strokeStyle = '#fff';
  for (let x = 0; x < CARD_W; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CARD_H);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = '#f5b800';
  ctx.fillRect(0, 0, CARD_W, 8);
  ctx.fillRect(0, CARD_H - 8, CARD_W, 8);
  ctx.letterSpacing = '0px';
}
function cardText(ctx, text, x, y, font, color, align, maxW, spacing) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align || 'center';
  ctx.letterSpacing = spacing || '0px';
  ctx.fillText(maxW ? truncate(ctx, text, maxW) : text, x, y);
  ctx.letterSpacing = '0px';
}
function cardFooter(ctx) {
  if (hasSponsor()) {
    // N5: sponsor on the left, hashtags on the right
    const img = sponsorImg();
    let x = 80;
    cardText(
      ctx,
      (EV.branding.sponsor.line || '').toUpperCase(),
      x,
      CARD_H - 58,
      '700 16px Barlow, sans-serif',
      'rgba(255,255,255,0.4)',
      'left',
      360,
      '3px',
    );
    if (img) {
      const h = 36,
        w = Math.min(220, (h * img.naturalWidth) / img.naturalHeight);
      roundRect(ctx, x - 6, CARD_H - 50, w + 12, h + 8, 6);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.drawImage(img, x, CARD_H - 46, w, (w * img.naturalHeight) / img.naturalWidth);
      x += w + 20;
    }
    cardText(ctx, EV.branding.sponsor.name.trim(), x, CARD_H - 22, '700 24px Barlow, sans-serif', 'rgba(255,255,255,0.75)', 'left', 360);
    cardText(
      ctx,
      (EV.branding.hashtags || EV.name).trim(),
      CARD_W - 80,
      CARD_H - 30,
      '500 22px Barlow, sans-serif',
      'rgba(255,255,255,0.38)',
      'right',
      CARD_W / 2 - 100,
    );
    return;
  }
  cardText(
    ctx,
    (EV.branding.hashtags || EV.name).trim(),
    CARD_W / 2,
    CARD_H - 46,
    '500 26px Barlow, sans-serif',
    'rgba(255,255,255,0.38)',
    'center',
    CARD_W - 120,
  );
}
async function cardLogo(ctx, team, cx, cy, r) {
  const img = (await cardImage(team.logo)) || (await cardImage(initialsBadge(team.name, team.color)));
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = '#111';
  ctx.fill();
  ctx.clip();
  if (img) {
    const side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height) || 1;
    ctx.drawImage(
      img,
      ((img.naturalWidth || img.width) - side) / 2,
      ((img.naturalHeight || img.height) - side) / 2,
      side,
      side,
      cx - r,
      cy - r,
      r * 2,
      r * 2,
    );
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 6;
  ctx.strokeStyle = team.color;
  ctx.stroke();
}
function cardTierPill(ctx, tier, x, y, h, align) {
  if (!tierDef(tier)) return 0;
  const label = tier.toUpperCase();
  ctx.font = `bold ${Math.round(h * 0.5)}px Barlow, sans-serif`;
  ctx.letterSpacing = '2px';
  const w = ctx.measureText(label).width + h * 0.9,
    x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  roundRect(ctx, x0, y, w, h, 6);
  ctx.fillStyle = rgba(tierColor(tier), 0.2);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = rgba(tierColor(tier), 0.6);
  ctx.stroke();
  ctx.fillStyle = mix(tierColor(tier), '#ffffff', 0.3);
  ctx.textAlign = 'center';
  ctx.fillText(label, x0 + w / 2, y + h * 0.68);
  ctx.letterSpacing = '0px';
  return w;
}

async function renderTeamCard(canvas, team) {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  cardBackdrop(ctx, team.color);
  cardText(
    ctx,
    (EV.branding.exportTitle || EV.name).toUpperCase(),
    CARD_W / 2,
    84,
    'bold 34px Anton, Impact, sans-serif',
    'rgba(255,255,255,0.55)',
    'center',
    CARD_W - 120,
    '4px',
  );
  await cardLogo(ctx, team, CARD_W / 2, 250, 120);
  cardText(ctx, team.name.toUpperCase(), CARD_W / 2, 452, 'bold 72px Anton, Impact, sans-serif', '#ffffff', 'center', CARD_W - 100, '2px');
  const cap = team.players.find(p => p.isCaptain);
  cardText(
    ctx,
    cap ? `CAPTAIN · ${cap.name.toUpperCase()}` : 'OFFICIAL SQUAD',
    CARD_W / 2,
    500,
    '700 26px Barlow, sans-serif',
    team.color,
    'center',
    CARD_W - 120,
    '4px',
  );

  const squad = team.players.filter(p => !p.isCaptain);
  const top = 548,
    bottom = CARD_H - 230;
  const rowH = squad.length ? Math.max(40, Math.min(70, (bottom - top) / squad.length)) : 70;
  const fs = Math.round(rowH * 0.46);
  squad.slice(0, Math.floor((bottom - top) / rowH)).forEach((p, i) => {
    const y = top + i * rowH;
    if (i % 2 === 0) {
      roundRect(ctx, 80, y, CARD_W - 160, rowH - 6, 10);
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.fill();
    }
    const mid = y + (rowH - 6) / 2;
    let x = 110;
    if (p.isFormer) {
      cardText(ctx, '🏅', x, mid + fs * 0.36, `${fs}px serif`, '#fff', 'left');
      x += fs * 1.35;
    }
    const priceTxt = p.isFormer
      ? p.finalPrice
        ? zarS(p.finalPrice)
        : (p.roundName || 'Pick').toUpperCase()
      : isRandom()
        ? p.drawNo
          ? '#' + p.drawNo
          : ''
        : zarS(p.finalPrice || 0);
    ctx.font = `bold ${fs}px Barlow, sans-serif`;
    const priceW = ctx.measureText(priceTxt).width;
    const pillW = tierDef(p.tier)
      ? (() => {
          ctx.font = `bold ${Math.round(rowH * 0.42 * 0.5)}px Barlow, sans-serif`;
          ctx.letterSpacing = '2px';
          const w = ctx.measureText(p.tier.toUpperCase()).width + rowH * 0.42 * 0.9;
          ctx.letterSpacing = '0px';
          return w;
        })()
      : 0;
    cardText(
      ctx,
      p.name,
      x,
      mid + fs * 0.36,
      `600 ${fs}px Barlow, sans-serif`,
      p.isFormer ? '#e0a878' : '#eef2f7',
      'left',
      CARD_W - 110 - x - priceW - pillW - 60,
    );
    cardText(
      ctx,
      priceTxt,
      CARD_W - 110,
      mid + fs * 0.36,
      `bold ${fs}px Barlow, sans-serif`,
      p.isFormer && !p.finalPrice ? '#c07840' : '#f5b800',
      'right',
    );
    if (pillW) cardTierPill(ctx, p.tier, CARD_W - 110 - priceW - 24, mid - rowH * 0.21, rowH * 0.42, 'right');
  });
  if (!squad.length)
    cardText(ctx, 'Squad to be announced', CARD_W / 2, top + 80, 'italic 32px Barlow, sans-serif', 'rgba(255,255,255,0.4)');

  const spent = startBudget(team) - team.budget;
  const stats = isDraft()
    ? [
        ['SQUAD', squadText(team)],
        ['PICKED', String(team.players.filter(p => p.isFormer).length)],
        ['FORMAT', 'DRAFT'],
      ]
    : isRandom()
      ? [
          ['SQUAD', squadText(team)],
          ['DRAWN', String(team.players.filter(p => p.drawn).length)],
          ['DRAW CODE', fmtCode(alloc.seed)],
        ]
      : [
          ['SPENT', zarS(spent)],
          ['LEFT', zarS(team.budget)],
          ['SQUAD', squadText(team)],
        ];
  const sw = (CARD_W - 160) / 3;
  stats.forEach(([k, v], i) => {
    const x = 80 + sw * i + sw / 2;
    cardText(ctx, v, x, CARD_H - 140, 'bold 50px Anton, Impact, sans-serif', i === 0 ? '#f5b800' : '#ffffff');
    cardText(ctx, k, x, CARD_H - 104, '700 20px Barlow, sans-serif', 'rgba(255,255,255,0.45)', 'center', 0, '4px');
  });
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(80, CARD_H - 200);
  ctx.lineTo(CARD_W - 80, CARD_H - 200);
  ctx.stroke();
  cardFooter(ctx);
}

async function renderSoldCard(canvas, sale) {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!sale) {
    cardBackdrop(ctx, '#00c8ff');
    cardText(
      ctx,
      isRandom() ? 'NOTHING DRAWN YET' : 'NO SIGNINGS YET',
      CARD_W / 2,
      CARD_H / 2,
      'bold 80px Anton, Impact, sans-serif',
      'rgba(255,255,255,0.5)',
    );
    return;
  }
  const team = teams.find(t => t.name === sale.team) || { name: sale.team, color: sale.teamColor || '#00c8ff', logo: '' };
  cardBackdrop(ctx, team.color);
  cardText(
    ctx,
    (EV.branding.exportTitle || EV.name).toUpperCase(),
    CARD_W / 2,
    84,
    'bold 34px Anton, Impact, sans-serif',
    'rgba(255,255,255,0.55)',
    'center',
    CARD_W - 120,
    '4px',
  );
  cardText(ctx, isRandom() ? 'DRAWN!' : 'SOLD!', CARD_W / 2, 286, 'bold 170px Anton, Impact, sans-serif', '#f5b800', 'center', 0, '6px');
  const art = await cardImage(svgSrc(generatePlayerSVG(sale.player)));
  if (art) ctx.drawImage(art, CARD_W / 2 - 130, 312, 260, 260);
  cardText(
    ctx,
    sale.player.toUpperCase(),
    CARD_W / 2,
    650,
    'bold 92px Anton, Impact, sans-serif',
    '#ffffff',
    'center',
    CARD_W - 100,
    '2px',
  );
  let y = 680;
  if (tierDef(sale.tier)) {
    cardTierPill(ctx, sale.tier, CARD_W / 2, y, 46, 'center');
    y += 46;
  }
  cardText(
    ctx,
    isRandom() ? 'JOINS' : 'SIGNS FOR',
    CARD_W / 2,
    y + 62,
    '700 26px Barlow, sans-serif',
    'rgba(255,255,255,0.5)',
    'center',
    0,
    '6px',
  );
  await cardLogo(ctx, team, CARD_W / 2, y + 146, 64);
  cardText(
    ctx,
    team.name.toUpperCase(),
    CARD_W / 2,
    y + 268,
    'bold 56px Anton, Impact, sans-serif',
    team.color,
    'center',
    CARD_W - 120,
    '2px',
  );
  if (sale.drawn) {
    cardText(ctx, `DRAW #${sale.drawNo}`, CARD_W / 2, CARD_H - 140, 'bold 92px Anton, Impact, sans-serif', '#f5b800');
    cardText(
      ctx,
      `DRAW CODE ${fmtCode(alloc.seed)}${sale.options > 1 ? ` · 1 OF ${sale.options} TEAMS` : ''}`,
      CARD_W / 2,
      CARD_H - 92,
      '700 22px Barlow, sans-serif',
      'rgba(255,255,255,0.45)',
      'center',
      0,
      '4px',
    );
    cardFooter(ctx);
    return;
  }
  cardText(ctx, zarS(sale.finalPrice), CARD_W / 2, CARD_H - 140, 'bold 104px Anton, Impact, sans-serif', '#f5b800');
  const bids = (sale.bidTrail || []).filter(b => !b.isPast).length;
  cardText(
    ctx,
    `BASE ${zarS(sale.basePrice)}${bids ? ` · ${bids} BID${bids !== 1 ? 'S' : ''}` : ''}${sale.unsoldRound ? ' · UNSOLD ROUND' : ''}`,
    CARD_W / 2,
    CARD_H - 92,
    '700 22px Barlow, sans-serif',
    'rgba(255,255,255,0.45)',
    'center',
    0,
    '4px',
  );
  cardFooter(ctx);
}

// ── N4: recap — the headline numbers and a few highlights, for a card and a PDF page ──
const sponsorText = () => `${(EV.branding.sponsor.line || '').trim()} ${EV.branding.sponsor.name.trim()}`.trim();
function recapData() {
  const placed = teams.flatMap(t => t.players.filter(p => !p.isCaptain).map(p => ({ ...p, team: t })));
  const H = [],
    stats = [[String(teams.length), 'Teams']];
  if (isDraft()) {
    const picks = selRounds[allRounds().length - 1] || { picks: [] };
    const order = (picks.turnOrder || []).map((id, i) => ({ id, name: picks.picks[i] })).filter(x => x.name);
    stats.push([String(order.length), 'Players drafted'], [EV.draft.order === 'snake' ? 'SNAKE' : 'STRAIGHT', 'Pick order']);
    const tm = id => teams.find(t => t.id === id) || {};
    if (order[0]) H.push({ label: 'First pick', title: order[0].name, sub: tm(order[0].id).name, color: tm(order[0].id).color });
    if (order.length > 1) {
      const l = order[order.length - 1];
      H.push({ label: 'Last pick', title: l.name, sub: tm(l.id).name, color: tm(l.id).color });
    }
  } else if (isRandom()) {
    const log = auctionLog.filter(e => e.drawn);
    stats.push([String(log.length), 'Players drawn'], [fmtCode(alloc.seed) || '—', 'Draw code']);
    if (log[0]) H.push({ label: 'First out of the hat', title: log[0].player, sub: log[0].team, color: log[0].teamColor, value: '#1' });
    if (log.length > 1) {
      const l = log[log.length - 1];
      H.push({ label: 'Last one drawn', title: l.player, sub: l.team, color: l.teamColor, value: '#' + l.drawNo });
    }
    if (EV.tiers.length && log.length)
      H.push({
        label: 'Balance',
        title: EV.random.balance ? 'Tier-balanced draw' : 'One hat',
        sub: teams.map(t => `${t.name}: ${tierMix(t) || '—'}`).join(' · '),
      });
  } else {
    const sales = auctionLog.filter(e => !e.drawn);
    const spent = teams.reduce((a, t) => a + startBudget(t) - t.budget, 0);
    stats.push(
      [String(sales.length), 'Players sold'],
      [zarS(spent), 'Total spent'],
      [sales.length ? zarS(Math.round(spent / Math.max(1, placed.filter(p => !p.isFormer).length))) : '—', 'Average buy'],
    );
    const bids = e => (e.bidTrail || []).filter(b => !b.isPast).length;
    const top = [...sales].sort((a, b) => b.finalPrice - a.finalPrice)[0];
    if (top) H.push({ label: 'Top buy', title: top.player, sub: top.team, color: top.teamColor, value: zarS(top.finalPrice) });
    const war = [...sales].sort((a, b) => bids(b) - bids(a))[0];
    if (war && bids(war) > 2 && war !== top)
      H.push({
        label: 'Biggest bidding war',
        title: war.player,
        sub: `${bids(war)} bids · ${war.team}`,
        color: war.teamColor,
        value: zarS(war.finalPrice),
      });
    const steal = sales.filter(e => e.basePrice > 0 && e.finalPrice <= e.basePrice).sort((a, b) => b.basePrice - a.basePrice)[0];
    if (steal && steal !== top)
      H.push({
        label: 'Bargain of the day',
        title: steal.player,
        sub: `${steal.team} · base ${zarS(steal.basePrice)}`,
        color: steal.teamColor,
        value: zarS(steal.finalPrice),
      });
    const bySpend = [...teams].sort((a, b) => startBudget(b) - b.budget - (startBudget(a) - a.budget));
    if (sales.length && bySpend.length > 1) {
      H.push({
        label: 'Biggest spenders',
        title: bySpend[0].name,
        color: bySpend[0].color,
        value: zarS(startBudget(bySpend[0]) - bySpend[0].budget),
      });
      const thrift = bySpend[bySpend.length - 1];
      H.push({ label: 'Most left in the bank', title: thrift.name, color: thrift.color, value: zarS(thrift.budget) });
    }
  }
  return { stats, highlights: H.slice(0, 5) };
}
function renderRecapCard(canvas) {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d'),
    r = recapData();
  cardBackdrop(ctx, '#f5b800');
  cardText(
    ctx,
    (EV.branding.exportTitle || EV.name).toUpperCase(),
    CARD_W / 2,
    84,
    'bold 34px Anton, Impact, sans-serif',
    'rgba(255,255,255,0.55)',
    'center',
    CARD_W - 120,
    '4px',
  );
  cardText(ctx, 'THE DAY IN NUMBERS', CARD_W / 2, 200, 'bold 96px Anton, Impact, sans-serif', '#ffffff', 'center', CARD_W - 100, '2px');
  const sw = (CARD_W - 160) / r.stats.length;
  r.stats.forEach(([v, k], i) => {
    const x = 80 + sw * i + sw / 2;
    cardText(ctx, v, x, 330, 'bold 60px Anton, Impact, sans-serif', i === 1 ? '#f5b800' : '#ffffff', 'center', sw - 16);
    cardText(ctx, k.toUpperCase(), x, 370, '700 20px Barlow, sans-serif', 'rgba(255,255,255,0.45)', 'center', sw - 16, '3px');
  });
  let y = 430;
  if (!r.highlights.length)
    cardText(
      ctx,
      'Highlights appear once the first players are placed',
      CARD_W / 2,
      y + 80,
      'italic 30px Barlow, sans-serif',
      'rgba(255,255,255,0.4)',
    );
  r.highlights.forEach(h => {
    const c = h.color || '#f5b800';
    roundRect(ctx, 80, y, CARD_W - 160, 140, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    ctx.fill();
    ctx.fillStyle = c;
    ctx.fillRect(80, y + 14, 8, 112);
    cardText(ctx, h.label.toUpperCase(), 116, y + 42, '700 20px Barlow, sans-serif', 'rgba(255,255,255,0.5)', 'left', 0, '4px');
    cardText(
      ctx,
      h.title.toUpperCase(),
      116,
      y + 94,
      'bold 46px Anton, Impact, sans-serif',
      '#ffffff',
      'left',
      h.value ? 560 : CARD_W - 240,
      '1px',
    );
    if (h.sub)
      cardText(ctx, h.sub, 116, y + 124, '500 22px Barlow, sans-serif', mix(c, '#ffffff', 0.35), 'left', h.value ? 560 : CARD_W - 240);
    if (h.value) cardText(ctx, h.value, CARD_W - 116, y + 94, 'bold 52px Anton, Impact, sans-serif', '#f5b800', 'right', 300);
    y += 158;
  });
  cardFooter(ctx);
}

// ── Image export: results / team cards / sold cards / recap ──
const EXPORT_TYPES = { results: 'Results', team: 'Team cards', sold: 'Sold cards', recap: 'Recap' };
const exportTypeLabel = k => (k === 'sold' && isRandom() ? 'Drawn cards' : EXPORT_TYPES[k]);
const exportTypesNow = () => Object.keys(EXPORT_TYPES).filter(k => !(k === 'sold' && isDraft()));
function exportPages() {
  if (_exportType === 'team') return teams.map(t => [t]);
  if (_exportType === 'sold') return auctionLog.length ? auctionLog.map(e => [e]) : [[null]];
  if (_exportType === 'recap') return [[null]];
  return resultsPages();
}
async function renderExportPage(canvas, i) {
  if (_exportType === 'team') return renderTeamCard(canvas, teams[i]);
  if (_exportType === 'sold') return renderSoldCard(canvas, auctionLog[i]);
  if (_exportType === 'recap') return renderRecapCard(canvas);
  renderResultsPage(canvas, i);
}
function renderExportControls() {
  const pages = exportPages();
  _exportPage = Math.max(0, Math.min(_exportPage, pages.length - 1));
  const tsel = document.getElementById('exportType');
  if (tsel)
    tsel.innerHTML = exportTypesNow()
      .map(k => `<option value="${k}">${exportTypeLabel(k)}</option>`)
      .join('');
  if (tsel) tsel.value = _exportType;
  const sel = document.getElementById('exportSize');
  if (sel && !sel.options.length) {
    sel.innerHTML = Object.entries(EXPORT_SIZES)
      .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
      .join('');
  }
  if (sel) sel.value = _exportSize;
  const sw = document.getElementById('exportSizeWrap');
  if (sw) sw.style.display = _exportType === 'results' ? '' : 'none';
  const nav = document.getElementById('exportPager');
  if (nav) {
    nav.style.display = pages.length > 1 ? 'flex' : 'none';
    const what =
      _exportType === 'team'
        ? (teams[_exportPage] || {}).name
        : _exportType === 'sold'
          ? `${isRandom() ? 'Draw' : 'Sale'} ${_exportPage + 1} of ${pages.length}`
          : `Page ${_exportPage + 1} of ${pages.length}`;
    document.getElementById('exportPageTxt').textContent = what || '';
    document.getElementById('exportPrev').disabled = _exportPage === 0;
    document.getElementById('exportNext').disabled = _exportPage >= pages.length - 1;
  }
  const noun = _exportType === 'results' ? 'pages' : 'cards';
  const dl = document.getElementById('exportDlBtn');
  if (dl) {
    dl.textContent = pages.length > 1 ? `⬇ Download all ${pages.length} ${noun}` : '⬇ Download PNG';
    dl.disabled = _exportType === 'sold' && !auctionLog.length;
  }
  const one = document.getElementById('exportDlOne');
  if (one) one.style.display = pages.length > 1 ? '' : 'none';
}

// Draw off-screen and copy only the newest request, so a slow (async) card can't paint over a later one
let _exportTok = 0;
async function redrawExport() {
  renderExportControls();
  const tok = ++_exportTok,
    off = document.createElement('canvas');
  await renderExportPage(off, _exportPage);
  if (tok !== _exportTok) return;
  const c = document.getElementById('exportCanvas');
  c.width = off.width;
  c.height = off.height;
  c.getContext('2d').drawImage(off, 0, 0);
}
function setExportSize(k) {
  _exportSize = EXPORT_SIZES[k] ? k : 'tall';
  _exportPage = 0;
  redrawExport();
}
function setExportType(k) {
  _exportType = EXPORT_TYPES[k] ? k : 'results';
  _exportPage = _exportType === 'sold' ? Math.max(0, auctionLog.length - 1) : 0; // newest signing first
  redrawExport();
}
function exportPageStep(d) {
  _exportPage += d;
  redrawExport();
}

function exportFileName(i, n) {
  const ev = slugify(EV.name);
  if (_exportType === 'team') return `${ev}-team-${slugify(teams[i].name)}.png`;
  if (_exportType === 'recap') return `${ev}-recap.png`;
  if (_exportType === 'sold')
    return `${ev}-${isRandom() ? 'drawn' : 'sold'}-${String(i + 1).padStart(2, '0')}-${slugify(auctionLog[i].player)}.png`;
  return ev + '-rosters' + (_exportSize === 'tall' ? '' : '-' + _exportSize) + (n > 1 ? `-${i + 1}of${n}` : '') + '.png';
}
async function savePage(i, n) {
  const c = document.createElement('canvas');
  await renderExportPage(c, i);
  const a = document.createElement('a');
  a.download = exportFileName(i, n);
  a.href = c.toDataURL('image/png');
  document.body.appendChild(a);
  a.click();
  a.remove();
}
async function downloadExport() {
  const n = exportPages().length;
  if (_exportType === 'sold' && !auctionLog.length) {
    showToast('No signings yet');
    return;
  }
  if (n > 1) showToast(`Downloading ${n} images — allow multiple downloads if your browser asks`);
  for (let i = 0; i < n; i++) {
    await savePage(i, n);
    if (i + 1 < n) await new Promise(r => setTimeout(r, 400));
  }
}
function downloadExportOne() {
  savePage(_exportPage, exportPages().length);
}

function showExportCard(type, page) {
  document.getElementById('exportOverlay').style.display = 'flex';
  if (type) {
    setExportType(type);
    if (page != null) {
      _exportPage = page;
      redrawExport();
    }
  } else {
    _exportPage = _exportType === 'sold' ? Math.max(0, auctionLog.length - 1) : 0;
    redrawExport();
  }
}

function renderExportCanvas(canvas, opts) {
  opts = opts || {};
  const teamList = opts.teams || teams;
  const COLS = opts.cols
    ? Math.min(opts.cols, teamList.length)
    : teamList.length <= 3
      ? teamList.length
      : teamList.length === 4
        ? 2
        : teamList.length <= 9
          ? 3
          : 4;
  const W = opts.width || 1200,
    HEADER_H = 140,
    FOOTER_H = 60;
  const COLS_N = COLS,
    ROWS = Math.ceil(teamList.length / COLS_N);
  const CARD_W = (W - 80 - (COLS_N - 1) * 20) / COLS_N;
  const MAX_PLAYERS = Math.max(1, ...teamList.map(t => t.players.length));
  const CARD_H = 52 + MAX_PLAYERS * 38 + 24;
  const teamsBottom = HEADER_H + ROWS * (CARD_H + 20);

  const captainNames = getCaptainNames();
  const unsold = opts.unsold === false ? [] : notPlaced().filter(p => !captainNames.includes(p.name.toLowerCase()));
  const UCOLS = 4;
  const UNSOLD_SECTION_H = unsold.length > 0 ? 20 + 36 + Math.ceil(unsold.length / UCOLS) * 28 + 16 : 0;

  const H = teamsBottom + UNSOLD_SECTION_H + FOOTER_H;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // ── Background ──
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, '#05080f');
  bgGrad.addColorStop(0.5, '#0a1020');
  bgGrad.addColorStop(1, '#040710');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Subtle pitch lines (cricket crease lines as atmosphere)
  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  for (let i = 0; i < W; i += 60) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, H);
    ctx.stroke();
  }
  ctx.restore();

  // Radial glow centre
  const glow = ctx.createRadialGradient(W / 2, HEADER_H / 2, 0, W / 2, HEADER_H / 2, 500);
  glow.addColorStop(0, 'rgba(0,200,255,0.12)');
  glow.addColorStop(1, 'rgba(0,200,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // ── Header ──
  // Gold top bar
  ctx.fillStyle = '#f5b800';
  ctx.fillRect(0, 0, W, 5);

  // Title
  ctx.font = 'bold 52px Anton, Impact, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.letterSpacing = '3px';
  ctx.textAlign = 'center';
  ctx.fillText(truncate(ctx, EV.branding.exportTitle || EV.name.toUpperCase(), W - 80), W / 2, 70);

  // Subtitle
  ctx.font = '600 20px Barlow, sans-serif';
  ctx.fillStyle = '#f5b800';
  ctx.fillText(EV.branding.exportSubtitle || '', W / 2, 100);
  if (opts.pageLabel) {
    ctx.font = '600 15px Barlow, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'right';
    ctx.fillText(opts.pageLabel, W - 40, 34);
    ctx.textAlign = 'center';
  }

  // Thin divider
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(40, HEADER_H - 12);
  ctx.lineTo(W - 40, HEADER_H - 12);
  ctx.stroke();

  // ── Team Cards ──

  teamList.forEach((team, ti) => {
    const col = ti % COLS_N;
    const row = Math.floor(ti / COLS_N);
    const cx = 40 + col * (CARD_W + 20);
    const cy = HEADER_H + row * (CARD_H + 20);

    // Card shadow
    ctx.save();
    ctx.shadowColor = team.color;
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;

    // Card background
    const cardBg = ctx.createLinearGradient(cx, cy, cx, cy + CARD_H);
    cardBg.addColorStop(0, 'rgba(255,255,255,0.07)');
    cardBg.addColorStop(1, 'rgba(255,255,255,0.02)');
    roundRect(ctx, cx, cy, CARD_W, CARD_H, 14);
    ctx.fillStyle = cardBg;
    ctx.fill();
    ctx.restore();

    // Card border with team colour
    ctx.save();
    roundRect(ctx, cx, cy, CARD_W, CARD_H, 14);
    ctx.strokeStyle = team.color;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // Team colour top bar on card
    ctx.save();
    roundRect(ctx, cx, cy, CARD_W, 6, { tl: 14, tr: 14, br: 0, bl: 0 });
    ctx.fillStyle = team.color;
    ctx.fill();
    ctx.restore();

    // Team name
    ctx.font = 'bold 17px Anton, Impact, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
    const nameY = cy + 34;
    ctx.fillText(truncate(ctx, team.name.toUpperCase(), CARD_W - 20), cx + 12, nameY);

    // Divider
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + 10, cy + 48);
    ctx.lineTo(cx + CARD_W - 10, cy + 48);
    ctx.stroke();

    // Players
    team.players.forEach((p, pi) => {
      const py = cy + 60 + pi * 38;
      const isCap = p.isCaptain;
      const isFormer = p.isFormer;

      // Row bg on hover-alternating style
      if (pi % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.025)';
        roundRect(ctx, cx + 6, py - 2, CARD_W - 12, 34, 6);
        ctx.fill();
      }

      // Icon
      const icon = isCap ? '👑' : isFormer ? '🏅' : '';
      if (icon) {
        ctx.font = '14px serif';
        ctx.textAlign = 'left';
        ctx.fillText(icon, cx + 12, py + 20);
      }
      const nameX = cx + (icon ? 30 : 12);

      // Player name
      ctx.font = isCap ? 'bold 13px Barlow, sans-serif' : '500 13px Barlow, sans-serif';
      ctx.fillStyle = isCap ? team.color : isFormer ? '#d4956a' : '#e8eaf0';
      ctx.textAlign = 'left';
      ctx.fillText(truncate(ctx, p.name, CARD_W - 110), nameX, py + 20);

      // Tier pill
      if (tierDef(p.tier) && !isCap) {
        const tc = mix(tierColor(p.tier), '#ffffff', 0.25);
        const tb = rgba(tierColor(p.tier), 0.16);
        ctx.font = 'bold 9px Barlow, sans-serif';
        const tw = ctx.measureText(p.tier.slice(0, 3).toUpperCase()).width + 10;
        const tx = cx + CARD_W - (p.finalPrice ? 65 : 15) - tw - 4;
        ctx.fillStyle = tb;
        roundRect(ctx, tx, py + 6, tw, 16, 3);
        ctx.fill();
        ctx.fillStyle = tc;
        ctx.textAlign = 'center';
        ctx.fillText(p.tier.slice(0, 3).toUpperCase(), tx + tw / 2, py + 18);
      }

      // Price
      if (p.finalPrice && !isCap) {
        ctx.font = 'bold 12px Barlow, sans-serif';
        ctx.fillStyle = '#f5b800';
        ctx.textAlign = 'right';
        ctx.fillText(zarS(p.finalPrice), cx + CARD_W - 10, py + 20);
      }
    });
  });

  // ── Unsold Players Section ──
  if (unsold.length > 0) {
    const uy = teamsBottom + 20;

    // Section header
    ctx.font = 'bold 13px Anton, Impact, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'left';
    ctx.letterSpacing = '2px';
    ctx.fillText(`${isRandom() ? 'NOT DRAWN' : isDraft() ? 'NOT PICKED' : 'UNSOLD PLAYERS'} (${unsold.length})`, 40, uy + 16);

    // Thin divider
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, uy + 24);
    ctx.lineTo(W - 40, uy + 24);
    ctx.stroke();

    // Players in 4 columns
    const UCOLS = 4;
    const UCOL_W = (W - 80 - (UCOLS - 1) * 16) / UCOLS;
    unsold.forEach((p, i) => {
      const col = i % UCOLS;
      const row = Math.floor(i / UCOLS);
      const px = 40 + col * (UCOL_W + 16);
      const py = uy + 36 + row * 28;

      // Subtle alternating row bg
      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.02)';
        roundRect(ctx, px, py - 2, UCOL_W, 22, 4);
        ctx.fill();
      }

      // Tier colour dot
      const dotColor = tierDef(p.tier) ? tierColor(p.tier) : 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.arc(px + 8, py + 9, 4, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();

      // Name
      ctx.font = '500 12px Barlow, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.textAlign = 'left';
      ctx.fillText(truncate(ctx, p.name, UCOL_W - 60), px + 18, py + 14);

      // Price
      ctx.font = '600 11px Barlow, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.textAlign = 'right';
      if (!noMoney()) ctx.fillText(zarS(p.price), px + UCOL_W - 4, py + 14);
    });
  }

  // ── Footer ──
  const fy = H - FOOTER_H + 20;
  ctx.font = '500 14px Barlow, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.textAlign = 'center';
  if (hasSponsor()) {
    const img = sponsorImg();
    ctx.textAlign = 'left';
    ctx.font = '700 13px Barlow, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    let x = 40;
    if (img) {
      const h = 24,
        w = Math.min(120, (h * img.naturalWidth) / img.naturalHeight);
      roundRect(ctx, x - 4, fy - 8, w + 8, h + 6, 4);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.drawImage(img, x, fy - 5, w, (w * img.naturalHeight) / img.naturalWidth);
      x += w + 12;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
    }
    ctx.fillText(sponsorText(), x, fy + 10);
    ctx.textAlign = 'right';
    ctx.font = '500 14px Barlow, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    if (EV.branding.hashtags) ctx.fillText(EV.branding.hashtags, W - 40, fy + 10);
  } else if (EV.branding.hashtags) ctx.fillText(EV.branding.hashtags, W / 2, fy + 10);

  // Bottom gold bar
  ctx.fillStyle = '#f5b800';
  ctx.fillRect(0, H - 5, W, 5);
}

function roundRect(ctx, x, y, w, h, r) {
  if (typeof r === 'number') r = { tl: r, tr: r, br: r, bl: r };
  ctx.beginPath();
  ctx.moveTo(x + r.tl, y);
  ctx.lineTo(x + w - r.tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r.tr);
  ctx.lineTo(x + w, y + h - r.br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
  ctx.lineTo(x + r.bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r.bl);
  ctx.lineTo(x, y + r.tl);
  ctx.quadraticCurveTo(x, y, x + r.tl, y);
  ctx.closePath();
}

function truncate(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
  return text + '…';
}
