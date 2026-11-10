/** Reading, not enqueueing, completes a caption-only delivery. */
export const captionReadingMs = (text: string) => Math.min(20000, Math.max(1400, 600 + text.trim().split(/\s+/).length * 240));

type CaptionFrames = { request(callback: FrameRequestCallback): number; cancel(id: number): void };
/** Two animation frames give newly inserted text a paint opportunity before its reading interval starts. */
export function waitForCaptionPaint(signal: AbortSignal, visibility: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>, isVisible: () => boolean, frames: CaptionFrames, timeoutMs = 5000): Promise<boolean> {
  if (signal.aborted || !isVisible()) return Promise.resolve(false);
  return new Promise(resolve => {
    let frame: number | undefined, remaining = 2, finished = false;
    const finish = (painted: boolean) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (frame !== undefined) frames.cancel(frame);
      signal.removeEventListener('abort', aborted); visibility.removeEventListener('visibilitychange', changed);
      resolve(painted);
    };
    const aborted = () => finish(false), changed = () => { if (!isVisible()) finish(false); };
    const next: FrameRequestCallback = () => {
      if (finished) return;
      if (!isVisible()) { finish(false); return; }
      if (--remaining === 0) { finish(true); return; }
      frame = frames.request(next);
    };
    const timer = setTimeout(() => finish(false), Math.max(0, timeoutMs));
    signal.addEventListener('abort', aborted, { once: true }); visibility.addEventListener('visibilitychange', changed);
    frame = frames.request(next);
  });
}

export function waitForCaptionReading(ms: number, signal: AbortSignal, visibility: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>, isVisible: () => boolean): Promise<boolean> {
  if (signal.aborted || !isVisible()) return Promise.resolve(false);
  return new Promise(resolve => {
    const finish = (completed: boolean) => {
      clearTimeout(timer); signal.removeEventListener('abort', aborted); visibility.removeEventListener('visibilitychange', changed);
      resolve(completed);
    };
    const aborted = () => finish(false);
    const changed = () => { if (!isVisible()) finish(false); };
    const timer = setTimeout(() => finish(isVisible()), Math.max(0, ms));
    signal.addEventListener('abort', aborted, { once: true }); visibility.addEventListener('visibilitychange', changed);
  });
}
