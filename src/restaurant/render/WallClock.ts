import * as THREE from 'three';
import { EVENING_EXCHANGES } from '../evening';

/** The restaurant closes at eleven; each exchange moves the clock five minutes, so a full evening starts at eight. */
export const CLOSING_HOUR = 11, MINUTES_PER_EXCHANGE = 5;

/** Minutes past twelve shown on the wall for the exchanges still to come. */
export function wallClockMinutes(exchangesLeft: number, total = EVENING_EXCHANGES): number {
  const left = Math.max(0, Math.min(total, Number.isFinite(exchangesLeft) ? exchangesLeft : total));
  return CLOSING_HOUR * 60 - left * MINUTES_PER_EXCHANGE;
}
/** Clockwise hand angles in radians from twelve o'clock. */
export function wallClockAngles(minutes: number): { hour: number; minute: number } {
  return { hour: (minutes / 720) * Math.PI * 2, minute: ((minutes % 60) / 60) * Math.PI * 2 };
}

export interface WallClock {
  root: THREE.Group;
  /** Move the hands toward the time for this many exchanges left. Server state decides the time; this only shows it. */
  update(exchangesLeft: number, dt: number, reducedMotion?: boolean): void;
  dispose(): void;
}

function faceTexture(): THREE.CanvasTexture {
  const size = 512, c = size / 2, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f1e6cc'; ctx.fillRect(0, 0, size, size);
  // The last quarter hour before closing is marked on the dial, the way a kitchen marks last orders.
  ctx.fillStyle = '#b5523f'; ctx.beginPath(); ctx.moveTo(c, c);
  ctx.arc(c, c, c * .93, -Math.PI / 2 - Math.PI / 2, -Math.PI / 2); ctx.closePath();
  ctx.globalAlpha = .2; ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = '#2b2a26'; ctx.fillStyle = '#2b2a26'; ctx.lineCap = 'butt';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2, major = i % 5 === 0, inner = c * (major ? .8 : .88);
    ctx.lineWidth = major ? 9 : 3;
    ctx.beginPath(); ctx.moveTo(c + Math.sin(a) * inner, c - Math.cos(a) * inner); ctx.lineTo(c + Math.sin(a) * c * .93, c - Math.cos(a) * c * .93); ctx.stroke();
  }
  ctx.font = '600 62px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let hour = 1; hour <= 12; hour++) {
    const a = (hour / 12) * Math.PI * 2;
    ctx.fillStyle = hour === CLOSING_HOUR ? '#a23a2a' : '#2b2a26';
    ctx.fillText(String(hour), c + Math.sin(a) * c * .64, c - Math.cos(a) * c * .64 + 4);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

/** A large station clock for the back wall. One face texture drawn once; the hands are the only moving parts. */
export function createWallClock(radius = .5): WallClock {
  const root = new THREE.Group(); root.name = 'wall-clock';
  const texture = faceTexture();
  // A little self-light keeps the dial readable from the table in the dim room without adding a lamp.
  const faceMat = new THREE.MeshStandardMaterial({ map: texture, emissive: '#ffffff', emissiveMap: texture, emissiveIntensity: .32, roughness: .6 });
  const rimMat = new THREE.MeshStandardMaterial({ color: '#8a6a3a', roughness: .38, metalness: .85 });
  const handMat = new THREE.MeshStandardMaterial({ color: '#1d1c1a', roughness: .5 });
  const geometries: THREE.BufferGeometry[] = [];
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material) => { geometries.push(geometry); const item = new THREE.Mesh(geometry, material); root.add(item); return item; };
  const body = mesh(new THREE.CylinderGeometry(radius * 1.08, radius * 1.08, .07, 48), rimMat);
  body.rotation.x = Math.PI / 2; body.position.z = .035;
  const face = mesh(new THREE.CircleGeometry(radius, 48), faceMat); face.position.z = .072;
  const hand = (length: number, width: number, z: number) => {
    const geometry = new THREE.BoxGeometry(width, length, .012);
    geometry.translate(0, length / 2 - length * .14, 0); // pivot near the tail, like a real hand
    const pivot = mesh(geometry, handMat); pivot.position.z = z;
    return pivot;
  };
  const hour = hand(radius * .56, radius * .075, .085), minute = hand(radius * .86, radius * .05, .098);
  const cap = mesh(new THREE.CylinderGeometry(radius * .06, radius * .06, .03, 20), rimMat); cap.rotation.x = Math.PI / 2; cap.position.z = .105;
  let shown: number | null = null;
  const place = (minutes: number) => { const angles = wallClockAngles(minutes); hour.rotation.z = -angles.hour; minute.rotation.z = -angles.minute; };
  place(wallClockMinutes(EVENING_EXCHANGES));
  return {
    root,
    update(exchangesLeft, dt, reducedMotion = false) {
      const target = wallClockMinutes(exchangesLeft);
      // The hands sweep forward to each new time; a fresh evening (or reduced motion) sets them directly.
      if (shown === null || reducedMotion || target < shown || target - shown > 30) shown = target;
      else if (shown !== target) shown = Math.min(target, shown + Math.max(0, dt) * 4);
      place(shown);
    },
    dispose() { geometries.forEach(geometry => geometry.dispose()); texture.dispose(); faceMat.dispose(); rimMat.dispose(); handMat.dispose(); },
  };
}
