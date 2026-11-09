export interface RenderDiagnostics { gpu: string; tier: string; pixelRatio: number; width: number; height: number; calls: number; triangles: number }

/**
 * Opt-in `?stats` readout for diagnosing slow devices: the GPU WebGL reports, frame rate, script time per
 * frame, the worst gap between frames and the last frame's draw calls. Refreshes twice a second; nothing is
 * created without the flag.
 */
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
  let windowStart = 0, last = 0, frames = 0, scriptMs = 0, worstGap = 0;
  return {
    /** Call once per animation frame with its timestamp and the script time the frame took. */
    sample(now: number, frameScriptMs: number) {
      if (last) worstGap = Math.max(worstGap, now - last);
      last = now; frames++; scriptMs += frameScriptMs;
      if (!windowStart) { windowStart = now; return; }
      const span = now - windowStart;
      if (span < 500) return;
      const d = read();
      box.textContent = `${d.gpu || 'GPU not reported'}\n${d.tier} tier · ${d.width}×${d.height} (${d.pixelRatio.toFixed(2)}x) · ${Math.round(frames * 1000 / span)} fps · script ${(scriptMs / frames).toFixed(1)} ms · worst gap ${Math.round(worstGap)} ms · ${d.calls} draws · ${Math.round(d.triangles / 1000)}k tris`;
      windowStart = now; frames = 0; scriptMs = 0; worstGap = 0;
    },
    dispose() { box.remove(); },
  };
}
