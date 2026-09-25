const BUDGET = 10000000;
const COLORS = ['#00c8ff','#f5b800','#00e87a','#ff4050','#b060ff','#ff8030'];
const zarFmt = v => 'R ' + Number(v).toLocaleString('en-ZA', {maximumFractionDigits:0});
const zarS = v => v >= 1e6 ? 'R'+(v/1e6).toFixed(2)+'M' : v >= 1000 ? 'R'+(v/1000).toFixed(0)+'K' : 'R'+v;
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const TIER_LIMIT = 2;
const tierCount = (team, tier) =>
  tier ? team.players.filter(p => !p.isCaptain && (p.tier||'').toLowerCase() === tier.toLowerCase()).length : 0;
const MAX_PLAYERS = 8; // 1 captain + 2 former picks + 5 auction signings
let teams=[], players=[], auctionLog=[], spinning=false, currentPlayer=null, selectedTeamId=null, spinAngle=0;
let _pid=0;
const nextId=()=>String(++_pid);

// ── TEAM CONFIG ──────────────────────────────────────────────────────────────
// Defaults come from teams.config.js (window.DRAFT_DAY_TEAMS). Edits made on the
// setup screen are remembered on this device until that file changes.
// logo: a path (e.g. 'logos/x.png'), a data URL from an upload, or '' for an initials badge.
const TEAM_COUNT = 6;
const TEAM_CFG_KEY = 'draftday.teams.v2';

function defaultTeamConfig() {
  const src = Array.isArray(window.DRAFT_DAY_TEAMS) ? window.DRAFT_DAY_TEAMS : [];
  if (src.length !== TEAM_COUNT) console.warn(`teams.config.js should list ${TEAM_COUNT} teams (found ${src.length}); filling the gaps.`);
  return Array.from({ length: TEAM_COUNT }, (_, i) => {
    const d = src[i] || {};
    return {
      name:    typeof d.name === 'string' ? d.name : 'Team ' + (i + 1),
      captain: typeof d.captain === 'string' ? d.captain : '',
      color:   /^#[0-9a-f]{6}$/i.test(d.color || '') ? d.color : COLORS[i],
      logo:    typeof d.logo === 'string' ? d.logo.trim() : '',
    };
  });
}
// Fingerprint of teams.config.js, so editing the file overrides older on-device edits
const CONFIG_SIG = JSON.stringify(defaultTeamConfig());

let teamConfig = loadTeamConfig();

function loadTeamConfig() {
  const base = defaultTeamConfig();
  try {
    const saved = JSON.parse(localStorage.getItem(TEAM_CFG_KEY) || 'null');
    if (saved && saved.sig === CONFIG_SIG && Array.isArray(saved.teams) && saved.teams.length === TEAM_COUNT) {
      return base.map((d, i) => {
        const t = saved.teams[i] || {};
        return {
          name:    typeof t.name === 'string' ? t.name : d.name,
          captain: typeof t.captain === 'string' ? t.captain : d.captain,
          color:   /^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : d.color,
          logo:    typeof t.logo === 'string' ? t.logo : d.logo,
        };
      });
    }
  } catch (e) { /* storage unavailable or corrupt — fall back to the config file */ }
  return base;
}
function saveTeamConfig() {
  try { localStorage.setItem(TEAM_CFG_KEY, JSON.stringify({ sig: CONFIG_SIG, teams: teamConfig })); }
  catch (e) { /* storage full/blocked — edits still work for this session */ }
}

