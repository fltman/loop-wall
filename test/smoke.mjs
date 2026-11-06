// Röktest i riktig Chrome (inte Playwrights headless shell: dess ljud
// stannar). Två körningar:
//   1. dockan dansar in fyra lager i högt tempo, och ljudet hörs
//   2. låtsaskameran går genom MediaPipe utan fel
// Skärmdumpar hamnar i test/out/.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 18340;
const base = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
await new Promise((r) => server.stdout.once('data', r));

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? '✔' : '✖'} ${msg}`); if (!ok) failed = true; };

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(e.message));

  await page.goto(`${base}/?puppet&autostart&bpm=240&rest=1&debug`);
  await page.waitForFunction(() => window.__loopwall?.ready, null, { timeout: 15000 });
  const t0 = Date.now();
  await page.waitForFunction(() => window.__loopwall.performer.layers.length >= 4, null, { timeout: 90000 });
  const s = await page.evaluate(() => {
    const a = window.__loopwall;
    return {
      layers: a.performer.layers.map((l) => l.role),
      notes: a.engine.stats.notes, live: a.engine.stats.live,
      ctx: a.engine.ctx.state, frames: a.visuals.frames, errors: a.errors,
      underruns: a.engine.ctx.playbackStats?.underrunEvents ?? null,
    };
  });
  console.log(`  fyra lager på ${((Date.now() - t0) / 1000).toFixed(1)} s: ${s.layers.join(', ')}`);
  check(JSON.stringify(s.layers) === JSON.stringify(['drums', 'bass', 'chords', 'melody']), 'lagren i bestämd ordning');
  check(s.ctx === 'running', `ljudet går (${s.ctx})`);
  check(s.notes > 100 && s.live > 20, `toner spelade: ${s.notes}, varav levande steg ${s.live}`);
  check(s.frames > 300, `bildrutor: ${s.frames}`);
  check(s.errors.length === 0 && consoleErrors.length === 0, `inga fel ${JSON.stringify([...s.errors, ...consoleErrors])}`);
  if (s.underruns != null) console.log(`  underruns: ${s.underruns}`);
  await page.screenshot({ path: 'test/out/puppet.png' });
  await page.keyboard.press('d');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test/out/puppet-clean.png' });
  await page.close();

  const cam = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const camErrors = [];
  cam.on('pageerror', (e) => camErrors.push(e.message));
  cam.on('console', (m) => m.type() === 'error' && camErrors.push(m.text()));
  await cam.goto(`${base}/?autostart&debug`);
  await cam.waitForFunction(() => window.__loopwall?.ready || window.__loopwall?.errors.length, null, { timeout: 60000 });
  await cam.waitForTimeout(3000);
  const c = await cam.evaluate(() => ({ ...window.__loopwall.stats, delegate: window.__loopwall.source?.delegate, fps: window.__loopwall.source?.fps, errors: window.__loopwall.errors }));
  check(c.poseFrames > 20, `kameran genom MediaPipe: ${c.poseFrames} bilder, ${c.delegate}, ${c.fps?.toFixed(0)} fps`);
  check(c.errors.length === 0, `inga fel i kameraläget ${JSON.stringify(c.errors)}`);
  const hidden = await cam.evaluate(() => {
    const v = document.querySelector('video');
    const r = v.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.id === 'wall';
  });
  check(!hidden, 'i debug-läget syns kamerabilden i hörnet');
  await cam.keyboard.press('d');
  await cam.waitForTimeout(200);
  const hiddenNow = await cam.evaluate(() => {
    const v = document.querySelector('video');
    const r = v.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.id === 'wall';
  });
  check(hiddenNow, 'utan debug ligger kamerabilden under duken och syns inte');
  if (camErrors.length) console.log('  konsolen:', camErrors.slice(0, 5));
  await cam.screenshot({ path: 'test/out/camera.png' });
} finally {
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
