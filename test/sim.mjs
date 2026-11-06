// Kör kedjan kropp → mått → performer på en låtsasklocka, utan webbläsare.
import { makeConfig } from '../src/config.js';
import { DanceMeter, bodyFrame, normalizePose, pickPerformer, plausible } from '../src/dance.js';
import { Performer } from '../src/performer.js';

export function simulate({ cfg = makeConfig(''), seconds, poses, fps = 30, performer = null, t0 = 0 }) {
  const meter = new DanceMeter(cfg);
  const perf = performer ?? new Performer(cfg);
  const actions = [];
  const feats = [];
  let prev = null;
  const aspect = 16 / 9;
  for (let i = 0; i < seconds * fps; i++) {
    const t = t0 + i / fps;
    const beat = (t * cfg.bpm) / 60;
    const pick = pickPerformer(poses(t), aspect, cfg, prev);
    let features = null, body = null;
    if (pick) {
      prev = pick.frame;
      const lm = plausible(pick.lm, aspect);
      const frame = bodyFrame(lm) ?? pick.frame;
      features = meter.update(lm, frame, t);
      body = normalizePose(lm, frame);
      feats.push({ t, ...features });
    } else {
      prev = null;
      meter.lose();
    }
    for (const a of perf.update({ t, beat, seen: !!pick, features, body, accents: features?.accents ?? [] })) actions.push({ ...a, t, beat });
  }
  return { performer: perf, actions, feats, cfg };
}
