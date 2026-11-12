/*
 * Draft Day: projector view
 * -------------------------
 * A second window for the TV or projector: the player up, the bid, the leader,
 * the timer and every team's purse, with no controls. The laptop drives it.
 *
 * The window is opened blank and written from here, so it shares this page's
 * origin and works the same from a web server or straight off the disk (file://).
 * A light poll (4 times a second) redraws it only when something it shows has changed.
 */
let _proj = null,
  _projSig = '';

// The same bundled fonts as vendor/fonts.css (inlined: a stylesheet link in a blank window isn't reliably fetched)
const PROJ_FONTS =
  "@font-face { font-family: 'Anton'; font-style: normal; font-display: swap; font-weight: 400; src: url(vendor/fonts/anton-latin-ext-400-normal.woff2) format('woff2'); unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; } @font-face { font-family: 'Anton'; font-style: normal; font-display: swap; font-weight: 400; src: url(vendor/fonts/anton-latin-400-normal.woff2) format('woff2'); unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; } @font-face { font-family: 'Barlow'; font-style: normal; font-display: swap; font-weight: 400; src: url(vendor/fonts/barlow-latin-ext-400-normal.woff2) format('woff2'); unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; } @font-face { font-family: 'Barlow'; font-style: normal; font-display: swap; font-weight: 400; src: url(vendor/fonts/barlow-latin-400-normal.woff2) format('woff2'); unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; } @font-face { font-family: 'Barlow'; font-style: normal; font-display: swap; font-weight: 500; src: url(vendor/fonts/barlow-latin-ext-500-normal.woff2) format('woff2'); unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; } @font-face { font-family: 'Barlow'; font-style: normal; font-display: swap; font-weight: 500; src: url(vendor/fonts/barlow-latin-500-normal.woff2) format('woff2'); unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; } @font-face { font-family: 'Barlow'; font-style: normal; font-display: swap; font-weight: 600; src: url(vendor/fonts/barlow-latin-ext-600-normal.woff2) format('woff2'); unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; } @font-face { font-family: 'Barlow'; font-style: normal; font-display: swap; font-weight: 600; src: url(vendor/fonts/barlow-latin-600-normal.woff2) format('woff2'); unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; } @font-face { font-family: 'Barlow'; font-style: normal; font-display: swap; font-weight: 700; src: url(vendor/fonts/barlow-latin-ext-700-normal.woff2) format('woff2'); unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; } @font-face { font-family: 'Barlow'; font-style: normal; font-display: swap; font-weight: 700; src: url(vendor/fonts/barlow-latin-700-normal.woff2) format('woff2'); unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; } @font-face { font-family: 'Barlow'; font-style: italic; font-display: swap; font-weight: 400; src: url(vendor/fonts/barlow-latin-ext-400-italic.woff2) format('woff2'); unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; } @font-face { font-family: 'Barlow'; font-style: italic; font-display: swap; font-weight: 400; src: url(vendor/fonts/barlow-latin-400-italic.woff2) format('woff2'); unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }";

