import type { PlayerId, PoolState } from '../../shared/protocol';
import { POOL } from '../../shared/venue';
import { ART } from './types';
import { drawCharacter } from './characters';

type PoolBall = PoolState['balls'][number];
type PoolLayout = { left: number; top: number; width: number; height: number; scale: number; rim: number };
const X0 = POOL.minX, X1 = POOL.maxX, Z0 = POOL.minZ, Z1 = POOL.maxZ;
const BALL = POOL.radius;
const COLORS = ['#f3e9d5', '#dbad62', '#64877f', '#c47769', '#6c6d82', '#d09469', '#935a65'];

/** The same affine transform drives both the illustration and pointer aiming. */
export function poolLayout(width: number, height: number): PoolLayout {
  const availableWidth = Math.max(100, width * .68 - 56);
  const availableHeight = Math.max(80, height * .50);
  const scale = Math.min(availableWidth / (X1 - X0), availableHeight / (Z1 - Z0));
  const tableWidth = scale * (X1 - X0), tableHeight = scale * (Z1 - Z0);
  return { left: Math.max(30, width * .035), top: Math.max(118, height * .19), width: tableWidth, height: tableHeight, scale, rim: Math.max(12, Math.min(27, scale * .20)) };
}
export function poolWorldPoint(layout: PoolLayout, x: number, y: number) {
  return { x: X0 + (x - layout.left) / layout.scale, z: Z0 + (y - layout.top) / layout.scale };
}
function screenPoint(layout: PoolLayout, x: number, z: number) {
  return { x: layout.left + (x - X0) * layout.scale, y: layout.top + (z - Z0) * layout.scale };
}
function rounded(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, stroke: string, lw = 2) {
  c.beginPath(); c.roundRect(x, y, w, h, r); c.fillStyle = fill; c.fill(); c.strokeStyle = stroke; c.lineWidth = lw; c.stroke();
}
function ball(c: CanvasRenderingContext2D, x: number, y: number, radius: number, id: number) {
  const color = COLORS[id % COLORS.length];
  const shade = c.createRadialGradient(x - radius * .38, y - radius * .48, radius * .05, x, y, radius);
  shade.addColorStop(0, '#fff9e8'); shade.addColorStop(.32, color); shade.addColorStop(1, id ? '#57434a' : '#a89d90');
  c.beginPath(); c.ellipse(x + radius * .18, y + radius * .31, radius * 1.05, radius * .72, 0, 0, Math.PI * 2); c.fillStyle = 'rgba(21,26,33,.28)'; c.fill();
  c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); c.fillStyle = shade; c.fill(); c.lineWidth = Math.max(1, radius * .12); c.strokeStyle = '#293841'; c.stroke();
  if (id) {
    c.beginPath(); c.arc(x, y, radius * .42, 0, Math.PI * 2); c.fillStyle = '#f6ecd7'; c.fill();
    c.fillStyle = '#423a40'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `bold ${Math.max(8, radius * .70)}px Georgia`; c.fillText(String(id), x, y + .2);
  }
}
function drawAim(c: CanvasRenderingContext2D, layout: PoolLayout, cue: PoolBall, angle: number, power: number, balls: readonly PoolBall[]) {
  const origin = cue.position, dx = Math.cos(angle), dz = Math.sin(angle);
  // Stop the guide at the first ball or cushion. It indicates initial direction only.
  let distance = Infinity; let hitsBall = false;
  if (dx > .0001) distance = Math.min(distance, (X1 - BALL - origin[0]) / dx);
  if (dx < -.0001) distance = Math.min(distance, (X0 + BALL - origin[0]) / dx);
  if (dz > .0001) distance = Math.min(distance, (Z1 - BALL - origin[2]) / dz);
  if (dz < -.0001) distance = Math.min(distance, (Z0 + BALL - origin[2]) / dz);
  for (const other of balls) {
    if (other.id === 0) continue;
    const ox = other.position[0] - origin[0], oz = other.position[2] - origin[2];
    const along = ox * dx + oz * dz, side2 = ox * ox + oz * oz - along * along, contact = BALL * 2;
    if (along > 0 && side2 < contact * contact) {
      const hit = along - Math.sqrt(Math.max(0, contact * contact - side2));
      if (hit >= 0 && hit < distance) { distance = hit; hitsBall = true; }
    }
  }
  const start = screenPoint(layout, origin[0], origin[2]), end = screenPoint(layout, origin[0] + dx * Math.max(0, distance), origin[2] + dz * Math.max(0, distance));
  c.save(); c.beginPath(); c.rect(layout.left, layout.top, layout.width, layout.height); c.clip();
  c.setLineDash([8, 7]); c.lineWidth = Math.max(2, layout.scale * .018); c.strokeStyle = 'rgba(255,244,210,.86)'; c.beginPath(); c.moveTo(start.x, start.y); c.lineTo(end.x, end.y); c.stroke(); c.setLineDash([]);
  if (hitsBall) { c.beginPath(); c.arc(end.x, end.y, BALL * layout.scale, 0, Math.PI * 2); c.strokeStyle = 'rgba(255,244,210,.58)'; c.lineWidth = 1.5; c.stroke(); } c.restore();
  // Cue points toward the ball; power controls the visible pullback distance.
  const r = BALL * layout.scale, pull = r * (1.8 + Math.max(0, Math.min(1, power)) * 2.5);
  c.save(); c.translate(start.x, start.y); c.rotate(angle); c.lineCap = 'round';
  c.strokeStyle = '#3b343c'; c.lineWidth = Math.max(5, r * .48); c.beginPath(); c.moveTo(-pull - layout.scale * .9, 0); c.lineTo(-pull, 0); c.stroke();
  c.strokeStyle = '#d3ad7c'; c.lineWidth = Math.max(3, r * .28); c.beginPath(); c.moveTo(-pull - layout.scale * .84, 0); c.lineTo(-pull, 0); c.stroke(); c.restore();
}

