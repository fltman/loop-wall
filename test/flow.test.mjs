import test from 'node:test';
import assert from 'node:assert/strict';
import { makeConfig } from '../src/config.js';
import { knobOf } from '../src/knobs.js';
import { ARP, arpNote, drumHits, percHits } from '../src/flow.js';
import { FlowPerformer } from '../src/flowperformer.js';

test('armen är ratten: hängande = 0, rakt ut = halvvägs, rakt upp = 1', () => {
  assert.equal(knobOf(10), 0);
  assert.ok(Math.abs(knobOf(95) - 0.5) < 0.01);
  assert.equal(knobOf(180), 1);
});

test('trummornas energi lägger till lager: nere bara kick, uppe tätt', () => {
  const bar = (e) => Array.from({ length: 16 }, (_, b) => drumHits(b, e)).flat().map((h) => h[0]);
  assert.deepEqual([...new Set(bar(0))], ['kick']);
  assert.ok(bar(0.5).includes('hat') && bar(0.5).includes('clap'));
  assert.ok(bar(1).length > bar(0.5).length && bar(0.5).length > bar(0).length);
  assert.ok(Array.from({ length: 16 }, (_, b) => percHits(b, 1)).flat().length > Array.from({ length: 16 }, (_, b) => percHits(b, 0)).flat().length);
});

test('arpeggiots oktavratt: nere en oktav, uppe tre', () => {
  const range = (b) => { const ns = Array.from({ length: 24 }, (_, k) => arpNote(k, b)); return Math.max(...ns) - Math.min(...ns); };
  assert.ok(range(0) < 12 && range(1) >= 24);
  assert.equal(arpNote(0, 0), ARP[0]);
});

// Kör flödesperformern med en hand som vrider rattarna efter en plan, 30 bilder/s.
function run(plan, seconds, cfg = makeConfig(''), p = new FlowPerformer(cfg), t0 = 0) {
  const events = [];
  for (let i = 0; i <= seconds * 30; i++) {
    const t = t0 + i / 30, beat = (t * cfg.bpm) / 60;
    const k = plan(t);
    for (const e of p.update({ t, beat, seen: k !== null, knobs: k, body: k ? { pts: new Float32Array(66), vis: new Uint8Array(33) } : null })) events.push({ ...e, t, beat });
  }
  return { p, events };
}
const bar = 60 / 112 * 4; // sekunder per takt

test('flödet: instrumentet svarar direkt, inspelningen börjar på taktslaget efter att en arm lyfts', () => {
  const { events } = run((t) => ({ a: t > 2 ? 0.7 : 0.02, b: 0.02, c: 0.1 }), 6);
  const phases = events.filter((e) => e.type === 'phase').map((e) => e.phase);
  assert.deepEqual(phases.slice(0, 3), ['ready', 'armed', 'rec']);
  const rec = events.find((e) => e.phase === 'rec');
  assert.ok(Math.abs(rec.beat - Math.round(rec.beat / 4) * 4) < 0.1, 'på ett taktslag');
});

test('flödet: sänkta armar avslutar, längden avrundas uppåt, och sänkningen spelas inte in', () => {
  // Lyft vid 1 s, håll ratten på 0,8 i ca 3 takter, sänk sedan till vila.
  const lvl = (t, x) => (t < 1 ? 0 : t < 1 + 3.4 * bar ? x : t < 1.3 + 3.4 * bar ? x / 2 : 0);
  const { p, events } = run((t) => ({ a: lvl(t, 0.8), b: lvl(t, 0.5), c: lvl(t, 0.3) }), 16);
  const layer = p.layers[0];
  assert.ok(layer, JSON.stringify(events.map((e) => e.type)));
  assert.equal(layer.instrument, 'drums', 'första lagret: trummor');
  assert.equal(layer.loopBeats, 16, 'tre takter blir fyra');
  assert.ok(layer.auto.every((k) => k.a > 0.7), `rattens läge behålls: min ${Math.min(...layer.auto.map((k) => k.a)).toFixed(2)}`);
});

