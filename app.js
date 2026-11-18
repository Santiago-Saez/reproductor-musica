'use strict';
/* Reproductor local: <audio> -> Biquad x5 -> Analyser -> destination.
   Rendimiento: FFT pequeña, buffers reutilizados, throttle a ~30fps,
   DPR capado, degradado automático. El audio nunca depende del canvas. */

const $ = (s) => document.querySelector(s);
const audio = $('#audio');
const canvas = $('#viz');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

const ui = {
  play: $('#btn-play'), prev: $('#btn-prev'), next: $('#btn-next'),
  seek: $('#seek'), tCur: $('#t-cur'), tDur: $('#t-dur'),
  vol: $('#vol'), mute: $('#btn-mute'), repeat: $('#repeat'), shuffle: $('#btn-shuffle'),
  queue: $('#queue'), qCount: $('#q-count'), now: $('#now-playing'),
  preset: $('#preset'), eqSliders: $('#eq-sliders'),
  fps: $('#fps'), state: $('#audio-state'), perfLabel: $('#perf-label'),
};

// ---------- Cola ----------
let queue = []; // {id,file,url,name,duration}
let index = -1;
let nextId = 1;
let seeking = false; // arrastre activo en la barra

function fmt(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  s = Math.floor(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function addFiles(files) {
  let added = 0;
  for (const f of files) {
    if (!/^audio\//.test(f.type) && !/\.(mp3|wav|ogg|m4a|flac|opus|webm)$/i.test(f.name)) continue;
    queue.push({ id: nextId++, file: f, url: URL.createObjectURL(f), name: f.name, duration: NaN });
    added++;
  }
  if (added) { renderQueue(); probeDurations(); if (index === -1) load(0, true); }
}

function probeDurations() {
  // Lee duración sin reproducir, liberando el objeto temporal.
  for (const t of queue) {
    if (!isNaN(t.duration)) continue;
    const a = new Audio();
    a.preload = 'metadata';
    a.src = t.url;
    a.onloadedmetadata = () => { t.duration = a.duration; renderQueue(); };
  }
}

function renderQueue() {
  ui.queue.innerHTML = '';
  queue.forEach((t, i) => {
    const li = document.createElement('li');
    if (i === index) li.className = 'current';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `${i + 1}. ${t.name}`;
    const dur = document.createElement('span');
    dur.className = 'dur';
    dur.textContent = isNaN(t.duration) ? '—' : fmt(t.duration);
    const rm = document.createElement('button');
    rm.className = 'rm'; rm.textContent = '✕'; rm.title = 'Quitar';
    rm.onclick = (e) => { e.stopPropagation(); removeAt(i); };
    li.append(name, dur, rm);
    li.onclick = () => load(i, true);
    li.ondblclick = () => load(i, true);
    ui.queue.appendChild(li);
  });
  ui.qCount.textContent = `(${queue.length})`;
}

function removeAt(i) {
  const [t] = queue.splice(i, 1);
  if (t && t.url) URL.revokeObjectURL(t.url);
  if (i === index) {
    if (!queue.length) { index = -1; audio.removeAttribute('src'); audio.load(); ui.now.textContent = 'Sin pista — añade ficheros'; }
    else load(Math.min(i, queue.length - 1), true);
  } else if (i < index) index--;
  renderQueue();
}

function load(i, autoplay) {
  if (!queue.length) return;
  index = ((i % queue.length) + queue.length) % queue.length;
  const t = queue[index];
  const wasSeeking = seeking;
  audio.src = t.url;
  audio.currentTime = 0;
  ui.now.textContent = `♪ ${t.name}`;
  ui.seek.value = 0;
  renderQueue();
  ensureGraph();
  if (autoplay && !wasSeeking) play();
}

// ---------- Motor de audio: EQ + Analyser ----------
let actx = null, srcNode = null, analyser = null, eqNodes = [];
const BANDS = [
  { f: 60,    type: 'lowshelf',  label: '60Hz' },
  { f: 250,   type: 'peaking',   label: '250Hz' },
  { f: 1000,  type: 'peaking',   label: '1kHz' },
  { f: 4000,  type: 'peaking',   label: '4kHz' },
  { f: 12000, type: 'highshelf', label: '12kHz' },
];
const PRESETS = {
  flat:      [0, 0, 0, 0, 0],
  rock:      [5, 3, -1, 3, 5],
  pop:       [-1, 2, 4, 2, -1],
  jazz:      [3, 2, 0, 2, 3],
  classical: [4, 2, -1, 2, 4],
  bass:      [7, 4, 1, 0, -2],
  treble:    [-2, 0, 1, 4, 7],
};
let gains = [...PRESETS.flat];

function ensureGraph() {
  if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
  actx = new (window.AudioContext || window.webkitAudioContext)();
  srcNode = actx.createMediaElementSource(audio);
  let head = srcNode;
  eqNodes = BANDS.map((b) => {
    const f = actx.createBiquadFilter();
    f.type = b.type; f.frequency.value = b.f; f.Q.value = 1; f.gain.value = 0;
    head.connect(f); head = f;
    return f;
  });
  analyser = actx.createAnalyser();
  analyser.fftSize = 1024;              // pequeño = barato; sobra para 64-96 barras
  analyser.smoothingTimeConstant = 0.8;
  analyser.minDecibels = -85; analyser.maxDecibels = -25;
  head.connect(analyser);
  analyser.connect(actx.destination);
  ui.state.textContent = `motor ${actx.sampleRate / 1000}kHz`;
  applyGains();
}

function applyGains() {
  if (!eqNodes.length) return;
  const t = actx.currentTime;
  eqNodes.forEach((n, i) => n.gain.setTargetAtTime(gains[i], t, 0.03));
}

// ---------- EQ UI ----------
function buildEQ() {
  BANDS.forEach((b, i) => {
    const d = document.createElement('div');
    d.className = 'eq-band';
    d.innerHTML = `<b>${b.label}</b><input type="range" min="-12" max="12" step="1" value="0" aria-label="${b.label}"><span>0 dB</span>`;
    const slider = d.querySelector('input');
    const val = d.querySelector('span');
    slider.oninput = () => { gains[i] = +slider.value; val.textContent = `${slider.value} dB`; ui.preset.value = 'custom'; ensureGraph(); applyGains(); };
    d._set = (g) => { slider.value = g; val.textContent = `${g} dB`; };
    ui.eqSliders.appendChild(d);
  });
}
function setPreset(name) {
  gains = [...(PRESETS[name] || PRESETS.flat)];
  [...ui.eqSliders.children].forEach((d, i) => d._set(gains[i]));
  ensureGraph(); applyGains();
}

// ---------- Transporte ----------
async function play() { ensureGraph(); try { await audio.play(); } catch { /* autoplay bloqueado */ } ui.play.textContent = '⏸'; }
function pause() { audio.pause(); ui.play.textContent = '▶'; }
function step(d) { if (queue[index]) { const t = queue[index]; t.duration = audio.duration || t.duration; renderQueue(); } d < 0 ? prev() : next(); }
function prev() { if (audio.currentTime > 3) audio.currentTime = 0; else load(index - 1, true); }
function next(manual = true) {
  if (!queue.length) return;
  if (ui.repeat.value === 'one' && !manual) { audio.currentTime = 0; play(); return; }
  const doShuffle = ui.shuffle.classList.contains('on');
  if (manual || ui.repeat.value !== 'none') {
    load(doShuffle ? Math.floor(Math.random() * queue.length) : index + 1, true);
  } else if (index === queue.length - 1) pause();
  else load(index + 1, true);
}

ui.play.onclick = () => (audio.paused ? play() : pause());
ui.next.onclick = () => next(true);
ui.prev.onclick = prev;
audio.onended = () => next(false);
audio.onplay = () => { ui.play.textContent = '⏸'; vizStart(); };
audio.onpause = () => { ui.play.textContent = '▶'; };
ui.shuffle.onclick = () => ui.shuffle.classList.toggle('on');
audio.onloadedmetadata = () => { ui.tDur.textContent = fmt(audio.duration); };

// Volumen / mute
ui.vol.oninput = () => { audio.volume = +ui.vol.value; audio.muted = false; };
ui.mute.onclick = () => { audio.muted = !audio.muted; ui.mute.textContent = audio.muted ? 'Unmute' : 'Mute'; };

// ---------- Barra de progreso: buscar arrastrando, también en pausa ----------
// input range: 'input' busca en directo (funciona en pausa con <audio>).
// 'seeking' evita que timeupdate luche con el dedo del usuario.
ui.seek.addEventListener('pointerdown', () => { seeking = true; });
addEventListener('pointerup', () => { seeking = false; });
ui.seek.addEventListener('input', () => {
  if (!isFinite(audio.duration)) return;
  ensureGraph();
  audio.currentTime = (+ui.seek.value / 1000) * audio.duration;
  ui.tCur.textContent = fmt(audio.currentTime);
});
audio.addEventListener('timeupdate', () => {
  if (!seeking && isFinite(audio.duration) && audio.duration > 0) {
    ui.seek.value = Math.round((audio.currentTime / audio.duration) * 1000);
    ui.tCur.textContent = fmt(audio.currentTime);
    ui.tDur.textContent = fmt(audio.duration);
  }
});

// ---------- Ficheros: input + arrastrar ----------
$('#file-input').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
const dz = $('#dropzone'), overlay = $('#drop-overlay');
let dragDepth = 0;
addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; overlay.hidden = false; dz.classList.add('dragover'); } });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; overlay.hidden = true; dz.classList.remove('dragover'); } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; overlay.hidden = true; dz.classList.remove('dragover');
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});
$('#btn-clear').onclick = () => { queue.forEach((t) => URL.revokeObjectURL(t.url)); queue = []; index = -1; audio.pause(); audio.removeAttribute('src'); audio.load(); ui.now.textContent = 'Sin pista — añade ficheros'; renderQueue(); };

