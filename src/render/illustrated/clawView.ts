import type { PlayerId, RoomState, Vec3 } from '../../shared/protocol';
import { CLAW } from '../../shared/venue';
import { ART } from './types';

type Point = { x: number; y: number };
type View = { c: CanvasRenderingContext2D; scale: number; project: (x: number, y: number, z: number) => Point };

function poly(c: CanvasRenderingContext2D, points: Point[], fill: string | CanvasGradient, stroke = '', width = 1) {
  if (!points.length) return;
  c.beginPath(); c.moveTo(points[0].x, points[0].y); for (const p of points.slice(1)) c.lineTo(p.x, p.y); c.closePath();
  c.fillStyle = fill; c.fill(); if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.lineJoin = 'round'; c.stroke(); }
}
function plane(v: View, points: Vec3[], fill: string | CanvasGradient, stroke = '', width = 1) {
  poly(v.c, points.map(([x, y, z]) => v.project(x, y, z)), fill, stroke, width);
}
function worldLine(v: View, points: Vec3[], color: string, width = 1.5, dashed = false) {
  if (!points.length) return; const c = v.c, first = v.project(...points[0]);
  c.save(); c.beginPath(); c.moveTo(first.x, first.y);
  for (const p of points.slice(1)) { const q = v.project(...p); c.lineTo(q.x, q.y); }
  c.lineWidth = width; c.lineJoin = 'round'; c.lineCap = 'round'; c.strokeStyle = color; if (dashed) c.setLineDash([5, 5]); c.stroke(); c.restore();
}
function groundEllipse(v: View, x: number, y: number, z: number, rx: number, rz: number, fill: string, stroke = '', width = 1) {
  const points: Vec3[] = [];
  for (let i = 0; i < 48; i++) { const a = i * Math.PI / 24; points.push([x + Math.cos(a) * rx, y, z + Math.sin(a) * rz]); }
  plane(v, points, fill, stroke, width);
}
function lineScreen(c: CanvasRenderingContext2D, a: Point, b: Point, color: string, width: number, dashed = false) {
  c.save(); c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; if (dashed) c.setLineDash([5, 5]);
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.restore();
}
function arrow(c: CanvasRenderingContext2D, a: Point, b: Point, color: string, width = 1.5) {
  lineScreen(c, a, b, color, width);
  const angle = Math.atan2(b.y - a.y, b.x - a.x), size = 5;
  c.save(); c.strokeStyle = color; c.lineWidth = width; c.beginPath();
  for (const sign of [-1, 1]) { c.moveTo(b.x, b.y); c.lineTo(b.x - Math.cos(angle + sign * .55) * size, b.y - Math.sin(angle + sign * .55) * size); }
  c.stroke(); c.restore();
}
function label(c: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, fontSize: number) {
  c.save(); c.font = `600 ${fontSize}px Georgia, serif`; c.textBaseline = 'middle';
  const width = Math.min(maxWidth, c.measureText(text).width + 22), h = fontSize + 12;
  c.fillStyle = 'rgba(44,34,44,.87)'; c.strokeStyle = '#a98168'; c.lineWidth = 1;
  c.beginPath(); c.roundRect(x, y - h / 2, width, h, 5); c.fill(); c.stroke();
  c.fillStyle = '#f3e3c4'; c.fillText(text, x + 11, y, width - 22); c.restore();
}
function shadow(c: CanvasRenderingContext2D, p: Point, rx: number, ry: number, alpha = .2) {
  c.save(); c.fillStyle = `rgba(27,25,32,${alpha})`; c.beginPath(); c.ellipse(p.x, p.y, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2); c.fill(); c.restore();
}
function projectedRotation(v: View, position: Vec3, q: [number, number, number, number]) {
  const [x, y, z, w] = q;
  // Rotate the toy's local x-axis by its authoritative quaternion, then project it.
  const axis: Vec3 = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)];
  const a = v.project(...position), b = v.project(position[0] + axis[0], position[1] + axis[1], position[2] + axis[2]);
  return Math.hypot(b.x - a.x, b.y - a.y) > .001 ? Math.atan2(b.y - a.y, b.x - a.x) : 0;
}
function prize(v: View, object: RoomState['objects'][number]) {
  const p = v.project(...object.position), radius = (object.kind === 'giant-prize' ? CLAW.giantRadius : CLAW.prizeRadius) * v.scale;
  const insideCabinet = Math.abs(object.position[0] - CLAW.centerX) <= CLAW.cabinetHalfX && Math.abs(object.position[2] - CLAW.centerZ) <= CLAW.cabinetHalfZ;
  const ground = v.project(object.position[0], insideCabinet && object.position[1] > CLAW.bedY ? CLAW.bedY + .02 : .03, object.position[2]);
  shadow(v.c, ground, radius * .8, radius * .25, .18);
  const c = v.c; c.save(); c.translate(p.x, p.y); c.rotate(projectedRotation(v, object.position, object.rotation));
  // This is the single dynamic prize, positioned and rotated from the server snapshot.
  for (const side of [-1, 1]) {
    c.beginPath(); c.arc(side * radius * .68, -radius * .68, radius * .26, 0, Math.PI * 2); c.fillStyle = '#ba805d'; c.fill(); c.lineWidth = Math.max(1.5, radius * .045); c.strokeStyle = '#513d42'; c.stroke();
    c.beginPath(); c.arc(side * radius * .68, -radius * .68, radius * .12, 0, Math.PI * 2); c.fillStyle = '#e0ad87'; c.fill();
  }
  const g = c.createRadialGradient(-radius * .32, -radius * .4, radius * .04, 0, 0, radius);
  g.addColorStop(0, '#fae2b3'); g.addColorStop(.5, '#dfac7b'); g.addColorStop(1, '#a66e53');
  c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2); c.fillStyle = g; c.fill(); c.lineWidth = Math.max(2, radius * .045); c.strokeStyle = '#513c42'; c.stroke();
  c.beginPath(); c.ellipse(0, radius * .31, radius * .40, radius * .28, 0, 0, Math.PI * 2); c.fillStyle = '#f5d4a5'; c.fill();
  c.fillStyle = '#352e35'; for (const side of [-1, 1]) { c.beginPath(); c.ellipse(side * radius * .31, -radius * .1, radius * .055, radius * .075, 0, 0, Math.PI * 2); c.fill(); }
  c.beginPath(); c.ellipse(0, radius * .21, radius * .095, radius * .07, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#513c42'; c.lineWidth = Math.max(1.3, radius * .035); c.beginPath(); c.moveTo(0, radius * .25); c.quadraticCurveTo(0, radius * .43, radius * .17, radius * .38); c.stroke(); c.restore();
}
function claw(v: View, state: RoomState) {
  const { x, y, z, prizeHeld } = state.claw, c = v.c, p = v.project(x, y, z), s = v.scale;
  const top = v.project(x, 4.05, z);
  lineScreen(c, top, p, '#f0d9ad', Math.max(2, s * .025));
  // The two fingertips close only when the server says the prize is held.
  const spread = prizeHeld ? .13 : .24, down = .38;
  c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
  for (const side of [-1, 1]) {
    const a = { x: p.x + side * s * .07, y: p.y + s * .02 };
    const b = { x: p.x + side * s * spread, y: p.y + s * .20 };
    const d = { x: p.x + side * s * (spread - .05), y: p.y + s * down };
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(d.x, d.y); c.strokeStyle = '#493a3e'; c.lineWidth = Math.max(5, s * .075); c.stroke();
    c.strokeStyle = '#dfb77f'; c.lineWidth = Math.max(2.5, s * .039); c.stroke();
  }
  c.beginPath(); c.arc(p.x, p.y, s * .10, 0, Math.PI * 2); c.fillStyle = '#d7b281'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#59454a'; c.stroke();
  c.beginPath(); c.arc(p.x - s * .025, p.y - s * .03, s * .025, 0, Math.PI * 2); c.fillStyle = '#fff1cd'; c.fill(); c.restore();
}

