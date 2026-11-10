import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { validBudget, type BudgetRecord } from './budget';

declare const __GAME_BACKEND_VERSION__: string;
const runtimeName = 'restaurant';
const port = 8080;
const instance = 'basic';
const inactivityMs = 10 * 60 * 1000;
const forwardedSettings = [
  'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'DOLPHIN_LLM_API_KEY', 'ELEVENLABS_API_KEY', 'DATE_SPEECH_PROVIDER', 'DATE_ALLOW_MODEL_SELECTION',
  'DATE_CONVERSATION_PROVIDER', 'DATE_EARNED_PROVIDER', 'AI_HORDE_API_KEY', 'AI_HORDE_MODEL', 'AI_HORDE_TRANSPORT', 'AI_HORDE_TIMEOUT_MS',
  'DATE_SPEECH_MODEL', 'DATE_SPEECH_COST_PER_1K', 'DATE_SESSION_LIMIT_USD', 'DATE_DAILY_LIMIT_USD', 'DATE_MAX_OUTPUT_TOKENS', 'DATE_REQUEST_TIMEOUT_MS',
  'DATE_EDGE_VOICE_MIRA', 'DATE_EDGE_VOICE_JULES', 'DATE_EDGE_VOICE_DEV', 'DATE_EDGE_VOICE_WAITER', 'DATE_EDGE_VOICE_DINER',
  'DATE_VOICE_MIRA', 'DATE_VOICE_JULES', 'DATE_VOICE_DEV', 'DATE_VOICE_WAITER', 'DATE_VOICE_DINER',
  'DATE_ICE_SERVERS_JSON', 'VOICE_ICE_SERVERS_JSON',
] as const;
interface Env {
  ASSETS: Fetcher;
  RUNTIME: DurableObjectNamespace<RestaurantRuntime>;
  [key: string]: unknown;
}
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
function isolation(response: Response) {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin'); headers.set('Cross-Origin-Embedder-Policy', 'require-corp'); headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Only this fixed namespace name is used, preserving existing private room affinity. */
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/__server/') || url.pathname.startsWith('/__internal/')) return isolation(new Response('Not found', { status: 404 }));
    if (url.pathname.startsWith('/api/') || url.pathname === '/healthz' || request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      return isolation(await env.RUNTIME.getByName(runtimeName).fetch(request));
    }
    if (url.pathname === '/') { url.pathname = '/index.html'; return isolation(await env.ASSETS.fetch(new Request(url, request))); }
    return isolation(await env.ASSETS.fetch(request));
  },
} satisfies ExportedHandler<Env>;

