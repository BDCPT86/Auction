/*
 * Draft Day: Sound
 * ----------------
 * The spin jingle and the sold sting, and where they play (laptop, projector or off).
 */

// ── AUDIO ───────────────────────────────────────────────────────────────────
let audioCtx = null,
  jingleNodes = [];

// Sound: 'on' (this laptop), 'projector' (only from the projector window, e.g. on the venue's
// speakers) or 'off'. Remembered on this device; S cycles it.
const SOUND_KEY = 'draftday.sound.v1';
let soundMode = (() => {
  try {
    return localStorage.getItem(SOUND_KEY) || 'on';
  } catch (e) {
    return 'on';
  }
})();
const SOUND_LABEL = { on: 'Sound on', projector: 'Sound on the projector only', off: 'Sound off' };
function setSound(mode) {
  soundMode = SOUND_LABEL[mode] ? mode : 'on';
  try {
    localStorage.setItem(SOUND_KEY, soundMode);
  } catch (e) {}
  if (soundMode === 'off') stopJingle();
  renderSoundBtn();
}
function cycleSound() {
  const next = { on: 'projector', projector: 'off', off: 'on' }[soundMode];
  setSound(next);
  showToast(
    SOUND_LABEL[soundMode] +
      (soundMode === 'projector' && !(typeof _proj !== 'undefined' && _proj && !_proj.closed)
        ? ' (open the projector window to hear it)'
        : ''),
  );
}
function renderSoundBtn() {
  document.querySelectorAll('.sound-btn').forEach(b => {
    b.innerHTML = icon(soundMode === 'off' ? 'mute' : 'sound') + (soundMode === 'projector' ? '<span class="sound-tag">TV</span>' : '');
    b.title = SOUND_LABEL[soundMode] + ' (S to change)';
    b.setAttribute('aria-label', SOUND_LABEL[soundMode]);
    b.classList.toggle('is-off', soundMode === 'off');
  });
}
function getAC() {
  if (soundMode === 'off') return null;
  if (soundMode === 'projector') {
    if (typeof _proj === 'undefined' || !_proj || _proj.closed) return null;
    const W = _proj;
    W._ac = W._ac || new (W.AudioContext || W.webkitAudioContext)();
    if (W._ac.state === 'suspended') W._ac.resume();
    return W._ac;
  }
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function stopJingle() {
  jingleNodes.forEach(n => {
    try {
      n.stop();
    } catch (e) {}
  });
  jingleNodes = [];
}

function playSpinJingle(duration) {
  stopJingle();
  const ac = getAC();
  if (!ac) return;
  const now = ac.currentTime;

  const master = ac.createGain();
  master.gain.setValueAtTime(0.28, now);
  master.connect(ac.destination);

  // Upbeat repeating carnival-style arpeggio
  // C major pentatonic: C4 E4 G4 A4 C5
  const notes = [261.63, 329.63, 392.0, 440.0, 523.25];
  const step = 0.13; // seconds per note
  const totalNotes = Math.floor(duration / 1000 / step);

  for (let i = 0; i < totalNotes; i++) {
    const freq = notes[i % notes.length];
    const t = now + i * step;

    // Bell-like tone: sine + triangle blend
    ['sine', 'triangle'].forEach((type, ti) => {
      const osc = ac.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq * (ti === 1 ? 2 : 1), t);

      const g = ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(ti === 0 ? 0.9 : 0.3, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + step * 0.85);

      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + step);
      jingleNodes.push(osc);
    });

    // Add a subtle bounce bass note every 5 notes
    if (i % 5 === 0) {
      const bass = ac.createOscillator();
      bass.type = 'sine';
      bass.frequency.setValueAtTime(freq * 0.5, t);
      const bg = ac.createGain();
      bg.gain.setValueAtTime(0, t);
      bg.gain.linearRampToValueAtTime(0.5, t + 0.02);
      bg.gain.exponentialRampToValueAtTime(0.001, t + step * 1.8);
      bass.connect(bg);
      bg.connect(master);
      bass.start(t);
      bass.stop(t + step * 2);
      jingleNodes.push(bass);
    }
  }

  // Speed up slightly as wheel slows (pitch bend up on last 20%)
  // Fade out at very end
  master.gain.setValueAtTime(0.28, now + duration / 1000 - 0.4);
  master.gain.linearRampToValueAtTime(0, now + duration / 1000);
}

function playVictorySting() {
  const ac = getAC();
  if (!ac) return;
  const now = ac.currentTime;
  const master = ac.createGain();
  master.gain.value = 0.4;
  master.connect(ac.destination);
  // Rising fanfare: C4 E4 G4 C5 — staggered
  [
    [261.63, 0],
    [329.63, 0.1],
    [392.0, 0.2],
    [523.25, 0.3],
  ].forEach(([freq, delay]) => {
    const o = ac.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, now + delay);
    g.gain.linearRampToValueAtTime(1.0, now + delay + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.9);
    o.connect(g);
    g.connect(master);
    o.start(now + delay);
    o.stop(now + delay + 1.0);
    // Octave shimmer
    const o2 = ac.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2;
    const g2 = ac.createGain();
    g2.gain.setValueAtTime(0, now + delay);
    g2.gain.linearRampToValueAtTime(0.3, now + delay + 0.02);
    g2.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.7);
    o2.connect(g2);
    g2.connect(master);
    o2.start(now + delay);
    o2.stop(now + delay + 0.8);
  });
}
