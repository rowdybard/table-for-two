import { EdgeTTS } from 'node-edge-tts';
import { CHROMIUM_FULL_VERSION, generateSecMsGecToken_V2, SEC_MS_GEC_VERSION_V2, TRUSTED_CLIENT_TOKEN } from 'node-edge-tts/dist/drm.js';
import { WebSocket, type ClientOptions } from 'ws';
import type { SceneUtterance } from '../../src/restaurant/types';
import { DateApiError, speechText, type SpeechAdapter, type SpeechRequest, type SpeechSettings } from './providers';

// The pinned MIT client maintains the Edge consumer protocol, SSML and frame
// parsing. Its public connection hook is overridden only to give game interrupts
// immediate cancellation, including while the WebSocket handshake is pending.
// https://github.com/SchneeHertz/node-edge-tts
// This consumer service has no availability guarantee or supported emotion styles.
export const EDGE_MODEL = 'edge-neural-v1';
export const EDGE_VOICES = { mira: 'en-US-AvaMultilingualNeural', jules: 'en-GB-SoniaNeural', dev: 'en-US-AndrewMultilingualNeural', waiter: 'en-GB-RyanNeural', diner: 'en-US-GuyNeural' } as const;
export const EDGE_FORMAT = 'audio-24khz-96kbitrate-mono-mp3';
export function edgeSettings(emotion: SceneUtterance['emotion']): SpeechSettings {
  // Small prosody changes, not a claim that Edge supports acted emotional styles.
  const values = { neutral: [0, 0], amused: [4, 2], warm: [-3, 0], flirtatious: [-3, 2], embarrassed: [-5, -2], annoyed: [2, -2], angry: [6, -3], defensive: [1, -1], surprised: [5, 3] }[emotion];
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${value}`;
  return { rate: `${signed(values[0])}%`, pitch: `${signed(values[1])}Hz`, volume: '+0%', outputFormat: EDGE_FORMAT };
}

export function edgeSpeechAdapter(createSocket: (url: URL, options: ClientOptions) => WebSocket = (url, options) => new WebSocket(url, options), timeoutMs = 12_000): SpeechAdapter {
  const once = edgeAttempt(createSocket, timeoutMs);
  // The consumer service drops the odd connection. It is free, so a failure before any audio
  // gets one quick second try instead of sending the player to the robotic device voice.
  // A timeout is not retried: the request has already waited long enough.
  return { async *stream(request: SpeechRequest, signal: AbortSignal) {
    for (let attempt = 0; ; attempt++) {
      let heard = false;
      try { for await (const chunk of once(request, signal)) { heard = true; yield chunk; } return; }
      catch (error) {
        if (heard || attempt > 0 || signal.aborted || !(error instanceof DateApiError) || error.code !== 'edge_speech' || /timed out/.test(error.message)) throw error;
      }
    }
  } };
}

function edgeAttempt(createSocket: (url: URL, options: ClientOptions) => WebSocket, timeoutMs: number) {
  return async function* (request: SpeechRequest, signal: AbortSignal) {
    const interrupted = () => new DateApiError(499, 'interrupted', 'Speech interrupted.');
    if (signal.aborted) throw interrupted();
    if (!/^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+Neural$/.test(request.voiceId)) throw new DateApiError(503, 'edge_voice', 'The configured free character voice is unavailable. Device voices and captions remain available.');
    const settings = request.settings ?? edgeSettings(request.emotion);
    let socket: WebSocket | undefined;
    const abort = () => socket?.terminate();
    signal.addEventListener('abort', abort, { once: true });
    const client = new EdgeTTS({ voice: request.voiceId, lang: request.voiceId.split('-').slice(0, 2).join('-'), ...settings, timeout: timeoutMs });
    client._connectWebSocket = () => new Promise<WebSocket>((resolve, reject) => {
      if (signal.aborted) { reject(interrupted()); return; }
      const url = new URL('wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1');
      url.searchParams.set('Ocp-Apim-Subscription-Key', TRUSTED_CLIENT_TOKEN);
      url.searchParams.set('Sec-MS-GEC', generateSecMsGecToken_V2());
      url.searchParams.set('Sec-MS-GEC-Version', SEC_MS_GEC_VERSION_V2);
      const major = CHROMIUM_FULL_VERSION.split('.')[0];
      const ws = socket = createSocket(url, { host: 'speech.platform.bing.com', origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold', handshakeTimeout: timeoutMs, maxPayload: 2 * 1024 * 1024, headers: {
        'Pragma': 'no-cache', 'Cache-Control': 'no-cache', 'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`,
        'Accept-Encoding': 'gzip, deflate, br, zstd', 'Accept-Language': 'en-US,en;q=0.9',
      } });
      // ws emits an error while terminating a pending handshake. Keep a guarded
      // listener until close even after this connection promise has settled.
      const ignoreTermination = () => {};
      ws.on('error', ignoreTermination); ws.once('close', () => ws.off('error', ignoreTermination));
      const timeout = setTimeout(() => { cleanup(); reject(new DateApiError(503, 'edge_speech', 'The free voice service timed out. Device voices and captions remain available.')); ws.terminate(); }, timeoutMs);
      const cleanup = () => { clearTimeout(timeout); ws.off('open', opened); ws.off('error', failed); ws.off('close', closed); };
      const opened = () => { cleanup(); if (signal.aborted) { ws.terminate(); reject(interrupted()); } else resolve(ws); };
      const failed = () => { cleanup(); reject(signal.aborted ? interrupted() : new DateApiError(503, 'edge_speech', 'The free voice service could not connect. Device voices and captions remain available.')); };
      const closed = () => { cleanup(); reject(signal.aborted ? interrupted() : new DateApiError(503, 'edge_speech', 'The free voice connection closed before it was ready.')); };
      ws.once('open', opened); ws.once('error', failed); ws.once('close', closed);
    });
    try {
      let total = 0;
      for await (const chunk of client.streamAudio(speechText({ ...request, provider: 'edge' }))) {
        if (signal.aborted) throw interrupted();
        if (!Buffer.isBuffer(chunk)) continue;
        total += chunk.length;
        if (total > 5 * 1024 * 1024) throw new DateApiError(502, 'speech_limit', 'The free voice response exceeded its size limit.');
        yield chunk;
      }
      if (signal.aborted) throw interrupted();
      if (!total) throw new DateApiError(503, 'edge_speech', 'The free voice service returned no audio. Device voices and captions remain available.');
    } catch (error) {
      if (signal.aborted) throw interrupted();
      if (error instanceof DateApiError) throw error;
      // The pinned client reports its stream deadline as an ordinary Error.
      // Preserve that distinction so the outer quick retry cannot double it.
      if (error instanceof Error && error.message === 'Timed out waiting for Edge TTS') throw new DateApiError(503, 'edge_speech', 'The free voice service timed out. Device voices and captions remain available.');
      throw new DateApiError(503, 'edge_speech', 'The free voice service is unavailable. Device voices and captions remain available.');
    } finally { signal.removeEventListener('abort', abort); if (socket && socket.readyState !== WebSocket.CLOSED) socket.terminate(); }
  };
}
