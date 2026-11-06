// Instrumentet genom hela kedjan (rensning, utjämning, ifyllnad), med råa
// kamerapunkter som indata. Det är här kamerans fel syns, inte i instrumentet ensamt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeConfig } from '../src/config.js';
import { makeChain } from '../src/chain.js';
import { puppetPose } from '../src/puppet.js';

const cfg = makeConfig('');
const A = 16 / 9, S = 0.2; // dockans torsolängd i bildhöjder
const jitter = (t, i) => { const s = Math.sin(t * 913.7 + i * 37.1) * 43758.5453; return (s - Math.floor(s) - 0.5) * 2; };

// Råa punkter: dockan står still; armarna sätts med vinkel (0 = ner, 180 = upp) och
// räckvidd för handleden i torsolängder, eller med en egen punkt för handleden.
function pose(t, arms, { noise = 0.003 } = {}) {
  const lm = puppetPose(0, { style: 'none', noise: 0 }).map((p) => ({ ...p }));
  for (const side of ['L', 'R']) {
    const a = arms[side];
    if (!a) continue;
    const [sh, el, wr, out] = side === 'L' ? [11, 13, 15, -1] : [12, 14, 16, 1];
    const s = lm[sh];
    let wx, wy;
    if (a.at) { wx = s.x + a.at[0] * S; wy = s.y + a.at[1] * S; }
    else { const r = (a.theta * Math.PI) / 180; wx = s.x + out * Math.sin(r) * a.r * S; wy = s.y + Math.cos(r) * a.r * S; }
    lm[wr] = { x: wx, y: wy, v: a.v ?? 0.99 };
    lm[el] = { x: (s.x + wx) / 2 + (a.elbow?.[0] ?? 0) * S, y: (s.y + wy) / 2 + (a.elbow?.[1] ?? 0) * S, v: 0.99 };
  }
  return lm.map((p, i) => ({ ...p, x: p.x + noise * jitter(t, i), y: p.y + noise * jitter(t, i + 50) }));
}

function run(name, arms, seconds, fps = 30) {
  const chain = makeChain(cfg, name);
  const hits = [];
  for (let i = 0; i <= seconds * fps; i++) {
    const t = i / fps;
    const r = chain.update([pose(t, arms(t))], A, t);
    for (const h of r?.hits ?? []) hits.push({ t, id: h.obj.id, voice: h.obj.note.voice ?? h.obj.note.deg });
  }
  return hits;
}
const hang = { theta: 12, r: 1.1 };

test('kedjan: hand vid motsatta axeln som rör sig upp och ner ger inga toner (vinkelskarven)', () => {
  const hits = run('melody', (t) => ({ L: hang, R: { at: [-0.85, 0.08 * Math.sin(t * 6)] } }), 4);
  assert.equal(hits.length, 0, JSON.stringify(hits.slice(0, 5)));
});

test('kedjan: ett harpsvep upp ger fem toner', () => {
  const hits = run('melody', (t) => ({ L: hang, R: { theta: 15 + Math.min(1, Math.max(0, t - 1) / 0.6) * 160, r: 1.1 } }), 2.5);
  assert.deepEqual(hits.map((h) => h.id), ['R0', 'R1', 'R2', 'R3', 'R4']);
});

test('kedjan: slag rakt ut med sträckt arm (räckvidd 1,15) ger ett slag, inte två', () => {
  for (const theta of [90, 102, 135, 150]) {
    // Handen nära kroppen → rakt ut, kvar en stund ytterst → tillbaka.
    const r = (t) => (t < 1 ? 0.4 : t < 1.2 ? 0.4 + ((t - 1) / 0.2) * 0.75 : t < 1.4 ? 1.15 : t < 1.6 ? 1.15 - ((t - 1.4) / 0.2) * 0.75 : 0.4);
    const hits = run('drums', (t) => ({ L: hang, R: { theta, r: r(t) } }), 2.5);
    assert.equal(hits.length, 1, `${theta}°: ${hits.map((h) => h.voice)}`);
  }
});

test('kedjan: snabba upprepade slag på virveln (4 per sekund, kort slag) ger ungefär lika många ljud', () => {
  // Handen pendlar mellan 0,55 och 1,15 i virvelns vinkel, 4 gånger per sekund i 3 s.
  const hits = run('drums', (t) => ({ L: hang, R: { theta: 102, r: 0.85 + 0.3 * Math.sin(t * 2 * Math.PI * 4) } }), 4);
  const n = hits.filter((h) => h.t > 1).length;
  assert.ok(n >= 10, `${n} slag på 12 försök`);
});

test('kedjan: spårningen hoppar till andra armen och tillbaka, inget ljud', () => {
  const hits = run('drums', (t) => ({ L: hang, R: t > 1 && t < 1.5 ? { at: [-0.84, 0.95] } : hang }), 3);
  assert.equal(hits.length, 0, JSON.stringify(hits));
});

test('kedjan: handleden osynlig mitt i ett svep, sedan synlig igen, ger inga falska toner', () => {
  const hits = run('melody', (t) => ({ L: hang, R: t > 1 && t < 1.4 ? { theta: 30, r: 1.1, v: 0.1 } : { theta: t < 1 ? 30 : 160, r: 1.1 } }), 3);
  assert.ok(hits.length <= 5, `${hits.length}`);
});

test('kedjan: risk 1, armar som sänks till vila (mäts)', () => {
  const lower = (t) => { const th = t < 1 ? 90 : 90 - Math.min(1, (t - 1) / 0.5) * 78; return { L: { theta: th, r: 1.1 }, R: { theta: th, r: 1.1 } }; };
  console.log(`    sänkta armar genom kedjan: harpa ${run('melody', lower, 2.5).length} toner, trummor ${run('drums', lower, 2.5).length} slag`);
  assert.ok(true);
});
