// Statisk server för väggen. Serverar bara sidan, koden, MediaPipe och
// modellerna: inget annat i mappen (vault, node_modules) går att nå.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8340;
const HOST = process.env.HOST || '127.0.0.1';

const MOUNTS = [
  ['/src/', 'src'],
  ['/vendor/tasks-vision/', 'node_modules/@mediapipe/tasks-vision'],
  ['/models/', 'models'],
];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm',
  '.task': 'application/octet-stream', '.map': 'application/json', '.css': 'text/css',
};

function resolve(urlPath) {
  if (urlPath === '/' || urlPath === '/index.html') return path.join(root, 'index.html');
  for (const [prefix, dir] of MOUNTS) {
    if (!urlPath.startsWith(prefix)) continue;
    const base = path.join(root, dir);
    const file = path.normalize(path.join(base, urlPath.slice(prefix.length)));
    return file.startsWith(base + path.sep) ? file : null;
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  let file = null;
  try { file = resolve(decodeURIComponent(new URL(req.url, 'http://x').pathname)); } catch {}
  if (!file) { res.writeHead(404).end('not found'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

server.listen(PORT, HOST, () => console.log(`loop wall: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