test('flödet: sex lager i ordning ger finalen, sedan börjar det om', () => {
  const cfg = makeConfig('');
  const p = new FlowPerformer(cfg);
  let t0 = 0;
  const events = [];
  const visit = (seconds) => {
    events.push(...run((t) => (t - t0 < seconds ? { a: (t - t0) < 1 ? 0 : (t - t0) < 1 + 2 * bar ? 0.7 : 0, b: 0.3, c: 0 } : null), seconds + 3, cfg, p, t0).events);
    t0 += seconds + 3;
  };
  for (let i = 0; i < 6; i++) visit(12);
  assert.deepEqual(p.layers.map((l) => l.instrument), ['drums', 'bass', 'chords', 'melody', 'perc', 'arp']);
  assert.equal(p.phase, 'show');
  assert.equal(events.filter((e) => e.type === 'finale').length, 1);
  visit(12); // under finalen spelas inget in
  assert.equal(p.layers.length, 6);
  assert.equal(p.reset().length, 6);
  assert.equal(p.layers.length, 0);
  visit(12); // efter omstarten: trummor igen
  assert.equal(p.layers[0]?.instrument, 'drums');
});

test('flödet: den som aldrig lyfter armarna spelar inte in något', () => {
  const { p, events } = run(() => ({ a: 0.05, b: 0.05, c: 0.1 }), 10);
  assert.equal(p.layers.length, 0);
  assert.ok(!events.some((e) => e.phase === 'rec'));
});

// Ratten lyfts vid taktslag `startBar`-ish, hålls på `v` i `bars` takter från inspelningens
// start, och sänks sedan på `drop` sekunder till vila.
function hold(barsHeld, v, drop, cfg = makeConfig('')) {
  const p = new FlowPerformer(cfg);
  // Lyft vid 1 s → inspelningen börjar på nästa taktslag (slag 4 vid 112 BPM = 2,14 s).
  const start = 4 * 60 / 112;
  const end = start + barsHeld * bar;
  const level = (t) => (t < 1 ? 0 : t < end ? v : t < end + drop ? v * (1 - (t - end) / drop) : 0);
  return run((t) => ({ a: level(t), b: level(t) * 0.5, c: level(t) * 0.3 }), barsHeld * 2.2 + 8, cfg, p);
}

test('granskning: exakt fyra takter blir fyra, inte åtta', () => {
  const { p } = hold(4, 0.8, 0.4);
  assert.equal(p.layers[0]?.loopBeats, 16);
});

test('granskning: en lugn sänkning (1,5 s) spelas inte in', () => {
  const { p } = hold(2, 0.9, 1.5);
  const l = p.layers[0];
  assert.ok(l, 'ett lager');
  assert.ok(Math.min(...l.auto.map((k) => k.a)) > 0.8, `lägsta ${Math.min(...l.auto.map((k) => k.a)).toFixed(2)}`);
});

test('granskning: sänkning nära maxlängden spelas inte in', () => {
  const { p } = hold(7.6, 0.8, 0.5);
  const l = p.layers[0];
  assert.equal(l?.loopBeats, 32);
  assert.ok(l.auto.slice(-12).every((k) => k.a > 0.7), `svansen ${l.auto.slice(-12).map((k) => k.a.toFixed(1))}`);
});

test('granskning: ett kort trevande lyft kastas och man kan börja om direkt', () => {
  const { p, events } = run((t) => ({ a: t > 1 && t < 1.2 ? 0.3 : 0, b: 0, c: 0 }), 10);
  assert.equal(p.layers.length, 0);
  const afterDiscard = events.slice(events.findIndex((e) => e.type === 'discard'));
  assert.equal(afterDiscard.find((e) => e.type === 'phase')?.phase, 'ready', 'tillbaka till ready, ingen vila');
});

import { CHORDS, PEN, defaultSeq, penShift, penValue, penWrite, seqIndex } from '../src/flow.js';

