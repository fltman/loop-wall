import test from 'node:test';
import assert from 'node:assert/strict';
import { Instrument, LAYOUTS, armOf, placeOf } from '../src/instrument.js';

// En kropp i egna mått där armarna pekar i vinkeln theta (0 = ner, 180 = upp) och
// handen når r torsolängder från axeln. Raka armar.
function body(thetaL, thetaR, rL = 1.1, rR = 1.1) {
  const pts = new Float32Array(66);
  const set = (i, x, y) => { pts[2 * i] = x; pts[2 * i + 1] = y; };
  set(0, 0, -1.12); set(11, -0.42, -0.5); set(12, 0.42, -0.5); set(23, -0.26, 0.5); set(24, 0.26, 0.5);
  for (const [side, th, r, sh, el, wr, out] of [['L', thetaL, rL, 11, 13, 15, -1], ['R', thetaR, rR, 12, 14, 16, 1]]) {
    const a = (th * Math.PI) / 180, dx = out * Math.sin(a), dy = Math.cos(a);
    const sx = pts[2 * sh], sy = pts[2 * sh + 1];
    const w = r - 0.2; // handen sitter 0,2 förbi handleden
    set(wr, sx + dx * w, sy + dy * w);
    set(el, sx + dx * w * 0.5, sy + dy * w * 0.5);
  }
  return { pts, vis: new Uint8Array(33).fill(1) };
}

// Kör en rörelse: theta(t) för båda armarna, 30 bilder/s.
function play(name, path, seconds, fps = 30) {
  const inst = new Instrument(name);
  const hits = [];
  for (let i = 0; i <= seconds * fps; i++) {
    const t = i / fps;
    const [l, r, rl, rr] = path(t);
    for (const h of inst.update(body(l, r, rl, rr), t)) hits.push({ t, ...h });
  }
  return hits;
}

const still = 20; // armen hänger nästan rakt ner

test('kroppsmodellen: armens vinkel och räckvidd mäts rätt', () => {
  const a = armOf(body(90, 180), 'L'), b = armOf(body(90, 180), 'R');
  assert.ok(Math.abs(a.theta - 90) < 0.5 && Math.abs(b.theta - 180) < 0.5);
  assert.ok(Math.abs(a.r - 1.1) < 0.01);
});

test('harpa: ett svep från sidan upp över huvudet ger exakt fem toner, i ordning', () => {
  const hits = play('melody', (t) => [still, still + Math.min(1, t / 0.6) * 160], 1.2);
  assert.deepEqual(hits.map((h) => `${h.obj.side}${h.obj.note.deg}`), ['R0', 'R1', 'R2', 'R3', 'R4']);
});

test('harpa: båda händerna, var sin röst', () => {
  const hits = play('melody', (t) => [still + Math.min(1, t / 0.6) * 160, still + Math.min(1, t / 0.6) * 160], 1.2);
  assert.equal(hits.filter((h) => h.obj.side === 'L').length, 5);
  assert.equal(hits.filter((h) => h.obj.side === 'R').length, 5);
});

test('harpa: armen rakt upp och lite förbi, fram och tillbaka, ger inga falska toner', () => {
  const hits = play('melody', (t) => [178 + 6 * Math.sin(t * 8), 178 + 6 * Math.sin(t * 8)], 3);
  assert.equal(hits.length, 0);
});

test('harpa: darr vid en sträng ger inget ljud', () => {
  const s = LAYOUTS.melody[4].theta; // en sträng i mitten
  const hits = play('melody', (t) => [still, s + 3 * Math.sin(t * 40)], 3);
  assert.equal(hits.length, 0);
});

test('harpa och trummor: armar som pendlar som när man går ger inget ljud', () => {
  const swing = (t) => [still + 12 * Math.sin(t * 6), still - 12 * Math.sin(t * 6)];
  assert.equal(play('melody', swing, 4).length, 0);
  assert.equal(play('drums', swing, 4).length, 0);
});

test('harpa och trummor: ett hopp i spårningen ger inget ljud', () => {
  const jump = (t) => [still, t < 1 ? still : 175];
  assert.equal(play('melody', jump, 2).length, 0);
  assert.equal(play('drums', jump, 2).length, 0);
});

test('harpa: att röra sig sakta genom strängarna låter inte', () => {
  const hits = play('melody', (t) => [still, still + t * 20], 7); // 20°/s
  assert.equal(hits.length, 0);
});

test('trummor: slå ut i hihatplattan ger ett slag; ligger handen kvar blir det inga fler', () => {
  const pad = LAYOUTS.drums.find((o) => o.side === 'R' && o.note.voice === 'hat');
  // Handen börjar nära kroppen (r 0,4) och slår ut till plattan, ligger kvar och darrar.
  const hits = play('drums', (t) => [still, pad.theta, 1.1, t < 0.5 ? 0.4 : t < 0.65 ? 0.4 + ((t - 0.5) / 0.15) * 0.6 : 1.0 + 0.03 * Math.sin(t * 30)], 2);
  assert.deepEqual(hits.map((h) => h.obj.note.voice), ['hat']);
  assert.ok(hits[0].vel > 0.6, 'snabbt slag låter starkt');
});

test('trummor: ut och in igen ger två slag', () => {
  const pad = LAYOUTS.drums.find((o) => o.side === 'L' && o.note.voice === 'snare');
  const r = (t) => (Math.floor(t / 0.4) % 2 ? 1.0 : 0.45);
  const hits = play('drums', (t) => [pad.theta, still, r(t), 1.1], 1.55);
  assert.equal(hits.length, 2);
});

test('trummor: plattorna sitter där de ska', () => {
  const b = body(still, still);
  const kick = placeOf(b, LAYOUTS.drums.find((o) => o.id === 'R0'));
  const hat = placeOf(b, LAYOUTS.drums.find((o) => o.id === 'R2'));
  assert.ok(kick.y > hat.y, 'kicken sitter lägre än hihaten');
  assert.ok(hat.y < -1.0, 'hihaten bredvid huvudet');
});

// Risk 1 från designunderlaget: att sänka armarna för att sluta. Det här testet
// mäter, det fäller inte: siffran rapporteras.
test('risk 1: armar som sänks från rakt ut till vila (mäts)', () => {
  const lower = (t) => { const th = 90 - Math.min(1, t / 0.5) * 75; return [th, th]; };
  const harp = play('melody', lower, 1.5).length, drums = play('drums', lower, 1.5).length;
  console.log(`    sänkta armar: harpa ${harp} toner, trummor ${drums} slag`);
  assert.ok(true);
});
