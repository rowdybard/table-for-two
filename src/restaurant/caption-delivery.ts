/** Reading, not enqueueing, completes a caption-only delivery. */
export const captionReadingMs = (text: string) => Math.min(20000, Math.max(1400, 600 + text.trim().split(/\s+/).length * 240));

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
