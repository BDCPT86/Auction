/*
 * Draft Day: Rosters PDF
 * ----------------------
 * The light, print-friendly rosters PDF, with the recap as its last page.
 */

// ── Roster PDF (light, print-friendly) ──
// Fonts come from vendor/pdf-fonts.js, loaded the first time a PDF is made; without them it falls back to Helvetica.
function loadPdfFonts() {
  if (window.DRAFT_DAY_PDF_FONTS) return Promise.resolve(true);
  return new Promise(res => {
    const sc = document.createElement('script');
    sc.src = 'vendor/pdf-fonts.js';
    sc.onload = () => res(!!window.DRAFT_DAY_PDF_FONTS);
    sc.onerror = () => res(false);
    document.head.appendChild(sc);
  });
}

// Round logo with a ring in the team colour, as a PNG with transparent corners
function pdfRoundLogo(t) {
  const draw = img => {
    const S = 240,
      R = S / 2,
      c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.beginPath();
    g.arc(R, R, R - 10, 0, Math.PI * 2);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.fill();
    if (img) {
      g.save();
      g.clip();
      const w = img.naturalWidth || img.width,
        h = img.naturalHeight || img.height,
        side = Math.min(w, h) || S;
      g.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 10, 10, S - 20, S - 20);
      g.restore();
    }
    g.beginPath();
    g.arc(R, R, R - 7, 0, Math.PI * 2);
    g.lineWidth = 14;
    g.strokeStyle = t.color;
    g.stroke();
    return c.toDataURL('image/png');
  };
  const tryLoad = src =>
    new Promise(res => {
      if (!src) return res(null);
      const img = new Image();
      img.onload = () => {
        try {
          res(draw(img));
        } catch (e) {
          res(null);
        }
      }; // tainted canvas (file://) → null
      img.onerror = () => res(null);
      img.src = src;
    });
  // No readable logo (none set, missing, or blocked when opened from disk): a drawn initials badge
  const badge = () => {
    const S = 240,
      R = S / 2,
      c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.beginPath();
    g.arc(R, R, R - 10, 0, Math.PI * 2);
    g.fillStyle = mix(t.color, '#ffffff', 0.82);
    g.fill();
    g.beginPath();
    g.arc(R, R, R - 7, 0, Math.PI * 2);
    g.lineWidth = 14;
    g.strokeStyle = t.color;
    g.stroke();
    const ini =
      t.name
        .replace(/[^A-Za-z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter(w => w && !/^(the|of|and)$/i.test(w))
        .slice(0, 2)
        .map(w => w[0].toUpperCase())
        .join('') || '?';
    g.fillStyle = inkOn(t.color);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold ${ini.length > 1 ? 92 : 110}px Barlow, Arial, sans-serif`;
    g.fillText(ini, R, R + 6);
    return c.toDataURL('image/png');
  };
  return tryLoad(t.logo).then(d => d || badge());
}

async function exportRosters() {
  if (typeof window.jspdf === 'undefined') {
    showToast('PDF library not loaded yet — try again in a moment');
    return;
  }
  showToast('Generating PDF…');
  const [hasFonts, logos] = await Promise.all([loadPdfFonts(), Promise.all(teams.map(pdfRoundLogo))]);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = 210,
    PH = 297,
    M = 16,
    CW = PW - M * 2;

  // Fonts: D = display (Anton), B = body (Barlow)
  let D = ['helvetica', 'bold'],
    B = w => ['helvetica', w >= 600 ? 'bold' : 'normal'];
  if (hasFonts) {
    const F = window.DRAFT_DAY_PDF_FONTS;
    [
      ['Anton', 'Anton', 'normal'],
      ['Barlow', 'Barlow', 'normal'],
      ['Barlow-SemiBold', 'Barlow', 'semibold'],
      ['Barlow-Bold', 'Barlow', 'bold'],
    ].forEach(([k, fam, st]) => {
      doc.addFileToVFS(k + '.ttf', F[k]);
      doc.addFont(k + '.ttf', fam, st);
    });
    D = ['Anton', 'normal'];
    B = w => ['Barlow', w >= 700 ? 'bold' : w >= 600 ? 'semibold' : 'normal'];
  }

  // Palette (light)
  const INK = [21, 26, 34],
    MUTED = [107, 118, 132],
    LINE = [228, 232, 238],
    SOFT = [245, 247, 250],
    GOLD = [201, 151, 0],
    BAR = [245, 184, 0];
  const dark = hex => hexRgb(inkOn(hex)); // team / tier colours readable on white
  const tint = (hex, k) => hexRgb(mix(hex, '#ffffff', k));

  const txt = (str, x, y, o = {}) => {
    doc.setFont(...(o.display ? D : B(o.w || 400)));
    doc.setFontSize(o.size || 9);
    doc.setTextColor(...(o.color || INK));
    doc.setCharSpace(o.space || 0);
    let t = String(str);
    if (o.max) {
      while (t.length > 1 && doc.getTextWidth(t) > o.max) t = t.slice(0, -1);
      if (t !== String(str)) t = t.trimEnd() + '…';
    }
    doc.text(t, x, y, { align: o.align || 'left' });
    doc.setCharSpace(0);
    return doc.getTextWidth(t);
  };
  const label = (str, x, y, o = {}) => txt(String(str).toUpperCase(), x, y, { size: 6, w: 700, color: MUTED, space: 0.35, ...o });

  const dateLong = new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const dateShort = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
  const title = (EV.branding.exportTitle || EV.name).trim();

  // ── Layout pass: which team blocks go on which page ──
  const ROW = 6.6,
    HEAD = 17,
    GAP = 6,
    TOP = 34,
    BOTTOM = PH - 22;
  const blockH = t => HEAD + Math.max(1, t.players.length) * ROW + 1;
  const captainNames = getCaptainNames();
  const notSigned = notPlaced().filter(p => !captainNames.includes(p.name.toLowerCase()));
  const recap = recapData();
  const blocks = teams.map((t, i) => ({ t, i, h: blockH(t) }));
  // The not-signed list goes on the cover when it fits there (decided below), otherwise after the teams
  const unsoldH = 14 + Math.ceil(notSigned.length / 3) * 5.6;
  const coverEnd = 168 + Math.max(6.5, Math.min(10, (PH - 180) / Math.max(1, teams.length))) * teams.length; // a little over the cover's real height
  const unsoldOnCover = notSigned.length && coverEnd + unsoldH < PH - 24;
  if (notSigned.length && !unsoldOnCover) blocks.push({ unsold: true, h: unsoldH });
  const pages = [[]];
  let y = TOP;
  blocks.forEach(bk => {
    if (y + bk.h > BOTTOM && pages[pages.length - 1].length) {
      pages.push([]);
      y = TOP;
    }
    pages[pages.length - 1].push(bk);
    y += bk.h + GAP;
  });
  const total = pages.length + 1 + (recap.highlights.length ? 1 : 0);

  const frame = n => {
    doc.setFillColor(...BAR);
    doc.rect(0, 0, PW, 2.2, 'F');
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.line(M, PH - 15, PW - M, PH - 15);
    txt(`${EV.name} · ${dateShort}${isRandom() && alloc.seed ? ' · Draw code ' + fmtCode(alloc.seed) : ''}`, M, PH - 10, {
      size: 7,
      color: MUTED,
    });
    if (hasSponsor()) txt(sponsorText(), PW / 2, PH - 10, { size: 7, w: 600, color: MUTED, align: 'center', max: CW / 3 });
    txt(`Page ${n} of ${total}`, PW - M, PH - 10, { size: 7, color: MUTED, align: 'right' });
  };

  function drawNotSigned(y) {
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.roundedRect(M, y, CW, unsoldH, 2, 2, 'S');
    label(`${isDraft() ? 'Not picked' : R ? 'Not drawn' : 'Not signed'} · ${notSigned.length}`, M + 5, y + 7, { size: 7, space: 0.6 });
    const cw = (CW - 10) / 3;
    notSigned.forEach((p, k) => {
      const x = M + 5 + (k % 3) * cw,
        yy = y + 13 + Math.floor(k / 3) * 5.6;
      txt(p.name, x, yy, { size: 8.5, w: 500, color: MUTED, max: cw - 4 });
    });
  }

  // ── Cover ──
  frame(1);
  label(`${EV.name} · Official team rosters`, M, 38, { size: 7.5, space: 0.9 });
  doc.setFont(...D);
  let ts = 60;
  doc.setFontSize(ts);
  while (ts > 26 && doc.getTextWidth(title.toUpperCase()) > CW) {
    ts -= 2;
    doc.setFontSize(ts);
  }
  txt(title.toUpperCase(), M, 38 + ts * 0.42, { display: true, size: ts, space: 0.3 });
  let cy = 38 + ts * 0.42;
  if (EV.branding.exportSubtitle) {
    cy += 11;
    txt(EV.branding.exportSubtitle.toUpperCase(), M, cy, { display: true, size: 17, color: GOLD, space: 0.9, max: CW });
  }
  cy += 8;
  txt(dateLong, M, cy, { size: 9.5, w: 600, color: MUTED });
  // N5: sponsor, top right of the cover
  if (hasSponsor()) {
    const sl = sponsorImg();
    let sy = 34;
    if (sl) {
      const h = 12,
        w = Math.min(46, (h * sl.naturalWidth) / sl.naturalHeight);
      try {
        doc.addImage(sl, 'PNG', PW - M - w, sy, w, (w * sl.naturalHeight) / sl.naturalWidth, '', 'FAST');
      } catch (e) {}
      sy += 16;
    }
    label(EV.branding.sponsor.line || 'Presented by', PW - M, sy, { align: 'right', size: 6 });
    txt(EV.branding.sponsor.name.trim(), PW - M, sy + 5, { size: 10, w: 700, align: 'right', max: CW * 0.35 });
  }

  // Key numbers
  cy += 12;
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.6);
  doc.line(M, cy, PW - M, cy);
  const sales = teams.flatMap(t => t.players.filter(p => !p.isCaptain && !p.isFormer));
  const top = sales.reduce((a, p) => ((p.finalPrice || 0) > (a ? a.finalPrice || 0 : -1) ? p : a), null);
  const spentAll = teams.reduce((s, t) => s + startBudget(t) - t.budget, 0);
  const R = noMoney();
  const stats = isDraft()
    ? [
        [String(teams.length), 'Teams'],
        [String(teams.reduce((s, t) => s + t.players.filter(p => p.isFormer).length, 0)), 'Players picked'],
        [EV.draft.order === 'snake' ? 'SNAKE' : 'STRAIGHT', 'Pick order'],
        [String(notPlaced().length), 'Not picked'],
      ]
    : isRandom()
      ? [
          [String(teams.length), 'Teams'],
          [String(drawnCount()), 'Players drawn'],
          [EV.random.balance ? 'BALANCED' : 'ONE HAT', EV.random.balance ? 'Tier-balanced draw' : 'Random draw'],
          [fmtCode(alloc.seed), 'Draw code'],
        ]
      : [
          [String(teams.length), 'Teams'],
          [String(teams.reduce((s, t) => s + t.players.filter(p => !p.isCaptain).length, 0)), 'Players signed'],
          [zarS(spentAll), 'Total spent'],
          top ? [zarS(top.finalPrice), 'Top buy · ' + top.name] : [zarS(teams.reduce((s, t) => s + t.budget, 0)), 'Total left'],
        ];
  const sw = CW / 4;
  stats.forEach(([v, k], i) => {
    txt(v, M + sw * i, cy + 12, { display: true, size: 20, max: sw - 4 });
    label(k, M + sw * i, cy + 18, { max: sw - 4 });
  });
  cy += 24;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(M, cy, PW - M, cy);

  // Teams table
  cy += 12;
  label('Teams', M, cy, { size: 7, space: 0.9 });
  cy += 7;
  const cols = { n: M + 2, logo: M + 9, name: M + 18, bought: M + CW * 0.6, spent: M + CW * 0.8, left: PW - M - 2 };
  label('Team', cols.name, cy);
  if (R) {
    label('Tier mix', cols.bought - 30, cy);
    label('Squad', cols.left, cy, { align: 'right' });
  } else {
    label(EV.squadSize ? 'Squad' : 'Bought', cols.bought, cy, { align: 'right' });
    label('Spent', cols.spent, cy, { align: 'right' });
    label('Left', cols.left, cy, { align: 'right' });
  }
  cy += 2.5;
  const rowH = Math.max(6.5, Math.min(10, (PH - 40 - cy) / Math.max(1, teams.length)));
  teams.forEach((t, i) => {
    if (cy + rowH > PH - 30) {
      return;
    } // very large events: the per-team pages still list everyone
    if (i % 2 === 0) {
      doc.setFillColor(...SOFT);
      doc.rect(M, cy, CW, rowH, 'F');
    }
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.line(M, cy, PW - M, cy);
    const mid = cy + rowH / 2;
    txt(String(i + 1), cols.n, mid + 1.2, { size: 8.5, w: 700, color: MUTED });
    const ls = Math.min(7, rowH - 1.5);
    doc.addImage(logos[i], 'PNG', cols.logo - ls / 2 + 2, mid - ls / 2, ls, ls, '', 'FAST');
    if (R) {
      txt(t.name, cols.name, mid + 1.2, { size: 9.5, w: 700, max: cols.bought - 30 - cols.name - 6 });
      txt(tierMix(t) || '—', cols.bought - 30, mid + 1.2, { size: 8.5, w: 500, color: MUTED, max: cols.left - cols.bought + 30 - 22 });
      txt(squadText(t), cols.left, mid + 1.2, { size: 9, w: 600, align: 'right' });
    } else {
      txt(t.name, cols.name, mid + 1.2, { size: 9.5, w: 700, max: cols.bought - cols.name - 18 });
      txt(squadText(t), cols.bought, mid + 1.2, { size: 9, w: 600, align: 'right' });
      txt(zarFmt(startBudget(t) - t.budget), cols.spent, mid + 1.2, { size: 9, w: 600, align: 'right' });
      txt(zarFmt(t.budget), cols.left, mid + 1.2, { size: 9, w: 600, align: 'right' });
    }
    cy += rowH;
  });
  doc.setDrawColor(...LINE);
  doc.line(M, cy, PW - M, cy);
  if (EV.branding.hashtags) {
    cy += 9;
    txt(EV.branding.hashtags.trim(), M, cy, { size: 8.5, w: 600, color: MUTED, max: CW });
  }
  if (unsoldOnCover) drawNotSigned(cy + 10);

  // ── Team pages ──
  pages.forEach((pg, pi) => {
    doc.addPage();
    frame(pi + 2);
    const ts2 = pg.filter(b => !b.unsold);
    txt(title.toUpperCase(), M, 22, { display: true, size: 15, space: 0.4, max: CW * 0.55 });
    label(
      ts2.length
        ? `Team rosters · ${ts2[0].i + 1}${ts2.length > 1 ? '–' + (ts2[ts2.length - 1].i + 1) : ''} of ${teams.length}`
        : 'Not signed',
      PW - M,
      22,
      { align: 'right', size: 6.5 },
    );
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.6);
    doc.line(M, 25.5, PW - M, 25.5);

    let y = TOP;
    pg.forEach(bk => {
      if (bk.unsold) {
        drawNotSigned(y);
        y += bk.h + GAP;
        return;
      }
      const t = bk.t,
        col = t.color,
        dk = dark(col);
      // card outline + header band (soft fade from the team colour)
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.3);
      doc.roundedRect(M, y, CW, bk.h, 2, 2, 'S');
      const steps = 90;
      for (let k = 0; k < steps; k++) {
        doc.setFillColor(...tint(col, 0.84 + 0.16 * (k / steps)));
        doc.rect(M + 0.15 + k * ((CW * 0.75) / steps), y + 0.15, (CW * 0.75) / steps + 0.2, HEAD - 0.3, 'F');
      }
      doc.setFillColor(255, 255, 255);
      doc.rect(M + 0.15 + CW * 0.75, y + 0.15, CW * 0.25 - 0.3, HEAD - 0.3, 'F');
      doc.setFillColor(...hexRgb(col));
      doc.rect(M, y, 1.8, HEAD, 'F');
      doc.addImage(logos[bk.i], 'PNG', M + 5, y + 2.5, 12, 12, '', 'FAST');
      const cap = t.players.find(p => p.isCaptain);
      txt(t.name.toUpperCase(), M + 20, y + 8.6, { display: true, size: 14, space: 0.15, max: CW * 0.48 });
      txt(cap ? 'Captain ' + cap.name : `${t.players.length} player${t.players.length !== 1 ? 's' : ''}`, M + 20, y + 13, {
        size: 7.5,
        w: 600,
        color: MUTED,
        max: CW * 0.48,
      });
      const st = isDraft()
        ? [
            ['Picked', String(t.players.filter(p => p.isFormer).length), GOLD],
            ['Squad', squadText(t), INK],
          ]
        : R
          ? [
              ['Drawn', String(t.players.filter(p => p.drawn).length), GOLD],
              ['Squad', squadText(t), INK],
            ]
          : [
              ['Spent', zarFmt(startBudget(t) - t.budget), GOLD],
              ['Left', zarFmt(t.budget), INK],
              [EV.squadSize ? 'Squad' : 'Bought', squadText(t), INK],
            ];
      let sx = PW - M - 5;
      [...st].reverse().forEach(([k, v, c]) => {
        doc.setFont(...D);
        doc.setFontSize(11.5);
        const w = Math.max(doc.getTextWidth(v), 10);
        txt(v, sx, y + 12.2, { display: true, size: 11.5, color: c, align: 'right' });
        label(k, sx, y + 6.6, { size: 5.5, align: 'right' });
        sx -= w + 7;
      });

      // player rows
      let ry = y + HEAD;
      const tagX = M + CW * 0.48,
        priceX = PW - M - 5;
      (t.players.length ? t.players : [null]).forEach((p, k) => {
        doc.setDrawColor(...LINE);
        doc.setLineWidth(0.2);
        doc.line(M, ry, PW - M, ry);
        if (k % 2 === 1) {
          doc.setFillColor(...SOFT);
          doc.rect(M + 0.15, ry + 0.1, CW - 0.3, ROW - 0.2, 'F');
        }
        const base = ry + ROW / 2 + 1.1;
        if (!p) {
          txt('No players yet', M + 5, base, { size: 8.5, color: MUTED });
          ry += ROW;
          return;
        }
        if (p.isCaptain) {
          txt(p.name, M + 5, base, { size: 8.8, w: 700, color: dk, max: tagX - M - 10 });
          label('Captain', tagX, base - 0.2, { size: 5.8, color: dk });
          txt('—', priceX, base, { size: 8.8, color: MUTED, align: 'right' });
        } else {
          txt(p.name, M + 5, base, { size: 8.8, w: p.isFormer ? 500 : 600, max: tagX - M - 10 });
          let tx = tagX;
          if (tierDef(p.tier)) {
            const tc = dark(tierColor(p.tier));
            doc.setFont(...B(700));
            doc.setFontSize(5.4);
            doc.setCharSpace(0.3);
            const w = doc.getTextWidth(p.tier.toUpperCase()) + 0.3 * p.tier.length + 3.4;
            doc.setCharSpace(0);
            doc.setDrawColor(...tc);
            doc.setLineWidth(0.25);
            doc.roundedRect(tx, base - 3.1, w, 4, 0.8, 0.8, 'S');
            txt(p.tier.toUpperCase(), tx + w / 2, base - 0.2, { size: 5.4, w: 700, color: tc, space: 0.3, align: 'center' });
            tx += w + 2.2;
          }
          if (p.isFormer) label(roundLabel(p), tx, base - 0.2, { size: 5.4, max: priceX - tx - 22 });
          if (p.isFormer && !p.finalPrice) txt('Pick', priceX, base, { size: 8.8, w: 600, color: MUTED, align: 'right' });
          else if (R) txt(p.drawNo ? 'Draw #' + p.drawNo : 'Added', priceX, base, { size: 8.5, w: 600, color: MUTED, align: 'right' });
          else txt(zarFmt(p.finalPrice || p.price), priceX, base, { size: 8.8, w: 700, align: 'right' });
        }
        ry += ROW;
      });
      y += bk.h + GAP;
    });
  });

  // ── N4: recap page ──
  if (recap.highlights.length) {
    doc.addPage();
    frame(total);
    txt(title.toUpperCase(), M, 22, { display: true, size: 15, space: 0.4, max: CW * 0.55 });
    label('Recap', PW - M, 22, { align: 'right', size: 6.5 });
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.6);
    doc.line(M, 25.5, PW - M, 25.5);
    let ry = 40;
    txt('THE DAY IN NUMBERS', M, ry, { display: true, size: 22 });
    ry += 6;
    const rw = CW / recap.stats.length;
    recap.stats.forEach(([v, k], i) => {
      txt(v, M + rw * i, ry + 13, { display: true, size: 20, color: i === 1 ? GOLD : INK, max: rw - 4 });
      label(k, M + rw * i, ry + 19, { max: rw - 4 });
    });
    ry += 30;
    recap.highlights.forEach(h => {
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.3);
      doc.roundedRect(M, ry, CW, 22, 2, 2, 'S');
      doc.setFillColor(...hexRgb(h.color || '#f5b800'));
      doc.rect(M, ry, 1.8, 22, 'F');
      label(h.label, M + 6, ry + 6.5, { size: 6.5 });
      txt(h.title, M + 6, ry + 14.5, { display: true, size: 15, max: CW * 0.62 });
      if (h.sub) txt(h.sub, M + 6, ry + 19, { size: 7.5, w: 500, color: MUTED, max: CW * 0.62 });
      if (h.value)
        txt(h.value, PW - M - 6, ry + 14.5, {
          display: true,
          size: 17,
          color: h.color ? dark(h.color) : GOLD,
          align: 'right',
          max: CW * 0.32,
        });
      ry += 26;
    });
  }

  doc.save(slugify(EV.name) + '-rosters.pdf');
  showToast('PDF exported!');
}