// Coloured initials badge, used when a team has no logo or its file can't be found
function initialsBadge(name, color) {
  const initials = (name || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(w => w && !/^(the|and|of)$/i.test(w))
    .slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#111"/>`+
    `<circle cx="32" cy="32" r="29" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="3"/>`+
    `<text x="32" y="34" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-weight="700" font-size="24" fill="${color}">${initials}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// Logo paths that failed to load (missing/misspelt file) → fall back to the badge
const brokenLogos = new Set();
function checkLogos() {
  const paths = [...new Set(teamConfig.map(c => c.logo).filter(l => l && !l.startsWith('data:') && !brokenLogos.has(l)))];
  paths.forEach(src => {
    const img = new Image();
    img.onerror = () => {
      brokenLogos.add(src);
      console.warn('Team logo not found:', src);
      renderTeamInputs(); renderPickOrderList();
      teams.forEach(t => { if (t.logo === src) t.logo = initialsBadge(t.name, t.color); });
      if (teams.length) renderTeamsBar();
    };
    img.src = src;
  });
}

const cfgLogo = i => {
  const c = teamConfig[i];
  return c.logo && !brokenLogos.has(c.logo) ? c.logo : initialsBadge(cfgName(i), c.color);
};
const cfgName = i => teamConfig[i].name.trim() || 'Team ' + (i + 1);

// Captain names currently in play (from launched teams, else from setup config).
// Captains are never put on the wheel.
function getCaptainNames() {
  const names = teams.length
    ? teams.flatMap(t => t.players.filter(p => p.isCaptain).map(p => p.name))
    : teamConfig.map(c => c.captain);
  return names.map(n => (n || '').trim().toLowerCase()).filter(Boolean);
}

let pickOrder = [...Array(TEAM_COUNT).keys()]; // team slot indices

function renderTeamInputs() {
  const w = document.getElementById('teamInputs');
  w.innerHTML = teamConfig.map((c, i) => `
    <div class="team-edit-row" style="--team-col:${c.color}">
      <button type="button" class="team-edit-logo" onclick="pickTeamLogo(${i})" title="Upload a logo for ${esc(cfgName(i))}">
        <img src="${cfgLogo(i)}" alt=""/>
      </button>
      <div class="team-edit-fields">
        <input class="team-edit-name" id="ti${i}" value="${esc(c.name)}" placeholder="Team ${i+1}" maxlength="32"
          aria-label="Team ${i+1} name" oninput="updateTeamCfg(${i},'name',this.value)"/>
        <label class="team-edit-captain-wrap" title="Captain — auto-assigned to this team, kept off the wheel">
          <span>👑</span>
          <input class="team-edit-captain" id="tc${i}" value="${esc(c.captain)}" placeholder="Captain name" maxlength="40"
            aria-label="Team ${i+1} captain" oninput="updateTeamCfg(${i},'captain',this.value)"/>
        </label>
      </div>
      <label class="team-edit-color" style="background:${c.color}" title="Team colour">
        <input type="color" value="${c.color}" aria-label="Team ${i+1} colour" oninput="updateTeamCfg(${i},'color',this.value)"/>
      </label>
    </div>`).join('');
}

function updateTeamCfg(i, field, value) {
  teamConfig[i][field] = value;
  saveTeamConfig();
  if (field === 'color') {
    const row = document.getElementById('ti'+i)?.closest('.team-edit-row');
    if (row) { row.style.setProperty('--team-col', value); row.querySelector('.team-edit-color').style.background = value; }
  }
  if (field === 'name') renderPickOrderList();
}

let _logoSlot = null;
function pickTeamLogo(i) { _logoSlot = i; document.getElementById('teamLogoInput').click(); }

function handleTeamLogo(e) {
  const f = e.target.files[0]; e.target.value = '';
  if (!f || _logoSlot === null) return;
  const slot = _logoSlot; _logoSlot = null;
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => {
    // Centre-crop to a square and shrink to 160px so it stays light in storage & save files
    const S = 160, c = document.createElement('canvas'); c.width = c.height = S;
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const g = c.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, S, S); // same backdrop as the logo circles; JPEG keeps PDF export happy
    g.drawImage(img, (img.naturalWidth-side)/2, (img.naturalHeight-side)/2, side, side, 0, 0, S, S);
    URL.revokeObjectURL(url);
    teamConfig[slot].logo = c.toDataURL('image/jpeg', 0.9);
    saveTeamConfig(); renderTeamInputs(); renderPickOrderList();
    showToast(`Logo updated for ${cfgName(slot)}`);
  };
  img.onerror = () => { URL.revokeObjectURL(url); showToast('Could not read that image'); };
  img.src = url;
}

function resetTeamConfig() {
  if (!confirm('Restore the teams from teams.config.js? Your edits on this device will be discarded.')) return;
  teamConfig = defaultTeamConfig();
  try { localStorage.removeItem(TEAM_CFG_KEY); } catch (e) {}
  renderTeamInputs(); renderPickOrderList(); checkLogos();
  showToast('Teams restored from teams.config.js');
}

renderTeamInputs();
checkLogos();

function renderPickOrderList() {
  const el = document.getElementById('pickOrderList');
  el.innerHTML = pickOrder.map((idx, pos) => {
    const name = cfgName(idx);
    return `<div class="pick-order-row" id="por-${idx}" draggable="true"
        ondragstart="pickDragStart(event,${idx})" ondragover="pickDragOver(event,${idx})"
        ondragleave="pickDragLeave(event,${idx})" ondrop="pickDrop(event,${idx})">
      <span class="pick-order-drag-handle">⠿</span>
      <div class="pick-order-num">${pos+1}</div>
      <img src="${cfgLogo(idx)}" class="team-logo-sm" alt=""/>
      <div class="pick-order-name">${esc(name)}</div>
      <div class="pick-order-btns">
        <button class="pick-order-btn" ${pos===0?'disabled':''} onclick="${pos===0?'':('pickMoveUp('+idx+')')}" title="Move up">▲</button>
        <button class="pick-order-btn" ${pos===pickOrder.length-1?'disabled':''} onclick="${pos===pickOrder.length-1?'':('pickMoveDown('+idx+')')}" title="Move down">▼</button>
      </div>
    </div>`;
  }).join('');
}

let _dragIdx = null;
function pickDragStart(e, idx) { _dragIdx = idx; e.dataTransfer.effectAllowed = 'move'; }
function pickDragOver(e, idx) {
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  document.getElementById('por-'+idx)?.classList.add('drag-over');
}
function pickDragLeave(e, idx) { document.getElementById('por-'+idx)?.classList.remove('drag-over'); }
function pickDrop(e, idx) {
  e.preventDefault();
  document.getElementById('por-'+idx)?.classList.remove('drag-over');
  if(_dragIdx === null || _dragIdx === idx) return;
  const from = pickOrder.indexOf(_dragIdx), to = pickOrder.indexOf(idx);
  pickOrder.splice(from, 1); pickOrder.splice(to, 0, _dragIdx);
  _dragIdx = null; renderPickOrderList();
}
function pickMoveUp(idx) {
  const i = pickOrder.indexOf(idx); if(i <= 0) return;
  [pickOrder[i-1], pickOrder[i]] = [pickOrder[i], pickOrder[i-1]]; renderPickOrderList();
}
function pickMoveDown(idx) {
  const i = pickOrder.indexOf(idx); if(i >= pickOrder.length-1) return;
  [pickOrder[i+1], pickOrder[i]] = [pickOrder[i], pickOrder[i+1]]; renderPickOrderList();
}
renderPickOrderList();

function launchAuction() {
  const budget = adminRules.budget;
  const caps = teamConfig.map(c => c.captain.trim().toLowerCase()).filter(Boolean);
  if (new Set(caps).size !== caps.length) { showToast('Two teams have the same captain — fix that first'); return; }
  teams = teamConfig.map((c, i) => {
    const captain = c.captain.trim();
    return {
      id: i,
      name: cfgName(i),
      color: c.color,
      logo: cfgLogo(i),
      budget: budget,
      players: captain ? [{
        id: nextId(), name: captain, price: 0, tier: 'Captain',
        finalPrice: 0, sold: true, isCaptain: true, teamId: i
      }] : []
    };
  });
  document.getElementById('setupScreen').style.display='none';
  // Go to selection round first
  selectionRoundInit();
}

// ── SELECTION ROUND ─────────────────────────────────────────────────────────
let selPlayers = [];   // former players pool
let selPickIdx = 0;    // index into selTurnOrder (0-11 for 12 total picks)
let selTurnOrder = []; // team ids, snake: [0,1,2,3,4,5,5,4,3,2,1,0]
let selDone = false;

const selPriceLabel = p => zarS(p.price);

function selectionRoundInit() {
  selPickIdx = 0;
  selDone = false;
  const round1 = [...pickOrder];
  const round2 = [...pickOrder].reverse();
  selTurnOrder = [...round1, ...round2];
  document.getElementById('selectionScreen').classList.add('open');
  selRenderOrderList();
  selRenderTurnCard();
  selRenderPlayerGrid();
}

function selCurrentTeam() {
  return teams.find(t => t.id === selTurnOrder[selPickIdx]);
}

function selRenderOrderList() {
  const half = selTurnOrder.length / 2;
  let html = '';
  selTurnOrder.forEach((teamId, i) => {
    const t = teams.find(x => x.id === teamId);
    const isDone = i < selPickIdx;
    const isCurrent = i === selPickIdx && !selDone;
    const formerPicks = t.players.filter(p => p.isFormer);
    const pick = formerPicks[i < half ? 0 : 1];
    if (i === 0) html += '<div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.12em;color:var(--accent);margin-bottom:0.35rem;margin-top:0.1rem">Round 1</div>';
    if (i === half) html += '<div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.12em;color:var(--gold);margin-bottom:0.35rem;margin-top:0.5rem">Round 2 \u2014 Reversed</div>';
    html += '<div class="sel-order-row'+(isCurrent?' current':'')+(isDone?' done':'')+'">'+
      '<div class="sel-order-num">'+(i < half ? i+1 : (selTurnOrder.length-i))+'</div>'+
      '<div class="sel-order-dot" style="background:'+t.color+'"></div>'+
      '<div class="sel-order-name">'+esc(t.name)+'</div>'+
      '<div class="sel-order-pick">'+(pick ? esc(pick.name) : (isDone ? 'Skipped' : '\u2014'))+'</div>'+
    '</div>';
  });
  document.getElementById('selOrderList').innerHTML = html;
}

function selRenderTurnCard() {
  if (selDone) {
    document.getElementById('selTurnTeam').textContent = 'All picks done!';
    document.getElementById('selTurnTeam').style.color = 'var(--green)';
    document.getElementById('selTurnSub').textContent = 'Click "Start Auction" to continue.';
    document.getElementById('selCompleteBanner').classList.add('visible');
    return;
  }
  if (selPickIdx >= selTurnOrder.length) { selDone = true; selRenderTurnCard(); return; }
  const t = selCurrentTeam();
  const isRound2 = selPickIdx >= selTurnOrder.length / 2;
  const el = document.getElementById('selTurnTeam');
  el.textContent = t.name;
  el.style.color = t.color;
  const logoEl = document.getElementById('selTurnLogo');
  if(logoEl){ logoEl.src = t.logo; logoEl.style.display='inline-block'; }
  document.getElementById('selTurnSub').textContent = selPlayers.length
    ? (isRound2 ? 'Round 2 \u2014 ' : '') + 'Select one former player for ' + t.name + ' (Pick ' + (isRound2 ? 2 : 1) + ')'
    : 'Load a CSV of former players to pick from.';
  document.querySelector('.sel-phase-badge').textContent = isRound2 ? 'ROUND 2 \u2014 REVERSED' : 'ROUND 1';
}

function selRenderPlayerGrid() {
  const grid = document.getElementById('selPlayerGrid');
  if (!selPlayers.length) {
    grid.innerHTML = '<div class="sel-empty">Load former players via the CSV panel \u2192</div>';
    return;
  }
  grid.innerHTML = selPlayers.map(p => {
    const taken = p.pickedBy !== null;
    const assignedTeam = taken ? teams.find(t => t.id === p.pickedBy) : null;
    const tierPill = p.tier ? '<span class="tier-pill tp-'+p.tier.toLowerCase()+'">'+p.tier+'</span>' : '';
    const priceLabel = selPriceLabel(p);
    const isFree = p.price === 0;
    return '<div class="sel-player-card'+(taken?' taken':'')+'" onclick="selPickPlayer(\''+p.id+'\')">'+
      '<div class="spc-name">'+esc(p.name)+'</div>'+
      tierPill+
      '<div class="spc-team">'+
        (taken
          ? '<div class="spc-taken-dot" style="background:'+(assignedTeam?.color||'#555')+'"></div><span>'+esc(assignedTeam?.name||'')+'</span>'
          : '<span style="color:'+(isFree?'var(--green)':'var(--muted)')+';font-size:0.72rem;font-weight:'+(isFree?'700':'400')+'">'+priceLabel+'</span>'
        )+
      '</div>'+
    '</div>';
  }).join('');
}

function selPickPlayer(id) {
  if (selDone || selPickIdx >= selTurnOrder.length) return;
  const p = selPlayers.find(x => x.id === id);
  if (!p || p.pickedBy !== null) return;
  const team = selCurrentTeam();
  p.pickedBy = team.id;
  team.players.push({
    id: nextId(), name: p.name, price: p.price, tier: p.tier,
    finalPrice: 0, sold: true, isFormer: true, teamId: team.id
  });
  selPickIdx++;
  selRenderOrderList();
  selRenderTurnCard();
  selRenderPlayerGrid();
  if (selPickIdx >= selTurnOrder.length) { selDone = true; selRenderTurnCard(); selRenderOrderList(); }
}

function selSkipTurn() {
  if (selDone || selPickIdx >= selTurnOrder.length) return;
  selPickIdx++;
  selRenderOrderList();
  selRenderTurnCard();
  if (selPickIdx >= selTurnOrder.length) { selDone = true; selRenderTurnCard(); selRenderOrderList(); }
}

function handleSelCSV(e) { const f = e.target.files[0]; if(f) parseSelCSV(f); e.target.value=''; }

function parseSelCSV(file) {
  const r = new FileReader();
  r.onload = e => {
    const lines = e.target.result.trim().split(/\r?\n/);
    let added = 0, skipped = 0;
    lines.forEach((line, i) => {
      if(i===0 && line.toLowerCase().startsWith('name')) return;
      const p = line.split(',');
      if(p.length < 2) return;
      const name = p[0].trim(), price = parseFloat(p[1].trim().replace(/[R\s]/g,''));
      const tier = p[2] ? p[2].trim().charAt(0).toUpperCase()+p[2].trim().slice(1).toLowerCase() : '';
      const validTier = ['Platinum','Gold','Silver','Bronze'].includes(tier) ? tier : '';
      if(!name || isNaN(price)) return;
      // Duplicate check — case-insensitive name match
      const exists = selPlayers.some(x => x.name.toLowerCase() === name.toLowerCase());
      if(exists) { skipped++; return; }
      selPlayers.push({ id: nextId(), name, price, tier: validTier, pickedBy: null });
      added++;
    });
    if(added) { selRenderPlayerGrid(); selRenderTurnCard(); }
    if(added && skipped) showToast(`Loaded ${added} player${added>1?'s':''} · ${skipped} duplicate${skipped>1?'s':''} skipped`);
    else if(added) showToast(`Loaded ${added} former player${added>1?'s':''}`);
    else if(skipped) showToast(`All ${skipped} player${skipped>1?'s were':' was'} already loaded`);
    else showToast('No valid rows found');
  };
  r.readAsText(file);
}

function startAuction() {
  document.getElementById('selectionScreen').classList.remove('open');
  document.getElementById('appScreen').style.display='flex';
  document.getElementById('appScreen').style.flexDirection='column';
  renderTeamsBar(); renderPlayersList(); drawWheel();
  document.getElementById('roundBadge').innerHTML = '<span class="live-dot"></span>AUCTION LIVE';
}

// Wire up sel dropzone
document.getElementById('selDropzone').addEventListener('dragover', e=>{e.preventDefault();e.currentTarget.classList.add('drag-over');});
document.getElementById('selDropzone').addEventListener('dragleave', e=>{e.currentTarget.classList.remove('drag-over');});
document.getElementById('selDropzone').addEventListener('drop', e=>{
  e.preventDefault(); e.currentTarget.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if(f?.name.endsWith('.csv')) parseSelCSV(f); else showToast('Drop a .csv file');
});

function renderTeamsBar() {
  document.getElementById('teamsBar').innerHTML = teams.map(t=>{
    const pct=(t.budget/BUDGET)*100;
    const cls=pct<20?'low':pct<50?'mid':'ok';
    const formerCount=t.players.filter(p=>p.isFormer).length;
    const auctionCount=t.players.filter(p=>!p.isCaptain&&!p.isFormer).length;
    return `<div class="team-card" onclick="showTeamRoster(${t.id})" title="${esc(t.name)} roster">
      <div class="team-card-top">
        <img src="${t.logo}" class="team-logo-sm" alt="${esc(t.name)}"/>
        <div class="team-card-name">${esc(t.name)}</div>
      </div>
      <div class="team-budget-bar-wrap">
        <div class="team-budget-bar" style="width:${pct}%;background:${t.color}"></div>
      </div>
      <div class="team-budget-nums">
        <div class="team-budget-left ${cls}">${zarS(t.budget)}</div>
        <div class="team-player-count">👑${formerCount?'🏅'.repeat(formerCount):''} + ${auctionCount}/5 signed</div>
      </div>
    </div>`;
  }).join('');
}

// CSV
document.getElementById('dropzone').addEventListener('dragover',e=>{e.preventDefault();e.currentTarget.classList.add('drag-over');});
document.getElementById('dropzone').addEventListener('dragleave',e=>{e.currentTarget.classList.remove('drag-over');});
document.getElementById('dropzone').addEventListener('drop',e=>{
  e.preventDefault(); e.currentTarget.classList.remove('drag-over');
  const f=e.dataTransfer.files[0];
  if(f?.name.endsWith('.csv')) parseCSV(f); else showToast('Drop a .csv file');
});

function handleCSV(e){const f=e.target.files[0];if(f)parseCSV(f);e.target.value='';}

function parseCSV(file){
  const r=new FileReader();
  r.onload=e=>{
    const lines=e.target.result.trim().split(/\r?\n/);
    let added=0, skipped=0;
    lines.forEach((line,i)=>{
      if(i===0&&line.toLowerCase().startsWith('name'))return;
      const p=line.split(',');
      if(p.length<2)return;
      const name=p[0].trim(), price=parseFloat(p[1].trim().replace(/[R\s]/g,''));
      const tier=p[2]?p[2].trim().charAt(0).toUpperCase()+p[2].trim().slice(1).toLowerCase():'';
      const validTier=['Platinum','Gold','Silver','Bronze'].includes(tier)?tier:'';
      if(!name||isNaN(price))return;
      const exists=players.some(x=>x.name.toLowerCase()===name.toLowerCase());
      if(exists){skipped++;return;}
      players.push({id:nextId(),name,price,tier:validTier,sold:false,teamId:null});
      added++;
    });
    if(added){renderPlayersList();drawWheel();}
    if(added&&skipped) showToast(`Loaded ${added} player${added>1?'s':''} · ${skipped} duplicate${skipped>1?'s':''} skipped`);
    else if(added) showToast(`Loaded ${added} player${added>1?'s':''}`);
    else if(skipped) showToast(`All ${skipped} player${skipped>1?'s were':' was'} already loaded`);
    else showToast('No valid rows found');
  };
  r.readAsText(file);
}

function addPlayer(){
  const nE=document.getElementById('newName'), pE=document.getElementById('newPrice'), tE=document.getElementById('newTier');
  const name=nE.value.trim(), price=parseFloat(pE.value.replace(/[R\s,]/g,'')), tier=tE.value;
  if(!name){showToast('Enter a player name');return;}
  if(isNaN(price)||price<0){showToast('Enter a valid price');return;}
  if(players.some(x=>x.name.toLowerCase()===name.toLowerCase())){showToast(`"${name}" is already in the list`);return;}
  players.push({id:nextId(),name,price,tier,sold:false,teamId:null});
  nE.value='';pE.value='';tE.value='';nE.focus();
  renderPlayersList();drawWheel();
}

function removePlayer(id){
  players=players.filter(p=>p.id!==id);
  renderPlayersList();drawWheel();
}

function renderPlayersList(){
  const el=document.getElementById('playersList');
  if(!players.length){el.innerHTML='<div class="empty-state">No players yet.</div>';document.getElementById('playerBadge').textContent=0;document.getElementById('spinBtn').disabled=true;return;}
  const captainNames=getCaptainNames();
  el.innerHTML=players.map((p,i)=>{
    const t=p.teamId!==null?teams.find(x=>x.id===p.teamId):null;
    const tierPill=p.tier?`<span class="tier-pill tp-${p.tier.toLowerCase()}">${p.tier}</span>`:'';
    const isCaptainPlayer=captainNames.includes(p.name.toLowerCase());
    const isSold=p.sold||isCaptainPlayer;
    const priceHtml=isSold
      ? `<div class="player-price">${p.finalPrice?zarS(p.finalPrice):zarS(p.price)}</div>`
      : `<div class="player-price-wrap" id="price-wrap-${p.id}"><div class="player-price-edit" title="Click to edit price">${zarS(p.price)}</div></div>`;
    return `<div class="player-row${isSold?' sold':''}" id="pr-${p.id}">
      <div class="player-idx">${i+1}</div>
      <div class="player-team-dot" style="background:${t?t.color:'transparent'}"></div>
      <div class="player-name">${esc(p.name)}</div>
      ${tierPill}
      ${priceHtml}
      ${!isSold?`<button class="player-remove" onclick="removePlayer('${p.id}')">✕</button>`:''}
    </div>`;
  }).join('');
  // Attach click handlers after render (avoids inline handler + ID type issues)
  players.forEach(p=>{
    const wrap=document.getElementById('price-wrap-'+p.id);
    if(wrap) wrap.querySelector('.player-price-edit').addEventListener('click',()=>startEditPrice(p.id));
  });
  document.getElementById('playerBadge').textContent=players.length;
  document.getElementById('spinBtn').disabled=players.filter(p=>!p.sold&&!captainNames.includes(p.name.toLowerCase())).length<1||spinning;
}

function startEditPrice(id) {
  const p = players.find(x=>x.id===id);
  if(!p||p.sold) return;
  const wrap = document.getElementById('price-wrap-'+id);
  if(!wrap) return;
  wrap.innerHTML = `<input class="player-price-inp" type="number" value="${p.price}" min="0" step="10000"/>`;
  const inp = wrap.querySelector('input');
  inp.focus();
  inp.select();
  let committed = false;
  function commit() {
    if(committed) return;
    committed = true;
    const val = parseFloat(inp.value);
    if(!isNaN(val) && val >= 0) p.price = val;
    renderPlayersList();
    drawWheel();
  }
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); commit(); }
    if(e.key==='Escape'){ committed=true; renderPlayersList(); }
  });
}

// WHEEL
const canvas=document.getElementById('wheelCanvas');
const ctx=canvas.getContext('2d');
function getWheelSize(){ return Math.min(560, window.innerWidth - 40); }
function resizeCanvas(){
  const sz = getWheelSize();
  canvas.width = sz; canvas.height = sz;
  const halo = document.getElementById('wheelHalo');
  if(halo){ halo.style.width = (sz+20)+'px'; halo.style.height = (sz+20)+'px'; }
}
resizeCanvas();
window.addEventListener('resize', ()=>{ resizeCanvas(); drawWheel(); });
function getCX(){ return canvas.width/2; }
function getCY(){ return canvas.height/2; }
function getR(){ return getCX()-12; }
const SLICECOLS=['#0e2236','#0e3620','#2a0e3a','#3a2208','#0e1e3a','#3a0e14','#082a3a','#083a18','#220836','#3a1e06','#08163a','#3a0810'];

function drawWheel(rotation){
  if(rotation===undefined)rotation=spinAngle;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const captainNames=getCaptainNames();
  const active=players.filter(p=>!p.sold&&!captainNames.includes(p.name.toLowerCase()));
  if(!active.length){
    ctx.beginPath();ctx.arc(getCX(),getCY(),getR(),0,Math.PI*2);ctx.fillStyle='#111820';ctx.fill();
    ctx.strokeStyle='#1e2a38';ctx.lineWidth=3;ctx.stroke();
    ctx.fillStyle='#5a7080';ctx.font='600 13px Barlow,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(players.length?'All players signed!':'Load players to spin',getCX(),getCY());
    return;
  }
  const sl=(Math.PI*2)/active.length;
  active.forEach((p,i)=>{
    const s=rotation+i*sl, e=s+sl;
    ctx.beginPath();ctx.moveTo(getCX(),getCY());ctx.arc(getCX(),getCY(),getR(),s,e);ctx.closePath();
    ctx.fillStyle=SLICECOLS[i%SLICECOLS.length];ctx.fill();
    ctx.strokeStyle='#060810';ctx.lineWidth=1.5;ctx.stroke();
    const g=ctx.createRadialGradient(getCX(),getCY(),0,getCX(),getCY(),getR());
    g.addColorStop(0,'rgba(255,255,255,0.08)');g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.beginPath();ctx.moveTo(getCX(),getCY());ctx.arc(getCX(),getCY(),getR(),s,e);ctx.closePath();ctx.fillStyle=g;ctx.fill();
    const mid=s+sl/2, lr=getR()*0.62, tx=getCX()+Math.cos(mid)*lr, ty=getCY()+Math.sin(mid)*lr;
    ctx.save();ctx.translate(tx,ty);ctx.rotate(mid+Math.PI/2);
    const fs=active.length>20?9:active.length>14?11:active.length>8?13:16;
    const mw=active.length>12?65:95;
    ctx.font=`700 ${fs}px Barlow,sans-serif`;ctx.fillStyle='#dde8f0';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.shadowColor='rgba(0,0,0,0.9)';ctx.shadowBlur=5;
    ctx.fillText(trunc(p.name,mw,ctx),0,-5);
    ctx.font=`500 ${fs-1}px Barlow,sans-serif`;ctx.fillStyle='#f5b800';ctx.shadowBlur=0;
    ctx.fillText(zarS(p.price),0,6);
    ctx.restore();
  });
  ctx.beginPath();ctx.arc(getCX(),getCY(),getR(),0,Math.PI*2);ctx.strokeStyle='rgba(0,200,255,0.3)';ctx.lineWidth=2.5;ctx.stroke();
  ctx.beginPath();ctx.arc(getCX(),getCY(),26,0,Math.PI*2);
  const cg=ctx.createRadialGradient(getCX()-5,getCY()-5,0,getCX(),getCY(),26);cg.addColorStop(0,'#18202c');cg.addColorStop(1,'#0d1218');
  ctx.fillStyle=cg;ctx.fill();ctx.strokeStyle='#00c8ff';ctx.lineWidth=2;ctx.stroke();
  ctx.font='15px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('⚽',getCX(),getCY());
}

function trunc(t,mx,c){if(c.measureText(t).width<=mx)return t;while(t.length>1&&c.measureText(t+'…').width>mx)t=t.slice(0,-1);return t+'…';}

// ── AUDIO ───────────────────────────────────────────────────────────────────
let audioCtx=null, jingleNodes=[];

function getAC(){
  audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)();
  if(audioCtx.state==='suspended') audioCtx.resume();
  return audioCtx;
}

function stopJingle(){
  jingleNodes.forEach(n=>{try{n.stop();}catch(e){}});
  jingleNodes=[];
}

function playSpinJingle(duration){
  stopJingle();
  const ac=getAC();
  const now=ac.currentTime;

  const master=ac.createGain();
  master.gain.setValueAtTime(0.28, now);
  master.connect(ac.destination);

  // Upbeat repeating carnival-style arpeggio
  // C major pentatonic: C4 E4 G4 A4 C5
  const notes=[261.63, 329.63, 392.00, 440.00, 523.25];
  const step=0.13; // seconds per note
  const totalNotes=Math.floor((duration/1000)/step);

  for(let i=0;i<totalNotes;i++){
    const freq=notes[i % notes.length];
    const t=now + i*step;

    // Bell-like tone: sine + triangle blend
    ['sine','triangle'].forEach((type,ti)=>{
      const osc=ac.createOscillator();
      osc.type=type;
      osc.frequency.setValueAtTime(freq * (ti===1?2:1), t);

      const g=ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(ti===0?0.9:0.3, t+0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t+step*0.85);

      osc.connect(g); g.connect(master);
      osc.start(t); osc.stop(t+step);
      jingleNodes.push(osc);
    });

    // Add a subtle bounce bass note every 5 notes
    if(i % 5 === 0){
      const bass=ac.createOscillator();
      bass.type='sine';
      bass.frequency.setValueAtTime(freq*0.5, t);
      const bg=ac.createGain();
      bg.gain.setValueAtTime(0,t);
      bg.gain.linearRampToValueAtTime(0.5, t+0.02);
      bg.gain.exponentialRampToValueAtTime(0.001, t+step*1.8);
      bass.connect(bg); bg.connect(master);
      bass.start(t); bass.stop(t+step*2);
      jingleNodes.push(bass);
    }
  }

  // Speed up slightly as wheel slows (pitch bend up on last 20%)
  const rampStart=now + duration/1000*0.75;
  // Fade out at very end
  master.gain.setValueAtTime(0.28, now+duration/1000-0.4);
  master.gain.linearRampToValueAtTime(0, now+duration/1000);
}

function playVictorySting(){
  const ac=getAC();
  const now=ac.currentTime;
  const master=ac.createGain(); master.gain.value=0.4; master.connect(ac.destination);
  // Rising fanfare: C4 E4 G4 C5 — staggered
  [[261.63,0],[329.63,0.1],[392.00,0.2],[523.25,0.3]].forEach(([freq,delay])=>{
    const o=ac.createOscillator(); o.type='triangle'; o.frequency.value=freq;
    const g=ac.createGain();
    g.gain.setValueAtTime(0, now+delay);
    g.gain.linearRampToValueAtTime(1.0, now+delay+0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now+delay+0.9);
    o.connect(g); g.connect(master);
    o.start(now+delay); o.stop(now+delay+1.0);
    // Octave shimmer
    const o2=ac.createOscillator(); o2.type='sine'; o2.frequency.value=freq*2;
    const g2=ac.createGain();
    g2.gain.setValueAtTime(0,now+delay);
    g2.gain.linearRampToValueAtTime(0.3,now+delay+0.02);
    g2.gain.exponentialRampToValueAtTime(0.001,now+delay+0.7);
    o2.connect(g2); g2.connect(master);
    o2.start(now+delay); o2.stop(now+delay+0.8);
  });
}

function spinWheel(){
  if(spinning)return;
  const captainNames=getCaptainNames();
  const active=players.filter(p=>!p.sold&&!captainNames.includes(p.name.toLowerCase()));
  if(!active.length)return;
  dismissWinner();
  spinning=true;
  document.getElementById('spinBtn').disabled=true;
  canvas.classList.add('spinning');
  document.getElementById('wheelHalo').classList.add('active');
  const target=spinAngle+(5+Math.random()*6)*Math.PI*2+Math.random()*Math.PI*2;
  const dur=4000+Math.random()*2000, s0=spinAngle, t0=performance.now();
  playSpinJingle(dur);
  const ease=t=>1-Math.pow(1-t,4);
  (function f(now){
    const t=Math.min((now-t0)/dur,1);
    spinAngle=s0+(target-s0)*ease(t);
    drawWheel(spinAngle);
    if(t<1){requestAnimationFrame(f);}
    else{
      spinAngle=target%(Math.PI*2);drawWheel(spinAngle);
      spinning=false;canvas.classList.remove('spinning');
      document.getElementById('wheelHalo').classList.remove('active');
      stopJingle();
      playVictorySting();
      resolveWinner(spinAngle);
    }
  })(t0);
}

function resolveWinner(angle){
  const captainNames=getCaptainNames();
  const active=players.filter(p=>!p.sold&&!captainNames.includes(p.name.toLowerCase()));
  if(!active.length)return;
  const sl=(Math.PI*2)/active.length;
  const pa=((-angle)%(Math.PI*2)+Math.PI*2)%(Math.PI*2);
  currentPlayer=active[Math.floor(pa/sl)%active.length];
  showWinnerPanel(currentPlayer);
  launchConfetti();
}

// ── CRICKET PLAYER SVG GENERATOR ────────────────────────────────────────────
function hashName(name){
  let h=0;
  for(let i=0;i<name.length;i++) h=(Math.imul(31,h)+name.charCodeAt(i))|0;
  return Math.abs(h);
}

function generatePlayerSVG(name){
  const h=hashName(name);
  const pick=(arr)=>arr[h % arr.length];
  const pick2=(arr,seed)=>arr[seed % arr.length];

  // Skin tones
  const skins=['#FDBCB4','#F1C27D','#E0AC69','#C68642','#8D5524','#5C3317'];
  const skin=pick(skins);

  // Kit colours — unique combos
  const kits=[
    {shirt:'#1a3a8f',pant:'#ffffff',trim:'#f5b800'},
    {shirt:'#8f1a1a',pant:'#f0f0f0',trim:'#00c8ff'},
    {shirt:'#1a7a1a',pant:'#fffde0',trim:'#ff6030'},
    {shirt:'#7a1a7a',pant:'#e8e8ff',trim:'#00e87a'},
    {shirt:'#0d2a40',pant:'#d0e8ff',trim:'#ff4050'},
    {shirt:'#403010',pant:'#f5e8c0',trim:'#00c8ff'},
    {shirt:'#1a4a3a',pant:'#ffffff',trim:'#f5b800'},
    {shirt:'#2a2a6a',pant:'#ffeedd',trim:'#00e87a'},
  ];
  const kit=pick(kits);

  // Helmet colours
  const helmets=['#cc2200','#003399','#006622','#552200','#444444','#880066','#1a5a7a'];
  const helmetCol=pick2(helmets, Math.floor(h/kits.length));

  // Stances: 0=cover drive, 1=pull shot, 2=defensive, 3=sweep
  const stance=h % 4;

  // Glove colour
  const gloveCol='#f0f0e0';

  // Bat colour
  const batCol='#d4a84b';
  const batHandle='#4a2a0a';

  // Build SVG based on stance
  const W=110, H=130;

  // Common elements generator
  const head=(cx,cy,r)=>`<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r*1.05}" fill="${skin}"/>`;
  const helmet=(cx,cy,r,col)=>`
    <ellipse cx="${cx}" cy="${cy-r*0.3}" rx="${r*1.15}" ry="${r*0.8}" fill="${col}"/>
    <rect x="${cx-r*1.15}" y="${cy-r*0.3}" width="${r*2.3}" height="${r*0.55}" rx="3" fill="${col}"/>
    <rect x="${cx-r*0.9}" y="${cy+r*0.25}" width="${r*1.8}" height="${r*0.22}" rx="2" fill="${col}" opacity="0.8"/>
    <line x1="${cx-r}" y1="${cy+r*0.18}" x2="${cx+r}" y2="${cy+r*0.18}" stroke="#ffffff22" stroke-width="1"/>`;
  const face=(cx,cy,r)=>`
    <ellipse cx="${cx-r*0.28}" cy="${cy+r*0.1}" rx="1.5" ry="1.8" fill="#00000033"/>
    <ellipse cx="${cx+r*0.28}" cy="${cy+r*0.1}" rx="1.5" ry="1.8" fill="#00000033"/>
    <path d="M${cx-r*0.2} ${cy+r*0.45} q${r*0.2} ${r*0.2} ${r*0.4} 0" stroke="#00000055" stroke-width="1.2" fill="none"/>`;

  let svg='';

  if(stance===0){
    // Cover drive — leaning forward, bat extended right
    svg=`
      <g transform="translate(5,4)">
        ${helmet(50,28,14,helmetCol)}
        ${head(50,32,13)}
        ${face(50,32,13)}
        <!-- body -->
        <rect x="38" y="55" width="24" height="36" rx="6" fill="${kit.shirt}"/>
        <rect x="40" y="55" width="4" height="36" rx="2" fill="${kit.trim}" opacity="0.6"/>
        <!-- back arm -->
        <line x1="38" y1="62" x2="18" y2="78" stroke="${skin}" stroke-width="7" stroke-linecap="round"/>
        <line x1="18" y1="78" x2="12" y2="88" stroke="${skin}" stroke-width="6" stroke-linecap="round"/>
        <!-- glove back -->
        <ellipse cx="12" cy="89" rx="6" ry="5" fill="${gloveCol}"/>
        <!-- front arm -->
        <line x1="62" y1="62" x2="80" y2="72" stroke="${skin}" stroke-width="7" stroke-linecap="round"/>
        <line x1="80" y1="72" x2="90" y2="80" stroke="${skin}" stroke-width="6" stroke-linecap="round"/>
        <!-- glove front -->
        <ellipse cx="90" cy="81" rx="6" ry="5" fill="${gloveCol}"/>
        <!-- bat -->
        <rect x="85" y="70" width="10" height="42" rx="3" fill="${batCol}" transform="rotate(30,90,80)"/>
        <rect x="87" y="68" width="4" height="12" rx="2" fill="${batHandle}" transform="rotate(30,90,80)"/>
        <!-- legs/pads -->
        <rect x="36" y="88" width="12" height="32" rx="4" fill="${kit.pant}"/>
        <rect x="52" y="88" width="12" height="32" rx="4" fill="${kit.pant}"/>
        <!-- pad straps -->
        <line x1="36" y1="96" x2="48" y2="96" stroke="#cccccc" stroke-width="1.5"/>
        <line x1="52" y1="96" x2="64" y2="96" stroke="#cccccc" stroke-width="1.5"/>
        <line x1="36" y1="106" x2="48" y2="106" stroke="#cccccc" stroke-width="1.5"/>
        <line x1="52" y1="106" x2="64" y2="106" stroke="#cccccc" stroke-width="1.5"/>
        <!-- shoes -->
        <ellipse cx="42" cy="121" rx="9" ry="4" fill="#222"/>
        <ellipse cx="58" cy="121" rx="9" ry="4" fill="#222"/>
      </g>`;
  } else if(stance===1){
    // Pull shot — upright, bat raised high left
    svg=`
      <g transform="translate(5,4)">
        ${helmet(52,24,14,helmetCol)}
        ${head(52,28,13)}
        ${face(52,28,13)}
        <!-- body -->
        <rect x="40" y="50" width="24" height="36" rx="6" fill="${kit.shirt}"/>
        <rect x="56" y="50" width="4" height="36" rx="2" fill="${kit.trim}" opacity="0.6"/>
        <!-- raised arm (bat side) -->
        <line x1="40" y1="56" x2="18" y2="36" stroke="${skin}" stroke-width="7" stroke-linecap="round"/>
        <line x1="18" y1="36" x2="14" y2="22" stroke="${skin}" stroke-width="6" stroke-linecap="round"/>
        <ellipse cx="14" cy="21" rx="6" ry="5" fill="${gloveCol}"/>
        <!-- bat up -->
        <rect x="6" y="4" width="10" height="44" rx="3" fill="${batCol}" transform="rotate(-15,14,22)"/>
        <rect x="8" y="2" width="4" height="12" rx="2" fill="${batHandle}" transform="rotate(-15,14,22)"/>
        <!-- other arm -->
        <line x1="64" y1="56" x2="82" y2="68" stroke="${skin}" stroke-width="7" stroke-linecap="round"/>
        <line x1="82" y1="68" x2="88" y2="78" stroke="${skin}" stroke-width="6" stroke-linecap="round"/>
        <ellipse cx="88" cy="79" rx="6" ry="5" fill="${gloveCol}"/>
        <!-- legs -->
        <rect x="38" y="84" width="12" height="32" rx="4" fill="${kit.pant}"/>
        <rect x="54" y="84" width="12" height="32" rx="4" fill="${kit.pant}"/>
        <line x1="38" y1="92" x2="50" y2="92" stroke="#cccccc" stroke-width="1.5"/>
        <line x1="54" y1="92" x2="66" y2="92" stroke="#cccccc" stroke-width="1.5"/>
        <line x1="38" y1="102" x2="50" y2="102" stroke="#cccccc" stroke-width="1.5"/>
        <line x1="54" y1="102" x2="66" y2="102" stroke="#cccccc" stroke-width="1.5"/>
        <ellipse cx="44" cy="117" rx="9" ry="4" fill="#222"/>
        <ellipse cx="60" cy="117" rx="9" ry="4" fill="#222"/>
      </g>`;
  } else if(stance===2){
    // Defensive — crouched, bat straight down
    svg=`
      <g transform="translate(5,8)">
        ${helmet(50,20,13,helmetCol)}
        ${head(50,24,12)}
        ${face(50,24,12)}
        <!-- body crouched -->
        <rect x="38" y="44" width="24" height="30" rx="6" fill="${kit.shirt}"/>
        <rect x="40" y="44" width="4" height="30" rx="2" fill="${kit.trim}" opacity="0.6"/>
        <!-- arms down on bat -->
        <line x1="38" y1="52" x2="24" y2="66" stroke="${skin}" stroke-width="7" stroke-linecap="round"/>
        <line x1="24" y1="66" x2="20" y2="78" stroke="${skin}" stroke-width="6" stroke-linecap="round"/>
        <ellipse cx="20" cy="79" rx="6" ry="5" fill="${gloveCol}"/>
        <line x1="62" y1="52" x2="72" y2="64" stroke="${skin}" stroke-width="7" stroke-linecap="round"/>
        <line x1="72" y1="64" x2="76" y2="76" stroke="${skin}" stroke-width="6" stroke-linecap="round"/>
        <ellipse cx="76" cy="77" rx="6" ry="5" fill="${gloveCol}"/>
        <!-- bat vertical -->
        <rect x="44" y="72" width="10" height="44" rx="3" fill="${batCol}"/>
        <rect x="46" y="70" width="4" height="12" rx="2" fill="${batHandle}"/>
        <!-- legs wide -->
        <rect x="30" y="72" width="14" height="34" rx="4" fill="${kit.pant}" transform="rotate(-8,37,88)"/>
        <rect x="56" y="72" width="14" height="34" rx="4" fill="${kit.pant}" transform="rotate(8,63,88)"/>
        <line x1="31" y1="82" x2="43" y2="80" stroke="#cccccc" stroke-width="1.5"/>
        <line x1="57" y1="80" x2="69" y2="82" stroke="#cccccc" stroke-width="1.5"/>
        <ellipse cx="37" cy="107" rx="10" ry="4" fill="#222"/>
        <ellipse cx="63" cy="107" rx="10" ry="4" fill="#222"/>
      </g>`;
  } else {
    // Sweep shot — low crouch, bat sweeping left
    svg=`
      <g transform="translate(5,6)">
        ${helmet(54,22,13,helmetCol)}
        ${head(54,26,12)}
        ${face(54,26,12)}
        <!-- body low -->
        <rect x="40" y="46" width="24" height="28" rx="6" fill="${kit.shirt}"/>
        <rect x="42" y="46" width="4" height="28" rx="2" fill="${kit.trim}" opacity="0.6"/>
        <!-- sweeping arms -->
        <line x1="40" y1="54" x2="20" y2="68" stroke="${skin}" stroke-width="7" stroke-linecap="round"/>
        <line x1="20" y1="68" x2="8"  y2="78" stroke="${skin}" stroke-width="6" stroke-linecap="round"/>
        <ellipse cx="8" cy="79" rx="6" ry="5" fill="${gloveCol}"/>
        <line x1="64" y1="54" x2="80" y2="64" stroke="${skin}" stroke-width="7" stroke-linecap="round"/>
        <line x1="80" y1="64" x2="92" y2="72" stroke="${skin}" stroke-width="6" stroke-linecap="round"/>
        <ellipse cx="92" cy="73" rx="6" ry="5" fill="${gloveCol}"/>
        <!-- bat sweep low diagonal -->
        <rect x="2" y="72" width="42" height="9" rx="3" fill="${batCol}" transform="rotate(-10,24,76)"/>
        <rect x="2" y="70" width="10" height="4" rx="2" fill="${batHandle}" transform="rotate(-10,8,72)"/>
        <!-- front knee down -->
        <rect x="36" y="73" width="14" height="38" rx="4" fill="${kit.pant}" transform="rotate(-20,43,90)"/>
        <rect x="56" y="70" width="14" height="36" rx="4" fill="${kit.pant}"/>
        <line x1="37" y1="84" x2="47" y2="80" stroke="#cccccc" stroke-width="1.5"/>
        <line x1="56" y1="80" x2="70" y2="80" stroke="#cccccc" stroke-width="1.5"/>
        <ellipse cx="40" cy="110" rx="10" ry="4" fill="#222" transform="rotate(-20,40,110)"/>
        <ellipse cx="63" cy="107" rx="10" ry="4" fill="#222"/>
      </g>`;
  }

  // Wrap in styled SVG with ground shadow
  return `<svg viewBox="0 0 110 130" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="shadow_${h}" cx="50%" cy="100%" rx="40%" ry="8%">
        <stop offset="0%" stop-color="#000000" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <ellipse cx="55" cy="126" rx="38" ry="6" fill="url(#shadow_${h})"/>
    ${svg}
  </svg>`;
}

