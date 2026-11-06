import test from 'node:test';
import assert from 'node:assert/strict';
import { makeConfig } from '../src/config.js';
import { ZONES, assignPoses, crowdFrame, makeZone, updateZone, zoneOf } from '../src/jam.js';
import { puppetPose } from '../src/puppet.js';

const cfg = makeConfig('');
const A = 16 / 9;

test('livejam: sex zoner från vänster till höger', () => {
  assert.equal(ZONES, 6);
  assert.deepEqual([0.05, 0.25, 0.45, 0.55, 0.75, 0.95].map((u) => zoneOf(u * A, A)), [0, 1, 2, 3, 4, 5]);
});

test('livejam: varje zon följer personen i sin zon, och styr bara sitt eget instrument', () => {
  const zones = Array.from({ length: 6 }, (_, i) => makeZone(cfg, i));
  // Tre personer: i zon 0 (armarna nere), zon 3 (armarna uppe) och zon 5.
  const crowd = (t) => [
    puppetPose(t, { x: 1 / 12, size: 0.55, style: 'stomp' }),
    puppetPose(t, { x: 7 / 12, size: 0.55, style: 'wave' }),
    puppetPose(t, { x: 11 / 12, size: 0.55, style: 'pump' }),
  ];
  for (let i = 0; i < 60; i++) { const mine = assignPoses(crowd(i / 30), A, zones); zones.forEach((z, j) => updateZone(z, mine[j], A, i / 30, 1 / 30, cfg)); }
  assert.deepEqual(zones.map((z) => z.present), [true, false, false, true, false, true]);
  assert.ok(zones[3].live.a > 0.7 && zones[3].live.b > 0.7, 'zon 3 har armarna uppe');
  assert.ok(zones[0].live.a < 0.2, 'zon 0 har armarna nere');
});

test('livejam: den som går ut lämnar zonen tom', () => {
  const z = makeZone(cfg, 2);
  const here = (t) => [puppetPose(t, { x: 5 / 12, size: 0.55, style: 'stomp' })];
  for (let i = 0; i < 30; i++) updateZone(z, here(i / 30), A, i / 30, 1 / 30, cfg);
  assert.ok(z.present);
  for (let i = 30; i < 120; i++) updateZone(z, [], A, i / 30, 1 / 30, cfg);
  assert.equal(z.present, false);
});

test('livejam: en person på gränsen hör bara till en zon, och byter inte när den gungar', () => {
  const zones = Array.from({ length: 6 }, (_, i) => makeZone(cfg, i));
  const owners = new Set();
  for (let i = 0; i < 120; i++) {
    const t = i / 30;
    const x = 0.5 + 0.02 * Math.sin(t * 3); // gungar över gränsen mellan zon 2 och 3
    const mine = assignPoses([puppetPose(t, { x, size: 0.55, style: 'stomp' })], A, zones);
    zones.forEach((z, j) => updateZone(z, mine[j], A, t, 1 / 30, cfg));
    assert.ok(mine.filter((m) => m.length).length <= 1, 'aldrig i två zoner samtidigt');
    zones.forEach((z, j) => { if (z.present) owners.add(j); });
  }
  assert.equal(owners.size, 1, `zoner som haft personen: ${[...owners]}`);
});

import { defaultSeq, penWrite } from '../src/flow.js';

// Flera personer, var och en på x (0..1); dropped: vilka som tappas i bild just den bilden.
function play(zones, xs, frames, dropped = () => []) {
  for (let i = 0; i < frames; i++) {
    const t = (zones.t ?? 0) + i / 30;
    const poses = xs.map((x, k) => (dropped(i).includes(k) ? null : puppetPose(t + k, { x, size: 0.55, style: 'stomp' }))).filter(Boolean);
    const mine = assignPoses(poses, A, zones);
    zones.forEach((z, j) => updateZone(z, mine[j], A, t, 1 / 30, cfg));
  }
  zones.t = (zones.t ?? 0) + frames / 30;
}
const owner = (zones) => zones.map((z) => (z.present ? Math.round((z.cx / A) * 12) : null));

test('granskning: en tappad bildruta byter inte instrument mellan grannar', () => {
  const zones = Array.from({ length: 6 }, (_, i) => makeZone(cfg, i));
  play(zones, [0.31, 0.52], 40); // två grannar nära gränsen mellan zon 1/2 och 2/3
  const before = owner(zones);
  play(zones, [0.31, 0.52], 3, (i) => (i === 1 ? [0] : []));
  play(zones, [0.31, 0.52], 20);
  assert.deepEqual(owner(zones), before);
});

