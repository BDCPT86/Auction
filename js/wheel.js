/*
 * Draft Day: The wheel
 * --------------------
 * Drawing the wheel of players and spinning it (or the quick shuffle in random-draw mode).
 */

// WHEEL
const canvas = document.getElementById('wheelCanvas');
const ctx = canvas.getContext('2d');
function getWheelSize() {
  return Math.min(560, window.innerWidth - 40);
}
function resizeCanvas() {
  const sz = getWheelSize();
  canvas.width = sz;
  canvas.height = sz;
  const halo = document.getElementById('wheelHalo');
  if (halo) {
    halo.style.width = sz + 20 + 'px';
    halo.style.height = sz + 20 + 'px';
  }
}
resizeCanvas();
window.addEventListener('resize', () => {
  resizeCanvas();
  drawWheel();
});
function getCX() {
  return canvas.width / 2;
}
function getCY() {
  return canvas.height / 2;
}
function getR() {
  return getCX() - 12;
}
const SLICECOLS = [
  '#0e2236',
  '#0e3620',
  '#2a0e3a',
  '#3a2208',
  '#0e1e3a',
  '#3a0e14',
  '#082a3a',
  '#083a18',
  '#220836',
  '#3a1e06',
  '#08163a',
  '#3a0810',
];

function drawWheel(rotation) {
  if (rotation === undefined) rotation = spinAngle;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const active = activePool();
  if (!active.length) {
    ctx.beginPath();
    ctx.arc(getCX(), getCY(), getR(), 0, Math.PI * 2);
    ctx.fillStyle = '#111820';
    ctx.fill();
    ctx.strokeStyle = '#1e2a38';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#5a7080';
    ctx.font = '600 13px Barlow,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      !players.length ? 'Load players to spin' : unsoldQueue().length && auctionPhase === 'main' ? 'Main draw done' : 'All done!',
      getCX(),
      getCY(),
    );
    return;
  }
  const sl = (Math.PI * 2) / active.length;
  active.forEach((p, i) => {
    const s = rotation + i * sl,
      e = s + sl;
    ctx.beginPath();
    ctx.moveTo(getCX(), getCY());
    ctx.arc(getCX(), getCY(), getR(), s, e);
    ctx.closePath();
    ctx.fillStyle = SLICECOLS[i % SLICECOLS.length];
    ctx.fill();
    ctx.strokeStyle = '#060810';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const g = ctx.createRadialGradient(getCX(), getCY(), 0, getCX(), getCY(), getR());
    g.addColorStop(0, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.moveTo(getCX(), getCY());
    ctx.arc(getCX(), getCY(), getR(), s, e);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    if (tierDef(p.tier)) {
      // tier colour on the rim, so the room sees what's coming
      ctx.save();
      ctx.beginPath();
      ctx.arc(getCX(), getCY(), getR() - 4, s + 0.012, e - 0.012);
      ctx.strokeStyle = tierColor(p.tier);
      ctx.lineWidth = 7;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.restore();
    }
    drawSliceLabel(p, s + sl / 2, sl, active.length);
  });
  ctx.beginPath();
  ctx.arc(getCX(), getCY(), getR(), 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,200,255,0.3)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(getCX(), getCY(), 26, 0, Math.PI * 2);
  const cg = ctx.createRadialGradient(getCX() - 5, getCY() - 5, 0, getCX(), getCY(), 26);
  cg.addColorStop(0, '#18202c');
  cg.addColorStop(1, '#0d1218');
  ctx.fillStyle = cg;
  ctx.fill();
  ctx.strokeStyle = '#00c8ff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = '15px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(EV.wheelIcon || '', getCX(), getCY());
}