// ── LIVE BIDDING ROUND ───────────────────────────────────────────────────────
// State for the current bidding round
let bidRound = {
  player: null,       // currentPlayer reference
  bids: [],           // [{teamId, amount, timestamp}] — per-action log
  passed: new Set(),  // teamIds that have passed
  leaderId: null,     // teamId of current highest bidder
  leaderBid: 0,
  startTime: null,
};

function showWinnerPanel(player) {
  // Init bid round state
  bidRound = {
    player,
    bids: [],
    passed: new Set(),
    leaderId: null,
    leaderBid: 0,
    startTime: new Date(),
  };

  document.getElementById('winnerName').textContent = player.name;
  document.getElementById('winnerBase').textContent = zarFmt(player.price);

  // Tier badge
  const tb = document.getElementById('winnerTier');
  const bn = document.getElementById('winnerTierBanner');
  if (player.tier) {
    tb.textContent = player.tier; tb.className = 'tier-badge tier-badge-inline tier-' + player.tier.toLowerCase();
    bn.textContent = '⭐ ' + player.tier + ' Tier'; bn.className = 'tier-banner tier-' + player.tier.toLowerCase();
  } else {
    tb.textContent = ''; tb.className = 'tier-badge tier-badge-inline';
    bn.textContent = ''; bn.className = 'tier-banner';
  }

  // Player graphic
  document.getElementById('playerGraphic').innerHTML = generatePlayerSVG(player.name);

  renderBidRoundTitle();
  renderBidRoundTeams();
  renderBidTrail();
  updateLeaderDisplay();

  document.getElementById('declareWinnerBtn').disabled = true;
  clearBidError();

  const p = document.getElementById('winnerPanel');
  p.classList.remove('visible'); void p.offsetWidth; p.classList.add('visible');
  document.querySelector('.wheel-area').classList.add('bidding');
  document.getElementById('spinBtn').disabled = true;
  setTimeout(() => p.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);

  startBidTimer();
}

