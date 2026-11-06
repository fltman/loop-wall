// Kopplar ihop kamera, kroppsmått, performer, ljud och bild.
//
//   ?puppet           en docka dansar i stället för kameran (=visit: går in och ut, =upper: benen syns inte)
//   ?debug            mått, roller och kamerabild i hörnet (tangent d)
//   ?autostart        starta utan klick (kiosk: Chrome med --autoplay-policy=no-user-gesture-required)
//   ?bpm= ?bars= ?rest= ?latency= ?model=full
//
// Tangenter för den som sköter väggen: d = debug, f = helskärm, c = töm väggen.

import { makeConfig } from './config.js';
import { BodyFiller, DanceMeter, PoseSmoother, bodyFrame, pickPerformer, plausible, poseAt } from './dance.js';
import { Performer } from './performer.js';
import { Engine } from './audio.js';
import { Visuals } from './visuals.js';
import { NAME, degreeOf, zoneOf } from './music.js';
import { puppetSource } from './puppet.js';

const params = new URLSearchParams(location.search);
const cfg = makeConfig(location.search);
const engine = new Engine(cfg);
const meter = new DanceMeter(cfg);
const filler = new BodyFiller();
const smoother = new PoseSmoother();
const performer = new Performer(cfg);
const visuals = new Visuals(document.getElementById('wall'), document.getElementById('count'));
const debugEl = document.getElementById('debug');
const startEl = document.getElementById('start');

const app = (window.__loopwall = {
  cfg, engine, performer, meter, visuals,
  errors: [], log: [], source: null, live: null,
  stats: { poseFrames: 0, seenFrames: 0, commits: 0, discards: 0 },
});
addEventListener('error', (e) => app.errors.push(String(e.message || e)));
addEventListener('unhandledrejection', (e) => app.errors.push(String(e.reason?.message || e.reason)));

let prev = null;
let debug = params.has('debug');
const visualEvents = [];

function onFrame(poses, aspect, tPerf) {
  app.stats.poseFrames++;
  const t = engine.now();
  const beat = engine.beatAt(t);
  const pick = pickPerformer(poses, aspect, cfg, prev);
  let features = null, body = null;
  if (pick) {
    prev = pick.frame;
    // Först bort med det en kropp inte kan, sedan mått och bild från det som är kvar.
    const lm = plausible(pick.lm, aspect);
    const frame = bodyFrame(lm) ?? pick.frame;
    features = meter.update(lm, frame, tPerf);
    // Bilden (och spökena) från utjämnade punkter; måtten ovan från de råa.
    const slm = smoother.filter(lm, tPerf, frame.scale);
    const sf = smoother.frame(slm, tPerf) ?? frame;
    body = filler.fill(slm, sf);
    const hidden = lm.reduce((n, p, i) => n + (pick.lm[i]?.v > 0.5 && !(p.v > 0.5) ? 1 : 0), 0);
    app.live = { body, cx: sf.cx, aspect, features, hidden };
    app.stats.seenFrames++;
  } else {
    prev = null;
    meter.lose();
    app.live = null;
  }
  // Ljudet direkt (lagret ska in i schemat innan dess första slag), bilden i nästa ruta.
  for (const a of performer.update({ t, beat, seen: !!pick, features, body, accents: features?.accents ?? [] })) {
    if (a.type === 'accent') { engine.playLive(a.notes, a.k, performer.style.instrument); app.lastAccent = { t, source: a.source }; continue; }
    if (a.type === 'commit') { engine.addLayer(a.layer); app.stats.commits++; }
    if (a.type === 'remove') engine.removeLayer(a.id);
    if (a.type === 'discard') app.stats.discards++;
    if (a.type === 'phase' && a.phase === 'away') { filler.reset(); smoother.reset(); } // nästa person börjar från vila
    if (a.type !== 'phase') app.log.push({ t: +t.toFixed(2), type: a.type, role: a.layer?.role ?? a.role, reason: a.reason });
    visualEvents.push(a);
  }
}

function schedule() {
  const beat = engine.beatAt(engine.now());
  engine.duck(performer.present && (performer.phase === 'count' || performer.phase === 'rec'));
  engine.tick(performer.layers);
  const B = cfg.beatsPerBar;
  if (performer.present && ['wait', 'rest', 'count'].includes(performer.phase) && beat >= performer.countBar * B - 0.5) {
    engine.countIn(performer.countBar);
  }
}

const mod1 = (x) => ((x % 1) + 1) % 1;

