import type { PlayerId, VoiceSignal } from '../src/shared/protocol';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const onlyKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(k => keys.includes(k));
const limitedString = (v: unknown, bytes: number): v is string => typeof v === 'string' && Buffer.byteLength(v, 'utf8') <= bytes;
const nullableString = (v: unknown, bytes: number): v is string | null => v === null || limitedString(v, bytes);

/** Validate and copy only the supported WebRTC signaling fields. */
export function validateVoiceSignal(value: unknown, from: PlayerId): VoiceSignal | null {
  if (!record(value)) return null;
  if (value.kind === 'description' && onlyKeys(value, ['kind', 'description']) && record(value.description)) {
    const d = value.description;
    if (!onlyKeys(d, ['type', 'sdp']) || !limitedString(d.sdp, 12 * 1024) || d.sdp.length === 0) return null;
    if ((d.type === 'offer' && from === 'p1') || (d.type === 'answer' && from === 'p2')) return { kind: 'description', description: { type: d.type, sdp: d.sdp } };
    return null;
  }
  if (value.kind === 'candidate' && onlyKeys(value, ['kind', 'candidate']) && record(value.candidate)) {
    const c = value.candidate;
    if (!onlyKeys(c, ['candidate', 'sdpMid', 'sdpMLineIndex', 'usernameFragment']) || !limitedString(c.candidate, 2048) || !nullableString(c.sdpMid, 256) || !(c.sdpMLineIndex === null || (typeof c.sdpMLineIndex === 'number' && Number.isInteger(c.sdpMLineIndex) && c.sdpMLineIndex >= 0 && c.sdpMLineIndex <= 65535)) || !(c.usernameFragment === undefined || nullableString(c.usernameFragment, 256))) return null;
    const candidate: Extract<VoiceSignal, { kind: 'candidate' }>['candidate'] = { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex as number | null };
    if (c.usernameFragment !== undefined) candidate.usernameFragment = c.usernameFragment as string | null;
    return { kind: 'candidate', candidate };
  }
  return null;
}