function renderBidRoundTitle() {
  const activeBidders = teams.filter(t => !bidRound.passed.has(t.id) && !isTeamBlocked(t));
  document.getElementById('bidRoundTitle').textContent = 'BIDDING ROUND';
  document.getElementById('bidRoundTurn').innerHTML =
    activeBidders.length
      ? `<strong>${activeBidders.length}</strong> team${activeBidders.length !== 1 ? 's' : ''} still bidding`
      : 'All teams have passed or are blocked';
}

function isTeamBlocked(t) {
  if (!bidRound.player) return true;
  const maxSlots = adminRules.maxPlayers;
  const tierMin = adminRules.tierMins[bidRound.player.tier] || 0;
  const minRequired = Math.max(bidRound.player.price, tierMin, adminRules.minIncrement);
  const auctionCount = t.players.filter(p => !p.isCaptain && !p.isFormer).length;
  if (t.budget < minRequired) return true;
  if (auctionCount >= maxSlots) return true;
  if (bidRound.player.tier && tierCount(t, bidRound.player.tier) >= TIER_LIMIT) return true;
  return false;
}

function renderBidRoundTeams() {
  const player = bidRound.player;
  const maxSlots = adminRules.maxPlayers;
  const html = teams.map(t => {
    const blocked = isTeamBlocked(t);
    const hasPassed = bidRound.passed.has(t.id);
    const isLeader = t.id === bidRound.leaderId;
    const teamBids = bidRound.bids.filter(b => b.teamId === t.id);
    const latestBid = teamBids.length ? teamBids[teamBids.length - 1].amount : null;
    const pct = (t.budget / adminRules.budget) * 100;
    const budgetCls = pct < 20 ? 'low' : pct < 50 ? 'mid' : 'ok';
    const auctionCount = t.players.filter(p => !p.isCaptain && !p.isFormer).length;
    const slotsLeft = maxSlots - auctionCount;

    let statusHtml = '';
    if (blocked && !hasPassed) {
      const tierMin = adminRules.tierMins[player.tier] || 0;
      if (t.budget < Math.max(player.price, tierMin)) statusHtml = `<div class="tbr-status" style="color:var(--red)">Insufficient funds</div>`;
      else if (auctionCount >= maxSlots) statusHtml = `<div class="tbr-status" style="color:var(--red)">Squad full</div>`;
      else statusHtml = `<div class="tbr-status" style="color:var(--red)">Blocked</div>`;
    } else if (hasPassed) {
      statusHtml = `<div class="tbr-status" style="color:var(--muted);font-style:italic">Passed</div>`;
    } else if (isLeader) {
      statusHtml = `<div class="tbr-status" style="color:var(--gold);font-weight:700">🏆 Leading — ${zarS(latestBid)}</div>`;
    } else if (latestBid) {
      statusHtml = `<div class="tbr-status" style="color:var(--muted)">Last bid: ${zarS(latestBid)} · <span class="${budgetCls}">${zarS(t.budget)} left</span></div>`;
    } else {
      statusHtml = `<div class="tbr-status"><span class="${budgetCls}">${zarS(t.budget)}</span> · ${slotsLeft} slot${slotsLeft !== 1 ? 's' : ''}</div>`;
    }

    const rowClass = [
      'team-bid-row',
      isLeader ? 'winner-row' : '',
      hasPassed ? 'passed' : '',
      blocked && !hasPassed ? 'broke' : '',
    ].filter(Boolean).join(' ');

    const disabled = blocked || hasPassed;
    const suggestedBid = bidRound.leaderBid > 0
      ? bidRound.leaderBid + adminRules.minIncrement
      : Math.max(player.price, adminRules.tierMins[player.tier] || 0, adminRules.minIncrement);

    return `<div class="${rowClass}" id="tbr-${t.id}">
      ${(isLeader || (!hasPassed && !blocked)) ? '<div class="tbr-turn-indicator"></div>' : ''}
      <img src="${t.logo}" class="team-logo-sm" alt="" style="flex-shrink:0"/>
      <div class="tbr-logo-name">
        <div style="min-width:0">
          <div class="tbr-name">${esc(t.name)}</div>
          ${statusHtml}
        </div>
      </div>
      <div class="tbr-inp-wrap">
        <span class="tbr-inp-prefix">R</span>
        <input type="number" class="tbr-bid-inp" id="tbrinp-${t.id}"
          value="${disabled ? '' : suggestedBid}"
          min="${adminRules.minIncrement}" step="${adminRules.minIncrement}"
          ${disabled ? 'disabled' : ''}
          onkeydown="if(event.key==='Enter')placeBid(${t.id})"/>
      </div>
      <div class="tbr-actions">
        <button class="tbr-btn tbr-btn-bid" onclick="placeBid(${t.id})" ${disabled ? 'disabled' : ''}>Bid</button>
        <button class="tbr-btn tbr-btn-pass" onclick="passTeam(${t.id})" ${disabled ? 'disabled' : ''}>Pass</button>
      </div>
    </div>`;
  }).join('');
  document.getElementById('teamBidList').innerHTML = html;
}

function placeBid(teamId) {
  const player = bidRound.player;
  if (!player) return;
  const team = teams.find(t => t.id === teamId);
  if (!team || bidRound.passed.has(teamId) || isTeamBlocked(team)) return;

  const inp = document.getElementById('tbrinp-' + teamId);
  const amount = parseFloat(inp?.value) || 0;

  if (amount <= 0) { showBidError('Enter a valid bid amount.'); return; }

  const minBid = getAdminMinBid(player, player.price);
  if (amount < minBid) {
    showBidError(`Minimum bid is ${zarFmt(minBid)}.`); return;
  }
  if (bidRound.leaderBid > 0 && amount <= bidRound.leaderBid) {
    showBidError(`Bid must be higher than current leader (${zarFmt(bidRound.leaderBid)}).`); return;
  }
  if (amount > team.budget) {
    showBidError(`${team.name} only has ${zarFmt(team.budget)} — can't bid ${zarFmt(amount)}.`); return;
  }

  clearBidError();

  const isNewHigh = amount > bidRound.leaderBid;
  bidRound.bids.push({ teamId, amount, timestamp: new Date(), isNewHigh });
  if (isNewHigh) {
    bidRound.leaderId = teamId;
    bidRound.leaderBid = amount;
  }

  // Enable declare winner once there's a bid
  document.getElementById('declareWinnerBtn').disabled = false;

  renderBidRoundTeams();
  renderBidTrail();
  updateLeaderDisplay();
  renderBidRoundTitle();
}

function passTeam(teamId) {
  if (bidRound.passed.has(teamId)) return;
  bidRound.passed.add(teamId);
  bidRound.bids.push({ teamId, amount: null, timestamp: new Date(), isPast: true });

  clearBidError();
  renderBidRoundTeams();
  renderBidTrail();
  renderBidRoundTitle();

  // Auto-declare if only 1 bidder left and they have bid
  const activeBidders = teams.filter(t => !bidRound.passed.has(t.id) && !isTeamBlocked(t));
  if (activeBidders.length === 0 && bidRound.leaderId !== null) {
    showToast('All teams passed — auto-declaring winner!');
    setTimeout(declareWinner, 600);
  }
}

function updateLeaderDisplay() {
  const el = document.getElementById('bidRoundLeader');
  if (bidRound.leaderId === null) {
    el.classList.remove('visible');
    return;
  }
  const team = teams.find(t => t.id === bidRound.leaderId);
  el.classList.add('visible');
  el.innerHTML = `
    <div class="bid-round-leader-lbl">🏆 Current Leader</div>
    <div class="bid-round-leader-name" style="color:${team.color}">${esc(team.name)}</div>
    <div class="bid-round-leader-amt">${zarFmt(bidRound.leaderBid)}</div>`;
}

function renderBidTrail() {
  const el = document.getElementById('bidTrail');
  if (!bidRound.bids.length) {
    el.innerHTML = '<div class="bid-trail-empty">No bids yet — waiting for first bid</div>';
    return;
  }
  el.innerHTML = [...bidRound.bids].reverse().map(b => {
    const team = teams.find(t => t.id === b.teamId);
    const time = b.timestamp.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (b.amount === null) {
      return `<div class="bid-trail-entry pass-entry">
        <div class="trail-dot" style="background:${team.color}"></div>
        <div class="trail-team">${esc(team.name)}</div>
        <div class="trail-action trail-pass">Passed</div>
        <div class="trail-time">${time}</div>
      </div>`;
    }
    const newHighHtml = b.isNewHigh ? '<span class="trail-new-high">↑ NEW HIGH</span>' : '';
    return `<div class="bid-trail-entry">
      <div class="trail-dot" style="background:${team.color}"></div>
      <div class="trail-team">${esc(team.name)}</div>
      <div class="trail-action trail-bid">${zarS(b.amount)}</div>
      ${newHighHtml}
      <div class="trail-time">${time}</div>
    </div>`;
  }).join('');
  el.scrollTop = 0;
}

function declareWinner() {
  const player = bidRound.player;
  if (!player) return;
  if (bidRound.leaderId === null) { showBidError('No bids placed — select a winner or skip.'); return; }

  const team = teams.find(t => t.id === bidRound.leaderId);
  const finalPrice = bidRound.leaderBid;

  clearBidTimer();

  // Build bid trail summary for history
  const trailSummary = bidRound.bids.map(b => ({
    teamId: b.teamId,
    teamName: teams.find(t => t.id === b.teamId)?.name || '',
    teamColor: teams.find(t => t.id === b.teamId)?.color || '#888',
    amount: b.amount,
    timestamp: b.timestamp.toISOString(),
    isNewHigh: b.isNewHigh || false,
    isPast: b.amount === null,
  }));

  team.budget -= finalPrice;
  const assigned = { ...player, finalPrice };
  team.players.push(assigned);
  player.sold = true; player.teamId = bidRound.leaderId; player.finalPrice = finalPrice;

  auctionLog.push({
    player: player.name,
    tier: player.tier || '',
    team: team.name,
    teamColor: team.color,
    basePrice: player.price,
    finalPrice,
    bidTrail: trailSummary,
    startTime: bidRound.startTime?.toISOString(),
    endTime: new Date().toISOString(),
  });

  const pName = player.name, tName = team.name;
  dismissWinner();
  renderTeamsBar(); renderPlayersList(); renderLog(); updateStats();
  showToast(`🏆 ${pName} → ${tName} for ${zarFmt(finalPrice)}`);
  currentPlayer = null;
}

function shakeBidInput() {
  // Shake all active bid inputs
  document.querySelectorAll('.tbr-bid-inp:not(:disabled)').forEach(e => {
    e.classList.add('error'); setTimeout(() => e.classList.remove('error'), 500);
  });
}
function dismissWinner(){
  clearBidTimer();
  bidRound = { player:null, bids:[], passed:new Set(), leaderId:null, leaderBid:0, startTime:null };
  document.getElementById('winnerPanel').classList.remove('visible');
  document.querySelector('.wheel-area').classList.remove('bidding');
  document.getElementById('bidRoundLeader').classList.remove('visible');
  clearBidError();
  document.getElementById('spinBtn').disabled=players.filter(p=>!p.sold&&!getCaptainNames().includes(p.name.toLowerCase())).length<1||spinning;
}
function showBidError(m){const e=document.getElementById('bidError');e.textContent=m;e.classList.add('visible');}
function clearBidError(){document.getElementById('bidError').classList.remove('visible');}

function renderLog(){
  const el=document.getElementById('logList');
  document.getElementById('logBadge').textContent=auctionLog.length;
  if(!auctionLog.length){el.innerHTML='<div class="empty-state">No players signed yet.</div>';return;}
  el.innerHTML=[...auctionLog].reverse().map((e,i)=>`
    <div class="log-row">
      <div class="log-num">${auctionLog.length-i}</div>
      <div class="log-dot" style="background:${e.teamColor}"></div>
      <div class="log-player">${esc(e.player)}</div>
      ${e.tier?`<span class="tier-pill tp-${e.tier.toLowerCase()}">${e.tier}</span>`:''}
      <div class="log-team">${esc(e.team)}</div>
      <div class="log-price">${zarS(e.finalPrice)}</div>
    </div>`).join('');
  el.scrollTop=0;
}

function updateStats(){
  const sold=players.filter(p=>p.sold).length;
  const badge = document.getElementById('roundBadge');
  if(!players.length || players.every(p=>p.sold)){
    badge.innerHTML = players.every(p=>p.sold) && players.length
      ? '✓ COMPLETE'
      : '<span class="live-dot"></span>AUCTION LIVE';
  } else {
    badge.innerHTML = `<span class="live-dot"></span>${sold} / ${players.length} SIGNED`;
  }
  // Keep bid history button pulsing if there's data
  const bhBtn = document.getElementById('bidHistoryBtn');
  if(bhBtn) bhBtn.style.opacity = auctionLog.length ? '1' : '0.5';
}

// ── BID HISTORY ──────────────────────────────────────────────────────────────
let _bhTab = 'feed';

function openBidHistory() {
  const overlay = document.getElementById('bhOverlay');
  overlay.classList.add('open');
  const total = auctionLog.length;
  const totalSpend = auctionLog.reduce((s,e)=>s+e.finalPrice,0);
  document.getElementById('bhSub').textContent =
    total ? `${total} player${total!==1?'s':''} signed · ${zarFmt(totalSpend)} total spent` : 'No bids yet';
  renderBhTab(_bhTab);
}

function closeBidHistory() {
  document.getElementById('bhOverlay').classList.remove('open');
}

function switchBhTab(tab) {
  _bhTab = tab;
  ['feed','team','tier','stats'].forEach(t => {
    document.getElementById('bhTab'+t.charAt(0).toUpperCase()+t.slice(1)).classList.toggle('active', t===tab);
  });
  renderBhTab(tab);
}