// Few players: label across the slice. Many: label along the slice (rim → hub),
// sized to the slice's width, kept upright, and the price dropped when it won't fit.
function drawSliceLabel(p, mid, sl, n) {
  const cx = getCX(),
    cy = getCY(),
    R = getR();
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 5;
  ctx.textBaseline = 'middle';
  if (n <= 8) {
    const lr = R * 0.62;
    ctx.translate(cx + Math.cos(mid) * lr, cy + Math.sin(mid) * lr);
    ctx.rotate(mid + Math.PI / 2);
    const fs = n > 6 ? 14 : 16;
    ctx.font = `700 ${fs}px Barlow,sans-serif`;
    ctx.fillStyle = '#dde8f0';
    ctx.textAlign = 'center';
    ctx.fillText(trunc(p.name, Math.min(140, 2 * lr * Math.sin(sl / 2) - 12), ctx), 0, -fs * 0.45);
    ctx.font = `500 ${fs - 2}px Barlow,sans-serif`;
    ctx.fillStyle = '#f5b800';
    ctx.shadowBlur = 0;
    ctx.fillText(zarS(p.price), 0, fs * 0.65);
    ctx.restore();
    return;
  }
  const ro = R - 12,
    ri = 36,
    len = ro - ri - 6;
  const thick = ro * 0.6 * sl; // slice width where the text sits
  const fs = Math.max(8, Math.min(15, Math.floor(thick * 0.55)));
  const two = thick >= fs * 2.5;
  // keep text upright: slices on the left half are flipped
  let a = mid % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  const flip = a > Math.PI / 2 && a < Math.PI * 1.5;
  ctx.translate(cx, cy);
  ctx.rotate(flip ? mid + Math.PI : mid);
  const x = flip ? -ro : ro;
  ctx.textAlign = flip ? 'left' : 'right';
  ctx.font = `700 ${fs}px Barlow,sans-serif`;
  ctx.fillStyle = '#dde8f0';
  if (two) {
    ctx.fillText(trunc(p.name, len, ctx), x, -fs * 0.5);
    ctx.font = `500 ${Math.max(8, fs - 2)}px Barlow,sans-serif`;
    ctx.fillStyle = '#f5b800';
    ctx.shadowBlur = 0;
    ctx.fillText(zarS(p.price), x, fs * 0.62);
  } else {
    ctx.font = `600 ${Math.max(8, fs - 2)}px Barlow,sans-serif`;
    const price = zarS(p.price),
      pw = ctx.measureText(price + '  ').width;
    const withPrice = len - pw >= 60; // only if the name still gets room
    ctx.font = `700 ${fs}px Barlow,sans-serif`;
    const name = trunc(p.name, withPrice ? len - pw : len, ctx);
    if (withPrice) {
      ctx.fillText(name, flip ? x + pw : x - pw, 0); // name sits inside the price, which hugs the rim
      ctx.font = `600 ${Math.max(8, fs - 2)}px Barlow,sans-serif`;
      ctx.fillStyle = '#f5b800';
      ctx.shadowBlur = 0;
      ctx.fillText(price, x, 0);
    } else ctx.fillText(name, x, 0);
  }
  ctx.restore();
}

function trunc(t, mx, c) {
  if (c.measureText(t).width <= mx) return t;
  while (t.length > 1 && c.measureText(t + '…').width > mx) t = t.slice(0, -1);
  return t + '…';
}

const SPIN_MS = { quick: [1500, 2500], normal: [4000, 6000], dramatic: [7000, 9000] };
let _skipSpin = false;
function setSpinButton(spinningNow) {
  const b = document.getElementById('spinBtn');
  b.textContent = spinningNow ? 'SKIP ▶▶' : DRAW_MODES[EV.draw].button;
  if (spinningNow) b.disabled = false;
}
function spinWheel() {
  if (spinning) {
    _skipSpin = true;
    return;
  } // second press skips to the result
  if (EV.draw === 'random') return drawRandom();
  if (EV.draw === 'order') return drawInOrder();
  if (EV.draw === 'manual') return;
  const active = activePool();
  if (!active.length || bidRound.player) return;
  dismissWinner();
  spinning = true;
  projectorTick();
  _skipSpin = false;
  setSpinButton(true);
  canvas.classList.add('spinning');
  document.getElementById('wheelHalo').classList.add('active');
  const [lo, hi] = reduceMotion() ? [600, 800] : SPIN_MS[EV.spin] || SPIN_MS.normal;
  const turns = EV.spin === 'quick' ? 3 : EV.spin === 'dramatic' ? 9 : 5;
  const target = spinAngle + (turns + Math.random() * turns) * Math.PI * 2 + Math.random() * Math.PI * 2;
  const dur = lo + Math.random() * (hi - lo),
    s0 = spinAngle,
    t0 = performance.now();
  playSpinJingle(dur);
  const ease = t => 1 - Math.pow(1 - t, 4);
  (function f(now) {
    const t = _skipSpin ? 1 : Math.min((now - t0) / dur, 1);
    spinAngle = s0 + (target - s0) * ease(t);
    drawWheel(spinAngle);
    if (t < 1) {
      requestAnimationFrame(f);
    } else {
      spinAngle = target % (Math.PI * 2);
      drawWheel(spinAngle);
      spinning = false;
      canvas.classList.remove('spinning');
      document.getElementById('wheelHalo').classList.remove('active');
      setSpinButton(false);
      stopJingle();
      playVictorySting();
      resolveWinner(spinAngle);
    }
  })(t0);
}
