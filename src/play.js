// Prototypen av solfjädern: bara live, ingen looper. ?inst=drums eller ?inst=melody.
//
// Kameran → kedjan (src/chain.js) → instrumentet runt axlarna → ljud direkt.
// När någon kliver in spelar instrumentet sig självt en gång, nerifrån och upp,
// så att man hör att lågt är lågt innan man har gjort något.

import { makeChain } from './chain.js';
import { COLOR } from './music.js';

export function startPlay({ cfg, engine, visuals, params, app }) {
  const name = params.get('inst') === 'melody' ? 'melody' : 'drums';
  const color = name === 'melody' ? COLOR.melody : COLOR.drums;
  const chain = makeChain(cfg, name);
  const inst = chain.inst;
  const flashes = new Map(); // föremål → när det spelades
  let seenSince = null, lostSince = null, present = false, demo = [];
  app.play = { name, inst, flashes, hits: 0, demo: 0 };

  const sound = (obj, vel, time) => {
    engine.playNotes(engine.live, [{ ...obj.note, role: name, vel, dur: 2, tone: name === 'drums' ? 1 : 0.6 }], time, 'live', name);
    flashes.set(obj.id, { t: time, vel });
  };

  // Självpresentationen: varje föremål en gång, nerifrån och upp, båda sidor samtidigt, en åttondel isär.
  const presentSelf = () => {
    const start = engine.now() + 0.15;
    const eighth = 30 / cfg.bpm;
    demo = inst.layout.filter((o) => o.side === 'R').sort((a, b) => a.rank - b.rank).flatMap((o, i) =>
      inst.layout.filter((x) => x.rank === o.rank).map((x) => ({ obj: x, time: start + i * eighth })));
    for (const d of demo) sound(d.obj, 0.3, d.time); // båda sidor samtidigt: halv styrka var
    app.play.demo++;
  };

  function onFrame(poses, aspect, tPerf) {
    app.stats.poseFrames++;
    const t = tPerf;
    const r = chain.update(poses, aspect, t);
    if (!r) {
      app.live = null;
      seenSince = null;
      lostSince ??= t;
      if (present && t - lostSince > cfg.presence.leave) { present = false; chain.reset(); }
      return;
    }
    lostSince = null;
    app.live = { body: r.body, cx: r.cx, aspect, features: null };
    seenSince ??= t;
    if (!present && t - seenSince > cfg.presence.enter) { present = true; presentSelf(); }
    for (const h of r.hits) {
      sound(h.obj, h.vel, engine.now() + 0.005);
      app.play.hits++;
    }
  }

  function frame() {
    const now = engine.now();
    engine.takeDue(now); // blommor ritas vid föremålen i stället
    visuals.draw({
      now, beat: engine.beatAt(now), ghosts: [], live: app.live, liveActive: false, style: null,
      phase: 'play', countBar: 0, takeStart: 0, takeMax: 32, restBars: 0, due: [],
      instrument: app.live ? { layout: inst.layout, flashes, color } : null,
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return onFrame;
}