function renderBhTab(tab) {
  const body = document.getElementById('bhBody');
  if (!auctionLog.length) {
    body.innerHTML = '<div class="bh-empty">🎯 No bids recorded yet.<br><span style="font-size:0.8rem">Sign players during the auction to see history here.</span></div>';
    return;
  }
  if (tab === 'feed')  body.innerHTML = renderBhFeed();
  if (tab === 'team')  body.innerHTML = renderBhByTeam();
  if (tab === 'tier')  body.innerHTML = renderBhByTier();
  if (tab === 'stats') body.innerHTML = renderBhStats();
  // Animate bars after render
  requestAnimationFrame(() => {
    body.querySelectorAll('[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; });
  });
}

function markupLabel(basePrice, finalPrice) {
  if (!basePrice || basePrice === 0) return '';
  const pct = Math.round(((finalPrice - basePrice) / basePrice) * 100);
  if (pct > 0)  return `<span class="bh-feed-markup bh-markup-up">+${pct}%</span>`;
  if (pct < 0)  return `<span class="bh-feed-markup bh-markup-under">${pct}%</span>`;
  return `<span class="bh-feed-markup bh-markup-base">Base</span>`;
}

function renderBhFeed() {
  const rows = [...auctionLog].reverse().map((e, ri) => {
    const pick = auctionLog.length - ri;
    const tierHtml = e.tier ? `<span class="tier-pill tp-${e.tier.toLowerCase()}">${e.tier}</span>` : '';
    const markup = markupLabel(e.basePrice, e.finalPrice);
    const trailCount = e.bidTrail ? e.bidTrail.filter(b => !b.isPast).length : 0;
    const trailHtml = e.bidTrail && e.bidTrail.length ? `
      <div class="bh-trail-expand" id="bhtrail-${pick}" style="display:none">
        <div class="bh-mini-trail">
          ${e.bidTrail.map(b => b.isPast
            ? `<div class="bh-mini-trail-row pass"><span class="trail-dot" style="background:${b.teamColor}"></span><span class="bh-mini-team">${esc(b.teamName)}</span><span class="bh-mini-action pass">Passed</span></div>`
            : `<div class="bh-mini-trail-row"><span class="trail-dot" style="background:${b.teamColor}"></span><span class="bh-mini-team">${esc(b.teamName)}</span><span class="bh-mini-action bid">${zarS(b.amount)}</span>${b.isNewHigh ? '<span class="trail-new-high">↑</span>' : ''}</div>`
          ).join('')}
        </div>
      </div>` : '';
    const trailToggle = e.bidTrail && e.bidTrail.length
      ? `<button class="bh-trail-toggle" onclick="toggleBhTrail(${pick}, this)">${trailCount} bid${trailCount!==1?'s':''} ▾</button>`
      : '';
    return `<div class="bh-feed-row">
      <div class="bh-feed-num">#${pick}</div>
      <div class="bh-feed-dot" style="background:${e.teamColor}"></div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap">
          <span class="bh-feed-player">${esc(e.player)}</span>
          ${tierHtml}
          ${trailToggle}
        </div>
        <div class="bh-feed-meta">→ <strong style="color:${e.teamColor}">${esc(e.team)}</strong></div>
        ${trailHtml}
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div class="bh-feed-price">${zarS(e.finalPrice)}</div>
        <div style="margin-top:0.15rem">${markup}</div>
      </div>
    </div>`;
  }).join('');
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
  const totalBudget = adminRules.budget;
  const sections = teams.map(t => {
    const entries = auctionLog.filter(e => e.team === t.name);
    if (!entries.length) return `
      <div class="bh-team-section">
        <div class="bh-team-hdr">
          <div class="bh-team-hdr-dot" style="background:${t.color}"></div>
          <div class="bh-team-hdr-name">${esc(t.name)}</div>
          <div style="font-size:0.78rem;color:var(--muted)">No signed players</div>
        </div>
      </div>`;
    const totalSpend = entries.reduce((s,e)=>s+e.finalPrice,0);
    const spentPct = Math.min(100, Math.round((totalSpend / totalBudget) * 100));
    const rows = entries.map((e,i) => {
      const markup = markupLabel(e.basePrice, e.finalPrice);
      const tierHtml = e.tier ? `<span class="tier-pill tp-${e.tier.toLowerCase()}">${e.tier}</span>` : '';
      return `<div class="bh-team-row">
        <div>
          <span style="font-weight:600">${esc(e.player)}</span>
          <span style="margin-left:0.4rem">${tierHtml}</span>
        </div>
        <div>${markup}</div>
        <div style="font-family:'Anton',sans-serif;font-size:0.95rem;color:var(--gold)">${zarS(e.finalPrice)}</div>
      </div>`;
    }).join('');
    return `
      <div class="bh-team-section">
        <div class="bh-team-hdr" style="border-left:3px solid ${t.color}">
          <div class="bh-team-hdr-dot" style="background:${t.color}"></div>
          <div class="bh-team-hdr-name">${esc(t.name)}</div>
          <div style="text-align:right">
            <div class="bh-team-hdr-spend">${zarS(totalSpend)}</div>
            <div class="bh-team-hdr-budget">${zarS(t.budget)} remaining · ${entries.length} player${entries.length!==1?'s':''}</div>
          </div>
        </div>
        <div class="bh-team-bar-wrap"><div class="bh-team-bar" style="background:${t.color};width:0" data-w="${spentPct}"></div></div>
        <div class="bh-team-rows">${rows}</div>
      </div>`;
  }).join('');
  return `<div class="bh-team-sections">${sections}</div>`;
}

function renderBhByTier() {
  const tiers = ['Platinum','Gold','Silver','Bronze',''];
  const tierLabels = {'Platinum':'Platinum','Gold':'Gold','Silver':'Silver','Bronze':'Bronze','':'Untiered'};
  const sections = tiers.map(tier => {
    const entries = auctionLog.filter(e => (e.tier||'') === tier);
    if (!entries.length) return '';
    const total = entries.reduce((s,e)=>s+e.finalPrice,0);
    const tierCls = tier ? 'tier-'+tier.toLowerCase() : 'tier-bronze';
    const rows = entries.map((e,i) => {
      const pick = auctionLog.indexOf(e)+1;
      const markup = markupLabel(e.basePrice, e.finalPrice);
      return `<div class="bh-tier-row">
        <div style="display:flex;align-items:center;gap:0.5rem">
          <div style="width:8px;height:8px;border-radius:50%;background:${e.teamColor};flex-shrink:0"></div>
          <span style="font-weight:600">${esc(e.player)}</span>
          <span style="font-size:0.72rem;color:var(--muted)">→ ${esc(e.team)}</span>
        </div>
        <div>${markup}</div>
        <div style="font-family:'Anton',sans-serif;font-size:0.9rem;color:var(--gold)">${zarS(e.finalPrice)}</div>
      </div>`;
    }).join('');
    return `
      <div class="bh-tier-section">
        <div class="bh-tier-hdr">
          ${tier ? `<span class="tier-badge ${tierCls}">${tier}</span>` : `<span style="font-size:0.8rem;color:var(--muted)">Untiered</span>`}
          <span style="font-size:0.78rem;color:var(--muted);margin-left:auto">${entries.length} player${entries.length!==1?'s':''} · ${zarS(total)} total</span>
        </div>
        <div class="bh-tier-rows">${rows}</div>
      </div>`;
  }).join('');
  return `<div class="bh-tier-sections">${sections}</div>`;
}

function renderBhStats() {
  const total = auctionLog.length;
  const totalSpend = auctionLog.reduce((s,e)=>s+e.finalPrice,0);
  const avg = total ? Math.round(totalSpend/total) : 0;
  const topBid = total ? auctionLog.reduce((a,b)=>b.finalPrice>a.finalPrice?b:a) : null;
  const mostExpTeam = teams.length ? teams.reduce((a,b)=>{
    const spendA=auctionLog.filter(e=>e.team===a.name).reduce((s,e)=>s+e.finalPrice,0);
    const spendB=auctionLog.filter(e=>e.team===b.name).reduce((s,e)=>s+e.finalPrice,0);
    return spendB>spendA?b:a;
  }) : null;
  const mostExpSpend = mostExpTeam ? auctionLog.filter(e=>e.team===mostExpTeam.name).reduce((s,e)=>s+e.finalPrice,0) : 0;
  const bestValue = total ? auctionLog.filter(e=>e.basePrice>0).reduce((best,e)=>{
    const ratio = e.finalPrice/e.basePrice;
    return (!best || ratio < best.ratio) ? {...e,ratio} : best;
  }, null) : null;
  const mostOverbid = total ? auctionLog.filter(e=>e.basePrice>0).reduce((best,e)=>{
    const over = e.finalPrice - e.basePrice;
    return (!best || over > best.over) ? {...e,over} : best;
  }, null) : null;

  // Team spend bars
  const totalBudget = adminRules.budget;
  const maxSpend = Math.max(...teams.map(t=>auctionLog.filter(e=>e.team===t.name).reduce((s,e)=>s+e.finalPrice,0)), 1);
  const spendBars = teams.map(t => {
    const spend = auctionLog.filter(e=>e.team===t.name).reduce((s,e)=>s+e.finalPrice,0);
    const pct = Math.round((spend/maxSpend)*100);
    const cnt = auctionLog.filter(e=>e.team===t.name).length;
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
  }).join('');

  return `
    <div class="bh-stats-grid">
      <div class="bh-stat-card">
        <div class="bh-stat-label">Total Players Signed</div>
        <div class="bh-stat-val" style="color:var(--accent)">${total}</div>
        <div class="bh-stat-sub">${players.filter(p=>!p.sold).length} still available</div>
      </div>
      <div class="bh-stat-card">
        <div class="bh-stat-label">Total Spend</div>
        <div class="bh-stat-val" style="color:var(--gold)">${zarS(totalSpend)}</div>
        <div class="bh-stat-sub">Avg ${zarS(avg)} per player</div>
      </div>
      <div class="bh-stat-card">
        <div class="bh-stat-label">Highest Bid</div>
        <div class="bh-stat-val" style="color:var(--green)">${topBid?zarS(topBid.finalPrice):'—'}</div>
        <div class="bh-stat-sub">${topBid?`${esc(topBid.player)} → ${esc(topBid.team)}`:'—'}</div>
      </div>
      <div class="bh-stat-card">
        <div class="bh-stat-label">Biggest Spender</div>
        <div class="bh-stat-val" style="color:${mostExpTeam?.color||'var(--text)'};font-size:1.1rem">${mostExpTeam?esc(mostExpTeam.name):'—'}</div>
        <div class="bh-stat-sub">${mostExpTeam?zarS(mostExpSpend)+' spent':''}</div>
      </div>
    </div>
    ${bestValue ? `
    <div class="bh-stats-grid" style="margin-bottom:1rem">
      <div class="bh-stat-card">
        <div class="bh-stat-label">Best Value Pick</div>
        <div class="bh-stat-val" style="color:var(--green);font-size:1rem">${esc(bestValue.player)}</div>
        <div class="bh-stat-sub">${zarS(bestValue.finalPrice)} (base ${zarS(bestValue.basePrice)}) · ${esc(bestValue.team)}</div>
      </div>
      <div class="bh-stat-card">
        <div class="bh-stat-label">Most Overbid</div>
        <div class="bh-stat-val" style="color:var(--red);font-size:1rem">${esc(mostOverbid.player)}</div>
        <div class="bh-stat-sub">+${zarS(mostOverbid.over)} over base · ${esc(mostOverbid.team)}</div>
      </div>
    </div>` : ''}
    <div class="bh-section-title">SPEND BY TEAM</div>
    <div class="bh-spend-bars">${spendBars}</div>
  `;
}

function rosterItemHtml(p, teamId){
  const isCap=p.isCaptain;
  const isFormer=p.isFormer;
  const tierHtml=p.tier&&!isCap?`<span class="tier-pill tp-${p.tier.toLowerCase()}">${p.tier}</span>`:'';
  let priceHtml, icon, bg, bdr, nw, nc, leftAccent='';
  if(isCap){
    priceHtml=`<span style="font-size:0.72rem;color:var(--muted);font-style:italic">Captain</span>`;
    icon='👑'; bg='rgba(0,200,255,0.05)'; bdr='rgba(0,200,255,0.3)'; nw='700'; nc='#00c8ff';
  } else if(isFormer){
    priceHtml=`<span style="font-size:0.68rem;color:#c07840;font-weight:600;text-transform:uppercase">Past</span>`;
    icon='🏅'; bg='rgba(160,80,20,0.1)'; bdr='rgba(190,110,40,0.4)'; nw='600'; nc='#d4956a';
    leftAccent='border-left:3px solid #c07840;';
  } else {
    priceHtml=`<span class="roster-item-price">${zarFmt(p.finalPrice)}</span>`;
    icon=''; bg='rgba(255,255,255,0.02)'; bdr='rgba(255,255,255,0.06)'; nw='500'; nc='var(--text)';
  }
  const actions = (!isCap && !isFormer && teamId != null) ? `
    <div class="roster-item-actions">
      <button class="roster-btn roster-btn-swap ri-action-swap">⇄ Swap</button>
      <button class="roster-btn roster-btn-remove ri-action-remove">✕ Remove</button>
    </div>` : '';
  const safeName = p.name.replace(/'/g,"&#39;");
  return `<div class="roster-item" style="background:${bg};border:1px solid ${bdr};${leftAccent}"
      data-team-id="${teamId}" data-player-name="${safeName}">
    <div class="roster-item-top">
      ${icon?`<span style="font-size:0.9rem;flex-shrink:0">${icon}</span>`:''}
      <div class="roster-item-name" style="font-weight:${nw};color:${nc}" title="${esc(p.name)}">${esc(p.name)}</div>
      ${tierHtml}
      ${priceHtml}
    </div>
    ${actions}
  </div>`;
}

let _rosterViewMode = null; // 'all' | teamId number

function showAllRosters(){
  _rosterViewMode = 'all';
  document.getElementById('exportRosterBtn').style.display = 'block';
  document.getElementById('modalTitle').textContent='All Team Rosters';
  document.getElementById('modalBody').innerHTML=`
    <div class="all-rosters-grid">
      ${teams.map(t=>{
        const auctionSigned=t.players.filter(p=>!p.isCaptain&&!p.isFormer).length;
        const formerPick=t.players.find(p=>p.isFormer);
        return `<div class="team-roster-col">
          <div class="team-roster-col-header">
            <img src="${t.logo}" class="team-logo-sm" alt=""/>
            <div class="team-roster-col-name">${esc(t.name)}</div>
            <div class="team-roster-col-meta">${zarS(t.budget)} left · 👑${formerPick?'🏅🏅':''} +${auctionSigned}/${adminRules.maxPlayers}</div>
          </div>
          ${t.players.map(p=>rosterItemHtml(p,t.id)).join('')}
        </div>`;
      }).join('')}
    </div>`;
  wireRosterButtons();
  document.getElementById('rosterModal').classList.add('open');
}

function showTeamRoster(id){
  _rosterViewMode = id;
  document.getElementById('exportRosterBtn').style.display = 'none';
  const t=teams.find(x=>x.id===id); if(!t)return;
  const pct=Math.round((t.budget/adminRules.budget)*100);
  const auctionSigned=t.players.filter(p=>!p.isCaptain&&!p.isFormer).length;
  const formerPick=t.players.find(p=>p.isFormer);
  const captainNames=getCaptainNames();
  const available=players.filter(p=>!p.sold&&!captainNames.includes(p.name.toLowerCase()));
  const maxSlots=adminRules.maxPlayers;
  const squadFull=auctionSigned>=maxSlots;

  // Build available options grouped by tier
  const tierOrder=['Platinum','Gold','Silver','Bronze',''];
  const sortedAvailable=[...available].sort((a,b)=>{
    const ta=tierOrder.indexOf(a.tier||''), tb=tierOrder.indexOf(b.tier||'');
    return (ta===-1?99:ta)-(tb===-1?99:tb) || a.name.localeCompare(b.name);
  });

  const optionsHtml = sortedAvailable.length
    ? sortedAvailable.map(p=>`<option value="${p.name.replace(/"/g,'&quot;')}" data-price="${p.price}">${esc(p.name)}${p.tier?' ('+p.tier+')':''} — ${zarS(p.price)}</option>`).join('')
    : '<option disabled>No available players</option>';

  const addSection = `<div class="add-to-roster" id="addToRosterSection" data-team-id="${id}">
    <div class="add-to-roster-title">+ Add Player to Roster</div>
    <div class="add-to-roster-row">
      <select class="add-to-roster-select" id="atrSelect">
        <option value="">— Select player —</option>
        ${optionsHtml}
      </select>
      <div class="add-to-roster-price-wrap">
        <span class="add-to-roster-prefix">R</span>
        <input type="number" class="add-to-roster-price" id="atrPrice" placeholder="Price" min="0" step="10000"/>
      </div>
      <button class="btn btn-green" id="atrConfirmBtn" style="white-space:nowrap;padding:0.42rem 0.85rem;font-size:0.82rem">✓ Add</button>
    </div>
    <div class="add-to-roster-error" id="atrError"></div>
  </div>`;

  document.getElementById('modalTitle').innerHTML=`<img src="${t.logo}" class="team-logo-sm" style="vertical-align:middle;margin-right:0.6rem"/>${esc(t.name)}`;
  document.getElementById('modalBody').innerHTML=`
    <div style="background:var(--bg2);border-radius:8px;padding:0.75rem 1rem;margin-bottom:1rem;display:grid;grid-template-columns:1fr 1fr;gap:0.5rem">
      <div>
        <div style="font-size:0.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.2rem">Budget Remaining</div>
        <div style="font-family:'Anton',sans-serif;font-size:1.5rem;color:${t.color}">${zarFmt(t.budget)}</div>
        <div style="font-size:0.72rem;color:var(--muted)">${pct}% · ${zarFmt(adminRules.budget-t.budget)} spent</div>
      </div>
      <div>
        <div style="font-size:0.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.2rem">Squad</div>
        <div style="font-family:'Anton',sans-serif;font-size:1.5rem;color:var(--text)">👑${formerPick?'🏅🏅':''} + ${auctionSigned}<span style="font-size:0.9rem;color:var(--muted)">/5</span></div>
        <div style="font-size:0.72rem;color:var(--muted)">${maxSlots-auctionSigned} auction slot${maxSlots-auctionSigned!==1?'s':''} remaining</div>
      </div>
    </div>
    <div class="roster-list">${t.players.map(p=>rosterItemHtml(p,t.id)).join('')}</div>
    ${addSection}`;
  wireRosterButtons();
  document.getElementById('rosterModal').classList.add('open');
}

function closeModal(){
  document.getElementById('rosterModal').classList.remove('open');
  _rosterViewMode = null;
  closeSwapPicker();
}

function closeExport(){
  document.getElementById('exportOverlay').style.display = 'none';
}

function downloadExport(){
  const canvas = document.getElementById('exportCanvas');
  const a = document.createElement('a');
  a.download = 'draft-day-rosters.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
}

function showExportCard(){
  const overlay = document.getElementById('exportOverlay');
  const canvas  = document.getElementById('exportCanvas');
  overlay.style.display = 'flex';
  renderExportCanvas(canvas);
}

function renderExportCanvas(canvas){
  const COLS = 3;
  const teamList = teams;
  const W = 1200, HEADER_H = 140, FOOTER_H = 60;
  const COLS_N = COLS, ROWS = Math.ceil(teamList.length / COLS_N);
  const CARD_W = (W - 80 - (COLS_N-1)*20) / COLS_N;
  const MAX_PLAYERS = Math.max(...teamList.map(t=>t.players.length));
  const CARD_H = 52 + MAX_PLAYERS * 38 + 24;
  const teamsBottom = HEADER_H + ROWS * (CARD_H + 20);

  const captainNames = getCaptainNames();
  const unsold = players.filter(p => !p.sold && !captainNames.includes(p.name.toLowerCase()));
  const UCOLS = 4;
  const UNSOLD_SECTION_H = unsold.length > 0 ? 20 + 36 + Math.ceil(unsold.length / UCOLS) * 28 + 16 : 0;

  const H = teamsBottom + UNSOLD_SECTION_H + FOOTER_H;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // ── Background ──
  const bgGrad = ctx.createLinearGradient(0,0,W,H);
  bgGrad.addColorStop(0,'#05080f');
  bgGrad.addColorStop(0.5,'#0a1020');
  bgGrad.addColorStop(1,'#040710');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0,0,W,H);

  // Subtle pitch lines (cricket crease lines as atmosphere)
  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  for(let i=0;i<W;i+=60){
    ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,H); ctx.stroke();
  }
  ctx.restore();

  // Radial glow centre
  const glow = ctx.createRadialGradient(W/2, HEADER_H/2, 0, W/2, HEADER_H/2, 500);
  glow.addColorStop(0,'rgba(0,200,255,0.12)');
  glow.addColorStop(1,'rgba(0,200,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0,0,W,H);

  // ── Header ──
  // Gold top bar
  ctx.fillStyle = '#f5b800';
  ctx.fillRect(0,0,W,5);

  // Title
  ctx.font = 'bold 52px Anton, Impact, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.letterSpacing = '3px';
  ctx.textAlign = 'center';
  ctx.fillText('6-A-SIDE', W/2, 70);

  // Subtitle
  ctx.font = '600 20px Barlow, sans-serif';
  ctx.fillStyle = '#f5b800';
  ctx.fillText('OFFICIAL TEAM ROSTERS', W/2, 100);

  // Thin divider
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(40,HEADER_H-12); ctx.lineTo(W-40,HEADER_H-12); ctx.stroke();

  // ── Team Cards ──
  const TIER_COLORS = { Platinum:'#e8f0ff', Gold:'#f5b800', Silver:'#b0bec5', Bronze:'#c07840' };
  const TIER_BG     = { Platinum:'rgba(100,140,255,0.15)', Gold:'rgba(245,184,0,0.12)', Silver:'rgba(180,200,210,0.1)', Bronze:'rgba(180,100,50,0.12)' };

  teamList.forEach((team, ti)=>{
    const col = ti % COLS_N;
    const row = Math.floor(ti / COLS_N);
    const cx  = 40 + col*(CARD_W+20);
    const cy  = HEADER_H + row*(CARD_H+20);

    // Card shadow
    ctx.save();
    ctx.shadowColor = team.color;
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 4;

    // Card background
    const cardBg = ctx.createLinearGradient(cx,cy,cx,cy+CARD_H);
    cardBg.addColorStop(0,'rgba(255,255,255,0.07)');
    cardBg.addColorStop(1,'rgba(255,255,255,0.02)');
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
    roundRect(ctx, cx, cy, CARD_W, 6, {tl:14,tr:14,br:0,bl:0});
    ctx.fillStyle = team.color;
    ctx.fill();
    ctx.restore();

    // Team name
    ctx.font = 'bold 17px Anton, Impact, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
    const nameY = cy + 34;
    ctx.fillText(truncate(ctx, team.name.toUpperCase(), CARD_W - 20), cx+12, nameY);

    // Divider
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx+10,cy+48); ctx.lineTo(cx+CARD_W-10,cy+48); ctx.stroke();

    // Players
    team.players.forEach((p, pi)=>{
      const py = cy + 60 + pi*38;
      const isCap = p.isCaptain;
      const isFormer = p.isFormer;

      // Row bg on hover-alternating style
      if(pi%2===0){
        ctx.fillStyle = 'rgba(255,255,255,0.025)';
        roundRect(ctx,cx+6,py-2,CARD_W-12,34,6);
        ctx.fill();
      }

      // Icon
      const icon = isCap ? '👑' : isFormer ? '🏅' : '';
      if(icon){
        ctx.font = '14px serif';
        ctx.textAlign = 'left';
        ctx.fillText(icon, cx+12, py+20);
      }
      const nameX = cx + (icon ? 30 : 12);

      // Player name
      ctx.font = isCap ? 'bold 13px Barlow, sans-serif' : '500 13px Barlow, sans-serif';
      ctx.fillStyle = isCap ? team.color : isFormer ? '#d4956a' : '#e8eaf0';
      ctx.textAlign = 'left';
      ctx.fillText(truncate(ctx, p.name, CARD_W - 110), nameX, py+20);

      // Tier pill
      if(p.tier && !isCap){
        const tc = TIER_COLORS[p.tier]||'#aaa';
        const tb = TIER_BG[p.tier]||'rgba(255,255,255,0.08)';
        ctx.font = 'bold 9px Barlow, sans-serif';
        const tw = ctx.measureText(p.tier.slice(0,3).toUpperCase()).width + 10;
        const tx = cx + CARD_W - (p.finalPrice?65:15) - tw - 4;
        ctx.fillStyle = tb;
        roundRect(ctx, tx, py+6, tw, 16, 3);
        ctx.fill();
        ctx.fillStyle = tc;
        ctx.textAlign = 'center';
        ctx.fillText(p.tier.slice(0,3).toUpperCase(), tx+tw/2, py+18);
      }

      // Price
      if(p.finalPrice && !isCap && !isFormer){
        ctx.font = 'bold 12px Barlow, sans-serif';
        ctx.fillStyle = '#f5b800';
        ctx.textAlign = 'right';
        ctx.fillText(zarS(p.finalPrice), cx+CARD_W-10, py+20);
      }
    });
  });

  // ── Unsold Players Section ──
  if(unsold.length > 0){
    const uy = teamsBottom + 20;

    // Section header
    ctx.font = 'bold 13px Anton, Impact, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'left';
    ctx.letterSpacing = '2px';
    ctx.fillText(`UNSOLD PLAYERS (${unsold.length})`, 40, uy + 16);

    // Thin divider
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(40, uy+24); ctx.lineTo(W-40, uy+24); ctx.stroke();

    // Players in 4 columns
    const UCOLS = 4;
    const UCOL_W = (W - 80 - (UCOLS-1)*16) / UCOLS;
    unsold.forEach((p, i) => {
      const col = i % UCOLS;
      const row = Math.floor(i / UCOLS);
      const px = 40 + col * (UCOL_W + 16);
      const py = uy + 36 + row * 28;

      // Subtle alternating row bg
      if(i % 2 === 0){
        ctx.fillStyle = 'rgba(255,255,255,0.02)';
        roundRect(ctx, px, py - 2, UCOL_W, 22, 4);
        ctx.fill();
      }

      // Tier colour dot
      const dotColor = {Platinum:'#a0b4ff', Gold:'#f5b800', Silver:'#b0bec5', Bronze:'#c07840'}[p.tier] || 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.arc(px + 8, py + 9, 4, 0, Math.PI*2);
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
      ctx.fillText(zarS(p.price), px + UCOL_W - 4, py + 14);
    });
  }

  // ── Footer ──
  const fy = H - FOOTER_H + 20;
  ctx.font = '500 14px Barlow, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.textAlign = 'center';
  ctx.fillText('#tygerbergcc  #6aside  #lekkersoosacracker', W/2, fy+10);

  // Bottom gold bar
  ctx.fillStyle = '#f5b800';
  ctx.fillRect(0, H-5, W, 5);
}