test('sekvensern: pennan flyttar tonen på steget som spelas, högre arm ger högre ton', () => {
  const tpl = defaultSeq('melody'), seq = defaultSeq('melody');
  assert.equal(penWrite('melody', seq, 0, 0.1, tpl), false, 'arm nere skriver inte');
  assert.equal(penWrite('melody', seq, 0, 0.95, tpl), true);
  assert.ok(seq[0] > tpl[0], 'högre');
  penWrite('melody', seq, 0, 0.2, tpl);
  assert.ok(seq[0] < tpl[0], 'lägre');
  const pent = [0, 3, 5, 7, 10];
  for (let b = PEN + 0.01; b <= 1; b += 0.05) assert.ok(pent.includes((penValue('melody', b, 74) - 62 + 120) % 12), 'alltid i skalan');
  assert.equal(penWrite('melody', seq, 1, 0.9, tpl), false, 'en paus förblir paus');
});

test('sekvensern: armen stilla rakt ut ändrar inget, stilla högre transponerar och behåller kurvan', () => {
  assert.equal(penShift(0.15 + 0.85 * (4 / 9)), 0, 'rakt ut: ingen ändring');
  const tpl = defaultSeq('melody'), seq = defaultSeq('melody');
  for (let k = 0; k < 32; k++) penWrite('melody', seq, k, 0.85, tpl);
  const notes = (s) => s.filter((x) => x != null);
  assert.ok(notes(seq).every((n, i) => n > notes(tpl)[i] || notes(tpl)[i] >= 86), 'allt uppåt');
  assert.ok(new Set(notes(seq)).size > 3, 'fortfarande en melodi, inte en enda ton');
});

test('sekvensern: basen behåller accenter och glid, ackorden väljs per stöt', () => {
  const bass = defaultSeq('bass');
  penWrite('bass', bass, 0, 0.8, defaultSeq('bass'));
  assert.equal(bass[0].a, 1, 'accenten finns kvar');
  assert.ok(bass[0].n > 0, 'och tonen flyttades upp');
  const chords = defaultSeq('chords');
  penWrite('chords', chords, 6, 0.99);
  assert.equal(chords[seqIndex('chords', 6)], CHORDS.length - 1);
  assert.equal(penWrite('chords', chords, 5, 0.99), false, 'inget ackordsteg på 5');
});

test('sekvensern: lagret behåller den skrivna sekvensen', () => {
  const cfg = makeConfig('');
  const p = new FlowPerformer(cfg);
  // Första lagret: trummor (ingen sekvens).
  run((t) => (t < 9 ? { a: t > 1 && t < 6 ? 0.6 : 0, b: 0, c: 0 } : null), 12, cfg, p);
  // Andra: basen. Skriv i sekvensen under tagningen och spara.
  const t0 = 12;
  run((t) => {
    const k = Math.floor(((t * cfg.bpm) / 60) * 4);
    if (p.seq && t - t0 > 1 && t - t0 < 5) penWrite('bass', p.seq, k, 0.9, p.template);
    return t - t0 < 9 ? { a: t - t0 > 1 && t - t0 < 6 ? 0.6 : 0, b: t - t0 > 1 && t - t0 < 6 ? 0.9 : 0, c: 0 } : null;
  }, 12, cfg, p, t0);
  const bass = p.layers.find((l) => l.instrument === 'bass');
  assert.ok(bass?.seq, 'baslagret har en sekvens');
  assert.ok(bass.seq.some((s, i) => s && s.n !== p.layers.find((l) => l.instrument === 'bass') && s.n > (defaultSeq('bass')[i]?.n ?? 99)), 'med de flyttade tonerna');
});

import { arpSpread, voxHits } from '../src/flow.js';
import { knobsOf, spreadOf } from '../src/knobs.js';

