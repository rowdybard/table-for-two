import { chromium, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { RoomState } from '../src/shared/protocol';
import { mkdir } from 'node:fs/promises';

// These contexts use Chrome's synthetic microphone and automatic fake-device
// permission; this suite never requests access to the user's real microphone.
let browser: Browser;
test.beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
});
test.afterAll(async () => { await browser.close(); });

async function instrument(context: BrowserContext, deny = false, delay = false) {
  await context.addInitScript(({ deny, delay }) => {
    const w = window as unknown as Window & { __voiceProbe: { calls: number; streams: MediaStream[]; peers: RTCPeerConnection[]; release?: () => void } };
    w.__voiceProbe = { calls: 0, streams: [], peers: [] };
    const media = navigator.mediaDevices, nativeGet = media.getUserMedia.bind(media);
    media.getUserMedia = async constraints => {
      w.__voiceProbe.calls++;
      if (deny) throw new DOMException('Permission denied for test', 'NotAllowedError');
      const stream = await nativeGet(constraints); w.__voiceProbe.streams.push(stream);
      if (delay) await new Promise<void>(resolve => { w.__voiceProbe.release = resolve; });
      return stream;
    };
    const NativePeer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeer {
      constructor(configuration?: RTCConfiguration) { super(configuration); w.__voiceProbe.peers.push(this); }
    };
  }, { deny, delay });
}
const state = (page: Page) => page.evaluate(() => (window as unknown as { __lfsState: RoomState }).__lfsState);
const media = (page: Page) => page.evaluate(() => {
  const probe = (window as unknown as { __voiceProbe: { calls: number; streams: MediaStream[] } }).__voiceProbe;
  return { calls: probe.calls, tracks: probe.streams.flatMap(stream => stream.getAudioTracks().map(track => ({ enabled: track.enabled, readyState: track.readyState }))) };
});
const packetBytes = (page: Page, type: 'inbound-rtp' | 'outbound-rtp') => page.evaluate(async type => {
  const probe = (window as unknown as { __voiceProbe: { peers: RTCPeerConnection[] } }).__voiceProbe;
  let bytes = 0;
  for (const peer of probe.peers) {
    const report = await peer.getStats();
    report.forEach(stat => { if (stat.type === type && (stat.kind === 'audio' || stat.mediaType === 'audio')) bytes += type === 'inbound-rtp' ? (stat.bytesReceived || 0) : (stat.bytesSent || 0); });
  }
  return bytes;
}, type);

