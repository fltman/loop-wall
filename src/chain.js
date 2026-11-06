// Kedjan från kameran till instrumentet, utan webbläsare, så att testerna kör
// exakt samma steg som appen: välj personen → rensa orimligt → utjämna → fyll i
// osynliga delar → instrumentet. Bilden får en lugn utjämning, träffarna en lätt.

import { BodyFiller, PoseSmoother, bodyFrame, pickPerformer, plausible } from './dance.js';
import { Instrument } from './instrument.js';

const vis = (p) => !!p && (p.v ?? 1) > 0.5;

export function makeChain(cfg, name = null) {
  const inst = name ? new Instrument(name) : null; // utan instrument: bara kroppen
  const smoother = new PoseSmoother(), filler = new BodyFiller(); // för bilden: lugn
  const quick = new PoseSmoother({ minCutoff: 2, dCutoff: 3 }), quickFiller = new BodyFiller(); // för träffarna
  let prev = null;
  return {
    inst,
    reset() { prev = null; inst?.reset(); smoother.reset(); filler.reset(); quick.reset(); quickFiller.reset(); },
    // Ger { body, cx, hits } för en bild, eller null om ingen står i ringen.
    update(poses, aspect, t) {
      const pick = pickPerformer(poses, aspect, cfg, prev);
      if (!pick) { prev = null; return null; }
      prev = pick.frame;
      const lm = plausible(pick.lm, aspect);
      const frame = bodyFrame(lm) ?? pick.frame;
      const slm = smoother.filter(lm, t, frame.scale);
      const sf = smoother.frame(slm, t) ?? frame;
      const body = filler.fill(slm, sf);
      const qlm = quick.filter(lm, t, frame.scale);
      const qbody = quickFiller.fill(qlm, quick.frame(qlm, t) ?? frame);
      const hits = inst ? inst.update(qbody, t, { L: vis(lm[15]), R: vis(lm[16]) }) : [];
      return { body, quick: qbody, cx: sf.cx, hits, raw: pick.lm, clean: lm, wrists: { L: vis(lm[15]), R: vis(lm[16]) } };
    },
  };
}
