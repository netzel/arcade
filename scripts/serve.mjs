// Tiny static server for dist/ — no dependencies.
// Listens on all interfaces so you can open it on an iPad/phone on the same Wi-Fi.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { parseEnv } from './lib.mjs';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
// 4600 is deliberately off the usual defaults (3000, 5173, 8080…) used by other dev servers.
let fileEnv = {};
try { fileEnv = parseEnv(readFileSync(path.join(DIST, '..', '.env'), 'utf8')); } catch { /* no .env */ }
const PORT = Number(process.env.PORT || fileEnv.PORT) || 4600;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

http.createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    const file = path.join(DIST, urlPath);
    if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is busy — set a different PORT in .env, e.g. PORT=4610` : e);
  process.exit(1);
}).listen(PORT, '0.0.0.0', () => {
  console.log(`\nSuper Games Arcade running:\n  http://127.0.0.1:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets || []) if (n.family === 'IPv4' && !n.internal) console.log(`  http://${n.address}:${PORT}   (phone / iPad on same Wi-Fi)`);
  }
});