test('voice requires opt-in, carries fake audio in both directions, and stops safely', async () => {
  test.setTimeout(150_000);
  const aContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const bContext = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  try {
    await Promise.all([instrument(aContext), instrument(bContext)]);
    const a = await aContext.newPage(), b = await bContext.newPage();
    await a.goto('http://127.0.0.1:5173/?venue=bowling'); await a.locator('#name').fill('Alex'); await a.locator('#join').click(); await expect(a.locator('#arrival')).toBeHidden();
    const room = (await state(a)).room;
    await b.goto('http://127.0.0.1:5173/?venue=bowling'); await b.locator('#name').fill('Sam'); await b.locator('#room').fill(room); await b.locator('#join').click();
    await expect.poll(async () => (await state(a)).phase).toBe('playing');
    expect((await media(a)).calls).toBe(0); expect((await media(b)).calls).toBe(0);
    await a.locator('#voice-toggle').click(); await b.locator('#voice-toggle').click();
    expect((await media(a)).calls).toBe(0); expect((await media(b)).calls).toBe(0);
    await a.locator('#voice-enable').click();
    await expect.poll(async () => (await media(a)).tracks.some(track => track.readyState === 'live'), { timeout: 15_000 }).toBe(true);
    expect((await media(a)).tracks.at(-1)?.enabled).toBe(false);
    expect((await media(b)).calls).toBe(0);
    await b.locator('#voice-enable').click();
    await expect.poll(async () => (await media(b)).tracks.some(track => track.readyState === 'live'), { timeout: 15_000 }).toBe(true);
    for (const page of [a,b]) for (const direction of ['inbound-rtp','outbound-rtp'] as const) {
      await expect.poll(() => packetBytes(page, direction), { timeout: 30_000 }).toBeGreaterThan(0);
    }
    await mkdir('.qa', { recursive: true });
    await a.screenshot({ path: '.qa/voice-1280.png' }); await b.screenshot({ path: '.qa/voice-1000.png' });
    await a.locator('#voice-volume').fill('0.35');
    await expect.poll(() => a.locator('#voice-output').evaluate(audio => (audio as HTMLAudioElement).volume)).toBeCloseTo(.35);
    await a.locator('#voice-mute').click(); await expect.poll(async () => (await media(a)).tracks.at(-1)?.enabled).toBe(false);
    await a.locator('#voice-close').click(); await expect(a.locator('#voice-toggle')).toHaveText('Mic muted');
    await a.screenshot({ path: '.qa/voice-muted-footer-1280.png' });
    await a.locator('#voice-toggle').click();
    await a.locator('#voice-mute').click(); await expect.poll(async () => (await media(a)).tracks.at(-1)?.enabled).toBe(true);
    await a.locator('#pause').click(); await expect.poll(async () => (await state(a)).phase).toBe('paused');
    await expect.poll(async () => (await media(a)).tracks.at(-1)?.enabled).toBe(false);
    await expect.poll(async () => (await media(b)).tracks.at(-1)?.enabled).toBe(false);
    await a.locator('#resume').click(); await b.locator('#resume').click(); await expect.poll(async () => (await state(a)).phase).toBe('playing');
    await expect.poll(async () => (await media(a)).tracks.at(-1)?.enabled).toBe(true);
    await expect.poll(async () => (await media(b)).tracks.at(-1)?.enabled).toBe(true);
    await a.locator('#voice-disable').click(); await expect.poll(async () => (await media(a)).tracks.at(-1)?.readyState).toBe('ended');
    await a.locator('#voice-enable').click(); await expect.poll(async () => (await media(a)).tracks.at(-1)?.readyState).toBe('live');

    await b.reload(); await expect.poll(async () => (await state(a)).pauseReason).toBe('reconnect');
    await b.locator('#name').fill('Sam'); await b.locator('#join').click();
    await expect.poll(async () => (await state(a)).pauseReason).toBe('manual');
    expect((await media(b)).calls).toBe(0);
    await a.locator('#resume').click(); await b.locator('#resume').click(); await expect.poll(async () => (await state(a)).phase).toBe('playing');
    expect((await media(b)).calls).toBe(0);
    await expect.poll(async () => (await media(a)).tracks.at(-1)?.readyState).toBe('ended');
    await a.locator('#leave').click();
  } finally { await aContext.close(); await bContext.close(); }
});

test('canceling a pending permission request stops a late fake stream', async () => {
  const context = await browser.newContext(), partnerContext = await browser.newContext();
  try {
    await instrument(context, false, true);
    const page = await context.newPage(), partner = await partnerContext.newPage();
    await page.goto('http://127.0.0.1:5173/?venue=bowling'); await page.locator('#join').click(); await expect(page.locator('#arrival')).toBeHidden();
    const room = (await state(page)).room;
    await partner.goto('http://127.0.0.1:5173/?venue=bowling'); await partner.locator('#name').fill('Sam'); await partner.locator('#room').fill(room); await partner.locator('#join').click();
    await expect.poll(async () => (await state(page)).phase).toBe('playing');
    await page.locator('#voice-toggle').click(); await page.locator('#voice-enable').click();
    await expect.poll(async () => (await media(page)).tracks.length).toBe(1);
    await expect(page.locator('#voice-disable')).toHaveText('Cancel'); await page.locator('#voice-disable').click();
    await page.evaluate(() => (window as unknown as { __voiceProbe: { release: () => void } }).__voiceProbe.release());
    await expect.poll(async () => (await media(page)).tracks[0]?.readyState).toBe('ended');
    expect((await state(page)).voice.enabled.p1).toBe(false);
  } finally { await context.close(); await partnerContext.close(); }
});

test('denied microphone permission does not enable voice', async () => {
  const context = await browser.newContext(), partnerContext = await browser.newContext();
  try {
    await instrument(context, true);
    const page = await context.newPage(), partner = await partnerContext.newPage();
    await page.goto('http://127.0.0.1:5173/?venue=bowling'); await page.locator('#join').click(); await expect(page.locator('#arrival')).toBeHidden();
    const room = (await state(page)).room;
    await partner.goto('http://127.0.0.1:5173/?venue=bowling'); await partner.locator('#name').fill('Sam'); await partner.locator('#room').fill(room); await partner.locator('#join').click();
    await expect.poll(async () => (await state(page)).phase).toBe('playing');
    await page.locator('#voice-toggle').click(); await page.locator('#voice-enable').click();
    await expect.poll(async () => (await media(page)).calls).toBe(1);
    await expect(page.locator('#voice-status')).toContainText(/denied|permission|microphone/i);
    expect((await media(page)).tracks).toHaveLength(0);
  } finally { await context.close(); await partnerContext.close(); }
});