const PROJ_CSS = `
:root{--bg:#05080f;--text:#eef2f7;--muted:#7d8ea3;--gold:#f5b800;--accent:#00c8ff;--red:#ff4050;--line:rgba(255,255,255,0.08)}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:var(--bg);color:var(--text);font-family:'Barlow',system-ui,sans-serif;overflow:hidden}
body{background:radial-gradient(ellipse at 50% 0%,rgba(0,200,255,0.10),transparent 60%),linear-gradient(160deg,#05080f,#0a1020 55%,#040710)}
#pj{position:absolute;inset:0;display:flex;flex-direction:column}
.pj-top{display:flex;align-items:center;justify-content:space-between;padding:2.2vh 3vw;border-bottom:1px solid var(--line);border-top:5px solid var(--gold)}
.pj-event{font-family:'Anton',Impact,sans-serif;font-size:3.4vh;letter-spacing:0.12em}
.pj-badge{font-family:'Anton',Impact,sans-serif;font-size:2.2vh;letter-spacing:0.14em;color:var(--gold);border:1px solid rgba(245,184,0,0.4);padding:0.6vh 1.2vw;border-radius:99px}
.pj-sponsor{display:flex;align-items:center;gap:0.8vw;font-size:1.9vh;color:var(--muted);letter-spacing:0.12em;text-transform:uppercase}
.pj-sponsor b{color:var(--text);letter-spacing:0.04em;text-transform:none;font-size:2.4vh}
.pj-sponsor img{height:4.2vh;max-width:14vw;object-fit:contain;background:#fff;border-radius:6px;padding:0.4vh 0.5vw}
.pj-badge.live{color:var(--red);border-color:rgba(255,64,80,0.5)}
.pj-main{flex:1;display:flex;align-items:center;justify-content:center;gap:4vw;padding:2vh 4vw;min-height:0}
.pj-art{width:28vh;height:28vh;flex-shrink:0;filter:drop-shadow(0 0 30px rgba(0,200,255,0.25))}
.pj-art svg{width:100%;height:100%}
.pj-card{display:flex;flex-direction:column;gap:1.4vh;min-width:0;max-width:52vw}
.pj-kicker{font-size:2.2vh;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:var(--muted)}
.pj-name{font-family:'Anton',Impact,sans-serif;font-size:11vh;line-height:0.95;letter-spacing:0.02em;text-transform:uppercase;overflow-wrap:anywhere}
.pj-tier{display:inline-block;font-weight:700;font-size:2.4vh;letter-spacing:0.16em;text-transform:uppercase;padding:0.5vh 1.2vw;border-radius:6px;align-self:flex-start}
.pj-base{font-size:2.6vh;color:var(--muted)}.pj-base b{color:var(--text)}
.pj-bid{display:flex;flex-direction:column;align-items:flex-end;gap:1vh;min-width:24vw;text-align:right}
.pj-amt{font-family:'Anton',Impact,sans-serif;font-size:12vh;line-height:1;color:var(--gold);letter-spacing:0.02em}
.pj-lead{display:flex;align-items:center;gap:1vw;font-size:3.4vh;font-weight:700}
.pj-lead img{width:6vh;height:6vh;border-radius:50%;object-fit:cover;background:#111}
.pj-sub{font-size:2.2vh;color:var(--muted)}

.pj-going{font-family:'Anton',Impact,sans-serif;font-size:5vh;letter-spacing:0.08em;color:#151a22;background:var(--gold);padding:0.6vh 1.6vw;border-radius:10px;animation:pulse 0.75s ease-in-out infinite}
.pj-timer{font-family:'Anton',Impact,sans-serif;font-size:5vh;color:var(--gold);letter-spacing:0.06em}
.pj-timer.urgent{color:var(--red);animation:pulse 0.6s ease-in-out infinite}
@keyframes pulse{50%{opacity:0.45}}
.pj-center{display:flex;flex-direction:column;align-items:center;text-align:center;gap:2vh}
.pj-big{font-family:'Anton',Impact,sans-serif;font-size:14vh;line-height:1;letter-spacing:0.04em}
.pj-sold{color:var(--gold);text-shadow:0 0 60px rgba(245,184,0,0.35)}
.pj-spin{animation:pulse 1s ease-in-out infinite}
.pj-sold-team{display:flex;align-items:center;gap:1.5vw;font-size:5vh;font-weight:700}
.pj-sold-team img{width:11vh;height:11vh;border-radius:50%;object-fit:cover;background:#111}
.pj-clock{font-family:'Anton',Impact,sans-serif;font-size:22vh;line-height:1;color:var(--gold)}
.pj-strip{display:flex;gap:0.8vw;padding:1.8vh 2vw 2.4vh;border-top:1px solid var(--line);overflow:hidden}
.pj-team{flex:1 1 0;min-width:0;display:flex;align-items:center;gap:0.7vw;padding:1.1vh 0.8vw;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid var(--line);border-top:3px solid var(--tc);transition:opacity .3s}
.pj-team img{width:4.4vh;height:4.4vh;border-radius:50%;object-fit:cover;flex-shrink:0;background:#111}
.pj-team-txt{min-width:0}
.pj-team-name{font-weight:700;font-size:1.9vh;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pj-team-purse{font-family:'Anton',Impact,sans-serif;font-size:2.4vh;letter-spacing:0.03em}
.pj-team-sq{font-size:1.5vh;color:var(--muted);white-space:nowrap}
.pj-team.lead{background:rgba(245,184,0,0.10);border-color:rgba(245,184,0,0.5);border-top-color:var(--gold)}
.pj-team.out{opacity:0.32}
.pj-strip.dense .pj-team img{display:none}
.pj-strip.dense .pj-team-name{font-size:1.5vh}
.pj-strip.dense .pj-team-purse{font-size:1.9vh}
.pj-standings{display:grid;grid-template-columns:repeat(auto-fit,minmax(30vw,1fr));gap:1.2vh 2vw;width:min(90vw,1400px)}
.pj-st{display:flex;align-items:center;gap:1vw;padding:1.2vh 1vw;border-left:4px solid var(--tc);background:rgba(255,255,255,0.03);border-radius:8px;text-align:left}
.pj-st img{width:5vh;height:5vh;border-radius:50%;object-fit:cover;background:#111}
.pj-st div{flex:1;min-width:0}.pj-st b{display:block;font-size:2.3vh;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pj-st span{font-size:1.7vh;color:var(--muted)}
.pj-st i{font-style:normal;font-family:'Anton',Impact,sans-serif;font-size:3vh}
#pjFs{position:fixed;right:1.2vw;bottom:1.2vh;font:600 13px 'Barlow',sans-serif;color:#9fb0c3;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:6px 10px;cursor:pointer;opacity:0.6}
#pjFs:hover{opacity:1}
:fullscreen #pjFs{display:none}
`;

