import type { PlayerId, PoolState } from '../../shared/protocol';
import { POOL } from '../../shared/venue';
import { poolLayout } from '../illustrated/poolView';
import { pixelText } from './font';
import { drawPixelCharacter } from './characters';

const COLORS = ['#f4e7c8', '#dca854', '#507f81', '#be6854', '#74627c', '#ce8652', '#a6505b'];
function circle(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  c.fillStyle = color; const radius = Math.max(1, Math.round(r));
  for (let dy = -radius; dy <= radius; dy++) {
    const dx = Math.floor(Math.sqrt(radius * radius - dy * dy));
    c.fillRect(Math.round(x) - dx, Math.round(y) + dy, dx * 2 + 1, 1);
  }
}
function line(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, size = 1) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); c.fillStyle = color;
  for (let i = 0; i <= steps; i++) { const t = i / Math.max(1, steps); c.fillRect(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), size, size); }
}

/** Pixel presentation keeps exactly the existing CSS-coordinate pointer transform. */
export function drawPixelPoolView(c: CanvasRenderingContext2D, width: number, height: number, cssWidth: number, cssHeight: number, state: PoolState, localId: PlayerId, angle: number, power: number, time: number, players: { id: PlayerId; name: string }[]) {
  const original = poolLayout(cssWidth, cssHeight), sx = width / cssWidth, sy = height / cssHeight;
  const l = { left: original.left * sx, top: original.top * sy, width: original.width * sx, height: original.height * sy, scaleX: original.scale * sx, scaleY: original.scale * sy, rim: original.rim * sx };
  const point = (x: number, z: number) => ({ x: l.left + (x - POOL.minX) * l.scaleX, y: l.top + (z - POOL.minZ) * l.scaleY });
  const rect = (x: number, y: number, w: number, h: number, fill: string) => { c.fillStyle = fill; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  c.save();
  rect(0, 0, width, height, '#342c34');
  rect(0, 0, width, 31, '#503a34');
  for (let x = 0; x < width; x += 24) { rect(x, 0, 1, 31, '#302b30'); rect(x + 2, 0, 1, 31, '#735041'); }
  rect(0, 31, width, 2, '#be9662'); rect(0, 33, width, 3, '#211f27');
  for (let y = 45; y < height; y += 14) for (let x = (y % 28 ? 8 : 0); x < width; x += 28) {
    rect(x, y, 1, 1, '#60434b'); rect(x - 2, y + 1, 5, 1, '#49363f'); rect(x, y + 2, 1, 1, '#60434b');
  }
  const r = l.rim;
  rect(l.left - r - 4, l.top - r + 6, l.width + r * 2 + 11, l.height + r * 2 + 8, '#211f27');
  rect(l.left - r - 3, l.top - r - 3, l.width + r * 2 + 6, l.height + r * 2 + 6, '#211f27');
  rect(l.left - r, l.top - r, l.width + r * 2, l.height + r * 2, '#81513e');
  rect(l.left - r, l.top - r, l.width + r * 2, 2, '#cca06c');
  rect(l.left - r, l.top + l.height + r - 1, l.width + r * 2, 2, '#4b3434');
  rect(l.left - 2, l.top - 2, l.width + 4, l.height + 4, '#203e3c');
  rect(l.left, l.top, l.width, l.height, '#3d6a5f');
  for (let y = Math.ceil(l.top + 4); y < l.top + l.height - 2; y += 7) for (let x = Math.ceil(l.left + 4 + y % 3); x < l.left + l.width - 2; x += 11) rect(x, y, 1, 1, '#426f64');
  for (const x of [POOL.minX, POOL.centerX, POOL.maxX]) for (const z of [POOL.minZ, POOL.maxZ]) {
    const p = point(x, z); circle(c, p.x, p.y, l.scaleX * POOL.pocketRadius + 1, '#c89c6a'); circle(c, p.x, p.y, l.scaleX * POOL.pocketRadius, '#161e25');
  }
  for (const f of [.125, .375, .625, .875]) for (const side of [-1, 1]) {
    const x = l.left + l.width * f, y = side < 0 ? l.top - r * .6 : l.top + l.height + r * .6;
    rect(x, y - 1, 1, 3, '#efd5a3'); rect(x - 1, y, 3, 1, '#efd5a3');
  }
  const cue = state.balls.find(b => b.id === 0);
  if (cue && state.phase === 'aiming' && state.turn === localId) {
    const [ox, , oz] = cue.position, dx = Math.cos(angle), dz = Math.sin(angle), radius = POOL.radius;
    let distance = Infinity;
    if (dx > .0001) distance = Math.min(distance, (POOL.maxX - radius - ox) / dx);
    if (dx < -.0001) distance = Math.min(distance, (POOL.minX + radius - ox) / dx);
    if (dz > .0001) distance = Math.min(distance, (POOL.maxZ - radius - oz) / dz);
    if (dz < -.0001) distance = Math.min(distance, (POOL.minZ + radius - oz) / dz);
    for (const ball of state.balls) {
      if (!ball.id) continue;
      const rx = ball.position[0] - ox, rz = ball.position[2] - oz, along = rx * dx + rz * dz, perpendicular = rx * rx + rz * rz - along * along;
      if (along > 0 && perpendicular < radius * radius * 4) distance = Math.min(distance, Math.max(0, along - Math.sqrt(Math.max(0, radius * radius * 4 - perpendicular))));
    }
    for (let step = radius * 2; step < distance; step += .15) { const p = point(ox + dx * step, oz + dz * step); rect(p.x, p.y, 1, 1, '#d2caa1'); }
    const pull = radius * (1.8 + power * 2.5), a = point(ox - dx * (pull + .9), oz - dz * (pull + .9)), b = point(ox - dx * pull, oz - dz * pull);
    line(c, a.x + 1, a.y + 2, b.x + 1, b.y + 2, '#273632', 2);
    line(c, a.x, a.y, b.x, b.y, '#d7b080', 2); rect(b.x, b.y, 2, 2, '#96b3b5');
  }
  for (const ball of state.balls) {
    const p = point(ball.position[0], ball.position[2]), radius = POOL.radius * l.scaleX;
    circle(c, p.x + 1, p.y + 2, radius + .4, '#244a43');
    circle(c, p.x, p.y, radius + .6, '#25292d'); circle(c, p.x, p.y, radius, COLORS[ball.id % COLORS.length]);
    rect(p.x - radius * .4, p.y - radius * .4, 2, 1, '#f4e7c8');
    if (ball.id && radius >= 5) pixelText(c, String(ball.id), p.x, p.y - 3, '#f4e7c8', 'center');
  }
  const labelY = Math.min(height - 24, l.top + l.height + r + 16);
  pixelText(c, state.phase === 'won' ? 'TABLE CLEARED' : 'THE POOL ROOM', l.left + l.width / 2, labelY, '#d8ba86', 'center');
  // Names remain DOM-readable in the turn panel; keep the world label short.
  const current = players.find(p => p.id === state.turn);
  if (current && state.phase === 'aiming') pixelText(c, state.turn === localId ? 'YOUR SHOT' : 'THEIR SHOT', l.left + l.width / 2, labelY + 12, '#e8d8b7', 'center');
  const feet = Math.min(height - 22, labelY + 60);
  for (let i = 0; i < Math.min(players.length, 2); i++) {
    const person = players[i], x = l.left + l.width * (i ? .74 : .26);
    drawPixelCharacter(c, x, feet, person.id, 'side', i ? -1 : 1, 0, time);
    line(c, x + (i ? -9 : 9), feet - 26, x + (i ? -11 : 11), feet, '#c49a64');
    if (state.turn === person.id) { rect(x - 3, feet + 4, 6, 1, '#e2b867'); rect(x - 2, feet + 5, 4, 1, '#e2b867'); }
  }
  c.restore();
}