function roundRect(ctx, x, y, w, h, r){
  if(typeof r === 'number') r = {tl:r,tr:r,br:r,bl:r};
  ctx.beginPath();
  ctx.moveTo(x + r.tl, y);
  ctx.lineTo(x + w - r.tr, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r.tr);
  ctx.lineTo(x+w, y+h-r.br);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r.br, y+h);
  ctx.lineTo(x+r.bl, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+h-r.bl);
  ctx.lineTo(x, y+r.tl);
  ctx.quadraticCurveTo(x, y, x+r.tl, y);
  ctx.closePath();
}

function truncate(ctx, text, maxW){
  if(ctx.measureText(text).width <= maxW) return text;
  while(text.length > 1 && ctx.measureText(text+'…').width > maxW) text=text.slice(0,-1);
  return text+'…';
}

function wireRosterButtons(){
  document.querySelectorAll('#modalBody .roster-item').forEach(row=>{
    const teamId = parseInt(row.dataset.teamId, 10);
    const playerName = row.dataset.playerName;
    if(isNaN(teamId) || !playerName) return;
    const removeBtn = row.querySelector('.ri-action-remove');
    const swapBtn   = row.querySelector('.ri-action-swap');
    if(removeBtn) removeBtn.addEventListener('click', ()=> removeFromRoster(teamId, playerName));
    if(swapBtn)   swapBtn.addEventListener('click',   ()=> openSwapPicker(teamId, playerName));
  });

  // Wire add-to-roster section
  const atrSection = document.getElementById('addToRosterSection');
  if(!atrSection) return;
  const teamId = parseInt(atrSection.dataset.teamId, 10);
  const sel    = document.getElementById('atrSelect');
  const price  = document.getElementById('atrPrice');
  const btn    = document.getElementById('atrConfirmBtn');
  if(sel) sel.addEventListener('change', ()=>{
    const opt = sel.options[sel.selectedIndex];
    if(opt && opt.dataset.price) price.value = opt.dataset.price;
    const err = document.getElementById('atrError');
    if(err){ err.textContent=''; err.classList.remove('visible'); }
  });
  if(btn) btn.addEventListener('click', ()=> addToRoster(teamId));
}

function addToRoster(teamId){
  const t = teams.find(x => x.id === teamId);
  if(!t) return;
  const sel = document.getElementById('atrSelect');
  const priceInp = document.getElementById('atrPrice');
  const err = document.getElementById('atrError');
  const showErr = msg => { err.textContent=msg; err.classList.add('visible'); };
  err.classList.remove('visible');

  const playerName = sel.value;
  if(!playerName){ showErr('Select a player first.'); return; }

  const mp = players.find(p => p.name === playerName);
  if(!mp || mp.sold){ showErr('Player is no longer available.'); return; }

  const price = parseFloat(priceInp.value);
  if(isNaN(price) || price < 0){ showErr('Enter a valid price.'); return; }

  // Rules checks
  const maxSlots = adminRules.maxPlayers;
  const auctionCount = t.players.filter(p=>!p.isCaptain&&!p.isFormer).length;
  if(auctionCount >= maxSlots){ showErr(`Squad full — ${maxSlots}/${maxSlots} auction slots used.`); return; }

  if(mp.tier && tierCount(t, mp.tier) >= TIER_LIMIT){
    showErr(`${t.name} already has ${TIER_LIMIT} ${mp.tier} tier players.`); return;
  }

  const tierMin = adminRules.tierMins[mp.tier] || 0;
  const minRequired = Math.max(mp.price, tierMin);
  if(price < minRequired){ showErr(`Minimum price for this player is ${zarFmt(minRequired)}.`); return; }

  if(price > t.budget){ showErr(`${t.name} only has ${zarFmt(t.budget)} — can't afford ${zarFmt(price)}.`); return; }

  // Assign
  t.budget -= price;
  t.players.push({...mp, finalPrice: price});
  mp.sold = true; mp.teamId = teamId; mp.finalPrice = price;
  auctionLog.push({player:mp.name, tier:mp.tier||'', team:t.name, teamColor:t.color, basePrice:mp.price, finalPrice:price});

  renderTeamsBar(); renderPlayersList(); renderLog(); updateStats(); drawWheel();
  showToast(`✓ ${mp.name} added to ${t.name} for ${zarFmt(price)}`);
  showTeamRoster(teamId); // refresh modal
}

function refreshRosterModal(){
  if(!document.getElementById('rosterModal').classList.contains('open')) return;
  if(_rosterViewMode === 'all') showAllRosters();
  else if(_rosterViewMode != null) showTeamRoster(_rosterViewMode);
}

function removeFromRoster(teamId, playerName){
  const t = teams.find(x => x.id === teamId);
  if(!t){ showToast('Team not found'); return; }
  const idx = t.players.findIndex(p => p.name === playerName && !p.isCaptain && !p.isFormer);
  if(idx === -1){ showToast('Player not found on roster'); return; }
  const p = t.players[idx];
  t.budget += p.finalPrice || 0;
  t.players.splice(idx, 1);
  const mp = players.find(x => x.name === playerName);
  if(mp){ mp.sold = false; mp.teamId = null; mp.finalPrice = undefined; }
  const logIdx = auctionLog.findIndex(e => e.player === playerName && e.team === t.name);
  if(logIdx !== -1) auctionLog.splice(logIdx, 1);
  renderTeamsBar(); renderPlayersList(); renderLog(); updateStats(); drawWheel();
  showToast(`${playerName} removed — ${zarFmt(p.finalPrice||0)} refunded to ${t.name}`);
  refreshRosterModal();
}

let _swapState = null;