function openProjector() {
  if (_proj && !_proj.closed) {
    _proj.focus();
    return;
  }
  _proj = window.open('', 'draftday-projector', 'width=1280,height=720');
  if (!_proj) {
    showToast('The browser blocked the window — allow pop-ups for this page, then try again');
    return;
  }
  const base = location.href.replace(/[^/]*([?#].*)?$/, '');
  const d = _proj.document;
  d.open();
  d.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(EV.name)} · Projector</title>
    <base href="${esc(base)}"><style>${PROJ_FONTS}${PROJ_CSS}</style></head>
    <body><div id="pj"></div><button id="pjFs" type="button">⛶ Full screen</button></body></html>`);
  d.close();
  d.getElementById('pjFs').onclick = () => d.documentElement.requestFullscreen && d.documentElement.requestFullscreen();
  // Browsers only allow sound after a click in that window: the Full screen click (or any click) unlocks it
  d.addEventListener('click', () => {
    try {
      _proj._ac = _proj._ac || new (_proj.AudioContext || _proj.webkitAudioContext)();
      _proj._ac.resume();
    } catch (e) {}
  });
  _projSig = '';
  projectorTick();
  showToast('Projector window open — drag it to the TV and press Full screen');
}

function closeProjector() {
  if (_proj && !_proj.closed) _proj.close();
  _proj = null;
}

// What the room sees right now
function projectorState() {
  const breakOpen = document.getElementById('breakOverlay').classList.contains('open');
  const last = auctionLog[auctionLog.length - 1];
  const recentSale = last && !bidRound.player && !spinning && Date.now() - new Date(last.endTime).getTime() < 8000;
  const draw = typeof allocProjectorState === 'function' ? allocProjectorState() : null;
  const mode = breakOpen ? 'break' : draw ? 'draw' : bidRound.player ? 'bid' : spinning ? 'spin' : recentSale ? 'sold' : 'idle';
  const timerOn = mode === 'bid' && bidTimerOn() && bidTimerRemaining > 0;
  return { mode, last, timerOn, breakEnd: breakOpen ? _breakEnd : 0, draw };
}

function projectorTick() {
  if (!_proj || _proj.closed) return;
  const root = _proj.document.getElementById('pj');
  if (!root) return;
  const st = projectorState();
  // Signature of everything drawn, so the window only redraws on a change
  const sig = JSON.stringify([
    st.mode,
    EV.name,
    EV.branding.sponsor,
    auctionPhase,
    auctionLog.length,
    bidRound.player && bidRound.player.id,
    bidRound.leaderId,
    bidRound.leaderBid,
    [...bidRound.passed],
    st.timerOn ? bidTimerRemaining + (bidTimerPaused ? 'p' : '') : -1,
    _going ? _going.step : 0,
    st.mode === 'break' ? Math.ceil((st.breakEnd - Date.now()) / 1000) : 0,
    teams.map(t => [t.name, t.budget, t.players.length, t.logo && t.logo.length, t.color]),
    st.draw
      ? [
          st.draw.shown,
          st.draw.rolling,
          st.draw.drawn,
          st.draw.last && st.draw.last.n,
          auctionLog.length && Date.now() - new Date(auctionLog[auctionLog.length - 1].endTime).getTime() < 8000,
        ]
      : 0,
  ]);
  if (sig === _projSig) return;
  _projSig = sig;
  root.innerHTML = projectorHTML(st);
}
setInterval(projectorTick, 250);
window.addEventListener('pagehide', closeProjector);

function projectorHTML(st) {
  const p = bidRound.player,
    signed = auctionLog.length;
  const left = activePool().length;
  const badge =
    st.mode === 'bid'
      ? '<span class="pj-badge live">● LIVE</span>'
      : st.mode === 'draw'
        ? `<span class="pj-badge">${st.draw.drawn} DRAWN</span>`
        : `<span class="pj-badge">${auctionPhase === 'unsold' ? 'UNSOLD ROUND · ' : ''}${signed} SIGNED</span>`;
  const sp = EV.branding.sponsor;
  const sponsor = hasSponsor()
    ? `<div class="pj-sponsor"><span>${esc(sp.line)}</span>${sp.logo ? `<img src="${esc(sp.logo)}" alt=""/>` : ''}<b>${esc(sp.name)}</b></div>`
    : '';
  const top = `<div class="pj-top"><div class="pj-event">${esc(EV.name.toUpperCase())}</div>${sponsor}${badge}</div>`;
  const logo = t => `<img src="${esc(t.logo || '')}" alt="" onerror="this.style.visibility='hidden'"/>`;
  let main = '';

  if (st.mode === 'draw') {
    const d = st.draw,
      L = d.last;
    const recent = auctionLog.length && Date.now() - new Date(auctionLog[auctionLog.length - 1].endTime).getTime() < 8000;
    if (L && (!d.done || d.rolling || recent)) {
      const t = teams.find(x => x.id === d.shown);
      const tier = tierDef(L.tier)
        ? `<span class="pj-tier" style="color:${mix(tierColor(L.tier), '#ffffff', 0.3)};background:${rgba(tierColor(L.tier), 0.18)};border:1px solid ${rgba(tierColor(L.tier), 0.5)}">${esc(L.tier)}</span>`
        : '';
      main = `<div class="pj-main">
        <div class="pj-art">${generatePlayerSVG(L.player)}</div>
        <div class="pj-card"><div class="pj-kicker">${L.group ? esc(L.group) + ' · ' : ''}Draw #${L.n}</div><div class="pj-name">${esc(L.player)}</div>${tier}</div>
        <div class="pj-bid"><div class="pj-kicker">${d.rolling ? 'Joining…' : 'Joins'}</div>
          ${t ? `<div class="pj-sold-team${d.rolling ? ' pj-spin' : ''}" style="color:${t.color};flex-direction:column;gap:1.5vh">${logo(t)}<span style="font-family:Anton,Impact,sans-serif;font-size:6vh;text-transform:uppercase;text-align:right">${esc(t.name)}</span></div>` : '<div class="pj-big pj-spin">?</div>'}
          <div class="pj-sub">${L.options.length > 1 ? `1 of ${L.options.length} teams${L.group ? ' still due a ' + esc(L.group) : ''}` : ''}</div></div>
      </div>`;
    } else {
      main = `<div class="pj-main"><div class="pj-center">
        <div class="pj-kicker">${d.done ? 'Every team is set' : 'Random draw'}</div>
        <div class="pj-big">${d.done ? 'DRAW COMPLETE' : `${d.left} TO DRAW`}</div>
        <div class="pj-sub">${d.drawn} drawn · draw code ${esc(fmtCode(alloc.seed))}</div></div></div>`;
    }
  } else if (st.mode === 'bid') {
    const lead = teams.find(t => t.id === bidRound.leaderId);
    const open = openingMin(p);
    const tier = tierDef(p.tier)
      ? `<span class="pj-tier" style="color:${mix(tierColor(p.tier), '#ffffff', 0.3)};background:${rgba(tierColor(p.tier), 0.18)};border:1px solid ${rgba(tierColor(p.tier), 0.5)}">${esc(p.tier)}</span>`
      : '';
    const bids = bidRound.bids.filter(b => b.amount !== null).length;
    const timer = st.timerOn
      ? `<div class="pj-timer${bidTimerRemaining <= 5 && !bidTimerPaused ? ' urgent' : ''}">${bidTimerPaused ? '⏸' : '⏱'} ${bidTimerRemaining}s</div>`
      : '';
    main = `<div class="pj-main">
      <div class="pj-art">${generatePlayerSVG(p.name)}</div>
      <div class="pj-card">
        <div class="pj-kicker">${inUnsoldRound(p) ? 'Unsold round · second chance' : 'Now up for auction'}</div>
        <div class="pj-name">${esc(p.name)}</div>
        ${tier}
        <div class="pj-base">Base <b>${zarFmt(p.price)}</b>${open !== p.price ? ` · opening bid <b>${zarFmt(open)}</b>` : ''}</div>
      </div>
      <div class="pj-bid">
        ${_going ? `<div class="pj-going">${_going.step === 1 ? 'GOING ONCE…' : 'GOING TWICE…'}</div>` : ''}
        ${
          lead
            ? `<div class="pj-kicker">Current bid</div><div class="pj-amt">${zarS(bidRound.leaderBid)}</div>
          <div class="pj-lead" style="color:${lead.color}">${logo(lead)}${esc(lead.name)}</div>
          <div class="pj-sub">${bids} bid${bids !== 1 ? 's' : ''}</div>`
            : `<div class="pj-kicker">Opening bid</div><div class="pj-amt">${zarS(open)}</div><div class="pj-sub">Waiting for the first bid</div>`
        }
        ${timer}
      </div>
    </div>`;
  } else if (st.mode === 'sold') {
    const t = teams.find(x => x.name === st.last.team) || { color: st.last.teamColor, logo: '' };
    main = `<div class="pj-main"><div class="pj-center">
      <div class="pj-big pj-sold">SOLD!</div>
      <div class="pj-name" style="font-size:8vh">${esc(st.last.player)}</div>
      <div class="pj-sold-team" style="color:${t.color}">${logo(t)}${esc(st.last.team)}</div>
      <div class="pj-amt" style="font-size:9vh">${zarS(st.last.finalPrice)}</div>
    </div></div>`;
  } else if (st.mode === 'spin') {
    main = `<div class="pj-main"><div class="pj-center">
      <div class="pj-kicker">${EV.draw === 'wheel' ? 'The wheel is spinning' : 'Drawing the next player'}</div>
      <div class="pj-big pj-spin">${EV.draw === 'wheel' ? esc(EV.wheelIcon || '') + ' ' : ''}WHO'S NEXT?</div>
      <div class="pj-sub">${left} player${left !== 1 ? 's' : ''} in the draw</div>
    </div></div>`;
  } else if (st.mode === 'break') {
    const ms = Math.max(0, st.breakEnd - Date.now()),
      m = Math.floor(ms / 60000),
      s = Math.floor(ms / 1000) % 60;
    main = `<div class="pj-main"><div class="pj-center">
      <div class="pj-kicker">${ms ? 'Back in' : ''}</div>
      <div class="pj-clock">${ms ? `${m}:${String(s).padStart(2, '0')}` : "WE'RE BACK"}</div>
      <div class="pj-standings">${teams
        .map(t => {
          const buys = t.players.filter(x => !x.isCaptain && !x.isFormer).sort((a, b) => (b.finalPrice || 0) - (a.finalPrice || 0));
          return `<div class="pj-st" style="--tc:${t.color}">${logo(t)}<div><b>${esc(t.name)}</b>
          <span>${squadText(t)} signed${buys[0] ? ` · top buy ${esc(buys[0].name)} ${zarS(buys[0].finalPrice)}` : ''}</span></div><i>${zarS(t.budget)}</i></div>`;
        })
        .join('')}</div>
    </div></div>`;
  } else {
    const q = EV.unsold.enabled && auctionPhase === 'main' ? unsoldQueue().length : 0;
    main = `<div class="pj-main"><div class="pj-center">
      <div class="pj-kicker">${left ? 'Up next' : 'Draw complete'}</div>
      <div class="pj-big">${left ? `${left} TO GO` : "THAT'S A WRAP"}</div>
      <div class="pj-sub">${signed} signed${q ? ` · ${q} in the unsold queue` : ''}${st.last ? ` · last: ${esc(st.last.player)} → ${esc(st.last.team)} for ${zarS(st.last.finalPrice)}` : ''}</div>
    </div></div>`;
  }

  const strip =
    st.mode === 'break'
      ? ''
      : `<div class="pj-strip${teams.length > 8 ? ' dense' : ''}">${teams
          .map(t => {
            const cls =
              st.mode === 'bid' ? (t.id === bidRound.leaderId ? ' lead' : bidRound.passed.has(t.id) || isTeamBlocked(t) ? ' out' : '') : '';
            return html`<div class="pj-team${cls}" style="--tc:${t.color}">
              ${raw(logo(t))}
              <div class="pj-team-txt">
                <div class="pj-team-name">${t.name}</div>
                <div class="pj-team-purse">${noMoney() ? squadText(teamView(t)) : zarS(t.budget)}</div>
                <div class="pj-team-sq">${noMoney() ? tierMix(teamView(t)) || 'squad' : squadText(t) + ' signed'}</div>
              </div>
            </div>`;
          })
          .join('')}</div>`;

  return top + main + strip;
}