test('granskning: en tömd zon fångar inte en nykomling i grannzonen', () => {
  const zones = Array.from({ length: 6 }, (_, i) => makeZone(cfg, i));
  play(zones, [0.35], 40); // spelar i zon 2, nära vänsterkanten
  play(zones, [], 90); // går
  play(zones, [0.31], 40); // en ny person i zon 1, nära gränsen
  assert.equal(zones[2].present, false);
  assert.equal(zones[1].present, true);
});

test('granskning: sekvensen kryper inte uppåt med varje ny spelare', () => {
  const z = makeZone(cfg, 3); // melodi
  for (let visit = 0; visit < 4; visit++) {
    play([z], [0.6], 30);
    for (let k = 0; k < 32; k++) penWrite('melody', z.seq, k, 0.99, z.template);
    play([z], [], 60);
  }
  const top = Math.max(...z.seq.filter((n) => n != null));
  const once = defaultSeq('melody'); for (let k = 0; k < 32; k++) penWrite('melody', once, k, 0.99, defaultSeq('melody'));
  assert.equal(top, Math.max(...once.filter((n) => n != null)));
  assert.ok(top <= 62 + 36, 'högst tre oktaver över grundtonen');
});

// Ett jam med dockor: humans(t) = människornas kroppar i kamerabilden.
function jam(humans, seconds, state = { zones: Array.from({ length: 6 }, (_, i) => makeZone(cfg, i)), until: [], t: 0 }) {
  for (let i = 0; i < seconds * 30; i++) {
    const t = state.t + i / 30;
    const mine = crowdFrame(humans(t), A, t, state.zones, state.until, 112);
    state.zones.forEach((z, j) => updateZone(z, mine[j], A, t, 1 / 30, cfg));
  }
  state.t += seconds;
  return state;
}
const map = (st) => st.zones.map((z) => (z.human ? 'M' : z.present ? 'd' : '·')).join('');
const at = (x, style = 'wave') => (t) => puppetPose(t, { x, size: 0.5, style });

test('dockor och människor: dockorna spelar alla zoner utan människa', () => {
  let st = jam(() => [], 2);
  assert.equal(map(st), 'dddddd');
  st = jam((t) => [at(0.45)(t)], 2, st);
  assert.equal(map(st), 'ddMddd', 'mitten: mittendockan');
  st = jam((t) => [at(0.45)(t), at(0.92, 'pump')(t)], 2, st);
  assert.equal(map(st), 'ddMddM');
});

test('dockor och människor: man byter instrument genom att byta plats', () => {
  let st = jam((t) => [at(0.1)(t)], 2);
  assert.equal(map(st), 'Mddddd');
  st = jam((t) => [at(0.75)(t)], 3, st); // går till slagverket
  assert.equal(map(st), 'ddddMd', 'trummorna fick tillbaka sin docka');
});

test('dockor och människor: två som byter plats byter instrument', () => {
  let st = jam((t) => [at(0.1)(t), at(0.9, 'pump')(t)], 2);
  const a0 = st.zones[0].live.a, a5 = st.zones[5].live.a;
  st = jam((t) => [at(0.9)(t), at(0.1, 'pump')(t)], 3, st);
  assert.equal(map(st), 'MddddM');
  assert.ok(st.zones[0].body && st.zones[5].body);
  void a0; void a5;
});

test('dockor och människor: den som går lämnar tillbaka zonen till dockan', () => {
  let st = jam((t) => [at(0.6)(t)], 2);
  assert.equal(map(st), 'dddMdd');
  st = jam(() => [], 3, st);
  assert.equal(map(st), 'dddddd');
});

test('dockor och människor: en tappad bildruta släpper inte in dockan', () => {
  let st = jam((t) => [at(0.6)(t)], 2);
  st = jam((t) => (Math.floor(t * 30) % 10 === 0 ? [] : [at(0.6)(t)]), 2, st); // var tionde bild saknas
  assert.equal(map(st), 'dddMdd');
});

test('granskning: en människa längst till höger behåller högerarmen utsträckt', () => {
  const armOut = (t) => {
    const lm = puppetPose(t, { x: 0.5, style: 'none', noise: 0.002 });
    const sh = lm[12];
    lm[14] = { ...lm[14], x: sh.x + 0.11, y: sh.y };
    lm[16] = { ...lm[16], x: sh.x + 0.2, y: sh.y };
    return lm;
  };
  // Människan står i högerkanten (zon 5) med höger arm rakt ut.
  const st = jam((t) => { const lm = armOut(t); return [lm.map((p) => ({ ...p, x: p.x + 0.7 }))]; }, 2);
  assert.ok(st.zones[5].human, map(st));
  assert.ok(Math.abs(st.zones[5].live.b - 0.47) < 0.06, `höger arm ${st.zones[5].live.b.toFixed(2)}`);
});