function openSwapPicker(teamId, playerName){
  closeSwapPicker();
  _swapState = {teamId, playerName};
  const t = teams.find(x => x.id === teamId);
  if(!t) return;
  const currentP = t.players.find(p => p.name === playerName);
  if(!currentP) return;
  const captainNames = getCaptainNames();
  const available = players.filter(p => !p.sold && !captainNames.includes(p.name.toLowerCase()));
  if(!available.length){ showToast('No available players to swap in'); return; }

  // Find the roster-item row for this player
  const row = [...document.querySelectorAll('#modalBody .roster-item')]
    .find(el => el.dataset.playerName === playerName && parseInt(el.dataset.teamId,10) === teamId);
  if(!row) return;

  const wrap = document.createElement('div');
  wrap.className = 'swap-picker-wrap';
  wrap.id = 'swap-picker-active';

  const optionsHtml = available.map(ap => {
    const diff = ap.price - (currentP.finalPrice || 0);
    const diffStr = diff === 0 ? 'Same' : (diff > 0 ? '+' : '') + zarS(diff);
    const diffCls = diff > 0 ? 'swap-diff-neg' : diff < 0 ? 'swap-diff-pos' : 'swap-diff-neu';
    const canAfford = t.budget >= Math.max(0, diff);
    const tierHtml = ap.tier ? `<span class="tier-pill tp-${ap.tier.toLowerCase()}">${ap.tier}</span>` : '';
    return `<div class="swap-option${canAfford ? '' : ' broke'}"
        data-in-name="${ap.name.replace(/'/g,"&#39;")}"
        style="${canAfford ? '' : 'opacity:0.4;cursor:not-allowed'}">
      <div class="swap-option-name">${esc(ap.name)}</div>
      ${tierHtml}
      <span class="swap-option-price">${zarS(ap.price)}</span>
      <span class="swap-option-diff ${diffCls}">${diffStr}</span>
    </div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="swap-picker-label">Swap <strong>${esc(playerName)}</strong> with:</div>
    <div class="swap-picker-list" id="swapOptionList">${optionsHtml}</div>
    <div class="swap-picker-cancel">✕ Cancel</div>`;

  row.after(wrap);

  // Wire option clicks
  wrap.querySelectorAll('.swap-option:not(.broke)').forEach(opt => {
    opt.addEventListener('click', () => confirmSwap(teamId, playerName, opt.dataset.inName));
  });
  wrap.querySelector('.swap-picker-cancel').addEventListener('click', closeSwapPicker);
}

function closeSwapPicker(){
  const el = document.getElementById('swap-picker-active');
  if(el) el.remove();
  _swapState = null;
}

function confirmSwap(teamId, outName, inName){
  const t = teams.find(x => x.id === teamId);
  if(!t) return;
  const outIdx = t.players.findIndex(p => p.name === outName && !p.isCaptain && !p.isFormer);
  if(outIdx === -1) return;
  const outPlayer = t.players[outIdx];
  const inPlayer = players.find(p => p.name === inName);
  if(!inPlayer || inPlayer.sold) return;

  const priceDiff = inPlayer.price - (outPlayer.finalPrice || 0);
  if(t.budget < priceDiff){ showToast('Insufficient budget for this swap'); return; }

  // Remove out-player
  t.players.splice(outIdx, 1);
  const mpOut = players.find(x => x.name === outName);
  if(mpOut){ mpOut.sold = false; mpOut.teamId = null; mpOut.finalPrice = undefined; }
  const logIdx = auctionLog.findIndex(e => e.player === outName && e.team === t.name);
  if(logIdx !== -1) auctionLog.splice(logIdx, 1);

  // Add in-player
  t.budget -= priceDiff;
  t.players.push({...inPlayer, finalPrice: inPlayer.price});
  inPlayer.sold = true; inPlayer.teamId = teamId; inPlayer.finalPrice = inPlayer.price;
  auctionLog.push({player:inPlayer.name, tier:inPlayer.tier||'', team:t.name, teamColor:t.color, basePrice:inPlayer.price, finalPrice:inPlayer.price});

  closeSwapPicker();
  renderTeamsBar(); renderPlayersList(); renderLog(); updateStats(); drawWheel();
  const msg = priceDiff === 0 ? 'no budget change' : priceDiff > 0 ? `${zarFmt(priceDiff)} deducted` : `${zarFmt(-priceDiff)} refunded`;
  showToast(`⇄ ${outName} → ${inName} (${msg})`);
  refreshRosterModal();
}

async function exportRosters(){
  if(typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined'){
    showToast('PDF library not loaded yet — try again in a moment');return;
  }
  showToast('Generating PDF…');

  // Logos are file paths now; turn each into a small JPEG data URL jsPDF can embed.
  // (If the browser blocks reading the file — e.g. some browsers on file:// — the logo is just left out.)
  const pdfLogos = {};
  await Promise.all(teams.map(t => new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const S = 200, c = document.createElement('canvas'); c.width = c.height = S;
        const g = c.getContext('2d'), side = Math.min(img.naturalWidth, img.naturalHeight) || S;
        g.fillStyle = '#111'; g.fillRect(0, 0, S, S);
        g.drawImage(img, (img.naturalWidth-side)/2, (img.naturalHeight-side)/2, side, side, 0, 0, S, S);
        pdfLogos[t.id] = c.toDataURL('image/jpeg', 0.9);
      } catch (e) { /* canvas tainted — skip this logo */ }
      resolve();
    };
    img.onerror = () => resolve();
    img.src = t.logo;
  })));

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
  const PW = 210, PH = 297, M = 14; // page width, height, margin
  const now = new Date().toLocaleString('en-ZA');

  // Helper: hex to rgb
  function hexRgb(hex){ const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16); return [r,g,b]; }

  // Tier colours (text colour)
  const tierCol = { platinum:'#a8d0e8', gold:'#f5b800', silver:'#98a8b8', bronze:'#c07840', captain:'#00c8ff', '':'#aabbcc' };
  const tierBg  = { platinum:[30,50,65], gold:[60,45,0], silver:[35,40,48], bronze:[55,32,10], captain:[0,35,50], '': [30,40,50] };

  // Summary page
  function drawSummaryPage(){
    // Dark bg
    doc.setFillColor(8,12,16); doc.rect(0,0,PW,PH,'F');
    // Title
    doc.setFont('helvetica','bold'); doc.setFontSize(28); doc.setTextColor(0,200,255);
    doc.text('DRAFT DAY', M, 22);
    doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(90,112,128);
    doc.text('Team Rosters — Exported '+now, M, 30);

    // Divider
    doc.setDrawColor(30,42,56); doc.setLineWidth(0.4); doc.line(M,34,PW-M,34);

    // Summary boxes
    const totalSpent=teams.reduce((s,t)=>s+(BUDGET-t.budget),0);
    const totalSigned=teams.reduce((s,t)=>s+t.players.filter(p=>!p.isCaptain).length,0);
    const totalLeft=teams.reduce((s,t)=>s+t.budget,0);
    const boxes=[
      {label:'Teams', value:String(teams.length)},
      {label:'Players Signed', value:String(totalSigned)},
      {label:'Total Spent', value:zarFmt(totalSpent)},
      {label:'Total Remaining', value:zarFmt(totalLeft)},
    ];
    const bw=(PW-M*2-9)/4, bh=18;
    boxes.forEach((b,i)=>{
      const bx=M+i*(bw+3), by=38;
      doc.setFillColor(17,24,32); doc.roundedRect(bx,by,bw,bh,2,2,'F');
      doc.setDrawColor(30,42,56); doc.setLineWidth(0.3); doc.roundedRect(bx,by,bw,bh,2,2,'S');
      doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(245,184,0);
      doc.text(b.value, bx+bw/2, by+8, {align:'center'});
      doc.setFont('helvetica','normal'); doc.setFontSize(6); doc.setTextColor(90,112,128);
      doc.text(b.label.toUpperCase(), bx+bw/2, by+14, {align:'center'});
    });

    // Team list
    let y=66;
    doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(90,112,128);
    doc.text('TEAM OVERVIEW', M, y); y+=5;

    teams.forEach(t=>{
      const pct=Math.round((t.budget/BUDGET)*100);
      const spent=BUDGET-t.budget;
      const auc=t.players.filter(p=>!p.isCaptain&&!p.isFormer).length;
      const col=hexRgb(t.color);

      doc.setFillColor(17,24,32); doc.roundedRect(M,y,PW-M*2,14,2,2,'F');
      doc.setDrawColor(30,42,56); doc.setLineWidth(0.3); doc.roundedRect(M,y,PW-M*2,14,2,2,'S');
      // Team colour bar left edge
      doc.setFillColor(...col); doc.rect(M,y,1.5,14,'F');
      // Name
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(221,232,240);
      doc.text(t.name, M+4.5, y+5.5);
      // Squad count
      doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(90,112,128);
      doc.text(`${1+t.players.filter(p=>p.isFormer).length+auc} players`, M+4.5, y+10.5);
      // Budget
      const budgetCol = pct<20?[255,64,80]:pct<50?[245,184,0]:[0,232,122];
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...budgetCol);
      doc.text(zarFmt(t.budget)+' left', PW-M-2, y+5.5, {align:'right'});
      doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(90,112,128);
      doc.text(zarFmt(spent)+' spent', PW-M-2, y+10.5, {align:'right'});
      // Budget bar
      const barX=M+1.5, barY=y+13, barW=PW-M*2-1.5, barH=1;
      doc.setFillColor(30,42,56); doc.rect(barX,barY,barW,barH,'F');
      doc.setFillColor(...col); doc.rect(barX,barY,barW*(pct/100),barH,'F');

      y+=16;
    });
  }

  // One page per team
  function drawTeamPage(t, isFirst){
    if(!isFirst) doc.addPage();
    doc.setFillColor(8,12,16); doc.rect(0,0,PW,PH,'F');

    const col=hexRgb(t.color);
    const pct=Math.round((t.budget/BUDGET)*100);
    const spent=BUDGET-t.budget;
    const auc=t.players.filter(p=>!p.isCaptain&&!p.isFormer).length;
    const former=t.players.filter(p=>p.isFormer).length;

    // Header band
    doc.setFillColor(17,24,32); doc.rect(0,0,PW,42,'F');
    doc.setFillColor(...col); doc.rect(0,0,PW,2,'F'); // colour top bar

    // Logo (pre-converted above; missing if the browser wouldn't let us read it)
    if(pdfLogos[t.id]){ try{ doc.addImage(pdfLogos[t.id],'JPEG',M,6,18,18,'','FAST'); } catch(e){} }
    doc.setRoundedRect && doc.setDrawColor(...col);

    // Team name
    doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.setTextColor(221,232,240);
    doc.text(t.name, M+21, 14);
    // Squad summary
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(90,112,128);
    doc.text(`Captain + ${former} past player${former!==1?'s':''} + ${auc}/5 auction`, M+21, 20);

    // Budget
    const budgetCol=pct<20?[255,64,80]:pct<50?[245,184,0]:[0,232,122];
    doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(...budgetCol);
    doc.text(zarFmt(t.budget), PW-M, 14, {align:'right'});
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(90,112,128);
    doc.text('remaining · '+zarFmt(spent)+' spent', PW-M, 20, {align:'right'});

    // Budget bar
    doc.setFillColor(30,42,56); doc.rect(M,26,PW-M*2,2.5,'F');
    doc.setFillColor(...col); doc.rect(M,26,(PW-M*2)*(pct/100),2.5,'F');

    // Divider
    doc.setDrawColor(30,42,56); doc.setLineWidth(0.4); doc.line(M,42,PW-M,42);

    // Players
    let y=49;
    t.players.forEach(p=>{
      const isCap=!!p.isCaptain, isFor=!!p.isFormer;
      const tier=(p.tier||'').toLowerCase();

      // Row bg
      if(isCap){ doc.setFillColor(0,35,50); }
      else if(isFor){ doc.setFillColor(55,32,10); }
      else { doc.setFillColor(18,26,36); }
      doc.roundedRect(M,y,PW-M*2,10,1.5,1.5,'F');

      // Left accent
      if(isCap){ doc.setFillColor(0,200,255); }
      else if(isFor){ doc.setFillColor(192,120,64); }
      else { doc.setFillColor(...col); }
      doc.rect(M,y,1.5,10,'F');

      // Icon
      doc.setFontSize(9);
      const icon = isCap?'C':isFor?'P':'•';
      if(isCap) doc.setTextColor(0,200,255);
      else if(isFor) doc.setTextColor(212,149,106);
      else doc.setTextColor(...col);
      doc.setFont('helvetica','bold');
      doc.text(icon, M+4.5, y+6.5);

      // Name
      const nc = isCap?[0,200,255]:isFor?[212,149,106]:[221,232,240];
      doc.setTextColor(...nc); doc.setFontSize(9);
      doc.setFont('helvetica', isCap||isFor?'bold':'normal');
      doc.text(p.name, M+9, y+6.5);

      // Tier pill
      if(p.tier && !isCap){
        const tc=tierCol[tier]||'#aabbcc';
        const [tr,tg,tb]=hexRgb(tc);
        const [br,bg2,bb]=tierBg[tier]||[30,40,50];
        const pillText=p.tier.toUpperCase();
        const pillW=doc.getTextWidth(pillText)*0.7+4;
        const pillX=PW-M-2-pillW-24;
        doc.setFillColor(br,bg2,bb); doc.roundedRect(pillX,y+2.5,pillW,5,1,1,'F');
        doc.setTextColor(tr,tg,tb); doc.setFontSize(5.5); doc.setFont('helvetica','bold');
        doc.text(pillText, pillX+pillW/2, y+6.2, {align:'center'});
      }

      // Price / label
      doc.setFontSize(8); doc.setFont('helvetica','bold');
      if(isCap){ doc.setTextColor(90,112,128); doc.text('Captain', PW-M-2, y+6.5, {align:'right'}); }
      else if(isFor){ doc.setTextColor(192,120,64); doc.text('Past Player', PW-M-2, y+6.5, {align:'right'}); }
      else { doc.setTextColor(245,184,0); doc.text(zarFmt(p.finalPrice||p.price), PW-M-2, y+6.5, {align:'right'}); }

      y+=12;
    });

    if(!t.players.length){
      doc.setFont('helvetica','italic'); doc.setFontSize(8); doc.setTextColor(90,112,128);
      doc.text('No players signed yet', M, y+5);
    }

    // Footer
    doc.setFont('helvetica','normal'); doc.setFontSize(6); doc.setTextColor(40,55,70);
    doc.text('Draft Day — '+now, PW/2, PH-6, {align:'center'});
  }

  drawSummaryPage();
  teams.forEach((t,i) => drawTeamPage(t, false));

  doc.save('draft-day-rosters.pdf');
  showToast('PDF exported!');
}


function exportLog(){
  if(!auctionLog.length){showToast('Nothing to export');return;}
  const rows=['Player,Tier,Team,Base Price (ZAR),Final Bid (ZAR)'];
  auctionLog.forEach(e=>rows.push(`"${e.player}","${e.tier}","${e.team}",${e.basePrice},${e.finalPrice}`));
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([rows.join('\n')],{type:'text/csv'}));
  a.download='draft-day-results.csv';a.click();showToast('Exported!');
}

function saveState(){
  // Reconcile sold status before saving — ensure any roster player is marked sold
  const assignedNames = new Set();
  teams.forEach(t => t.players.forEach(p => assignedNames.add(p.name.toLowerCase())));
  players.forEach(p => { if(assignedNames.has(p.name.toLowerCase())) p.sold = true; });

  const state = {
    version: 1,
    savedAt: new Date().toISOString(),
    // which screen we're on
    phase: document.getElementById('selectionScreen').classList.contains('open') ? 'selection'
         : document.getElementById('appScreen').style.display !== 'none' ? 'auction'
         : 'setup',
    // core state
    _pid,
    pickOrder,
    teams, // logos are saved as paths (or data URLs for uploaded ones)
    players,
    auctionLog,
    spinAngle,
    // selection round state
    selPlayers,
    selPickIdx,
    selTurnOrder,
    selDone,
  };
  const blob = new Blob([JSON.stringify(state, null, 2)], {type: 'application/json'});
  const a = document.createElement('a');
  const ts = new Date().toLocaleString('en-ZA').replace(/[/:, ]/g, '-').replace(/-+/g,'-');
  a.href = URL.createObjectURL(blob);
  a.download = `draft-day-save-${ts}.json`;
  a.click();
  showToast('State saved!');
}

