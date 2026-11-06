// Kameran → kroppar. MediaPipe Pose körs i webbläsaren; ingen bild lämnar
// datorn och ingen bild sparas, bara 33 punkter per kropp.

import { FilesetResolver, PoseLandmarker } from '/vendor/tasks-vision/vision_bundle.mjs';

// wide (?cam=43): be om 4:3. De flesta kameror har en 4:3-sensor och 16:9 är en beskärning
// av den, så 4:3 ger hela sensorhöjden: mer av benen. device: en del av kamerans
// namn (t.ex. 'iphone' för Continuity Camera med vidvinkel).
export async function cameraSource({ model = 'lite', onFrame, wide = false, device = null, poses = 3 }) {
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  const want = wide
    ? { width: { ideal: 1920 }, height: { ideal: 1440 }, aspectRatio: { ideal: 4 / 3 } }
    : { width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: { ideal: 16 / 9 } };
  let deviceId;
  if (device) {
    // Kamerornas namn syns först efter att man gett lov en gång.
    let cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    if (!cams.some((c) => c.label)) {
      (await navigator.mediaDevices.getUserMedia({ video: true })).getTracks().forEach((t) => t.stop());
      cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    }
    deviceId = cams.find((c) => c.label.toLowerCase().includes(device.toLowerCase()))?.deviceId;
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { ...want, frameRate: { ideal: 60 }, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
    audio: false,
  });
  const track = stream.getVideoTracks()[0];
  // Zooma ut så långt det går, om kameran kan zooma.
  const caps = track.getCapabilities?.() ?? {};
  if (caps.zoom) await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] }).catch(() => {});
  video.srcObject = stream;
  await video.play();
  const settings = track.getSettings?.() ?? {};
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').map((d) => d.label || '(namnlös)');

  const fileset = await FilesetResolver.forVisionTasks('/vendor/tasks-vision/wasm');
  const src = {
    video, aspect: video.videoWidth / video.videoHeight || 16 / 9, delegate: null, fps: 0,
    info: { label: track.label, width: settings.width, height: settings.height, zoom: caps.zoom ? `${settings.zoom ?? '?'} (min ${caps.zoom.min})` : 'kan inte zooma', cams },
  };
  let landmarker = null, lastErr = null;
  for (const delegate of ['GPU', 'CPU']) {
    try {
      landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `/models/pose_landmarker_${model}.task`, delegate },
        runningMode: 'VIDEO',
        numPoses: poses,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      src.delegate = delegate;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!landmarker) throw lastErr;

  // En detektion per ny videobild. requestVideoFrameCallback slutar anropas
  // när videon inte syns (headless, dold), så vi frågar i varje animationsruta.
  let lastVideoTime = -1, count = 0, since = performance.now();
  const step = () => {
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const ts = performance.now();
      src.aspect = video.videoWidth / video.videoHeight || src.aspect;
      const r = landmarker.detectForVideo(video, ts);
      const a = src.aspect;
      // Säker = både synlig och närvarande enligt modellen.
      const poses = r.landmarks.map((p) => p.map((l) => ({ x: (1 - l.x) * a, y: l.y, v: Math.min(l.visibility ?? 1, l.presence ?? 1) })));
      onFrame(poses, a, ts / 1000);
      count++;
      if (ts - since > 1000) { src.fps = (count * 1000) / (ts - since); count = 0; since = ts; }
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return src;
}
