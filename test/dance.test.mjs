import test from 'node:test';
import assert from 'node:assert/strict';
import { makeConfig } from '../src/config.js';
import { BodyFiller, DanceMeter, PoseSmoother, bodyFrame, pickPerformer, plausible, poseAt } from '../src/dance.js';
import { ON } from '../src/music.js';
import { puppetPose, STYLES } from '../src/puppet.js';

const cfg = makeConfig('');

function meanFeatures(style, { seconds = 6, noise = 0.003, from = 2 } = {}) {
  const m = new DanceMeter(cfg);
  const acc = { height: 0, side: 0, move: 0, pace: 0, arms: 0, legs: 0 };
  let n = 0;
  for (let i = 0; i < seconds * 30; i++) {
    const t = i / 30;
    const lm = puppetPose(t, { style, noise });
    const f = m.update(lm, bodyFrame(lm), t);
    if (t >= from) { for (const k in acc) acc[k] += f[k]; n++; }
  }
  for (const k in acc) acc[k] /= n;
  return acc;
}

test('stilla kropp med darrning blir tyst', () => {
  const m = new DanceMeter(cfg);
  let f, accents = 0;
  for (let i = 0; i < 120; i++) {
    const t = i / 30;
    const lm = puppetPose(0, { style: 'none', noise: 0 }).map((p, j) => ({
      ...p,
      x: p.x + 0.004 * Math.sin(t * 97 + j * 3.1),
      y: p.y + 0.004 * Math.cos(t * 83 + j * 1.7),
    }));
    f = m.update(lm, bodyFrame(lm), t);
    accents += f.accents.length;
  }
  assert.ok(f.armsMove < 0.1, `armsMove ${f.armsMove}`);
  assert.ok(f.legs < 0.1, `legs ${f.legs}`);
  assert.ok(f.move < ON, `rörelse ${f.move}`);
  assert.equal(accents, 0, 'inga slag');
  assert.equal(m.gain, 3, 'full känslighet, och ändå tyst');
});



test('helkroppsthereminen: armar uppe ger hög höjd, nere låg', () => {
  assert.ok(meanFeatures('wave').height > 0.8);
  assert.ok(meanFeatures('stomp').height < 0.25);
});

// Slagen i en dans: [källa, taktslagsfas] efter uppvärmning.
function accentsOf(style, { amp = 1, seconds = 10 } = {}) {
  const m = new DanceMeter(cfg);
  const out = [];
  for (let i = 0; i < seconds * 30; i++) {
    const t = i / 30;
    const lm = puppetPose(t, { style, amp, noise: 0.003 });
    const f = m.update(lm, bodyFrame(lm), t);
    if (t >= 3) for (const a of f.accents) out.push({ source: a.source, beat: (t * 112) / 60 });
  }
  return out;
}

test('rytmen: ett slag per taktslag och hand när man dansar i takt', () => {
  const beats = ((10 - 3) * 112) / 60;
  const pump = accentsOf('pump');
  for (const src of ['L', 'R']) {
    const n = pump.filter((a) => a.source === src).length;
    assert.ok(Math.abs(n - beats) <= 1.5, `${src}: ${n} slag på ${beats.toFixed(1)} taktslag`);
  }
  const stomp = accentsOf('stomp');
  assert.ok(Math.abs(stomp.filter((a) => a.source === 'B').length - beats) <= 1.5, 'stamp: ett slag per steg');
  assert.equal(accentsOf('wave').length, 0, 'långsamt bölj ger inga slag');
});

test('rytmen: slaget sitter där foten landar, inte där den lyfter', () => {
  // Dockans fot landar på hela taktslag; slaget kommer strax efter (detektorns fördröjning).
  const phases = accentsOf('stomp').map((a) => a.beat % 1);
  assert.ok(phases.every((p) => p > 0 && p < 0.3), `faser ${phases.slice(0, 6).map((p) => p.toFixed(2))}`);
});

test('rytmen: försiktig dans ger också slag', () => {
  assert.ok(accentsOf('pump', { amp: 0.4 }).length >= 8);
});

test('alla danser rör sig, och en lugn dans är lugnare än en vild', () => {
  for (const style of STYLES) assert.ok(meanFeatures(style).move >= ON, style);
  assert.ok(meanFeatures('wave').pace < meanFeatures('pump').pace);
});

test('en person i taget: den i mitten, och den som redan dansar behåller platsen', () => {
  const a = 16 / 9;
  const center = puppetPose(0, { style: 'none', noise: 0 });
  const off = center.map((p) => ({ ...p, x: p.x + 0.4 }));
  const big = center.map((p) => ({ ...p, x: (p.x - a / 2) * 1.3 + a / 2 + 0.25, y: p.y * 1.1 }));
  const edge = center.map((p) => ({ ...p, x: p.x - 0.85 }));
  assert.equal(pickPerformer([edge], a, cfg), null, 'utanför ringen räknas inte');
  assert.equal(pickPerformer([center, big], a, cfg).lm, big, 'större vinner när ingen dansar');
  const prev = bodyFrame(center);
  assert.equal(pickPerformer([center, big], a, cfg, prev).lm, center, 'den som dansar behåller platsen');
  assert.equal(pickPerformer([off], a, cfg)?.lm ?? null, off);
});

