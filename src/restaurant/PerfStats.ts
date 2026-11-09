export interface RenderDiagnostics {
  gpu: string; tier: string; pixelRatio: number; width: number; height: number; calls: number; triangles: number;
  drawCount: number; software: boolean; pixelBudget: number; shadows: boolean; reflections: boolean; maxDrawFPS: number;
}
export interface PerfWindowResult { updateFPS: number; drawFPS: number; scriptMs: number; worstGap: number }

/** Measure draws separately from update callbacks; reset rather than report across counter/time discontinuities. */
export class PerfWindow {
  private start: number | undefined;
  private last = 0;
  private initialDraws = 0;
  private lastDraws = 0;
  private updates = 0;
  private scriptMs = 0;
  private worstGap = 0;

  reset() { this.start = undefined; }

  sample(now: number, frameScriptMs: number, drawCount: number): PerfWindowResult | undefined {
    if (!Number.isFinite(now) || !Number.isFinite(frameScriptMs) || !Number.isFinite(drawCount) || drawCount < 0) { this.start = undefined; return; }
    if (this.start === undefined || now < this.last || drawCount < this.lastDraws) {
      this.start = now; this.last = now; this.initialDraws = this.lastDraws = drawCount;
      this.updates = 0; this.scriptMs = 0; this.worstGap = 0;
      return;
    }
    this.worstGap = Math.max(this.worstGap, now - this.last);
    this.last = now; this.lastDraws = drawCount; this.updates++; this.scriptMs += Math.max(0, frameScriptMs);
    const span = now - this.start;
    if (span < 500) return;
    const result = { updateFPS: this.updates * 1000 / span, drawFPS: (drawCount - this.initialDraws) * 1000 / span, scriptMs: this.scriptMs / this.updates, worstGap: this.worstGap };
    this.start = now; this.initialDraws = drawCount; this.updates = 0; this.scriptMs = 0; this.worstGap = 0;
    return result;
  }
}

/** Opt-in ?stats readout; nothing is created without the flag. */
export function createPerfStats(parent: HTMLElement, read: () => RenderDiagnostics) {
  const box = document.createElement('div');
  box.id = 'perf-stats';
  box.setAttribute('aria-hidden', 'true');
  Object.assign(box.style, {
    position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 6px)', left: 'calc(env(safe-area-inset-left, 0px) + 6px)', zIndex: '90',
    padding: '4px 7px', font: '11px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace', color: '#f6eadb', background: '#120c0acc',
    whiteSpace: 'pre', pointerEvents: 'none',
  });
  box.textContent = 'measuring…';
  parent.appendChild(box);
  const window = new PerfWindow();
  const visibilityChanged = () => { window.reset(); box.textContent = 'measuring…'; };
  document.addEventListener('visibilitychange', visibilityChanged);
  return {
    /** Call once per update callback with its timestamp and script duration. */
    sample(now: number, frameScriptMs: number) {
      if (document.hidden) { window.reset(); return; }
      const d = read(), result = window.sample(now, frameScriptMs, d.drawCount);
      if (!result) return;
      const fps = (value: number) => value < 10 ? value.toFixed(1) : String(Math.round(value));
      box.textContent = `${d.gpu || 'GPU not reported'}\n${d.tier} tier · ${d.software ? 'software' : 'hardware'} · ${d.width}×${d.height} (${d.pixelRatio.toFixed(2)}x) · pixel budget ${d.pixelBudget}\n${fps(result.drawFPS)} draw fps · ${fps(result.updateFPS)} update fps · draw cap ${d.maxDrawFPS} fps · script ${result.scriptMs.toFixed(1)} ms · worst gap ${Math.round(result.worstGap)} ms\n${d.calls} draw calls · ${Math.round(d.triangles / 1000)}k tris · shadows ${d.shadows ? 'on' : 'off'} · reflections ${d.reflections ? 'on' : 'off'}`;
    },
    dispose() { document.removeEventListener('visibilitychange', visibilityChanged); box.remove(); },
  };
}
