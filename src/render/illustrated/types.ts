export type ScreenPoint = { x: number; y: number; scale: number; depth: number };
export type SceneView = {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  time: number;
  clockSeconds: number;
  cameraZ: number;
  project: (x: number, y: number, z: number) => ScreenPoint;
};
export type DrawItem = { depth: number; draw: () => void };
export const ART = {
  ink: '#281f19', midnight: '#211913', blue: '#3c4b4a', plum: '#4d2e2e',
  wine: '#7c3031', coral: '#b76546', cream: '#f1debc', gold: '#c49a5a',
  walnut: '#4d3023', wood: '#a4683d', felt: '#315c53', shadow: '#1b1513',
} as const;

export function polygon(c: CanvasRenderingContext2D, points: { x: number; y: number }[], fill: string | CanvasGradient, stroke?: string, width = 1) {
  if (!points.length) return;
  c.beginPath(); c.moveTo(points[0].x, points[0].y);
  for (const p of points.slice(1)) c.lineTo(p.x, p.y);
  c.closePath(); c.fillStyle = fill; c.fill();
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
}
export function surface(v: SceneView, points: [number, number, number][], fill: string | CanvasGradient, stroke?: string, width = 1) {
  polygon(v.ctx, points.map(p => v.project(...p)), fill, stroke, width);
}
export function line(v: SceneView, a: [number, number, number], b: [number, number, number], color: string, width = 1) {
  const c = v.ctx, p = v.project(...a), q = v.project(...b);
  c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.strokeStyle = color; c.lineWidth = width; c.stroke();
}
export function billboard(v: SceneView, x: number, y: number, z: number, draw: (c: CanvasRenderingContext2D) => void) {
  const p = v.project(x, y, z), c = v.ctx;
  c.save(); c.translate(p.x, p.y); c.scale(p.scale / 100, p.scale / 100); draw(c); c.restore();
}
