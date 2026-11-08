import { createServer } from 'node:http';
import { attachRestaurantServer } from '../../server/restaurant';
import { attachDoubleDateServer } from '../../server/double-date';
import { attachGameServer } from '../../server';
import { remoteBudgetStore } from './budget';

// The Worker serves static files; this process owns the authoritative game.
const http = createServer((request, response) => {
  // The only ingress is our Worker, which replaces this header before proxying.
  if (typeof request.headers['x-forwarded-host'] === 'string') request.headers.host = request.headers['x-forwarded-host'];
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  if (doubles.handle(request, response) || restaurant.handle(request, response)) return;
  if (request.url === '/healthz') { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"ready":true}'); return; }
  response.writeHead(404, { 'content-type': 'application/json' }); response.end('{"error":"Not found"}');
});
const restaurant = await attachRestaurantServer(http, { development: false, ledgerPath: false, budgetStore: remoteBudgetStore(fetch, process.env.BUDGET_BRIDGE_URL || 'http://budget.internal/ledger', process.env.BUDGET_EPOCH) });
const doubles = await attachDoubleDateServer(http, restaurant);
const archive = await attachGameServer(http);
http.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('Restaurant runtime ready.'));
let closing = false;
const close = async () => { if (closing) return; closing = true; doubles.close(); await restaurant.close(); await archive.close(); http.close(() => process.exit(0)); };
process.on('SIGTERM', close); process.on('SIGINT', close);