export class RestaurantRuntime extends DurableObject<Env> {
  private boot?: Promise<void>;
  private ready = false;
  private activeConfig?: string;
  private startupStage = 'initializing';
  private configHash?: { source: string; digest: Promise<string> };
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }
  private async configureBridge() {
    const container = this.ctx.container!;
    const exports = this.ctx.exports as unknown as { BudgetBridge(options: { props: Record<string, never> }): Fetcher };
    this.startupStage = 'budget-bridge-export';
    const bridge = exports.BudgetBridge({ props: {} });
    this.startupStage = 'budget-bridge-intercept';
    await container.interceptOutboundHttp('budget.internal', bridge);
    if (container.running) await container.setInactivityTimeout(inactivityMs);
  }
  private settings() {
    const settings: Record<string, string> = { NODE_ENV: 'production', PORT: String(port) };
    for (const key of forwardedSettings) if (typeof this.env[key] === 'string') settings[key] = this.env[key] as string;
    return settings;
  }
  private fingerprint() {
    const source = JSON.stringify([__GAME_BACKEND_VERSION__, instance, this.settings()]);
    if (this.configHash?.source !== source) this.configHash = { source, digest: crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
      .then(bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')) };
    return this.configHash.digest;
  }
  private async healthy() {
    try { return (await this.ctx.container!.getTcpPort(port).fetch('http://runtime/healthz', { signal: AbortSignal.timeout(1500) })).ok; }
    catch { return false; }
  }
  private async startRuntime() {
    this.startupStage = 'container-binding';
    const container = this.ctx.container;
    if (!container) throw new Error('The restaurant container is not configured.');
    this.startupStage = 'configuration-fingerprint';
    const fingerprint = await this.fingerprint();
    if (container.running && await this.ctx.storage.get<string>('runtime-config') === fingerprint && await this.healthy()) { await this.configureBridge(); this.activeConfig = fingerprint; return; }
    if (container.running) await container.destroy('Restaurant code or configuration changed.');
    // Never blockConcurrencyWhile this startup: Node awaits a ledger RPC back to this object.
    const epoch = crypto.randomUUID();
    this.startupStage = 'ledger-epoch';
    await this.ctx.storage.put('runtime-epoch', epoch);
    this.startupStage = 'budget-bridge';
    await this.configureBridge();
    this.startupStage = 'container-start';
    container.start({ image: 'cloudflare/debian-trixie', entrypoint: ['sleep', 'infinity'], instance, enableInternet: true });
    this.startupStage = 'inactivity-timeout';
    await container.setInactivityTimeout(inactivityMs);
    this.startupStage = 'backend-asset';
    const bundle = await this.env.ASSETS.fetch('https://assets.internal/__server/game-server.mjs');
    if (!bundle.ok || !bundle.body) throw new Error('The packaged restaurant server is missing.');
    this.startupStage = 'backend-upload';
    const upload = await container.exec(['tee', '/tmp/table-for-two-server.mjs'], { stdin: bundle.body, stdout: 'ignore', stderr: 'ignore' });
    if (await upload.exitCode !== 0) throw new Error('The restaurant server could not be prepared.');
    this.startupStage = 'node-start';
    await container.exec(['node', '/tmp/table-for-two-server.mjs'], { env: { ...this.settings(), BUDGET_EPOCH: epoch }, stdout: 'ignore', stderr: 'ignore' });
    this.startupStage = 'node-ready';
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await this.healthy()) { await this.ctx.storage.put('runtime-config', fingerprint); this.activeConfig = fingerprint; return; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('The restaurant is taking too long to start.');
  }
  async fetch(request: Request) {
    let boot: Promise<void> | undefined;
    try {
      if (this.ready && (!this.ctx.container?.running || this.activeConfig !== await this.fingerprint())) { this.boot = undefined; this.ready = false; }
      boot = this.boot ??= this.startRuntime().then(() => { this.ready = true; });
      await boot;
      const headers = new Headers(request.headers); headers.set('x-forwarded-host', new URL(request.url).host);
      const upstream = new URL(request.url); upstream.protocol = 'http:';
      this.startupStage = 'request-proxy';
      // Community generation can spend most of a minute queued before its first byte.
      const hordeWait = Number(this.env.AI_HORDE_TIMEOUT_MS || 60_000);
      const proxyTimeout = this.env.DATE_CONVERSATION_PROVIDER === 'aihorde' || this.env.DATE_EARNED_PROVIDER === 'aihorde' || this.env.DATE_ALLOW_MODEL_SELECTION === '1' ? Math.min(120_000, Math.max(1000, Number.isFinite(hordeWait) ? hordeWait : 60_000)) + 5000 : 35_000;
      const signal = request.headers.get('upgrade')?.toLowerCase() === 'websocket' ? request.signal : AbortSignal.any([request.signal, AbortSignal.timeout(proxyTimeout)]);
      return await this.ctx.container!.getTcpPort(port).fetch(new Request(upstream, new Request(request, { headers, signal })));
    } catch (error) {
      console.error('Restaurant runtime request failed.', { stage: this.startupStage, type: error instanceof Error ? error.name : typeof error });
      if (this.boot === boot) { this.boot = undefined; this.ready = false; }
      return json({ error: 'The restaurant is warming up. Please try again in a moment.', code: 'runtime_starting' }, 503);
    }
  }
  private async checkEpoch(epoch: string) {
    if (!epoch || epoch !== await this.ctx.storage.get<string>('runtime-epoch')) throw new Error('The previous restaurant process has stopped.');
  }
  async readBudget(epoch: string): Promise<BudgetRecord | null> { await this.checkEpoch(epoch); return await this.ctx.storage.get<BudgetRecord>('budget-ledger') ?? null; }
  async saveBudget(epoch: string, value: BudgetRecord) {
    if (!validBudget(value)) throw new Error('Invalid budget ledger.');
    await this.ctx.storage.transaction(async storage => {
      if (!epoch || epoch !== await storage.get<string>('runtime-epoch')) throw new Error('The previous restaurant process has stopped.');
      await storage.put('budget-ledger', value);
    });
  }
}

/** Private loopback entrypoint: no HTTP route exposes the ledger to players. */
export class BudgetBridge extends WorkerEntrypoint<Env> {
  async fetch(request: Request) {
    try {
      if (new URL(request.url).pathname !== '/ledger') return json({ error: 'Not found' }, 404);
      const epoch = request.headers.get('x-budget-epoch') || '', runtime = this.env.RUNTIME.getByName(runtimeName);
      if (request.method === 'GET') return json(await runtime.readBudget(epoch));
      if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);
      const text = await request.text(); if (text.length > 2048) return json({ error: 'Invalid budget ledger' }, 413);
      const value: unknown = JSON.parse(text); if (!validBudget(value)) return json({ error: 'Invalid budget ledger' }, 400);
      await runtime.saveBudget(epoch, value); return json({ saved: true });
    } catch { return json({ error: 'The durable budget ledger is unavailable.' }, 503); }
  }
}
