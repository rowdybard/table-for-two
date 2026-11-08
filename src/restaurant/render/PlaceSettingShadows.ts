import * as THREE from 'three';
import { RESTAURANT } from '../content';

/** Soft contact beneath the stationary place settings. Positions are in table metres. */
export function createPlaceSettingShadows() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d')!;
  const span = 1.8;
  const centerZ = RESTAURANT.table[2];
  function contact(x: number, z: number, radiusX: number, radiusZ: number, opacity: number) {
    context.save();
    context.translate((x / span + .5) * canvas.width, ((z - centerZ) / span + .5) * canvas.height);
    context.scale(radiusX * canvas.width / span, radiusZ * canvas.height / span);
    const shade = context.createRadialGradient(0, 0, .18, 0, 0, 1);
    shade.addColorStop(0, `rgba(53, 26, 27, ${opacity})`);
    shade.addColorStop(.55, `rgba(65, 32, 33, ${opacity * .6})`);
    shade.addColorStop(1, 'rgba(65, 32, 33, 0)');
    context.fillStyle = shade;
    context.fillRect(-1, -1, 2, 2);
    context.restore();
  }
  for (const z of [-.64, -1.67]) {
    contact(.015, z + .013, .23, .218, .65);
    contact(.29, z + .013, .059, .135, .56);
    contact(-.241, z + .007, .022, .134, .45);
    contact(.225, z + .008, .019, .124, .46);
  }
  contact(-.27, -1.105, .085, .065, .68);
  contact(-.50, -1.337, .104, .09, .67);
  contact(-.425, -1.69, .072, .063, .51);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(span, span), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, .7835, centerZ);
  return { mesh, dispose() { texture.dispose(); material.dispose(); mesh.geometry.dispose(); } };
}
