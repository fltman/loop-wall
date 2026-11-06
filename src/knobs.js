// Grundflödet (?flow): musiken går hela tiden och armarna är rattar.
//
//   vänster arm → ratt A, höger arm → ratt B, händernas avstånd → ratt C (se KNOB_NAMES i flow.js)
//
// Armens vinkel från axeln är rattens läge: hängande arm = 0, rakt upp = 1. Vad
// rattarna gör beror på instrumentet (se KNOB_NAMES i flow.js), men nere är alltid
// mörkt och glest och uppe ljust och tätt. Varje dansare får nästa instrument;
// rattrörelserna spelas in och loopar som spökets lager.

import { makeChain } from './chain.js';
import { armOf } from './instrument.js';
import { poseAt } from './dance.js';
import { CHORD_NAMES, COLOR, Flow, INSTRUMENTS, KNOB_NAMES, NAME, PEN, PULSE, TONAL, penWrite, seqIndex } from './flow.js';
import { FlowPerformer } from './flowperformer.js';
import { Fx, LOOKS, pickRound } from './fx.js';

export const knobOf = (theta) => Math.min(1, Math.max(0, (theta - 15) / 160));
// Avståndet mellan händerna (handlederna, i torsolängder). Samma dödzon som armarna:
// armar som hänger upp till 15° ut (d ≈ 1,35) ger 0, utsträckta armar (d ≈ 2,9) ger 1.
export const spreadOf = (body) => {
  const p = body.pts;
  const d = Math.hypot(p[30] - p[32], p[31] - p[33]);
  return Math.min(1, Math.max(0, (d - 1.35) / 1.55));
};
// Armens vinkel från armbågen när handleden inte syns (den står annars fryst i bilden).
const elbowTheta = (body, side) => {
  const p = body.pts, sh = side === 'L' ? 11 : 12, el = side === 'L' ? 13 : 14, out = side === 'L' ? -1 : 1;
  let th = (Math.atan2((p[2 * el] - p[2 * sh]) * out, p[2 * el + 1] - p[2 * sh + 1]) * 180) / Math.PI;
  if (th < -90) th += 360;
  return th;
};
// seen: syns handlederna { L, R }. Syns inte en handled följer armens ratt armbågen,
// och avståndsratten går mot noll i stället för att frysa.
export const knobsOf = (body, seen = { L: true, R: true }) => ({
  a: knobOf(seen.L ? armOf(body, 'L').theta : elbowTheta(body, 'L')),
  b: knobOf(seen.R ? armOf(body, 'R').theta : elbowTheta(body, 'R')),
  c: seen.L && seen.R ? spreadOf(body) : 0,
});


const mod1 = (x) => ((x % 1) + 1) % 1;

