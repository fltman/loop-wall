// Livejammet (?jam): kameran delas i sex zoner från vänster till höger, en per
// instrument (trummor, bas, ackord, melodi, slagverk, arpeggio). I varje zon följs
// en person, och den personen styr zonens instrument live med samma tre rattar som
// i grundflödet (och pennan i sekvensern). Alla spelar samtidigt; inget spelas in.

import { makeChain } from './chain.js';
import { bodyFrame } from './dance.js';
import { COLOR, Flow, INSTRUMENTS, KNOB_NAMES, NAME, PEN, PULSE, TONAL, defaultSeq, penWrite, seqIndex } from './flow.js';
import { knobsOf } from './knobs.js';
import { puppetPose } from './puppet.js';

export const ZONES = INSTRUMENTS.length;
export const zoneOf = (cx, aspect, n = ZONES) => Math.min(n - 1, Math.max(0, Math.floor((cx / aspect) * n)));

// Dockorna byter dans var sjätte takt (stamp, bölj, pump, gung), i olika fas, så att
// alla rör båda armarna emellanåt.
const PUPPET_PHASE = [0, 7.3, 14.1, 21.7, 3.9, 11.2]; // sekunder in i dansernas cykel

// Människor och dockor: en människa styr dockan i zonen där den står, och byter
// instrument genom att byta plats. Zoner utan människa spelas av sin docka; en zon
// en människa just lämnat får tillbaka dockan efter en kort stund (holdFor sekunder),
// så att en tappad bildruta inte släpper in dockan. Ger en lista per zon.
export function crowdFrame(people, aspect, t, zones, humanUntil, bpm, holdFor = 0.8) {
  const humans = people.map((lm) => Object.assign(lm.slice(), { human: true }));
  const mine = assignPoses(humans, aspect, zones);
  return mine.map((list, i) => {
    if (list.length) { humanUntil[i] = t + holdFor; return list; }
    if (t < (humanUntil[i] ?? -Infinity)) return [];
    return [puppetPose(t + PUPPET_PHASE[i], { bpm, aspect, x: (i + 0.5) / ZONES, size: 0.55 })];
  });
}
const posOf = (lm, f) => lm.zoneX ?? f.cx; // var personen står i zonindelningen

// Fördela personerna: varje person hör till en enda zon. Först paras zoner och
// personer ihop globalt, närmaste par först: den som redan spelar i en zon får
// glida en kvarts zon över gränsen utan att byta (en zon vars spelare har gått får
// bara ta någon som står i den egna zonen). Sedan får övriga den zon de står i,
// närmast kameran först. Ger en lista per zon (0 eller 1 kropp).
export function assignPoses(poses, aspect, zones, slack = 0.25) {
  const out = zones.map(() => []);
  const frames = poses.map((lm) => bodyFrame(lm));
  const pairs = [];
  zones.forEach((z, i) => {
    if (z.cx == null) return;
    frames.forEach((f, j) => {
      if (!f) return;
      const x = posOf(poses[j], f);
      const d = Math.abs(x - z.cx) / f.scale;
      const u = (x / aspect) * zones.length;
      const inside = z.lostSince == null ? u > i - slack && u < i + 1 + slack : zoneOf(x, aspect, zones.length) === i;
      if (d < 1 && inside) pairs.push({ i, j, d });
    });
  });
  pairs.sort((a, b) => a.d - b.d);
  const taken = new Set();
  for (const { i, j } of pairs) {
    if (out[i].length || taken.has(j)) continue;
    out[i].push(poses[j]);
    taken.add(j);
  }
  frames.map((f, j) => ({ f, j })).filter(({ f, j }) => f && !taken.has(j)).sort((a, b) => b.f.scale - a.f.scale).forEach(({ f, j }) => {
    const i = zoneOf(posOf(poses[j], f), aspect, zones.length);
    if (!out[i].length) { out[i].push(poses[j]); taken.add(j); }
  });
  return out;
}

// En zon: sin egen kedja (personen i zonen, utjämning) och sitt eget instrument.
export function makeZone(cfg, i) {
  // Zonens kedja får bara zonens egen person (assignPoses), så gränserna avgörs där.
  const zcfg = { ...cfg, presence: { ...cfg.presence, xMin: 0, xMax: 1, minScale: 0.03 } };
  const inst = INSTRUMENTS[i];
  return {
    i, inst, chain: makeChain(zcfg), present: false, seenSince: null, lostSince: null,
    live: { a: 0, b: 0, c: 0 }, body: null, cx: null, human: false,
    seq: defaultSeq(inst), template: defaultSeq(inst), emptySince: 0,
  };
}