// ---------- Visualizador ----------
let vizMode = 'bars';
let rafId = 0, lastDraw = 0, fpsAcc = 0, fpsN = 0, fpsT = 0;
let freq = null, time = null;         // buffers reutilizados, cero allocs en el bucle
let perfMode = 'auto';                // auto | full | eco
let ecoLevel = 0;                     // 0 = normal, 1 = degradado (portátil lento)
let slowFrames = 0;
let grad = null;

document.querySelectorAll('.seg button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.seg button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    vizMode = b.dataset.mode;
    vizStart();
  };
});

function sizeCanvas() {
  const dpr = Math.min(devicePixelRatio || 1, perfMode === 'eco' || ecoLevel ? 1 : 1.5);
  const scale = (perfMode === 'eco' || ecoLevel) ? 0.5 : 1; // degradado: mitad de píxeles
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr * scale));
  const h = Math.max(1, Math.floor(180 * dpr * scale));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; grad = null; }
}
new ResizeObserver(sizeCanvas).observe(canvas);

function vizStart() {
  sizeCanvas();
  cancelAnimationFrame(rafId);
  if (vizMode === 'off') { paintIdle('visualizador off — pulsa B u O'); return; }
  if (!freq) { freq = new Uint8Array(analyser ? analyser.frequencyBinCount : 512); time = new Uint8Array(1024); }
  lastDraw = 0;
  rafId = requestAnimationFrame(draw);
}