export function startFlow({ cfg, engine, visuals, app }) {
  const chain = makeChain(cfg);
  const performer = new FlowPerformer(cfg);
  const flow = new Flow(engine);
  flow.start();
  const live = { a: 0, b: 0, c: 0 };
  let lastT = null;
  const visualEvents = [];
  let show = null; // { start, beat, looks } medan finalen pågår
  let round = Number(localStorage.getItem('loopwall.round') || 0); // varje final ser annorlunda ut
  const fxCanvas = document.getElementById('fx');
  let fx = null;
  try { fx = new Fx(fxCanvas); fx.warm(); } catch (e) { app.errors.push(`effekter: ${e.message}`); }
  app.fx = fx;
  app.flow = { flow, performer, live, get show() { return show; }, clear: () => performer.reset() };

  // Vem styr instrumentets rattar just nu: den som dansar, spöket, eller grundpulsen.
  flow.source = (inst, k) => {
    if (performer.live() && inst === performer.instrument) {
      // Höger arm uppe skriver tonen på steget som spelas nu, så den hörs direkt.
      if (TONAL.includes(inst) && penWrite(inst, performer.seq, k, live.b, performer.template)) app.flow.wrote = { k, at: engine.now() };
      return { ...live, seq: performer.seq };
    }
    const layer = performer.layers.find((l) => l.instrument === inst);
    if (layer) return { ...FlowPerformer.knobsAt(layer, k, cfg.stepsPerBeat), seq: layer.seq };
    return inst === 'drums' ? PULSE : null;
  };
  setInterval(() => flow.tick(), 25);

  function onFrame(poses, aspect, t) {
    app.stats.poseFrames++;
    const dt = lastT == null ? 1 / 30 : Math.min(0.2, Math.max(0.001, t - lastT));
    lastT = t;
    const now = engine.now();
    const r = chain.update(poses, aspect, t);
    let knobs = null;
    if (r) {
      knobs = knobsOf(r.quick, r.wrists);
      const a = 1 - Math.exp(-dt / 0.06); // mjukt, så att ett darr inte hörs som knaster
      for (const k of ['a', 'b', 'c']) live[k] += (knobs[k] - live[k]) * a;
      app.live = { body: r.body, cx: r.cx, aspect, features: null };
      app.debugPose = { raw: r.raw, clean: r.clean, aspect, all: poses };
    } else { app.live = null; app.debugPose = { raw: null, aspect, all: poses }; }
    for (const ev of performer.update({ t: now, beat: engine.beatAt(now), seen: !!r, knobs, body: r?.body })) {
      app.log.push({ t: +now.toFixed(2), type: ev.type, role: ev.layer?.instrument ?? ev.instrument, reason: ev.reason });
      visualEvents.push(ev);
      if (ev.type === 'finale') {
        show = { start: now, beat: Math.ceil(engine.beatAt(now) / 4) * 4, looks: pickRound(round).map((i) => LOOKS[i]) };
        localStorage.setItem('loopwall.round', String(++round));
        app.log.push({ t: +now.toFixed(2), type: 'final', role: show.looks.map((l) => l.name).join(', ') });
      }
    }
    if (show) {
      const left = show.start + cfg.showSeconds - now;
      if (left < 8 && !show.fading) { show.fading = true; engine.bus.gain.setTargetAtTime(0, now, 2.2); } // tonar ut
      if (left <= 0) { // börja om
        performer.reset();
        show = null;
        engine.bus.gain.cancelScheduledValues(now);
        engine.bus.gain.setTargetAtTime(0.7, now, 0.4);
      }
    }
  }

  function frame() {
    const now = engine.now();
    const beat = engine.beatAt(now);
    engine.takeDue(now);
    for (const ev of visualEvents.splice(0)) {
      if (ev.type === 'commit') visuals.born({ ...ev.layer, role: ev.layer.instrument });
    }
    const S = cfg.stepsPerBeat;
    const k = Math.floor(beat * S);
    const ghosts = performer.layers.map((layer, rank) => ({
      layer: { ...layer, role: layer.instrument }, rank,
      body: poseAt(layer.frames, mod1((beat - layer.startBeat) / layer.loopBeats)),
      knobs: FlowPerformer.knobsAt(layer, k, S),
    }));
    if (show) {
      // Fyra looks, lika långa, bytet på ett taktslag.
      const elapsed = now - show.start;
      const totalBeats = (cfg.showSeconds * cfg.bpm) / 60;
      const seg = Math.max(4, Math.round(totalBeats / 4 / 4) * 4);
      const idx = Math.min(3, Math.max(0, Math.floor((beat - show.beat) / seg)));
      const look = show.looks[idx];
      const frac = ((beat % 1) + 1) % 1;
      const kick = Math.exp(-frac * 5);
      const left = cfg.showSeconds - elapsed;
      const fade = Math.min(1, Math.max(0, left / 6), elapsed / 1.5);
      const energy = ghosts.reduce((s2, gh) => s2 + (gh.knobs?.a ?? 0), 0) / Math.max(1, ghosts.length);
      app.show = { look: look.name, idx };
      visuals.drawShow({ now, beat, ghosts, layout: look.layout, kick, fade: 1, elapsed });
      if (fx) {
        fxCanvas.style.display = 'block';
        const dt = Math.min(0.1, Math.max(0, now - (show.lastT ?? now)));
        show.lastT = now;
        fx.render(visuals.canvas, look, { kick, beat, bar: Math.floor(beat / 4), phase: ((beat - show.beat) % seg) / seg, energy }, dt, elapsed, fade);
      }
      requestAnimationFrame(frame);
      return;
    }
    fxCanvas.style.display = 'none';
    const p = performer, take = p.take;
    const phase = !p.present ? 'away' : p.phase === 'armed' ? 'count' : p.phase === 'ready' ? 'wait' : p.phase;
    const inst = p.instrument;
    visuals.draw({
      now, beat, ghosts, live: app.live, liveActive: p.live(), style: inst ? { instrument: inst } : null,
      phase, countBar: take ? take.startBeat / 4 - 1 : p.restUntil / 4, takeStart: take?.startBeat ?? 0,
      takeMax: (cfg.fixedBars ?? cfg.maxBars) * cfg.beatsPerBar, restBars: p.restBars || cfg.restBars, due: [],
      knobs: app.live && p.live() && inst ? { color: COLOR[inst], values: live } : null,
      seq: app.live && p.live() && TONAL.includes(inst) && p.seq ? { inst, steps: p.seq, play: seqIndex(inst, k), writing: live.b > PEN, color: COLOR[inst] } : null,
      spread: app.live && p.live() && inst ? { inst, color: COLOR[inst], c: live.c } : null,
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  app.flowDebug = (bar10) => {
    const p = performer, inst = p.instrument;
    const names = inst ? KNOB_NAMES[inst] : ['A', 'B', 'C'];
    return [
      `grundflödet · ${app.source?.delegate ?? '–'} · pose ${app.source?.fps?.toFixed?.(0) ?? '–'} fps · fas ${p.present ? p.phase : 'away'}`,
      `du spelar: ${inst ? NAME[inst] : '–'}${p.take ? ` · takt ${Math.max(0, Math.floor((engine.beatAt(engine.now()) - p.take.startBeat) / 4) + 1)}` : ''}`, '',
      `${names[0].padEnd(8)} (vänster arm)  ${bar10(live.a)} ${live.a.toFixed(2)}`,
      `${names[1].padEnd(8)} (höger arm)    ${bar10(live.b)} ${live.b.toFixed(2)}${TONAL.includes(inst) ? (live.b > PEN ? '  skriver' : '  (arm nere: skriver inte)') : ''}`,
      ...(inst === 'chords' && p.seq ? [`ackorden: ${p.seq.map((i) => CHORD_NAMES[i]).join(' ')}`] : []),
      `${(names[2] ?? 'C').padEnd(8)} (avstånd)      ${bar10(live.c)} ${live.c.toFixed(2)}`, '',
      ...INSTRUMENTS.map((i) => { const l = p.layers.find((x) => x.instrument === i); return `${NAME[i].padEnd(9)} ${l ? `${l.loopBeats / 4} takter` : i === 'drums' ? 'grundpuls' : '–'}`; }),
      '', ...app.log.slice(-3).map((e) => `${e.t.toFixed(1)}s ${e.type} ${e.role ?? ''} ${e.reason ?? ''}`),
      ...(app.source?.info ? ['', `kamera: ${app.source.info.label} · ${app.source.info.width}×${app.source.info.height} · zoom ${app.source.info.zoom}`,
        `kameror: ${app.source.info.cams.join(' · ')}`] : []),
    ].join('\n');
  };
  return onFrame;
}
