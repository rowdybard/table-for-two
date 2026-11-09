import * as THREE from 'three';
import type { RestaurantPropKit } from './RestaurantPropKit';
import type { RenderQuality } from './RenderQuality';

/** Keep the lightweight botanical fallback on low-end GPUs instead of loading four dense plant clones. */
export function placeRestaurantPlant(
  props: Pick<RestaurantPropKit, 'root' | 'place'>,
  fallback: THREE.Group,
  x: number,
  z: number,
  height: number,
  yaw: number,
  quality?: Pick<RenderQuality, 'tier'>,
) {
  if (quality?.tier !== 'low') return props.place('plant', fallback, x, 0, z, height, yaw);
  const anchor = new THREE.Group();
  anchor.name = 'prop-slot-plant';
  anchor.position.set(x, 0, z);
  anchor.rotation.y = yaw;
  anchor.add(fallback);
  props.root.add(anchor);
  (props.root.userData.models as Record<string, string>).plant = 'fallback';
  return anchor;
}