function paintIdle(msg) {
  sizeCanvas();
  ctx.fillStyle = '#0a0d12'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#5b6575'; ctx.font = `${Math.max(12, canvas.height * 0.09)}px system-ui`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(msg, canvas.width / 2, canvas.height / 2);
}

function draw(now) {
  rafId = requestAnimationFrame(draw);
  if (document.hidden) return;                       // pestaña oculta: no quemar CPU
  const interval = (perfMode === 'eco' || ecoLevel) ? 66 : 33; // 15fps eco / 30fps normal
  if (now - lastDraw < interval) return;
  const cost0 = performance.now();
  lastDraw = now;

  if (!analyser) { paintIdle('añade audio y pulsa play'); return; }
  sizeCanvas();
  const W = canvas.width, H = canvas.height;

  if (!grad) {
    grad = ctx.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, '#1d7a4f'); grad.addColorStop(0.6, '#4cc38a'); grad.addColorStop(1, '#b8f5d6');
  }

  if (vizMode === 'bars') {
    analyser.getByteFrequencyData(freq);
    // ~72 barras log-ish: promedia bins, ignora agudos vacíos (> 2/3 del espectro).
    const N = perfMode === 'eco' || ecoLevel ? 48 : 72;
    const usable = Math.floor(freq.length * 0.66);
    const bw = W / N;
    ctx.fillStyle = '#0a0d12'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = grad;
    for (let i = 0; i < N; i++) {
      const a = Math.floor(Math.pow(i / N, 1.6) * usable);
      const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / N, 1.6) * usable));
      let s = 0; for (let k = a; k < b; k++) s += freq[k];
      const v = s / (b - a) / 255;
      const h = Math.max(2, v * H);
      ctx.fillRect(i * bw + 1, H - h, bw - 2, h);
    }
  } else {
    analyser.getByteTimeDomainData(time);
    ctx.fillStyle = '#0a0d12'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#4cc38a'; ctx.lineWidth = Math.max(1, H / 90);
    ctx.beginPath();
    const stepX = W / time.length;
    for (let i = 0; i < time.length; i++) {
      const y = ((time[i] - 128) / 128) * (H * 0.45) + H / 2;
      i ? ctx.lineTo(i * stepX, y) : ctx.moveTo(0, y);
    }
    ctx.stroke();
  }

  // Contabilidad rendimiento: fps + degradado automático.
  const cost = performance.now() - cost0;
  if (cost > 12) { if (++slowFrames > 30 && !ecoLevel && perfMode === 'auto') { ecoLevel = 1; freq = time = null; } }
  else slowFrames = Math.max(0, slowFrames - 1);
  fpsAcc += now - fpsT; fpsT = now; fpsN++;
  if (fpsN >= 15) { ui.fps.textContent = `${Math.round(1000 / (fpsAcc / fpsN))} fps`; fpsAcc = 0; fpsN = 0; }
}