/** Cutaway cabinet view; every moving element comes directly from the room snapshot. */
export function drawClawView(c: CanvasRenderingContext2D, width: number, height: number, state: RoomState, localId: PlayerId, time: number): void {
  const scale = Math.max(40, Math.min((width * .68 - 56) / 5.2, (height * .78 - 105) / 4.8));
  const originX = width * .34, originY = height * .78;
  const v: View = { c, scale, project: (x, y, z) => ({
    x: originX + (x - CLAW.centerX) * scale + (z - CLAW.centerZ) * scale * .55,
    y: originY + (x - CLAW.centerX) * scale * .13 + (z - CLAW.centerZ) * scale * .36 - y * scale * .92,
  }) };
  const x0 = CLAW.centerX - CLAW.cabinetHalfX, x1 = CLAW.centerX + CLAW.cabinetHalfX;
  const z0 = CLAW.centerZ - CLAW.cabinetHalfZ, z1 = CLAW.centerZ + CLAW.cabinetHalfZ, bed = CLAW.bedY, top = 4.12;
  c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
  const bg = c.createLinearGradient(0, 0, 0, height); bg.addColorStop(0, '#292b3a'); bg.addColorStop(.58, '#3b303e'); bg.addColorStop(1, '#553b43'); c.fillStyle = bg; c.fillRect(0, 0, width, height);
  const glowCenter = v.project(CLAW.centerX, 2.2, CLAW.centerZ), glow = c.createRadialGradient(glowCenter.x, glowCenter.y, 10, glowCenter.x, glowCenter.y, scale * 3.7);
  glow.addColorStop(0, 'rgba(223,169,122,.16)'); glow.addColorStop(1, 'rgba(223,169,122,0)'); c.fillStyle = glow; c.fillRect(0, 0, width * .70, height);
  shadow(c, v.project(CLAW.centerX, 0, CLAW.centerZ), scale * 2.25, scale * .5, .28);

  // Back and side glass use the same physical cabinet footprint; the front remains open.
  plane(v, [[x0, bed, z0], [x1, bed, z0], [x1, top, z0], [x0, top, z0]], '#506970', '#55464b', 3);
  plane(v, [[x0 + .06, bed + .07, z0 + .01], [x1 - .06, bed + .07, z0 + .01], [x1 - .06, top - .08, z0 + .01], [x0 + .06, top - .08, z0 + .01]], '#718684', '#718684', 1);
  plane(v, [[x1, bed, z0], [x1, bed, z1], [x1, top, z1], [x1, top, z0]], 'rgba(125,153,148,.45)', '#b79677', 2);
  worldLine(v, [[x0 + .18, 3.85, z0 + .02], [x0 + .88, 3.85, z0 + .02]], 'rgba(250,230,196,.38)', 2);
  worldLine(v, [[x1 - .03, 2.55, z0 + .15], [x1 - .03, 3.65, z1 - .15]], 'rgba(250,230,196,.22)', 3);

  // Front apron and right side are below the bed and cannot cover its target.
  plane(v, [[x0, 0, z1], [x1, 0, z1], [x1, bed, z1], [x0, bed, z1]], '#a45f5d', '#493840', 3);
  plane(v, [[x1, 0, z0], [x1, 0, z1], [x1, bed, z1], [x1, bed, z0]], '#704c50', '#493840', 2);
  plane(v, [[x0 + .14, .16, z1 + .005], [x1 - .14, .16, z1 + .005], [x1 - .14, 1.18, z1 + .005], [x0 + .14, 1.18, z1 + .005]], '#ba7568', '#815454', 1.5);
  worldLine(v, [[x0 + .22, 1.08, z1 + .01], [x1 - .22, 1.08, z1 + .01]], '#e5bb8a', 2);
  const chuteA = v.project(CLAW.centerX - .28, .35, z1 + .02), chuteB = v.project(CLAW.centerX + .28, .82, z1 + .02);
  c.fillStyle = '#483943'; c.strokeStyle = '#d1a97b'; c.lineWidth = 2; c.beginPath(); c.roundRect(Math.min(chuteA.x, chuteB.x), Math.min(chuteA.y, chuteB.y), Math.abs(chuteB.x - chuteA.x), Math.abs(chuteB.y - chuteA.y), 5); c.fill(); c.stroke();
  plane(v, [[x0, bed, z0], [x1, bed, z0], [x1, bed, z1], [x0, bed, z1]], '#e1bd89', '#5c4648', 3);
  plane(v, [[x0 + .08, bed + .01, z0 + .08], [x1 - .08, bed + .01, z0 + .08], [x1 - .08, bed + .01, z1 - .08], [x0 + .08, bed + .01, z1 - .08]], '#bd8a77', '#d5aa83', 1.5);

  // A genuinely open side hatch fits the full 1.5 m prize throughout the release region.
  // Brass surrounds a dark opening; no opaque shelf is drawn across its interior.
  plane(v, [[6.80, bed - .09, -4.10], [8.90, bed - .09, -4.10], [8.90, bed - .09, -2.10], [6.80, bed - .09, -2.10]], '#c39b70', '#4c3b42', 2);
  plane(v, [[6.90, bed - .07, -4.00], [8.80, bed - .07, -4.00], [8.80, bed - .07, -2.20], [6.90, bed - .07, -2.20]], '#292b36', '#e2c093', 2);
  // A dashed guide marks the permitted claw-center region; it is not the physical hole.
  const guide = [[CLAW.surpriseMinX, bed - .035, CLAW.hatchMinZ], [CLAW.hatchMaxX, bed - .035, CLAW.hatchMinZ], [CLAW.hatchMaxX, bed - .035, CLAW.maxZ], [CLAW.surpriseMinX, bed - .035, CLAW.maxZ], [CLAW.surpriseMinX, bed - .035, CLAW.hatchMinZ]] as Vec3[];
  worldLine(v, guide, '#f8daa5', 1.8, true);
  const hatchLabel = v.project(7.9, bed - .02, -2.15);
  c.save(); c.font = `bold ${Math.max(10, scale * .105)}px Georgia`; c.textAlign = 'center'; c.fillStyle = '#f7e5c2'; c.strokeStyle = '#4a393e'; c.lineWidth = 3; c.strokeText('RELEASE HATCH', hatchLabel.x, hatchLabel.y + scale * .15); c.fillText('RELEASE HATCH', hatchLabel.x, hatchLabel.y + scale * .15); c.restore();

  // Live position guides are drawn on the bed; neither is a predicted outcome.
  const h = state.claw, markerY = bed + .035;
  const travelMinX = h.phase === 'surprise' || h.phase === 'won' ? CLAW.surpriseMinX : CLAW.minX;
  worldLine(v, [[travelMinX, markerY, h.z], [CLAW.maxX, markerY, h.z]], 'rgba(255,238,201,.43)', 1.3, true);
  worldLine(v, [[h.x, markerY, CLAW.minZ], [h.x, markerY, CLAW.maxZ]], 'rgba(255,238,201,.43)', 1.3, true);
  groundEllipse(v, h.x, markerY + .01, h.z, .22, .22, 'rgba(247,226,178,.14)', '#ffe4ad', 2);
  const marker = v.project(h.x, markerY, h.z), head = v.project(h.x, h.y, h.z);
  lineScreen(c, head, marker, `rgba(255,234,195,${.30 + .08 * Math.sin(time * 3)})`, 1.5, true);
  const actualPrize = state.objects.find(o => o.kind === 'claw-prize' || o.kind === 'giant-prize');

  // Cabinet framing is behind the prize and never blocks its visible position.
  for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1]] as const) worldLine(v, [[x, bed, z], [x, top, z]], '#d6ae7c', Math.max(5, scale * .075));
  worldLine(v, [[x0, top, z0], [x1, top, z0], [x1, top, z1]], '#d6ae7c', Math.max(6, scale * .09));
  worldLine(v, [[travelMinX, 4.06, h.z], [CLAW.maxX, 4.06, h.z]], '#f0d4a2', 2);
  worldLine(v, [[h.x, 4.06, CLAW.minZ], [h.x, 4.06, CLAW.maxZ]], '#d3ac7d', 2);
  if (actualPrize) {
    if (h.phase === 'won') {
      // Highlight follows the real released object; there is no scripted travel or substitute toy.
      const p = v.project(...actualPrize.position), radius = (actualPrize.kind === 'giant-prize' ? CLAW.giantRadius : CLAW.prizeRadius) * scale;
      const glow = c.createRadialGradient(p.x, p.y, radius * .3, p.x, p.y, radius * 1.8);
      glow.addColorStop(0, 'rgba(255,224,162,.28)'); glow.addColorStop(1, 'rgba(255,224,162,0)');
      c.fillStyle = glow; c.beginPath(); c.arc(p.x, p.y, radius * 1.8, 0, Math.PI * 2); c.fill();
    }
    prize(v, actualPrize);
  }
  claw(v, state);

  // Modest title and operator labels: the same axes as the two control roles.
  const title = v.project(CLAW.centerX, 4.34, z0);
  const titleW = scale * 2.0, titleH = scale * .38;
  c.save(); c.translate(title.x, title.y); c.rotate(.10); c.fillStyle = '#744b52'; c.strokeStyle = '#d9b181'; c.lineWidth = 2;
  c.beginPath(); c.roundRect(-titleW / 2, -titleH / 2, titleW, titleH, 5); c.fill(); c.stroke(); c.fillStyle = '#f6e0b9'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `bold ${Math.max(11, scale * .15)}px Georgia`; c.fillText('THE PRIZE DROP', 0, 1, titleW - 14); c.restore();
  const name = (id: PlayerId | null) => { if (!id) return 'waiting'; const p = state.players.find(player => player.id === id); return (p?.name || 'player') + (id === localId ? ' (you)' : ''); };
  const axisX0 = v.project(travelMinX, markerY + .02, z1 - .05), axisX1 = v.project(CLAW.maxX, markerY + .02, z1 - .05);
  arrow(c, axisX0, axisX1, '#f1d4a5'); arrow(c, axisX1, axisX0, '#f1d4a5');
  const axisZ0 = v.project(x1 - .05, markerY + .02, CLAW.minZ), axisZ1 = v.project(x1 - .05, markerY + .02, CLAW.maxZ);
  arrow(c, axisZ0, axisZ1, '#f1d4a5'); arrow(c, axisZ1, axisZ0, '#f1d4a5');
  const labelY = Math.min(height - 75, originY + scale * .48), fs = Math.max(11, Math.min(14, scale * .12));
  label(c, `LEFT / RIGHT: ${name(h.operators.x)}`, Math.max(15, originX - scale * 2.5), labelY, scale * 2.5, fs);
  label(c, `AWAY / TOWARD: ${name(h.operators.z)}`, Math.max(15, originX - scale * 2.5), labelY + fs + 17, scale * 2.9, fs);
  c.restore();
}