function frame() {
  const now = engine.now();
  const beat = engine.beatAt(now);
  for (const a of visualEvents.splice(0)) {
    if (a.type === 'commit') visuals.born(a.layer);
    if (a.type === 'remove') visuals.gone(a.slot, a.role);
  }
  const ghosts = performer.layers.map((layer, rank) => ({
    layer, rank, body: poseAt(layer.frames, mod1((beat - layer.startBeat) / layer.loopBeats)),
  }));
  visuals.draw({
    now, beat, ghosts,
    live: app.live,
    liveActive: performer.liveActive(beat),
    style: performer.style,
    phase: performer.present ? performer.phase : 'away',
    countBar: performer.countBar,
    takeStart: performer.take?.startBeat ?? 0,
    takeMax: performer.take?.maxBeats ?? 32,
    restBars: Math.min(cfg.restBars, (performer.layers.at(-1)?.loopBeats ?? 16) / cfg.beatsPerBar),
    due: engine.takeDue(now),
  });
  if (debug) drawDebug(beat);
  requestAnimationFrame(frame);
}

const bar10 = (x) => '█'.repeat(Math.round(x * 10)).padEnd(10, '·');

function drawDebug(beat) {
  const f = app.live?.features;
  const src = app.source;
  const lines = [
    `loop wall · ${cfg.bpm} BPM · ${src?.delegate ?? '–'} · pose ${src?.fps?.toFixed?.(0) ?? '–'} fps · känslighet ×${meter.gain.toFixed(1)}`,
    `fas ${performer.present ? performer.phase : 'away'} · takt ${(beat / cfg.beatsPerBar).toFixed(1)} · nästa lager: ${NAME[performer.nextStyle().instrument]}${performer.style ? ` · du spelar: ${NAME[performer.style.instrument]}` : ''}${performer.take ? ` · takt ${Math.floor((beat - performer.take.startBeat) / cfg.beatsPerBar) + 1} av högst ${performer.take.maxBeats / cfg.beatsPerBar}` : ''}`,
    '',
  ];
  if (f) {
    const NOTE = ['D', 'F', 'G', 'A', 'C'];
    const OCT = { bass: 2, chords: 3, melody: 4, arp: 4 };
    const ZONE = { drums: ['kick', 'virvel', 'hihat'], perc: ['tom', 'klapp', 'shaker'] };
    const inst = performer.style?.instrument;
    const what = (h) => {
      if (!inst) return '';
      if (ZONE[inst]) return ZONE[inst][zoneOf(h)];
      const d = degreeOf(inst, h);
      return `${NOTE[d % 5]}${OCT[inst] + Math.floor(d / 5)}`;
    };
    lines.push(`vänster hand   ${bar10(f.hL)}  ${what(f.hL)}`);
    lines.push(`höger hand     ${bar10(f.hR)}  ${what(f.hR)}`);
    lines.push(`avstånd        ${bar10(f.spread)}  ${f.spread < 0.3 ? 'litet, tyst' : f.spread > 0.7 ? 'stort, starkt' : 'mellan'}`);
    const la = app.lastAccent;
    const ago = la ? engine.now() - la.t : Infinity;
    lines.push(`senaste slag   ${ago < 2 ? `${{ L: 'vänster hand', R: 'höger hand', B: 'fot/studs' }[la.source]} för ${ago.toFixed(1)} s sedan` : '–'}`);
    lines.push(`spelar         ${inst ? NAME[inst] : '–'}`);
    lines.push(`orimligt ${app.live.hidden ? `${app.live.hidden} punkter bortsållade` : '–'}`);
  } else {
    lines.push('(ingen i ringen)');
  }
  lines.push('', ...performer.layers.map((l) => `${l.id}. ${NAME[l.role]} (${l.loopBeats / cfg.beatsPerBar} takter)`));
  const recent = app.log.slice(-4).map((e) => `${e.t.toFixed(1)}s ${e.type}${e.role ? ' ' + e.role : ''}${e.reason ? ' (' + e.reason + ')' : ''}`);
  if (recent.length) lines.push('', ...recent);
  debugEl.textContent = lines.join('\n');
}

async function drawPlayDebug() {
  const { armOf } = await import('./instrument.js');
  const b = app.live?.body;
  const lines = [`solfjädern · ${app.play.name} · ${app.source?.delegate ?? '–'} · pose ${app.source?.fps?.toFixed?.(0) ?? '–'} fps · ${app.play.hits} ljud`, ''];
  if (b) for (const side of ['L', 'R']) {
    const a = armOf(b, side);
    lines.push(`${side === 'L' ? 'vänster' : 'höger  '} arm  vinkel ${a.theta.toFixed(0).padStart(4)}°  räckvidd ${a.r.toFixed(2)}`);
  } else lines.push('(ingen i ringen)');
  debugEl.textContent = lines.join('\n');
}