function loadState(e){
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const s = JSON.parse(ev.target.result);
      if(s.version !== 1) { showToast('Unrecognised save file'); return; }

      // Restore scalar state
      _pid = s._pid || 0;
      pickOrder = s.pickOrder || [...Array(TEAM_COUNT).keys()];
      players = s.players || [];
      auctionLog = s.auctionLog || [];
      spinAngle = s.spinAngle || 0;
      selPlayers = s.selPlayers || [];
      selPickIdx = s.selPickIdx || 0;
      selTurnOrder = s.selTurnOrder || [];
      selDone = s.selDone || false;

      // Restore teams — older saves have no logo field, so fall back to the configured one
      teams = (s.teams || []).map(t => ({...t, logo: t.logo || cfgLogo(t.id)}));
      // Mirror the loaded teams into the setup screen (this session only)
      teams.forEach(t => {
        const cap = t.players.find(p => p.isCaptain);
        teamConfig[t.id] = { name: t.name, captain: cap ? cap.name : '', color: t.color, logo: t.logo };
      });
      renderTeamInputs();

      // Reconcile: any player already on a team roster must be marked sold in the players array
      // (captains and former players are assigned to teams but may have sold:false in the players array)
      const assignedNames = new Set();
      teams.forEach(t => t.players.forEach(p => assignedNames.add(p.name.toLowerCase())));
      players.forEach(p => { if(assignedNames.has(p.name.toLowerCase())) p.sold = true; });

      // Hide all screens first
      document.getElementById('setupScreen').style.display = 'none';
      document.getElementById('selectionScreen').classList.remove('open');
      document.getElementById('appScreen').style.display = 'none';
      document.getElementById('selCompleteBanner').classList.remove('visible');

      if(s.phase === 'selection'){
        document.getElementById('selectionScreen').classList.add('open');
        selRenderOrderList();
        selRenderTurnCard();
        selRenderPlayerGrid();
        renderTeamsBar();
      } else if(s.phase === 'auction'){
        document.getElementById('appScreen').style.display = 'flex';
        document.getElementById('appScreen').style.flexDirection = 'column';
        dismissWinner();
        renderTeamsBar();
        renderPlayersList();
        renderLog();
        updateStats();
        drawWheel();
      } else {
        // setup phase — just go back to setup screen
        document.getElementById('setupScreen').style.display = 'flex';
        renderPickOrderList();
      }

      const d = new Date(s.savedAt);
      showToast(`Resumed from ${d.toLocaleString('en-ZA')}`);
    } catch(err) {
      showToast('Failed to load save file');
      console.error(err);
    }
  };
  r.readAsText(file);
}

function selResetPicks(){
  selPlayers.forEach(p => p.pickedBy = null);
  teams.forEach(t => { t.players = t.players.filter(p => !p.isFormer); });
  selPickIdx = 0;
  selDone = false;
  document.getElementById('selCompleteBanner').classList.remove('visible');
  selRenderOrderList();
  selRenderTurnCard();
  selRenderPlayerGrid();
  showToast('Picks reset — starting from pick 1');
}

function confirmResetPicks(){
  teams.forEach(t => {
    const spent = t.players.filter(p => !p.isCaptain && !p.isFormer).reduce((s, p) => s + (p.finalPrice||0), 0);
    t.budget += spent;
    t.players = t.players.filter(p => p.isCaptain || p.isFormer);
  });
  players.forEach(p => { p.sold = false; p.teamId = null; p.finalPrice = 0; });
  auctionLog = [];
  currentPlayer = null;
  selectedTeamId = null;
  spinAngle = 0;
  dismissWinner();
  renderTeamsBar(); renderPlayersList(); renderLog(); updateStats(); drawWheel();
  showToast('Auction picks reset — wheel reloaded');
}

function confirmReset(){
  if(!confirm('Reset entire auction? All data will be lost.'))return;
  players=[];auctionLog=[];currentPlayer=null;selectedTeamId=null;spinAngle=0;spinning=false;_pid=0;
  selPlayers=[];selPickIdx=0;selDone=false;selTurnOrder=[];
  pickOrder=[...Array(TEAM_COUNT).keys()];
  teams=[]; // back to setup — team edits now go to the setup config again
  renderTeamInputs(); renderPickOrderList();
  stopJingle();
  // Hide app and selection screens, go back to setup
  document.getElementById('appScreen').style.display='none';
  document.getElementById('selectionScreen').classList.remove('open');
  document.getElementById('setupScreen').style.display='flex';
  document.getElementById('selCompleteBanner').classList.remove('visible');
  canvas.classList.remove('spinning');
  document.getElementById('wheelHalo').classList.remove('active');
  dismissWinner();
  showToast('Auction reset');
}

function launchConfetti(){
  const cc=document.getElementById('confettiCanvas');
  cc.width=innerWidth;cc.height=innerHeight;
  const cx=cc.getContext('2d');
  const cols=['#00c8ff','#f5b800','#00e87a','#ff4050','#b060ff','#ff8030'];
  const ps=Array.from({length:100},()=>({
    x:Math.random()*cc.width,y:-10,vx:(Math.random()-.5)*5,vy:2+Math.random()*4,
    c:cols[Math.floor(Math.random()*cols.length)],w:5+Math.random()*8,h:3+Math.random()*5,
    r:Math.random()*Math.PI*2,rv:(Math.random()-.5)*0.12,life:1
  }));
  (function d(){
    cx.clearRect(0,0,cc.width,cc.height);let alive=false;
    ps.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vy+=0.1;p.r+=p.rv;p.life-=0.008;
      if(p.y<cc.height+20&&p.life>0){alive=true;cx.save();cx.globalAlpha=Math.max(0,p.life);cx.translate(p.x,p.y);cx.rotate(p.r);cx.fillStyle=p.c;cx.fillRect(-p.w/2,-p.h/2,p.w,p.h);cx.restore();}
    });
    if(alive)requestAnimationFrame(d);else cx.clearRect(0,0,cc.width,cc.height);
  })();
}

let _tt;
function showToast(m){const e=document.getElementById('toast');e.textContent=m;e.classList.add('show');clearTimeout(_tt);_tt=setTimeout(()=>e.classList.remove('show'),2600);}

// Admin accessible from setup screen (rules config before launch)
function openAdminSetup() {
  openAdmin();
  switchAdminTab('rules');
  // Bind apply to also update setup budget display
  const origApply = window.applyAdmin;
}

// Update budget display on setup screen when adminRules change
function updateSetupBudgetDisplay() {
  const el = document.getElementById('setupBudgetDisplay');
  if (el) el.textContent = 'R ' + adminRules.budget.toLocaleString('en-ZA');
}

// Patch applyAdmin to update setup display
const _baseApplyAdmin = applyAdmin;
window.applyAdmin = function() {
  _baseApplyAdmin();
  updateSetupBudgetDisplay();
};
let adminRules = {
  minIncrement: 10000,
  autoFillBase: true,
  bidTimer: 0,
  maxPlayers: 5,
  budget: 10000000,
  tierMins: { Platinum: 500000, Gold: 200000, Silver: 50000, Bronze: 10000 }
};

// ── ADMIN PANEL ──────────────────────────────────────────────────────────────
function openAdmin() {
  const overlay = document.getElementById('adminOverlay');
  overlay.classList.remove('hidden');
  overlay.style.display = 'flex';
  switchAdminTab('teams');
  renderAdminTeams();
  loadAdminRulesToUI();
}

function closeAdmin() {
  const overlay = document.getElementById('adminOverlay');
  overlay.style.display = 'none';
}

function switchAdminTab(tab) {
  document.getElementById('adminTabTeams').style.display = tab === 'teams' ? 'block' : 'none';
  document.getElementById('adminTabRules').style.display = tab === 'rules' ? 'block' : 'none';
  document.getElementById('tabTeams').classList.toggle('active', tab === 'teams');
  document.getElementById('tabRules').classList.toggle('active', tab === 'rules');
}

function renderAdminTeams() {
  const grid = document.getElementById('adminTeamsGrid');
  const launched = teams.length > 0;
  // Before launch we edit the setup config; after launch we edit the live teams.
  const rows = launched
    ? teams.map(t => ({ id: t.id, name: t.name, color: t.color, captain: (t.players.find(p => p.isCaptain) || {}).name || '', budget: t.budget }))
    : teamConfig.map((c, i) => ({ id: i, name: c.name, color: c.color, captain: c.captain, budget: null }));
  grid.innerHTML = rows.map(t => `
    <div class="admin-team-row" id="adminTeamRow${t.id}">
      <div style="position:relative;flex-shrink:0">
        <div class="admin-team-color-swatch" style="background:${t.color}" onclick="document.getElementById('acp${t.id}').click()" title="Change colour"></div>
        <input type="color" class="admin-color-picker" id="acp${t.id}" value="${rgbToHex(t.color)}" onchange="previewTeamColor(${t.id},this.value)"/>
      </div>
      <div style="display:flex;flex-direction:column;gap:0.35rem;flex:1;min-width:0">
        <input class="admin-team-name-inp" id="atn${t.id}" value="${esc(t.name)}" placeholder="Team ${t.id+1}" maxlength="32"/>
        <input class="admin-team-name-inp" id="atc${t.id}" value="${esc(t.captain)}" placeholder="👑 Captain" maxlength="40" style="font-size:0.8rem;font-weight:500"/>
      </div>
      ${launched ? `<div class="admin-team-budget-wrap">
        <input type="number" class="admin-team-budget-inp" id="atb${t.id}" value="${t.budget}" min="0" step="100000"/>
      </div>` : ''}
    </div>
  `).join('') + (launched ? '' : '<div style="color:var(--muted);font-size:0.75rem;margin-top:0.25rem">Budgets are set under Auction Rules until the auction launches.</div>');
}

function previewTeamColor(teamId, hexVal) {
  const swatch = document.querySelector(`#adminTeamRow${teamId} .admin-team-color-swatch`);
  if (swatch) swatch.style.background = hexVal;
}

function rgbToHex(color) {
  // color is already a hex string like #00c8ff
  if (color.startsWith('#')) {
    // Ensure 6-digit hex
    if (color.length === 4) {
      return '#' + color[1]+color[1]+color[2]+color[2]+color[3]+color[3];
    }
    return color;
  }
  return '#888888';
}

function loadAdminRulesToUI() {
  document.getElementById('ruleMinIncrement').value = adminRules.minIncrement;
  document.getElementById('ruleAutoFillBase').checked = adminRules.autoFillBase;
  document.getElementById('ruleBidTimer').value = adminRules.bidTimer;
  document.getElementById('ruleMaxPlayers').value = adminRules.maxPlayers;
  document.getElementById('ruleBudget').value = adminRules.budget;
  document.getElementById('rulePlatinumMin').value = adminRules.tierMins.Platinum;
  document.getElementById('ruleGoldMin').value = adminRules.tierMins.Gold;
  document.getElementById('ruleSilverMin').value = adminRules.tierMins.Silver;
  document.getElementById('ruleBronzeMin').value = adminRules.tierMins.Bronze;
}

function applyAdmin() {
  let changes = 0;

  // Before launch: edit the setup config (and keep it remembered)
  if (!teams.length) {
    teamConfig.forEach((c, i) => {
      const nameEl = document.getElementById('atn' + i), capEl = document.getElementById('atc' + i), colorEl = document.getElementById('acp' + i);
      if (nameEl && nameEl.value.trim() && nameEl.value.trim() !== c.name) { c.name = nameEl.value.trim(); changes++; }
      if (capEl && capEl.value.trim() !== c.captain) { c.captain = capEl.value.trim(); changes++; }
      if (colorEl && colorEl.value !== rgbToHex(c.color)) { c.color = colorEl.value; changes++; }
    });
    if (changes) { saveTeamConfig(); renderTeamInputs(); renderPickOrderList(); }
  }

  // After launch: edit the live teams
  teams.forEach(t => {
    const capEl = document.getElementById('atc' + t.id);
    const cap = t.players.find(p => p.isCaptain);
    if (capEl) {
      const newCap = capEl.value.trim();
      if (cap && newCap && newCap !== cap.name) { cap.name = newCap; changes++; }
      else if (!cap && newCap) {
        t.players.unshift({ id: nextId(), name: newCap, price: 0, tier: 'Captain', finalPrice: 0, sold: true, isCaptain: true, teamId: t.id });
        changes++;
      }
    }
    const nameEl = document.getElementById('atn' + t.id);
    const budgetEl = document.getElementById('atb' + t.id);
    const colorEl = document.getElementById('acp' + t.id);
    if (nameEl) {
      const newName = nameEl.value.trim() || t.name;
      if (newName !== t.name) { t.name = newName; changes++; }
    }
    if (budgetEl) {
      const newBudget = parseInt(budgetEl.value) || t.budget;
      if (newBudget !== t.budget) { t.budget = newBudget; changes++; }
    }
    if (colorEl) {
      const newColor = colorEl.value;
      if (newColor !== rgbToHex(t.color)) { t.color = newColor; changes++; }
    }
  });

  // Apply rules
  const newRules = {
    minIncrement: parseInt(document.getElementById('ruleMinIncrement').value) || adminRules.minIncrement,
    autoFillBase: document.getElementById('ruleAutoFillBase').checked,
    bidTimer: parseInt(document.getElementById('ruleBidTimer').value) || 0,
    maxPlayers: parseInt(document.getElementById('ruleMaxPlayers').value) || adminRules.maxPlayers,
    budget: parseInt(document.getElementById('ruleBudget').value) || adminRules.budget,
    tierMins: {
      Platinum: parseInt(document.getElementById('rulePlatinumMin').value) || 0,
      Gold: parseInt(document.getElementById('ruleGoldMin').value) || 0,
      Silver: parseInt(document.getElementById('ruleSilverMin').value) || 0,
      Bronze: parseInt(document.getElementById('ruleBronzeMin').value) || 0
    }
  };

  // Check for rule changes
  if (JSON.stringify(newRules) !== JSON.stringify(adminRules)) {
    adminRules = newRules;
    changes++;
    // Apply maxPlayers globally
    if (typeof MAX_PLAYERS !== 'undefined') {
      window._adminMaxPlayers = adminRules.maxPlayers;
    }
  }

  // Re-render UI if teams changed
  if (teams.length && changes > 0) {
    teams.forEach(t => {
      const cap = t.players.find(p => p.isCaptain);
      Object.assign(teamConfig[t.id], { name: t.name, color: t.color, captain: cap ? cap.name : '' });
    });
    saveTeamConfig(); renderTeamInputs(); renderPickOrderList();
    renderTeamsBar();
    renderPlayersList(); drawWheel(); renderLog();
    updateStats();
    if (currentPlayer) showWinnerPanel(currentPlayer);
  }

  closeAdmin();
  showToast(changes > 0 ? `✓ ${changes} change${changes > 1 ? 's' : ''} applied` : 'No changes made');
}

// ── ADMIN RULES INTEGRATION ──────────────────────────────────────────────────
// Override bid validation to use admin min increment & tier mins
function getAdminMinBid(player, basePrice) {
  const tierMin = adminRules.tierMins[(player?.tier)] || 0;
  return Math.max(basePrice, tierMin);
}

// ── BID TIMER ────────────────────────────────────────────────────────────────
let bidTimerInterval = null;
let bidTimerRemaining = 0;

function startBidTimer() {
  clearBidTimer();
  if (!adminRules.bidTimer || adminRules.bidTimer <= 0) return;
  bidTimerRemaining = adminRules.bidTimer;
  renderBidTimerUI();
  bidTimerInterval = setInterval(() => {
    bidTimerRemaining--;
    renderBidTimerUI();
    if (bidTimerRemaining <= 0) {
      clearBidTimer();
      if (bidRound.leaderId !== null) {
        showToast('⏱ Time\'s up — declaring winner!');
        setTimeout(declareWinner, 400);
      } else {
        dismissWinner();
        showToast('⏱ Time\'s up — player skipped');
      }
    }
  }, 1000);
}

function clearBidTimer() {
  if (bidTimerInterval) { clearInterval(bidTimerInterval); bidTimerInterval = null; }
  const el = document.getElementById('adminBidTimerDisplay');
  if (el) el.remove();
}

function renderBidTimerUI() {
  let el = document.getElementById('adminBidTimerDisplay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'adminBidTimerDisplay';
    el.style.cssText = `
      position:absolute; top:0.8rem; right:1rem; z-index:10;
      font-family:'Anton',sans-serif; font-size:1.1rem; letter-spacing:0.08em;
      padding:0.3rem 0.8rem; border-radius:8px;
      background:rgba(255,64,80,0.12); border:1px solid rgba(255,64,80,0.3);
      color:var(--red); display:flex; align-items:center; gap:0.4rem;
    `;
    const winnerTop = document.querySelector('.winner-top');
    if (winnerTop) { winnerTop.style.position='relative'; winnerTop.appendChild(el); }
  }
  const urgent = bidTimerRemaining <= 5;
  el.innerHTML = `⏱ ${bidTimerRemaining}s`;
  el.style.color = urgent ? 'var(--red)' : 'var(--gold)';
  el.style.background = urgent ? 'rgba(255,64,80,0.18)' : 'rgba(245,184,0,0.1)';
  el.style.borderColor = urgent ? 'rgba(255,64,80,0.4)' : 'rgba(245,184,0,0.25)';
  if (urgent) el.style.animation = 'live-pulse 0.6s ease-in-out infinite';
  else el.style.animation = '';
}