$('#btn-perf').onclick = () => {
  perfMode = perfMode === 'auto' ? 'eco' : perfMode === 'eco' ? 'full' : 'auto';
  ecoLevel = 0; slowFrames = 0;
  ui.perfLabel.textContent = perfMode === 'auto' ? 'Auto' : perfMode === 'eco' ? 'Eco' : 'Full';
  vizStart();
};
document.addEventListener('visibilitychange', () => { if (!document.hidden) vizStart(); });

// Tono de prueba (para ver el visualizador sin ficheros)
$('#btn-tone').onclick = async () => {
  ensureGraph();
  const o = actx.createOscillator(), g = actx.createGain();
  o.frequency.value = 220; g.gain.value = 0.15;
  o.connect(g); g.connect(actx.destination);
  o.start(); o.stop(actx.currentTime + 2);
  vizStart();
};

// ---------- Atajos ----------
addEventListener('keydown', (e) => {
  if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
  const k = e.key;
  if (k === ' ') { e.preventDefault(); audio.paused ? play() : pause(); }
  else if (k === 'ArrowRight') audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (e.shiftKey ? 10 : 5));
  else if (k === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - (e.shiftKey ? 10 : 5));
  else if (k === 'ArrowUp') { e.preventDefault(); ui.vol.value = Math.min(1, +ui.vol.value + 0.05); ui.vol.oninput(); }
  else if (k === 'ArrowDown') { e.preventDefault(); ui.vol.value = Math.max(0, +ui.vol.value - 0.05); ui.vol.oninput(); }
  else if (k === 'n' || k === 'N') next(true);
  else if (k === 'p' || k === 'P') prev();
  else if (k === 'm' || k === 'M') ui.mute.onclick();
  else if (k === 'b' || k === 'B') document.querySelector('[data-mode="bars"]').click();
  else if (k === 'o' || k === 'O') document.querySelector('[data-mode="off"]').click();
  else if (k === 'v' || k === 'V') document.querySelector('[data-mode="wave"]').click();
  else if (k === 'Delete' && index >= 0) removeAt(index);
});

// ---------- init ----------
buildEQ();
ui.preset.onchange = () => setPreset(ui.preset.value);
$('#btn-flat').onclick = () => { ui.preset.value = 'flat'; setPreset('flat'); };
renderQueue();
paintIdle('añade audio y pulsa play');