test('poseAt interpolerar och går runt', () => {
  const fr = (p, x) => ({ p, pts: Float32Array.from([x, 0]), vis: new Uint8Array([1]) });
  const frames = [fr(0.1, 0), fr(0.5, 4), fr(0.9, 8)];
  assert.equal(poseAt(frames, 0.3).pts[0], 2);
  assert.ok(Math.abs(poseAt(frames, 0.95).pts[0] - 6) < 1e-5); // 8 → 0 över skarven
  assert.ok(Math.abs(poseAt(frames, 0.0).pts[0] - 4) < 1e-5);
  assert.equal(poseAt([], 0.5), null);
});

test('gubben blir aldrig halv: osynliga delar står still', () => {
  const filler = new BodyFiller();
  const lm = puppetPose(0, { style: 'none', noise: 0 });
  const f = bodyFrame(lm);
  // Benen syns inte alls (nära en laptop): de står i vila under kroppen.
  const noLegs = lm.map((p, i) => (i >= 25 ? { ...p, x: 99, y: 99, v: 0.1 } : p));
  let b = filler.fill(noLegs, f);
  assert.ok(b.vis.every((v) => v === 1), 'alla delar ritas');
  assert.ok(b.pts[2 * 27 + 1] > 1.5 && b.pts[2 * 27 + 1] < 2.5, 'fotleden står under kroppen');
  // En hand som har synts och sedan försvinner står kvar där den sågs.
  const up = lm.map((p, i) => (i === 15 ? { ...p, y: p.y - 0.3 } : p));
  const seen = filler.fill(up, f).pts.slice(30, 32);
  const gone = lm.map((p, i) => (i === 15 ? { ...p, x: 99, y: 99, v: 0.2 } : p));
  b = filler.fill(gone, f);
  assert.deepEqual(Array.from(b.pts.slice(30, 32)), Array.from(seen));
  filler.reset();
  assert.notDeepEqual(Array.from(filler.fill(gone, f).pts.slice(30, 32)), Array.from(seen), 'ny person börjar i vila');
});

// Gubben som den ritas: utjämnade punkter, utjämnad mitt och storlek, ifylld kropp.
function drawn(stream, seconds = 6) {
  const sm = new PoseSmoother(), filler = new BodyFiller();
  const out = [];
  for (let i = 0; i < seconds * 30; i++) {
    const t = i / 30, lm = stream(t);
    const slm = sm.filter(lm, t, bodyFrame(lm).scale);
    const f = sm.frame(slm, t);
    out.push({ t, pts: filler.fill(slm, f).pts, cx: f.cx, scale: f.scale });
  }
  return out.filter((d) => d.t >= 2);
}
const spread = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
const shake = (frames, i) => spread(frames.map((d) => d.pts[2 * i])) + spread(frames.map((d) => d.pts[2 * i + 1]));

test('den som står helt still skakar inte', () => {
  // Darrning som i en riktig kamera: ±0,005 bildhöjd per punkt och bildruta.
  const still = (t) => puppetPose(0, { style: 'none', noise: 0 }).map((p, j) => ({
    ...p, x: p.x + 0.005 * Math.sin(t * 97 + j * 3.1), y: p.y + 0.005 * Math.cos(t * 83 + j * 1.7),
  }));
  const raw = [];
  for (let i = 60; i < 180; i++) { const lm = still(i / 30); const f = bodyFrame(lm); raw.push({ pts: new BodyFiller().fill(lm, f).pts }); }
  const smooth = drawn(still);
  for (const i of [0, 15, 16, 27]) {
    assert.ok(shake(smooth, i) < shake(raw, i) * 0.25, `punkt ${i}: ${shake(smooth, i).toFixed(4)} mot rått ${shake(raw, i).toFixed(4)}`);
  }
});

test('dansen hänger med: handen tappar inte sina rörelser', () => {
  const pump = (t) => puppetPose(t, { style: 'pump', noise: 0 });
  const rawY = [];
  for (let i = 60; i < 180; i++) { const lm = pump(i / 30); const f = bodyFrame(lm); rawY.push((lm[15].y - f.cy) / f.scale); }
  const sy = drawn(pump).map((d) => d.pts[2 * 15 + 1]);
  const range = (xs) => Math.max(...xs) - Math.min(...xs);
  assert.ok(range(sy) > range(rawY) * 0.8, `utslag ${range(sy).toFixed(2)} mot ${range(rawY).toFixed(2)}`);
});