export function drawPoolView(c: CanvasRenderingContext2D, width: number, height: number, state: PoolState, localId: PlayerId, angle: number, power: number, time: number, players: { id: PlayerId; name: string }[]) {
  const l = poolLayout(width, height), rim = l.rim;
  c.save();
  // This close view has its own floor. Rendering venue furniture underneath the
  // two player figures made them appear to stand on the foreground counter.
  const backdrop = c.createLinearGradient(0, 0, 0, height);
  backdrop.addColorStop(0, '#282936'); backdrop.addColorStop(.55, '#382e3b'); backdrop.addColorStop(1, '#513841');
  c.fillStyle = backdrop; c.fillRect(0, 0, width, height);
  c.fillStyle = 'rgba(17,22,31,.24)'; c.beginPath(); c.ellipse(l.left + l.width * .5, l.top + l.height + rim * 1.4, l.width * .48, rim * 1.5, 0, 0, Math.PI * 2); c.fill();
  // The horizontal felt exactly maps x; vertical felt exactly maps z.
  rounded(c, l.left - rim - 5, l.top - rim - 5, l.width + 2 * rim + 10, l.height + 2 * rim + 10, rim * .75, '#3b3039', '#222532', 3);
  rounded(c, l.left - rim, l.top - rim, l.width + 2 * rim, l.height + 2 * rim, rim * .6, '#9b6c56', '#4d3a3d', 2);
  rounded(c, l.left - rim * .5, l.top - rim * .5, l.width + rim, l.height + rim, rim * .35, '#bf9270', '#715149', 2);
  const felt = c.createLinearGradient(l.left, l.top, l.left + l.width, l.top + l.height); felt.addColorStop(0, '#538078'); felt.addColorStop(.55, '#416e69'); felt.addColorStop(1, '#355d5d');
  c.fillStyle = felt; c.fillRect(l.left, l.top, l.width, l.height); c.strokeStyle = '#2b4a4b'; c.lineWidth = 2; c.strokeRect(l.left, l.top, l.width, l.height);
  // Fine cloth grain and rail diamonds stay subordinate to the balls.
  c.save(); c.beginPath(); c.rect(l.left, l.top, l.width, l.height); c.clip(); c.globalAlpha = .07; c.strokeStyle = '#d7e0c8'; c.lineWidth = 1;
  for (let i = -l.height; i < l.width; i += 9) { c.beginPath(); c.moveTo(l.left + i, l.top); c.lineTo(l.left + i + l.height, l.top + l.height); c.stroke(); }
  c.restore();
  for (const x of [X0, POOL.centerX, X1]) for (const z of [Z0, Z1]) {
    const p = screenPoint(l, x, z); c.beginPath(); c.arc(p.x, p.y, l.scale * POOL.pocketRadius, 0, Math.PI * 2); c.fillStyle = '#202c31'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#caa37b'; c.stroke();
  }
  for (const fraction of [.25, .5, .75]) for (const z of [Z0, Z1]) {
    const p = screenPoint(l, X0 + (X1 - X0) * fraction, z); c.save(); c.translate(p.x, p.y + (z === Z0 ? -rim * .72 : rim * .72)); c.rotate(Math.PI / 4); c.fillStyle = '#edcf9e'; c.fillRect(-2.5, -2.5, 5, 5); c.restore();
  }
  const cue = state.balls.find(b => b.id === 0);
  if (cue && state.phase === 'aiming' && state.turn === localId) drawAim(c, l, cue, angle, power, state.balls);
  for (const b of state.balls) { const p = screenPoint(l, b.position[0], b.position[2]); ball(c, p.x, p.y, BALL * l.scale, b.id); }
  // Two small full-body figures are placed below the table, never over the balls.
  const baseline = Math.min(height - 22, l.top + l.height + rim + Math.min(155, height * .20));
  const scale = Math.max(.32, Math.min(.55, (baseline - (l.top + l.height + rim) - 5) / 200));
  for (let i = 0; i < Math.min(2, players.length); i++) {
    const p = players[i], x = l.left + 55 + i * Math.min(120, l.width * .2);
    drawCharacter(c, { x, y: baseline, scale, facing: i === 0 ? 1 : -1, walk: 0, time, variant: p.id === 'p1' ? 'alex' : 'sam', mood: 'idle' });
    c.fillStyle = ART.cream; c.strokeStyle = ART.shadow; c.lineWidth = 3; c.font = '600 11px Segoe UI'; c.textAlign = 'center'; c.textBaseline = 'top'; c.strokeText(p.name, x, baseline + 4); c.fillText(p.name, x, baseline + 4);
  }
  c.restore();
}
