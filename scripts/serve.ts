import { attachDoubleDateServer } from '../server/double-date';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { attachRestaurantServer } from '../server/restaurant';
import { attachGameServer } from '../server';

if (existsSync('.env')) process.loadEnvFile('.env');
const root = resolve('dist');
if (!existsSync(resolve(root, 'index.html'))) throw new Error('Build the game with pnpm build before starting the production server.');
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json' };
const http = createServer((req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  if (doubleDate.handle(req, res)) return;
  if (restaurant.handle(req, res)) return;
  void (async () => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
    const file = resolve(root, pathname === '/' ? 'index.html' : '.' + pathname);
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(404).end('Not found'); }
  })();
});
const restaurant = await attachRestaurantServer(http, { development: false });
const doubleDate = await attachDoubleDateServer(http, restaurant);
const game = await attachGameServer(http);
const port = Number(process.env.PORT || 5173), host = process.env.HOST || '127.0.0.1';
http.listen(port, host, () => console.log(`Table for Two · http://${host}:${port}`));
let closing = false;
async function close() { if (closing) return; closing = true; await doubleDate.close(); await restaurant.close(); await game.close(); http.close(() => process.exit(0)); }
process.on('SIGINT', close); process.on('SIGTERM', close);
