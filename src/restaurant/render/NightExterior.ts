import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface NightExterior {
  root: THREE.Group;
  update(time: number, reducedMotion: boolean): void;
  dispose(): void;
}

/** A quiet, actual 3D backdrop. No city textures, videos, lights, or gameplay state. */
export function createNightExterior(): NightExterior {
  const root = new THREE.Group();
  root.name = 'restaurant-night-exterior';
  const facades: THREE.BufferGeometry[] = [];
  const panes: THREE.BufferGeometry[] = [];
  const ownedGeometries: THREE.BufferGeometry[] = [];
  const ownedMaterials: THREE.Material[] = [];
  const unitBox = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const transform = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const hash = (value: number) => {
    const n = Math.sin(value * 127.1 + 311.7) * 43758.5453;
    return n - Math.floor(n);
  };

  function box(list: THREE.BufferGeometry[], x: number, y: number, z: number, width: number, height: number, depth: number, color: string, yaw = 0) {
    const geometry = unitBox.clone();
    transform.compose(position.set(x, y, z), rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), scale.set(width, height, depth));
    geometry.applyMatrix4(transform);
    const normal = geometry.getAttribute('normal');
    const base = new THREE.Color(color);
    const colors = new Float32Array(normal.count * 3);
    for (let i = 0; i < normal.count; i++) {
      const shade = .82 + Math.max(0, normal.getY(i)) * .15 + Math.max(0, normal.getX(i)) * .1;
      colors.set([base.r * shade, base.g * shade, base.b * shade], i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    list.push(geometry);
  }

  // Buildings are deliberately simple. Near and far rows supply real parallax
  // when the player moves around the restaurant, rather than a flat window card.
  let buildings = 0;
  let litWindows = 0;
  function building(x: number, z: number, width: number, height: number, depth: number, seed: number, facing: 'rear' | 'left', far = false) {
    const floor = -2;
    const color = far ? '#223247' : ['#192b3b', '#1c2e3e', '#20313f'][seed % 3]!;
    box(facades, x, floor + height / 2, z, width, height, depth, color);
    // A modest stepped roof silhouette; no rooftop clutter or detailed facade kit.
    if (seed % 3 === 0) box(facades, x + width * .12, floor + height + .16, z, width * .58, .32, depth * .75, color);
    else box(facades, x, floor + height + .055, z, width + .08, .11, depth + .08, color);
    buildings++;
    const columns = Math.max(2, Math.floor((facing === 'rear' ? width : depth) / .73));
    const rows = Math.max(2, Math.floor(height / .9));
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      if (hash(seed * 103 + row * 13 + column * 3.7) < (far ? .93 : .86)) continue;
      const offset = (column - (columns - 1) / 2) * .65;
      const y = floor + .5 + row * .86;
      const warm = far ? '#796b55' : hash(seed + row * 7 + column) > .55 ? '#a48c65' : '#8b7a5f';
      if (facing === 'rear') box(panes, x + offset, y, z + depth / 2 + .008, .19, .32, .008, warm);
      else box(panes, x + width / 2 + .008, y, z + offset, .008, .32, .19, warm);
      litWindows++;
    }
  }

  for (const [index, values] of [
    [-10.6, -14.8, 3.5, 5.6, 3.8], [-6.4, -13.4, 3.5, 5.1, 3.3], [-2.2, -15.2, 3.6, 6.0, 3.9],
    [2.4, -14.2, 4.4, 5.2, 3.5], [7.1, -15.4, 3.6, 5.9, 4.0], [11.4, -13.5, 3.9, 4.9, 3.4],
  ].entries()) building(values[0]!, values[1]!, values[2]!, values[3]!, values[4]!, index + 1, 'rear');
  for (const [index, values] of [
    [-13.4, -9.1, 3.8, 5.2, 3.6], [-14.7, -4.7, 3.9, 6.1, 3.8], [-12.9, -.4, 3.1, 4.7, 3.5],
    [-14.1, 4.0, 3.6, 5.7, 4.0], [-13.4, 8.7, 3.2, 4.9, 3.9],
  ].entries()) building(values[0]!, values[1]!, values[2]!, values[3]!, values[4]!, index + 12, 'left');
  for (let i = 0; i < 5; i++) building(-12 + i * 5.5, -23 - hash(i) * 2, 4.4, 7 + hash(i + 12) * 2, 4.0, i + 24, 'rear', true);
  for (let i = 0; i < 4; i++) building(-23 - hash(i + 6) * 2, -10 + i * 6.5, 4.1, 7 + hash(i + 19) * 2, 4.7, i + 37, 'left', true);
  // This ground is entirely outside the restaurant footprint and only glimpsed
  // below the windows. It keeps the backdrop from feeling like floating boxes.
  box(facades, 0, -2.08, -19, 56, .12, 19, '#172739');
  box(facades, -19, -2.08, 4.5, 19, .12, 28, '#172739');
  unitBox.dispose();

  function batch(parts: THREE.BufferGeometry[], name: string, material: THREE.Material) {
    const geometry = mergeGeometries(parts, false);
    parts.forEach(part => part.dispose());
    if (!geometry) return;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.userData.backgroundOnly = true;
    root.add(mesh);
    ownedGeometries.push(geometry);
  }
  const facadeMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  const paneMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, toneMapped: false });
  ownedMaterials.push(facadeMaterial, paneMaterial);
  batch(facades, 'night-building-silhouettes', facadeMaterial);
  batch(panes, 'night-occupied-windows', paneMaterial);

  // One lightweight shader is shared by all window planes. Rain stays clipped
  // to the glass instead of drawing lines over the wall or window mullions.
  const rainMaterial = new THREE.ShaderMaterial({
    name: 'quiet-rain-on-glass',
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vWorld;
      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      void main() {
        vec2 phase = floor(vWorld.xz * .21);
        vec2 cells = vUv * vec2(63.0, 38.0);
        vec2 id = floor(cells);
        float seed = hash21(id + phase);
        vec2 center = vec2(.2 + hash21(id + phase + 2.1) * .6,
                           .2 + hash21(id + phase + 5.8) * .6);
        vec2 local = fract(cells) - center;
        float speck = (1.0 - smoothstep(.055, .14, length(local * vec2(1.0, .72)))) * step(.91, seed);

        float column = floor(vUv.x * 31.0);
        float streamSeed = hash21(vec2(column, floor(vWorld.x + vWorld.z)));
        float streamX = .2 + hash21(vec2(column + 9.0, 4.7)) * .6;
        float streamWidth = 1.0 - smoothstep(.018, .055, abs(fract(vUv.x * 31.0) - streamX));
        float head = fract(vUv.y * 1.3 + uTime * (.05 + streamSeed * .045) + streamSeed * 7.0);
        float tail = 1.0 - smoothstep(.006, .11, head);
        float streak = streamWidth * tail * step(.78, streamSeed);

        float softReflection = smoothstep(.8, 1.0, vUv.y) * .016;
        float alpha = .012 + speck * .095 + streak * .095 + softReflection;
        vec3 tint = mix(vec3(.26, .35, .44), vec3(.55, .65, .72), min(1.0, speck + streak));
        gl_FragColor = vec4(tint, alpha);
        #include <colorspace_fragment>
      }
    `,
  });
  ownedMaterials.push(rainMaterial);
  const glassGeometry = new THREE.PlaneGeometry(1, 1);
  ownedGeometries.push(glassGeometry);
  function glass(x: number, y: number, z: number, width: number, height: number, yaw = 0) {
    const mesh = new THREE.Mesh(glassGeometry, rainMaterial);
    mesh.name = 'rain-window-glass';
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, 1);
    mesh.rotation.y = yaw;
    mesh.userData.backgroundOnly = true;
    root.add(mesh);
  }
  for (const z of [-4.65, -.8, 3.2]) glass(-6.485, 2.02, z, 3.12, 1.88, Math.PI / 2);
  for (const x of [-4.4, 4.4]) glass(x, 2.05, -6.943, 3.04, 1.9);
  root.userData.buildingCount = buildings;
  root.userData.litWindowCount = litWindows;
  root.userData.weatherTime = 0;
  root.userData.reducedMotion = false;
  root.userData.source = 'authored-geometry';
  let disposed = false;

  return {
    root,
    update(time, reducedMotion) {
      if (disposed) return;
      const weatherTime = reducedMotion ? 0 : Math.max(0, Number.isFinite(time) ? time : 0);
      rainMaterial.uniforms.uTime!.value = weatherTime;
      root.userData.weatherTime = weatherTime;
      root.userData.reducedMotion = reducedMotion;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ownedGeometries.forEach(geometry => geometry.dispose());
      ownedMaterials.forEach(material => material.dispose());
      root.clear();
      root.removeFromParent();
    },
  };
}
