import type * as THREE from 'three';
import type { RenderQuality } from './RenderQuality';

/** Avoid the full-window animated rain shader on low-end renderers. */
export function applyNightExteriorQuality(root: THREE.Object3D, quality?: Pick<RenderQuality, 'tier'>) {
  if (quality?.tier !== 'low') return;
  root.traverse(object => {
    if (object.name === 'rain-window-glass') object.visible = false;
  });
}