// En bild för en zon: följ personen, uppdatera rattarna. Ren logik (testbar).
export function updateZone(z, poses, aspect, t, dt, cfg) {
  const r = z.chain.update(poses, aspect, t);
  if (r) {
    const human = !!poses[0]?.human;
    if (human && !z.human) { z.seq = defaultSeq(z.inst); z.template = defaultSeq(z.inst); } // en människa tar över: grundmönstret
    z.human = human;
    z.lostSince = null;
    z.seenSince ??= t;
    if (!z.present && t - z.seenSince >= 0.4) {
      z.present = true;
      if (t - z.emptySince > 10) z.seq = defaultSeq(z.inst); // länge tom: börja om med grundmönstret
      // Pennan flyttar alltid från grundmönstret, så att sekvensen inte kryper uppåt
      // en oktav för varje ny spelare. Det förra spelas tills pennan går över det.
      z.template = defaultSeq(z.inst);
    }
    const k = knobsOf(r.quick, r.wrists);
    const a = 1 - Math.exp(-dt / 0.06);
    for (const key of ['a', 'b', 'c']) z.live[key] += (k[key] - z.live[key]) * a;
    z.body = r.body;
    z.cx = poses[0].zoneX ?? r.cx; // zonpositionen (för en flyttad människa: den lediga zonens)
  } else {
    z.seenSince = null; // kroppen står kvar i bild tills zonen räknas som tom
    z.lostSince ??= t;
    if (!z.present) z.cx = null;
    if (z.present && t - z.lostSince >= cfg.presence.leave) {
      Object.assign(z, { present: false, emptySince: t, body: null, cx: null });
      z.chain.reset();
    }
  }
  return z;
}

export function startJam({ cfg, engine, visuals, app, puppets = true }) {
  const zones = Array.from({ length: ZONES }, (_, i) => makeZone(cfg, i));
  const humanUntil = []; // zon → tills när den hålls åt en människa som just lämnat
  const flow = new Flow(engine);
  flow.start();
  let lastT = null;
  app.jam = {
    zones, flow,
    clear: () => zones.forEach((z) => { z.seq = defaultSeq(z.inst); z.template = defaultSeq(z.inst); }),
  };

  flow.source = (inst, k) => {
    const z = zones[INSTRUMENTS.indexOf(inst)];
    if (z.present) {
      if (TONAL.includes(inst)) penWrite(inst, z.seq, k, z.live.b, z.template);
      return { ...z.live, seq: z.seq };
    }
    // Står ingen i trumzonen går kick-pulsen, så att alla har en takt att spela till.
    return inst === 'drums' ? PULSE : null;
  };
  setInterval(() => flow.tick(), 25);

  function onFrame(poses, aspect, t) {
    app.stats.poseFrames++;
    const dt = lastT == null ? 1 / 30 : Math.min(0.2, Math.max(0.001, t - lastT));
    lastT = t;
    // Zonen är där man står; zoner utan människa spelas av sin docka (?nopuppets: inga dockor).
    const people = poses.concat(app.jamExtra ?? []); // jamExtra: för tester
    const mine = puppets ? crowdFrame(people, aspect, t, zones, humanUntil, cfg.bpm)
      : assignPoses(people.map((lm) => Object.assign(lm.slice(), { human: true })), aspect, zones);
    zones.forEach((z, i) => updateZone(z, mine[i], aspect, t, dt, cfg));
    app.debugPose = { raw: null, aspect, all: poses };
  }

  function frame() {
    const now = engine.now();
    const k = Math.floor(engine.beatAt(now) * cfg.stepsPerBeat);
    engine.takeDue(now);
    visuals.drawJam({
      now, beat: engine.beatAt(now),
      zones: zones.map((z) => ({
        inst: z.inst, color: COLOR[z.inst], present: z.present, body: z.body, live: z.live, human: z.human,
        seq: z.present && TONAL.includes(z.inst) ? { inst: z.inst, steps: z.seq, play: seqIndex(z.inst, k), writing: z.live.b > PEN, color: COLOR[z.inst] } : null,
      })),
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  app.jamDebug = (bar10) => [
    `livejam · ${app.source?.delegate ?? '–'} · pose ${app.source?.fps?.toFixed?.(0) ?? '–'} fps · ${zones.filter((z) => z.present).length} av 6 spelar`,
    puppets ? `${zones.filter((z) => z.human).length} människor · ${zones.filter((z) => z.present && !z.human).length} dockor` : 'utan dockor', '',
    ...zones.map((z) => `${NAME[z.inst].padEnd(9)}${z.present && !z.human ? '(docka) ' : ''} ${z.present ? `${KNOB_NAMES[z.inst][0]} ${bar10(z.live.a)}  ${KNOB_NAMES[z.inst][1]} ${bar10(z.live.b)}  ${KNOB_NAMES[z.inst][2]} ${bar10(z.live.c)}` : '(tom)'}`),
  ].join('\n');
  app.jamFeed = onFrame; // för tester: mata in "kamerans" personer
  return onFrame;
}
