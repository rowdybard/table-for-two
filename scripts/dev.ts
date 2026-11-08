import { attachDoubleDateServer } from '../server/double-date';
import { createServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import { attachGameServer } from '../server/index';
import { attachRestaurantServer } from '../server/restaurant/index';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 5173);
const vite = await createViteServer({ server: { middlewareMode: true, hmr: false, ws: false } });
const httpServer = createServer((req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  if (doubleDate.handle(req, res)) return;
  if (restaurant.handle(req, res)) return;
  vite.middlewares(req, res, () => {
  res.statusCode = 404;
  res.end('Not found');
  });
});
const restaurant = await attachRestaurantServer(httpServer, { development: process.env.NODE_ENV !== 'production' });
const doubleDate = await attachDoubleDateServer(httpServer, restaurant);
const game = await attachGameServer(httpServer);
httpServer.listen(port, host, () => console.log(`Table for Two · restaurant playtest\nhttp://${host}:${port}\nBowling archive: http://${host}:${port}/?venue=bowling`));
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await doubleDate.close();
  await restaurant.close();
  await game.close();
  await vite.close();
  httpServer.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