function handsBody(dist) {
  const pts = new Float32Array(66);
  pts[2 * 11] = -0.42; pts[2 * 11 + 1] = -0.5; pts[2 * 12] = 0.42; pts[2 * 12 + 1] = -0.5;
  pts[2 * 13] = -0.5; pts[2 * 13 + 1] = 0; pts[2 * 14] = 0.5; pts[2 * 14 + 1] = 0;
  pts[2 * 15] = -dist / 2; pts[2 * 15 + 1] = 0.4; pts[2 * 16] = dist / 2; pts[2 * 16 + 1] = 0.4;
  return { pts, vis: new Uint8Array(33).fill(1) };
}

test('tredje ratten: händernas avstånd, hängande armar = 0, isär = 1', () => {
  assert.equal(spreadOf(handsBody(0.85)), 0, 'armarna hänger');
  assert.ok(spreadOf(handsBody(2.9)) > 0.95, 'armarna utsträckta');
  assert.ok('a' in knobsOf(handsBody(1)) && 'b' in knobsOf(handsBody(1)) && 'c' in knobsOf(handsBody(1)));
});

test('tredje ratten per instrument: röststötar och oktaver växer med avståndet', () => {
  assert.equal(Array.from({ length: 16 }, (_, b) => voxHits(b, 0.05)).filter(Boolean).length, 0);
  assert.ok(Array.from({ length: 16 }, (_, b) => voxHits(b, 0.9)).filter(Boolean).length > Array.from({ length: 16 }, (_, b) => voxHits(b, 0.3)).filter(Boolean).length);
  const span = (c) => Math.max(...[0, 1, 2, 3].map((k) => arpSpread(k, c)));
  assert.deepEqual([span(0.1), span(0.5), span(0.9)], [0, 12, 24]);
});

test('den som bara drar isär händerna spelar också in ett lager', () => {
  const lvl = (t) => (t > 1 && t < 1 + 2.5 * bar ? 0.7 : 0);
  const { p } = run((t) => ({ a: 0, b: 0, c: lvl(t) }), 14);
  assert.equal(p.layers[0]?.instrument, 'drums');
  assert.ok(p.layers[0].auto.some((k) => k.c > 0.5), 'tredje ratten finns i lagret');
});

// En kropp med raka armar i vinkeln th (0 = rakt ner) från axlarna, i egna mått.
function armsBody(thL, thR) {
  const pts = new Float32Array(66);
  const set = (i, x, y) => { pts[2 * i] = x; pts[2 * i + 1] = y; };
  set(11, -0.42, -0.5); set(12, 0.42, -0.5);
  for (const [th, sh, el, wr, out] of [[thL, 11, 13, 15, -1], [thR, 12, 14, 16, 1]]) {
    const a = (th * Math.PI) / 180, dx = out * Math.sin(a), dy = Math.cos(a);
    set(el, pts[2 * sh] + dx * 0.55, pts[2 * sh + 1] + dy * 0.55);
    set(wr, pts[2 * sh] + dx * 0.95, pts[2 * sh + 1] + dy * 0.95);
  }
  return { pts, vis: new Uint8Array(33).fill(1) };
}

test('granskning: står man still med armarna hängande eller lätt isär (0–15°) spelas inget in', () => {
  for (const th of [0, 8, 10, 15]) {
    const k = knobsOf(armsBody(th, th));
    const { p } = run(() => k, 20);
    assert.equal(p.layers.length, 0, `${th}°: ${JSON.stringify(k)}`);
  }
});

test('granskning: lyft till 90°, sänk till en lätt öppen vila (10°), och tagningen slutar', () => {
  const up = knobsOf(armsBody(90, 90)), rest = knobsOf(armsBody(10, 10));
  const { p } = run((t) => (t > 1 && t < 1 + 2 * bar ? up : rest), 14);
  assert.equal(p.layers.length, 1);
  assert.equal(p.layers[0].loopBeats, 8, 'två takter, inte åtta');
});

test('granskning: en handled utanför bild fryser inte avståndsratten', () => {
  const k = knobsOf(armsBody(90, 90), { L: false, R: true });
  assert.equal(k.c, 0);
  assert.ok(k.a > 0.4, 'armens ratt följer armbågen');
});
