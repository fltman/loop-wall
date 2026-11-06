// En docka som dansar framför en låtsaskamera, för att kunna prova väggen
// utan att stå framför den. Fyra danser byter av varandra:
//
//   stomp  – stampar växelvis, armarna hänger   (bör bli rytm)
//   wave   – armarna uppe, böljar långsamt       (bör bli ackord)
//   pump   – armarna uppe och pumpar i takt      (bör bli melodi)
//   groove – armarna nere i cirklar, lätt gung   (bör bli bas)
//
// Dockan är ett test av kedjan, inte av måtten: den dansar som vi tror att
// folk dansar. Riktiga kroppar kan ge helt andra värden.

export const STYLES = ['stomp', 'wave', 'pump', 'groove'];

// Liten deterministisk darrning, så att testerna ger samma svar varje gång.
const jitter = (t, i, k) => {
  const s = Math.sin(t * 913.7 + i * 37.1 + k * 11.3) * 43758.5453;
  return (s - Math.floor(s) - 0.5) * 2;
};

export function puppetPose(t, { bpm = 112, aspect = 16 / 9, styleBars = 6, style = null, noise = 0.003, amp = 1, x = 0.5, size = 1 } = {}) {
  const beat = (t * bpm) / 60;
  const st = style ?? STYLES[Math.floor(beat / (4 * styleBars)) % STYLES.length];
  const P = Array.from({ length: 33 }, () => ({ x: 0, y: 0 }));
  const set = (i, x, y) => { P[i].x = x; P[i].y = y; };

  // Grundkropp i torsolängder, axlarnas mitt i origo, y nedåt.
  let dy = 0, lL = 0, lR = 0;
  let wl = { x: -0.5, y: 0.95 }, wr = { x: 0.5, y: 0.95 };
  const ph = beat * Math.PI * 2;

  if (st === 'stomp') {
    lL = Math.max(0, Math.sin(beat * Math.PI)) * 0.5 * amp;
    lR = Math.max(0, -Math.sin(beat * Math.PI)) * 0.5 * amp;
    dy = 0.06 * amp * Math.abs(Math.sin(beat * Math.PI));
    wl = { x: -0.52, y: 0.95 + 0.05 * Math.sin(beat * Math.PI) };
    wr = { x: 0.52, y: 0.95 - 0.05 * Math.sin(beat * Math.PI) };
  } else if (st === 'wave') {
    const sw = 0.5 * amp * Math.sin((beat * Math.PI) / 2);
    wl = { x: -0.45 + sw, y: -1.15 + 0.1 * Math.cos((beat * Math.PI) / 2) };
    wr = { x: 0.45 + sw, y: -1.15 - 0.1 * Math.cos((beat * Math.PI) / 2) };
  } else if (st === 'pump') {
    wl = { x: -0.4, y: -0.9 + 0.45 * amp * Math.sin(ph) };
    wr = { x: 0.4, y: -0.9 + 0.45 * amp * Math.sin(ph) };
    dy = 0.03 * Math.abs(Math.sin(ph));
  } else if (st === 'groove') {
    wl = { x: -0.45 + 0.25 * amp * Math.cos(ph), y: 0.7 + 0.25 * amp * Math.sin(ph) };
    wr = { x: 0.45 - 0.25 * amp * Math.cos(ph), y: 0.7 + 0.25 * amp * Math.sin(ph) };
    dy = 0.03 * Math.abs(Math.sin(ph));
  }

  set(0, 0, -0.62);
  for (let i = 1; i <= 10; i++) set(i, (i <= 5 ? -1 : 1) * 0.05 * ((i % 5) + 1), -0.68 + (i > 8 ? 0.12 : 0));
  set(11, -0.42, 0);
  set(12, 0.42, 0);
  set(15, wl.x, wl.y);
  set(16, wr.x, wr.y);
  set(13, (-0.42 + wl.x) / 2 - 0.14, wl.y / 2);
  set(14, (0.42 + wr.x) / 2 + 0.14, wr.y / 2);
  for (const [i, w] of [[17, wl], [19, wl], [21, wl], [18, wr], [20, wr], [22, wr]]) set(i, w.x * 1.05, w.y + 0.08);
  set(23, -0.26, 1);
  set(24, 0.26, 1);
  set(25, -0.28, 1.75 - lL * 0.8);
  set(26, 0.28, 1.75 - lR * 0.8);
  set(27, -0.3, 2.5 - lL);
  set(28, 0.3, 2.5 - lR);
  set(29, -0.3, 2.56 - lL);
  set(30, 0.3, 2.56 - lR);
  set(31, -0.36, 2.58 - lL);
  set(32, 0.36, 2.58 - lR);

  const S = 0.2 * size, ox = aspect * x + 0.03 * size * Math.sin(t * 0.7), oy = 0.3 - dy * S; // x: var i bilden (0..1)
  return P.map((p, i) => ({
    x: ox + p.x * S + noise * jitter(t, i, 0),
    y: oy + p.y * S + noise * jitter(t, i, 1),
    v: 0.99,
  }));
}

// amp: hur stora rörelserna är (1 = docka som dansar tydligt, 0.4 = försiktigt).

// visit: [närvarande takter, borta takter] – dockan går in och ut ur ringen.
// upper: benen syns inte, som nära en laptop (MediaPipe gissar då vilt med låg säkerhet).
// crowd: flera dockor bredvid varandra (för livejammet), var och en med sin dans och fas.
export function puppetSource({ cfg, onFrame, visit = null, upper = false, crowd = 0 }) {
  const aspect = 16 / 9;
  const t0 = performance.now();
  const id = setInterval(() => {
    const now = performance.now();
    const t = (now - t0) / 1000;
    const bar = (t * cfg.bpm) / 60 / cfg.beatsPerBar;
    const here = !visit || bar % (visit[0] + visit[1]) < visit[0];
    if (crowd) {
      const styles = ['stomp', 'groove', 'wave', 'pump', 'stomp', 'pump'];
      const poses = Array.from({ length: crowd }, (_, i) => puppetPose(t + i * 0.37, { bpm: cfg.bpm, aspect, x: (i + 0.5) / crowd, size: 0.55, style: styles[i % 6] }));
      onFrame(poses, aspect, now / 1000);
      return;
    }
    let lm = here ? puppetPose(t, { bpm: cfg.bpm, aspect }) : null;
    if (lm && upper) lm = lm.map((p, i) => (i >= 25 ? { x: p.x + Math.sin(t * 7 + i) * 0.1, y: p.y + Math.cos(t * 5 + i) * 0.1, v: 0.1 } : p));
    onFrame(lm ? [lm] : [], aspect, now / 1000);
  }, 1000 / 30);
  return { aspect, delegate: 'docka', fps: 30, stop: () => clearInterval(id) };
}