// Debug: kamerabilden i ett hörn med modellens punkter. Gröna godtas, röda sållades
// bort som orimliga, grå hör till andra personer i bild.
const camdbg = document.getElementById('camdbg');
function drawCamDebug() {
  const g = camdbg.getContext('2d');
  g.clearRect(0, 0, camdbg.width, camdbg.height);
  const d = app.debugPose;
  if (!d) return;
  const P = (p) => [(p.x / d.aspect) * camdbg.width, p.y * camdbg.height];
  const dot = (p, c, r = 3) => { const [x, y] = P(p); g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  for (const lm of d.all ?? []) if (lm !== d.raw) for (const p of lm) if ((p.v ?? 1) > 0.5) dot(p, 'rgba(160,160,160,.6)', 2);
  if (!d.raw) return;
  const bones = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
  g.strokeStyle = 'rgba(120,255,160,.7)'; g.lineWidth = 1.5;
  for (const [a, b] of bones) {
    const pa = d.clean[a], pb = d.clean[b];
    if ((pa.v ?? 1) > 0.5 && (pb.v ?? 1) > 0.5) { g.beginPath(); g.moveTo(...P(pa)); g.lineTo(...P(pb)); g.stroke(); }
  }
  d.raw.forEach((p, i) => {
    if (!((p.v ?? 1) > 0.5)) return;
    dot(p, (d.clean[i].v ?? 1) > 0.5 ? '#6f6' : '#f44', i === 15 || i === 16 ? 4 : 3);
  });
}
setInterval(() => { if (debug && camdbg.style.display === 'block') drawCamDebug(); }, 33);

function setDebug(on) {
  debug = on;
  debugEl.style.display = on ? 'block' : 'none';
  if (app.source?.video) {
    app.source.video.className = on ? 'cam' : 'under';
    // Förhandsbilden får kamerans format, så att inget skärs bort.
    const h = Math.round(360 / (app.source.aspect || 16 / 9));
    if (on) { app.source.video.style.height = `${h}px`; camdbg.style.height = `${h}px`; camdbg.height = h; }
    else app.source.video.style.height = '';
  }
  camdbg.style.display = on && app.source?.video ? 'block' : 'none';
}

addEventListener('keydown', (e) => {
  if (e.key === 'd') setDebug(!debug);
  if (e.key === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  if (e.key === 'c') { if (app.jam) app.jam.clear(); else if (app.flow) app.flow.clear(); else for (const id of performer.clear()) engine.removeLayer(id); }
});

let started = false;
async function start() {
  if (started) return;
  started = true;
  startEl.textContent = 'startar …';
  try {
    await engine.start();
    // ?inst=drums|melody: prototypen av solfjädern, bara live, ingen looper.
    let handle = onFrame;
    const jam = params.has('jam');
    if (jam) {
      // Dockorna spelar alla zoner ingen människa har (?nopuppets: bara människor).
      const { startJam } = await import('./jam.js');
      handle = startJam({ cfg, engine, visuals, app, puppets: !params.has('nopuppets') });
    } else if (params.has('flow')) {
      const { startFlow } = await import('./knobs.js');
      handle = startFlow({ cfg, engine, visuals, app });
    } else if (params.has('inst')) {
      const { startPlay } = await import('./play.js');
      handle = startPlay({ cfg, engine, visuals, params, app });
    }
    if (params.has('puppet') && !jam) {
      const mode = params.get('puppet');
      app.source = puppetSource({ cfg, onFrame: handle, visit: mode === 'visit' ? [8, 3] : null, upper: mode === 'upper', crowd: params.has('jam') ? Number(params.get('crowd') || 6) : 0 });
    } else {
      const { cameraSource } = await import('./pose.js');
      try {
        app.source = await cameraSource({ model: params.get('model') || 'lite', onFrame: handle, wide: params.get('cam') === '43', device: params.get('camera'), poses: jam ? 6 : 3 });
      } catch (e) {
        // Livejam utan kamera: dockorna dansar ändå.
        if (!jam) throw e;
        app.errors.push(`kameran: ${e.message}`);
        const t0 = performance.now();
        setInterval(() => handle([], 16 / 9, (performance.now() - t0) / 1000), 1000 / 30);
        app.source = { aspect: 16 / 9, delegate: 'dockor (ingen kamera)', fps: 30 };
      }
      // Väggen visar bara gubben, aldrig kamerabilden. Videon måste ändå ligga
      // på sidan för att ge nya bildrutor, så den ligger under den ogenomskinliga duken.
      if (app.source.video) {
        app.source.video.className = 'under';
        document.body.prepend(app.source.video);
      }
    }
    startEl.remove();
    setDebug(debug);
    if (app.jam) {
      debugEl.classList.add('jam'); // nere till vänster: sekvenserna ligger i toppen
      setInterval(() => { if (debug) debugEl.textContent = app.jamDebug(bar10); }, 100);
    } else if (app.flow) {
      setInterval(() => { if (debug) debugEl.textContent = app.flowDebug(bar10); }, 100);
    } else if (app.play) {
      setInterval(() => debug && drawPlayDebug(), 100);
    } else {
      setInterval(schedule, 25);
      requestAnimationFrame(frame);
    }
    app.ready = true;
  } catch (e) {
    app.errors.push(String(e?.message || e));
    startEl.textContent = `kunde inte starta: ${e?.message || e}`;
    started = false;
  }
}

startEl.addEventListener('click', start);
if (params.has('autostart')) start();
