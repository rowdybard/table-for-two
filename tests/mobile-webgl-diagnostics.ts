import type { Page } from '@playwright/test';

export type MobileGLSample = {
  tag: string; time: number; frames: number; drawCalls: number; frameDrawCalls: number;
  clearCalls: number; contextLost: boolean; buffer: number[]; viewport: number[];
  framebuffer: boolean; errors: number[]; pixels: number[][]; image: string;
  attributes: WebGLContextAttributes | null;
  alpha: { min: number; max: number; opaqueSamples: number; sampleCount: number };
};
type Monitor = {
  frames: number; drawCalls: number; clearCalls: number; capture: string | null;
  requestedFrame: number; samples: MobileGLSample[]; events: { type: string; time: number }[];
  sizes: { name: string; value: number; time: number }[];
};
declare global { interface Window { __mobileGLDiagnostics?: Monitor } }

/**
 * Read inside the game's render callback, before its normal draw buffer is discarded.
 * Windows Playwright WebKit can capture a blank composited canvas after resize while
 * this actual GL buffer contains the correctly rendered scene. Keep that distinction
 * explicit instead of changing production buffer preservation to satisfy screenshots.
 */
export async function installMobileGLDiagnostics(page: Page) {
  await page.addInitScript(() => {
    const monitor: Monitor = { frames: 0, drawCalls: 0, clearCalls: 0, capture: null, requestedFrame: 0, samples: [], events: [], sizes: [] };
    window.__mobileGLDiagnostics = monitor;
    let gl: WebGL2RenderingContext | null = null;
    const contexts = new WeakSet<object>();
    const canvasPrototype = HTMLCanvasElement.prototype;
    for (const name of ['width', 'height'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(canvasPrototype, name)!;
      Object.defineProperty(canvasPrototype, name, { ...descriptor, set(this: HTMLCanvasElement, value: number) {
        if (this.classList.contains('restaurant-canvas')) { monitor.sizes.push({ name, value, time: performance.now() }); if (monitor.sizes.length > 40) monitor.sizes.shift(); }
        descriptor.set!.call(this, value);
      } });
    }
    const prototype = canvasPrototype as unknown as { getContext(...args: unknown[]): unknown };
    const originalContext = prototype.getContext;
    prototype.getContext = function(this: HTMLCanvasElement, ...args: unknown[]) {
      const result = originalContext.apply(this, args);
      if (result && ['webgl', 'webgl2', 'experimental-webgl'].includes(String(args[0])) && !contexts.has(result as object)) {
        contexts.add(result as object); gl = result as WebGL2RenderingContext;
        this.addEventListener('webglcontextlost', () => monitor.events.push({ type: 'lost', time: performance.now() }));
        this.addEventListener('webglcontextrestored', () => monitor.events.push({ type: 'restored', time: performance.now() }));
        this.addEventListener('webglcontextcreationerror', () => monitor.events.push({ type: 'creation-error', time: performance.now() }));
        const calls = gl as unknown as Record<string, (...args: number[]) => void>;
        for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'clear']) {
          const original = calls[name];
          if (typeof original !== 'function') continue;
          const context = gl;
          calls[name] = function(...values: number[]) {
            if (name === 'clear') monitor.clearCalls++; else monitor.drawCalls++;
            return original.apply(context, values);
          };
        }
      }
      return result;
    };
    const sample = (context: WebGL2RenderingContext, frameDrawCalls: number) => {
      const errors: number[] = [], pixels: number[][] = [];
      let error: number;
      while ((error = context.getError()) !== context.NO_ERROR && errors.length < 12) errors.push(error);
      for (const y of [.15, .35, .55, .75, .9]) for (const x of [.1, .3, .5, .7, .9]) {
        const pixel = new Uint8Array(4);
        context.readPixels(Math.floor(context.drawingBufferWidth * x), Math.floor(context.drawingBufferHeight * y), 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
        pixels.push([...pixel]);
      }
      while ((error = context.getError()) !== context.NO_ERROR && errors.length < 12) errors.push(error);
      monitor.samples.push({ tag: monitor.capture!, time: performance.now(), frames: monitor.frames, drawCalls: monitor.drawCalls,
        frameDrawCalls, clearCalls: monitor.clearCalls, contextLost: context.isContextLost(), buffer: [context.drawingBufferWidth, context.drawingBufferHeight],
        viewport: Array.from(context.getParameter(context.VIEWPORT) ?? []), framebuffer: !!context.getParameter(context.FRAMEBUFFER_BINDING),
        attributes: context.getContextAttributes(), errors, pixels,
        alpha: { min: Math.min(...pixels.map(pixel => pixel[3])), max: Math.max(...pixels.map(pixel => pixel[3])), opaqueSamples: pixels.filter(pixel => pixel[3] === 255).length, sampleCount: pixels.length },
        image: (context.canvas as HTMLCanvasElement).toDataURL('image/png') });
      monitor.capture = null;
    };
    const originalFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => originalFrame(time => {
      const callsBefore = monitor.drawCalls;
      callback.call(window, time); monitor.frames++;
      if (monitor.capture && gl && (monitor.drawCalls > callsBefore || monitor.frames - monitor.requestedFrame >= 12)) sample(gl, monitor.drawCalls - callsBefore);
    });
  });
}

export async function captureMobileGL(page: Page, tag: string) {
  await page.evaluate(tag => { const monitor = window.__mobileGLDiagnostics!; monitor.capture = tag; monitor.requestedFrame = monitor.frames; }, tag);
  await page.waitForFunction(tag => window.__mobileGLDiagnostics!.samples.some(sample => sample.tag === tag), tag);
  return page.evaluate(tag => window.__mobileGLDiagnostics!.samples.find(sample => sample.tag === tag)!, tag);
}

export async function readMobileGLDiagnostics(page: Page) {
  return page.evaluate(() => {
    const monitor = window.__mobileGLDiagnostics!;
    return { ...monitor, samples: monitor.samples.map(({ image: _image, ...sample }) => sample) };
  });
}