test('höfter som blinkar får inte gubben att byta storlek', () => {
  // Nära en laptop: höfterna syns varannan halvsekund.
  const blink = (t) => puppetPose(0, { style: 'none', noise: 0 }).map((p, i) =>
    (i === 23 || i === 24) && Math.floor(t * 2) % 2 ? { ...p, v: 0.2 } : p);
  const scales = drawn(blink, 10).map((d) => d.scale);
  const m = scales.reduce((a, b) => a + b, 0) / scales.length;
  assert.ok((Math.max(...scales) - Math.min(...scales)) / m < 0.02, `storleken varierar ${(100 * (Math.max(...scales) - Math.min(...scales)) / m).toFixed(1)} %`);
});

const A = 16 / 9;
const hiddenBy = (lm) => plausible(lm, A).map((p, i) => (lm[i].v > 0.5 && !(p.v > 0.5) ? i : -1)).filter((i) => i >= 0);
const stand = () => puppetPose(0, { style: 'none', noise: 0 });
const T = 0.2; // dockans torsolängd i bildhöjder

test('rimliga kroppar får vara ifred, hela dansen igenom', () => {
  for (const style of [...STYLES, 'none']) {
    for (let i = 0; i < 300; i++) assert.deepEqual(hiddenBy(puppetPose(i / 30, { style, noise: 0.003 })), [], `${style} vid ${(i / 30).toFixed(2)} s`);
  }
});

test('ben som viks upp i kroppen sållas bort', () => {
  // Som på skärmdumpen: knäna uppe vid höfterna, fötterna uppe i magen.
  const lm = stand();
  lm[25] = { ...lm[25], y: lm[23].y - 0.5 * T }; lm[26] = { ...lm[26], y: lm[24].y - 0.5 * T };
  lm[27] = { ...lm[27], x: lm[24].x, y: lm[23].y - 0.2 * T }; lm[28] = { ...lm[28], x: lm[23].x, y: lm[24].y - 0.1 * T };
  const hid = hiddenBy(lm);
  for (const i of [25, 26, 27, 28, 29, 30, 31, 32]) assert.ok(hid.includes(i), `punkt ${i}`);
  const clean = plausible(lm, A);
  const filled = new BodyFiller().fill(clean, bodyFrame(clean));
  assert.ok(filled.pts[2 * 27 + 1] > 1.5, 'gubben står på vilobenen i stället');
});

test('ben som korsar till fel sida sållas bort, ryggen till räknas rätt', () => {
  const lm = stand();
  lm[27] = { ...lm[27], x: lm[24].x + 0.4 * T }; // vänster fot långt ut till höger
  assert.ok(hiddenBy(lm).includes(27));
  const back = stand().map((p) => ({ ...p, x: A - p.x })); // speglad = ryggen mot kameran
  assert.deepEqual(hiddenBy(back), []);
});

test('punkter utanför bilden sållas bort även när modellen är säker', () => {
  const lm = stand();
  lm[27] = { ...lm[27], y: 1.3, v: 0.95 };
  assert.ok(hiddenBy(lm).includes(27));
});

test('höfter uppe vid axlarna tar med sig benen', () => {
  const lm = stand();
  lm[23] = { ...lm[23], y: lm[11].y + 0.02 }; lm[24] = { ...lm[24], y: lm[12].y + 0.02 };
  const hid = hiddenBy(lm);
  for (const i of [23, 24, 25, 26, 27, 28]) assert.ok(hid.includes(i), `punkt ${i}`);
});

test('en arm blir aldrig längre än en arm', () => {
  const lm = stand();
  lm[15] = { ...lm[15], x: lm[13].x - 1.6 * T };
  assert.ok(hiddenBy(lm).includes(15));
  assert.ok(!hiddenBy(lm).includes(13));
});

test('ben rakt ut åt sidan i höfthöjd (kamerans gissning när man sitter) sållas bort', () => {
  // Som på andra skärmdumpen: ett lår vågrätt ut, foten längre ut i samma höjd.
  const lm = stand();
  lm[25] = { ...lm[25], x: lm[23].x - 0.8 * T, y: lm[23].y + 0.1 * T };
  lm[27] = { ...lm[27], x: lm[23].x - 1.6 * T, y: lm[23].y + 0.05 * T };
  const hid = hiddenBy(lm);
  for (const i of [25, 27, 29, 31]) assert.ok(hid.includes(i), `punkt ${i}`);
  assert.ok(!hid.includes(26) && !hid.includes(28), 'det andra benet får stå kvar');
});

test('sittande: knäna i höfthöjd, fötterna rakt under, sållas bort', () => {
  const lm = stand();
  lm[25] = { ...lm[25], y: lm[23].y + 0.1 * T }; lm[26] = { ...lm[26], y: lm[24].y + 0.1 * T };
  lm[27] = { ...lm[27], y: lm[23].y + 0.7 * T }; lm[28] = { ...lm[28], y: lm[24].y + 0.7 * T };
  const hid = hiddenBy(lm);
  for (const i of [25, 26, 27, 28]) assert.ok(hid.includes(i), `punkt ${i}`);
});
