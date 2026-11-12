/*
 * Draft Day: Player art
 * ---------------------
 * The cartoon cricketer drawn for each player (the same name always gives the same picture).
 */

// ── CRICKET PLAYER SVG GENERATOR ────────────────────────────────────────────
function hashName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function generatePlayerSVG(name) {
  const h = hashName(name);
  const pick = arr => arr[h % arr.length];
  const pick2 = (arr, seed) => arr[seed % arr.length];

  // Skin tones
  const skins = ['#FDBCB4', '#F1C27D', '#E0AC69', '#C68642', '#8D5524', '#5C3317'];
  const skin = pick(skins);

  // Kit colours — unique combos
  const kits = [
    { shirt: '#1a3a8f', pant: '#ffffff', trim: '#f5b800' },
    { shirt: '#8f1a1a', pant: '#f0f0f0', trim: '#00c8ff' },
    { shirt: '#1a7a1a', pant: '#fffde0', trim: '#ff6030' },
    { shirt: '#7a1a7a', pant: '#e8e8ff', trim: '#00e87a' },
    { shirt: '#0d2a40', pant: '#d0e8ff', trim: '#ff4050' },
    { shirt: '#403010', pant: '#f5e8c0', trim: '#00c8ff' },
    { shirt: '#1a4a3a', pant: '#ffffff', trim: '#f5b800' },
    { shirt: '#2a2a6a', pant: '#ffeedd', trim: '#00e87a' },
  ];
  const kit = pick(kits);

  // Helmet colours
  const helmets = ['#cc2200', '#003399', '#006622', '#552200', '#444444', '#880066', '#1a5a7a'];
  const helmetCol = pick2(helmets, Math.floor(h / kits.length));

  // Stances: 0=cover drive, 1=pull shot, 2=defensive, 3=sweep
  const stance = h % 4;

  // Glove colour
  const gloveCol = '#f0f0e0';

  // Bat colour
  const batCol = '#d4a84b';
  const batHandle = '#4a2a0a';

  // Build SVG based on stance

  // Common elements generator
  const head = (cx, cy, r) => `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 1.05}" fill="${skin}"/>`;
  const helmet = (cx, cy, r, col) => `
    <ellipse cx="${cx}" cy="${cy - r * 0.3}" rx="${r * 1.15}" ry="${r * 0.8}" fill="${col}"/>
    <rect x="${cx - r * 1.15}" y="${cy - r * 0.3}" width="${r * 2.3}" height="${r * 0.55}" rx="3" fill="${col}"/>
    <rect x="${cx - r * 0.9}" y="${cy + r * 0.25}" width="${r * 1.8}" height="${r * 0.22}" rx="2" fill="${col}" opacity="0.8"/>
    <line x1="${cx - r}" y1="${cy + r * 0.18}" x2="${cx + r}" y2="${cy + r * 0.18}" stroke="#ffffff22" stroke-width="1"/>`;
  const face = (cx, cy, r) => `
    <ellipse cx="${cx - r * 0.28}" cy="${cy + r * 0.1}" rx="1.5" ry="1.8" fill="#00000033"/>
    <ellipse cx="${cx + r * 0.28}" cy="${cy + r * 0.1}" rx="1.5" ry="1.8" fill="#00000033"/>
    <path d="M${cx - r * 0.2} ${cy + r * 0.45} q${r * 0.2} ${r * 0.2} ${r * 0.4} 0" stroke="#00000055" stroke-width="1.2" fill="none"/>`;

  let svg = '';

  if (stance === 0) {
    // Cover drive — leaning forward, bat extended right
    svg = `
      <g transform="translate(5,4)">
        ${helmet(50, 28, 14, helmetCol)}
        ${head(50, 32, 13)}
        ${face(50, 32, 13)}
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
  } else if (stance === 1) {
    // Pull shot — upright, bat raised high left
    svg = `
      <g transform="translate(5,4)">
        ${helmet(52, 24, 14, helmetCol)}
        ${head(52, 28, 13)}
        ${face(52, 28, 13)}
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
  } else if (stance === 2) {
    // Defensive — crouched, bat straight down
    svg = `
      <g transform="translate(5,8)">
        ${helmet(50, 20, 13, helmetCol)}
        ${head(50, 24, 12)}
        ${face(50, 24, 12)}
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
    svg = `
      <g transform="translate(5,6)">
        ${helmet(54, 22, 13, helmetCol)}
        ${head(54, 26, 12)}
        ${face(54, 26, 12)}
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
