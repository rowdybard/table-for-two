import * as THREE from 'three';
import { RestaurantRenderer } from '../../src/restaurant/RestaurantRenderer';
import type { AudioPlayback, DinnerState } from '../../src/restaurant/types';

/** A deterministic harness for looking at the date: the caller advances scene time and frames on demand. */
const container = document.querySelector<HTMLElement>('#stage')!;
const params = new URLSearchParams(location.search);
const renderer = new RestaurantRenderer(container, (params.get('date') as 'mira') || 'mira');
renderer.setPresentation('gameplay');
let state: DinnerState | null = null;
let playback: AudioPlayback = { speaker: null, amplitude: 0, emotion: 'neutral', caption: '' };
const internal = renderer as unknown as { renderer: THREE.WebGLRenderer };
Object.assign(window, { dateFixture: {
  renderer,
  setState(value: DinnerState) { state = value; },
  setPlayback(value: AudioPlayback) { playback = value; },
  setBehaviour(value: Record<string, unknown>) { (renderer as unknown as { setDateBehaviourInput(v: Record<string, unknown>): void }).setDateBehaviourInput?.(value); },
  /** Advance scene time in fixed steps and leave the last frame on the canvas. */
  advance(seconds: number, step = .1) { if (!state) return false; for (let t = 0; t < seconds; t += step) { state.elapsed += step; renderer.update(step, state, playback); } return renderer.isReady; },
  /** Look from a given point at a given point (world). */
  view(from: number[], at: number[], fov = 40) { const c = renderer.camera; c.position.set(from[0]!, from[1]!, from[2]!); c.fov = fov; c.updateProjectionMatrix(); c.lookAt(at[0]!, at[1]!, at[2]!); internal.renderer.render(renderer.scene, c); return internal.renderer.domElement.toDataURL('image/png'); },
  ready() { return renderer.isReady; },
} });
