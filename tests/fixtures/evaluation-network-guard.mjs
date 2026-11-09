// CI-only preload. Loopback fixtures and static/model downloads remain usable;
// real text/speech generation endpoints fail the job even if an application catches the error.
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
const provider = /(?:^|\.)(?:anthropic\.com|openrouter\.ai|aihorde\.net|elevenlabs\.io|msedgeservices\.com|speech\.platform\.bing\.com)$/i;
const blocked = new Set();
function check(input) {
  let host = '';
  try { host = typeof input === 'string' || input instanceof URL ? new URL(input).hostname : input?.hostname ?? input?.host ?? new URL(input?.url).hostname; } catch { /* Relative/local options are not provider traffic. */ }
  if (provider.test(String(host).replace(/:\d+$/, ''))) {
    blocked.add(String(host).replace(/:\d+$/, ''));
    throw new Error('BLOCKED_PROVIDER: live model and speech calls are disabled in automated checks.');
  }
}
const fetcher = globalThis.fetch;
globalThis.fetch = function(input, init) { check(input); return fetcher.call(this, input, init); };
for (const module of [http, https]) for (const method of ['request', 'get']) {
  const original = module[method];
  module[method] = function(input, ...args) { check(input); return original.call(this, input, ...args); };
}
syncBuiltinESMExports();
process.on('exit', () => {
  if (blocked.size) {
    // Public hostnames only: never print request paths, payloads or credentials.
    console.error('BLOCKED_PROVIDER: automated checks attempted provider access: ' + [...blocked].join(', '));
    process.exitCode = 86;
  }
});
