import type { ClaudeModel, ProviderStatus, TurnEvent } from './types';

/** Server processing budget plus a small transport margin; old servers remain compatible. */
export function replyDeadlineMs(status: Pick<ProviderStatus, 'horde' | 'conversationTimeoutMs' | 'hordeTimeoutMs'> | undefined, model?: ClaudeModel): number {
  const budget = (horde: boolean) => {
    const configured = horde ? status?.hordeTimeoutMs : status?.conversationTimeoutMs;
    return typeof configured === 'number' && Number.isFinite(configured)
      ? Math.max(1, Math.min(120000, configured)) : horde ? 60000 : 25000;
  };
  return (model ? budget(model === 'ai-horde') : Math.max(budget(false), status?.horde ? budget(true) : 0)) + 5000;
}

/** Consume the actual NDJSON protocol, including terminal state after a provider error.
 * A clean HTTP EOF without `done` is an interrupted reply, never silent success. */
export async function consumeTurnResponse(response: Response, signal: AbortSignal, onEvent: (event: TurnEvent) => void): Promise<void> {
  if (!response.body) throw new Error('The conversation stream was empty. Please try again.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', complete = false, ended = false, failure: Error | undefined;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const consume = (line: string) => {
    if (!line.trim()) return;
    let event: TurnEvent;
    try { event = JSON.parse(line) as TurnEvent; } catch { throw new Error('The conversation connection returned an unreadable reply. Please try again.'); }
    if (event.type === 'error') failure = new Error(event.message);
    if (event.type === 'done') complete = true;
    onEvent(event);
  };
  try {
    signal.throwIfAborted();
    while (true) {
      const next = await reader.read(); signal.throwIfAborted();
      buffer += decoder.decode(next.value, { stream: !next.done });
      if (buffer.length > 256000) throw new Error('The conversation connection returned too much data.');
      const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
      for (const line of lines) { consume(line); if (complete) break; }
      // `done` is the protocol boundary. A proxy that keeps its HTTP body open
      // must not keep a successfully completed conversation busy.
      if (complete) { cancel(); ended = true; break; }
      if (next.done) { consume(buffer); ended = true; break; }
    }
    if (failure) throw failure;
    if (!complete) throw new Error('The reply was interrupted. You can try another turn.');
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!ended) cancel();
    reader.releaseLock();
  }
}
