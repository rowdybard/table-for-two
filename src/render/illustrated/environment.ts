import { ART, billboard, line, polygon, surface, type DrawItem, type SceneView } from './types';
import { CLAW, DESK, LOUNGE, POOL } from '../../shared/venue';
import type { PoolState } from '../../shared/protocol';

type P = [number, number, number];
const C = {
  ...ART,
  wall: '#765138', wallLight: '#d4b58b', wallShade: '#513729',
  rose: '#a75b4b', darkWine: '#592c29', mahogany: '#493027',
  amber: '#dca66b', bone: '#f4e1bc', dark: '#2b211f',
};

/** Small canvas helpers deliberately use the same irregular, inked line language throughout. */
function shape(c: CanvasRenderingContext2D, path: (c: CanvasRenderingContext2D) => void, fill: string | CanvasGradient, stroke = C.dark, width = 3) {
  c.beginPath(); path(c); c.closePath(); c.fillStyle = fill; c.fill();
  if (stroke) { c.lineWidth = width; c.strokeStyle = stroke; c.lineJoin = 'round'; c.stroke(); }
}
function stroke(c: CanvasRenderingContext2D, path: (c: CanvasRenderingContext2D) => void, color: string, width = 2) {
  c.beginPath(); path(c); c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
}
function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, outline = C.dark, width = 3) {
  shape(c, p => p.roundRect(x, y, w, h, r), fill, outline, width);
}
function ellipseWorld(v: SceneView, x: number, y: number, z: number, rx: number, rz: number, fill: string | CanvasGradient, outline?: string, width = 1) {
  const points: P[] = [];
  for (let i = 0; i < 32; i++) { const a = i * Math.PI / 16; points.push([x + Math.cos(a) * rx, y, z + Math.sin(a) * rz]); }
  surface(v, points, fill, outline, width);
}
function roundedWorldQuad(v: SceneView, points: [P, P, P, P], fill: string | CanvasGradient, outline: string, width = 1.5, round = .10) {
  const c = v.ctx, p = points.map(point => v.project(...point));
  const mix = (a: typeof p[number], b: typeof p[number], n: number) => ({ x: a.x + (b.x - a.x) * n, y: a.y + (b.y - a.y) * n });
  const first = mix(p[0], p[3], round); c.beginPath(); c.moveTo(first.x, first.y);
  for (let i = 0; i < 4; i++) { const corner = p[i], next = p[(i + 1) % 4], end = mix(corner, next, round); c.quadraticCurveTo(corner.x, corner.y, end.x, end.y); const beforeNext = mix(next, corner, round); c.lineTo(beforeNext.x, beforeNext.y); }
  c.closePath(); c.fillStyle = fill; c.fill(); c.strokeStyle = outline; c.lineWidth = width; c.lineJoin = 'round'; c.stroke();
}
function horizontalGradient(v: SceneView, from: P, to: P, stops: [number, string][]) {
  const a = v.project(...from), b = v.project(...to), gradient = v.ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  for (const [at, color] of stops) gradient.addColorStop(at, color); return gradient;
}
function star(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, points = 4) {
  shape(c, p => { for (let i = 0; i < points * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / points, d = i % 2 ? r * .27 : r; if (!i) p.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d); else p.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); } }, color, '', 0);
}
function worldLine(v: SceneView, pts: P[], color: string, width = 1.2) {
  const c = v.ctx; if (!pts.length) return; c.beginPath(); const first = v.project(...pts[0]); c.moveTo(first.x, first.y);
  for (const pt of pts.slice(1)) { const p = v.project(...pt); c.lineTo(p.x, p.y); }
  c.lineWidth = width; c.strokeStyle = color; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
}
function arch(v: SceneView, x: number, y: number, z: number, w: number, h: number, fill: string, outline = C.dark) {
  billboard(v, x, y, z, c => {
    const a = w * 50, b = h * 100;
    shape(c, p => { p.moveTo(-a, 0); p.lineTo(-a, -b + a); p.quadraticCurveTo(-a, -b, 0, -b); p.quadraticCurveTo(a, -b, a, -b + a); p.lineTo(a, 0); }, fill, outline, 4);
  });
}

function sidePoster(v: SceneView, side: -1 | 1, z: number, motif: number) {
  const x = side * 16.9, xFace = side * 16.86;
  surface(v, [[x, 1.9, z - 1.13], [x, 1.9, z + 1.13], [x, 4.15, z + 1.13], [x, 4.15, z - 1.13]], '#5b4650', C.dark, 2);
  surface(v, [[xFace, 2.04, z - .99], [xFace, 2.04, z + .99], [xFace, 4.01, z + .99], [xFace, 4.01, z - .99]], motif ? '#d1a084' : '#e8cba5', '#c29d7d', 1);
  const disc: P[] = [];
  for (let i = 0; i < 32; i++) { const a = i * Math.PI / 16; disc.push([xFace, 3.1 + Math.sin(a) * .64, z + Math.cos(a) * .64]); }
  surface(v, disc, motif ? '#78555b' : '#c68272', '#6b5255', 1.4);
  const center: P[] = [];
  for (let i = 0; i < 20; i++) { const a = i * Math.PI / 10; center.push([xFace, 3.1 + Math.sin(a) * .24, z + Math.cos(a) * .24]); }
  surface(v, center, motif ? '#efd8b3' : '#e9c38f');
  for (const y of [2.25, 2.37]) line(v, [xFace, y, z - .55], [xFace, y, z + .55], '#9c7770', 1);
  for (const y of [3.79, 3.87]) line(v, [xFace, y, z - .5], [xFace, y, z + .5], '#f3dfbb', 1);
}

/** Static room surfaces are drawn behind all sorted characters and props. */
export function drawArchitecture(v: SceneView): void {
  const { ctx: c, width, height } = v;
  const frontZ = Math.min(15, v.cameraZ - 1.6), floorFront = v.cameraZ - 1.6;
  // A dark ceiling, timber walls and deep carpet enclose the room, including the front cutaway.
  const background = c.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, '#211a19'); background.addColorStop(.34, '#3e2b25'); background.addColorStop(1, '#362327');
  c.fillStyle = background; c.fillRect(0, 0, width, height);
  const ceiling = horizontalGradient(v, [0, 5.5, -15], [0, 5.5, frontZ], [[0, '#594234'], [.48, '#443028'], [1, '#241d1b']]);
  surface(v, [[-17, 5.5, -15], [17, 5.5, -15], [17, 5.5, frontZ], [-17, 5.5, frontZ]], ceiling);
  for (const x of [-15, -10, -5, 0, 5, 10, 15]) line(v, [x, 5.48, -15], [x, 5.48, frontZ], 'rgba(218,172,117,.18)', 1.2);
  for (let z = -12; z < frontZ; z += 5) line(v, [-17, 5.47, z], [17, 5.47, z], 'rgba(30,22,20,.5)', 2);
  const back = horizontalGradient(v, [0, 5.5, -15], [0, 0, -15], [[0, '#715039'], [.46, '#8b6243'], [1, '#493127']]);
  surface(v, [[-17, 0, -15], [17, 0, -15], [17, 5.5, -15], [-17, 5.5, -15]], back);
  const left = horizontalGradient(v, [-17, 5.5, -15], [-17, 0, frontZ], [[0, '#654533'], [1, '#332722']]);
  const right = horizontalGradient(v, [17, 5.5, -15], [17, 0, frontZ], [[0, '#75503a'], [1, '#332722']]);
  surface(v, [[-17, 0, -15], [-17, 0, frontZ], [-17, 5.5, frontZ], [-17, 5.5, -15]], left);
  surface(v, [[17, 0, -15], [17, 0, frontZ], [17, 5.5, frontZ], [17, 5.5, -15]], right);
  // Long walnut boards, recessed joints and a low leather-colored dado create scale.
  surface(v, [[-17, 0, -14.96], [17, 0, -14.96], [17, 1.18, -14.96], [-17, 1.18, -14.96]], '#402823');
  for (let x = -16; x <= 16; x += 1.6) {
    line(v, [x, .12, -14.91], [x, 5.35, -14.91], 'rgba(40,25,21,.48)', 1.6);
    line(v, [x + .06, 1.3, -14.9], [x + .06, 5.25, -14.9], 'rgba(226,180,125,.12)', .8);
    line(v, [x + .52, 1.5, -14.9], [x + .47, 4.65, -14.9], 'rgba(46,29,22,.12)', .6);
  }
  for (const x of [-16.95, 16.95]) {
    surface(v, [[x, 0, -15], [x, 0, frontZ], [x, 1.18, frontZ], [x, 1.18, -15]], '#382622');
    for (let z = -14; z < frontZ; z += 1.8) line(v, [x, .12, z], [x, 5.3, z], 'rgba(37,25,22,.38)', 1.2);
    line(v, [x, 1.2, -15], [x, 1.2, frontZ], '#a77950', 1.7);
  }
  line(v, [-17, 1.2, -14.9], [17, 1.2, -14.9], '#c49a69', 2);
  line(v, [-17, 5.42, -14.9], [17, 5.42, -14.9], '#a98158', 2);
  // Three wall washes make the wood and illustrated fixtures feel locally lit.
  for (const x of [-10, 0, 10]) {
    const p = v.project(x, 3.2, -14.88), edge = v.project(x + 4, 3.2, -14.88), radius = Math.max(1, Math.abs(edge.x - p.x));
    const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius); g.addColorStop(0, 'rgba(247,195,127,.16)'); g.addColorStop(1, 'rgba(247,195,127,0)');
    c.fillStyle = g; c.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
  }
  // A single painted lane mural is part of the architecture, not a fictitious game screen.
  billboard(v, -1.3, 1.45, -14.82, b => {
    b.save(); rr(b, -420, -245, 840, 245, 4, '#432c27', '#b68a5c', 5);
    shape(b, p => { p.moveTo(-404, -15); p.bezierCurveTo(-250, -158, -58, -222, 190, -225); p.lineTo(405, -225); p.lineTo(405, -183); p.bezierCurveTo(104, -186, -103, -119, -244, -15); }, '#a65b46', '', 0);
    stroke(b, p => { p.moveTo(-395, -26); p.bezierCurveTo(-225, -165, -42, -210, 200, -209); }, '#e4b873', 7);
    stroke(b, p => { p.moveTo(-380, -13); p.bezierCurveTo(-200, -140, -16, -183, 210, -183); }, '#d19265', 3);
    shape(b, p => { p.moveTo(-55, -25); p.bezierCurveTo(-74, -50, -61, -83, -51, -109); p.bezierCurveTo(-46, -130, -59, -149, -53, -168); p.bezierCurveTo(-45, -190, -13, -190, -5, -168); p.bezierCurveTo(1, -149, -12, -130, -7, -109); p.bezierCurveTo(4, -82, 16, -50, -4, -25); }, '#f1dfbe', '#bda17a', 2);
    stroke(b, p => { p.moveTo(-47, -137); p.lineTo(-13, -137); p.moveTo(-47, -128); p.lineTo(-13, -128); }, '#a24437', 7);
    shape(b, p => p.arc(102, -68, 48, 0, Math.PI * 2), '#2d2422', '#bb9365', 2);
    for (const [x, y] of [[89, -79], [109, -81], [100, -65]]) shape(b, p => p.arc(x, y, 4, 0, Math.PI * 2), '#b78a66', '', 0);
    star(b, 198, -123, 12, '#edd09b'); star(b, -210, -167, 9, '#edd09b');
    b.fillStyle = '#f4dfb9'; b.textAlign = 'center'; b.font = 'italic 29px Georgia'; b.fillText('One more frame', 220, -134);
    b.fillStyle = '#dec295'; b.font = 'bold 12px Georgia'; b.letterSpacing = '2px'; b.fillText('BOWLING  •  NEW YEAR’S EVE', 220, -107); b.restore();
  });
  // Recessed glass at the edges keeps the far wall from becoming an uninterrupted panel.
  for (const x of [-14.1, 14.1]) {
    arch(v, x, 1.35, -14.78, 1.8, 2.9, '#282d2b', '#ae855b');
    billboard(v, x, 1.35, -14.72, b => {
      stroke(b, p => { p.moveTo(0, -275); p.lineTo(0, -5); p.moveTo(-80, -115); p.lineTo(80, -115); }, '#b18a60', 4);
      for (const [sx, sy] of [[-37, -205], [42, -167], [15, -246]]) star(b, sx, sy, 4, '#e8c793');
    });
  }
  const floor = horizontalGradient(v, [0, 0, -15], [0, 0, floorFront], [[0, '#644039'], [.48, '#4d2d2c'], [1, '#2e2225']]);
  surface(v, [[-17, 0, -15], [17, 0, -15], [17, 0, floorFront], [-17, 0, floorFront]], floor);
  // Fine woven carpet details sit below the action rather than forming a giant central icon.
  for (let z = -13; z <= Math.min(20, floorFront - .2); z += 2.1) for (let x = -16; x <= 16; x += 2.4) {
    const xx = x + (Math.round((z + 13) / 2.1) % 2 ? 1.2 : 0);
    worldLine(v, [[xx - .22, .012, z], [xx, .012, z - .09], [xx + .22, .012, z], [xx, .012, z + .09], [xx - .22, .012, z]], 'rgba(211,155,119,.09)', .8);
  }
  // Maple flooring joins the approach to the shoe desk and pool, breaking up the concourse without a raised obstacle.
  const woodEnd = Math.min(14.4, floorFront - .1);
  if (woodEnd > -1.6) {
    const wood = horizontalGradient(v, [-9, .015, -1.6], [-9, .015, woodEnd], [[0, '#ac774a'], [.5, '#aa764b'], [1, '#805538']]);
    surface(v, [[-14, .015, -1.6], [-5, .015, -1.6], [-5, .015, woodEnd], [-14, .015, woodEnd]], wood);
    line(v, [-5, .019, -1.6], [-5, .019, woodEnd], '#65442f', 2);
    for (let x = -13.8; x < -5; x += .42) line(v, [x, .02, -1.6], [x, .02, woodEnd], 'rgba(91,53,31,.24)', .8);
    for (let z = 1; z < woodEnd; z += 3.7) line(v, [-13.9, .021, z], [-5.08, .021, z], 'rgba(110,68,39,.14)', .7);
  }
  for (const [x, z, rx, rz] of [[-9, -4, 4.2, 6], [-3, 7, 3.7, 3.2], [8, 7.5, 4.3, 3.8], [10, -5, 3.2, 3.2]] as const) {
    if (z + .2 >= frontZ) continue;
    // Layered transparent shapes follow the actual floor plane without a hard oval edge.
    const depthRadius = Math.min(rz, frontZ - z - .1);
    for (let layer = 7; layer >= 1; layer--) {
      const f = layer / 7; ellipseWorld(v, x, .02 + (7 - layer) * .001, z, rx * f, depthRadius * f, 'rgba(233,175,108,.018)');
    }
  }
  // One honey-maple lane and approach; all physical positions remain unchanged.
  const laneEnd = Math.min(4.45, frontZ - .05);
  const lane = horizontalGradient(v, [-9, 0, -12.8], [-9, 0, 4.45], [[0, '#b57a46'], [.42, '#dbac69'], [1, '#b77a47']]);
  surface(v, [[-11, .025, -12.8], [-7, .025, -12.8], [-7, .025, laneEnd], [-11, .025, laneEnd]], lane, '#6e482c', 1.2);
  for (let x = -10.85; x < -7; x += .25) line(v, [x, .03, -12.75], [x, .03, laneEnd], 'rgba(106,63,35,.32)', .7);
  if (laneEnd > .5) line(v, [-11, .04, .5], [-7, .04, .5], '#633e2f', 2.5);
  for (let x = -10.4; x <= -7.6; x += .7) {
    if (laneEnd > -2.3) surface(v, [[x, .05, -2.7], [x - .1, .05, -2.3], [x, .05, -2.4], [x + .1, .05, -2.3]], '#835332');
    if (laneEnd > 2.8) ellipseWorld(v, x, .05, 2.7, .065, .065, '#835332');
  }
  // Restrained New Year's paper bunting, hanging from the back beam.
  for (let x = -15; x <= 15; x += 2.5) {
    const y = 5.12 - .15 * Math.cos(x * .25);
    if (x < 15) worldLine(v, [[x, y, -14.6], [x + 2.5, 5.12 - .15 * Math.cos((x + 2.5) * .25), -14.6]], '#d0a777', 1);
    billboard(v, x, y, -14.55, b => { shape(b, p => { p.moveTo(-13, 0); p.lineTo(13, 0); p.lineTo(0, 27); }, '#caa16e', '', 0); });
  }
}

function drawLaneRails(v: SceneView) {
  const end = Math.min(.6, v.cameraZ - 1.6);
  for (const x of [-11.1, -6.9]) {
    surface(v, [[x - .16, 0, -12.8], [x + .16, 0, -12.8], [x + .16, .68, -12.8], [x - .16, .68, -12.8]], '#493b3d');
    surface(v, [[x - .16, .68, -12.8], [x + .16, .68, -12.8], [x + .16, .68, end], [x - .16, .68, end]], '#b28a68', C.dark, 1.4);
    surface(v, [[x - .16, .04, end], [x + .16, .04, end], [x + .16, .68, end], [x - .16, .68, end]], '#6b4a47', C.dark, 1.4);
  }
}
function ballReturn(v: SceneView) {
  ellipseWorld(v, -5.9, .012, 1.05, .8, 1.05, 'rgba(18,14,13,.28)');
  billboard(v, -5.9, 0, 1.05, c => {
    // A cream enamel hood and recessed walnut cradle form the return, not a box with balls on it.
    const hood = c.createLinearGradient(-55, -125, 60, 0); hood.addColorStop(0, '#e9d5ae'); hood.addColorStop(.48, '#b69a78'); hood.addColorStop(1, '#665142');
    shape(c, p => { p.moveTo(-58, -5); p.lineTo(-58, -58); p.quadraticCurveTo(-56, -104, -31, -121); p.quadraticCurveTo(-8, -136, 32, -126); p.quadraticCurveTo(61, -118, 63, -82); p.lineTo(60, -9); p.quadraticCurveTo(3, 5, -58, -5); }, hood, '#514032', 2.5);
    shape(c, p => { p.moveTo(-50, -75); p.quadraticCurveTo(-46, -111, -19, -118); p.quadraticCurveTo(6, -124, 32, -114); p.quadraticCurveTo(51, -108, 54, -79); p.quadraticCurveTo(1, -67, -50, -75); }, '#6a4d3b', '#4a3327', 2);
    shape(c, p => p.ellipse(2, -92, 43, 18, 0, 0, Math.PI * 2), '#211e1d', '#9c7455', 2);
    for (const [x, y, col] of [[-27, -103, '#893c30'], [0, -111, '#3a5045'], [27, -103, '#bb824d']] as const) {
      const g = c.createRadialGradient(x - 5, y - 6, 1, x, y, 16); g.addColorStop(0, '#f5ddba'); g.addColorStop(.25, col); g.addColorStop(1, '#302821');
      c.beginPath(); c.arc(x, y, 16, 0, Math.PI * 2); c.fillStyle = g; c.fill(); c.strokeStyle = '#3c3029'; c.lineWidth = 1.5; c.stroke();
      for (const [dx, dy] of [[-2, -3], [4, -3], [1, 3]]) shape(c, p => p.arc(x + dx, y + dy, 1.2, 0, Math.PI * 2), '#261e1b', '', 0);
    }
    shape(c, p => { p.moveTo(-48, -70); p.quadraticCurveTo(0, -57, 53, -70); p.lineTo(50, -15); p.quadraticCurveTo(0, -4, -48, -15); }, '#7a3b30', '#4c2d24', 2);
    stroke(c, p => { p.moveTo(-39, -60); p.quadraticCurveTo(0, -51, 42, -60); }, '#d49b71', 2);
    for (let y = -40; y < -21; y += 5) stroke(c, p => { p.moveTo(-29, y); p.quadraticCurveTo(0, y + 4, 29, y); }, '#4f2c24', 1.5);
    rr(c, -18, -67, 36, 12, 5, '#d2aa73', '#60452f', 1.2);
    c.font = 'bold 6px Georgia'; c.textAlign = 'center'; c.fillStyle = '#5a3b28'; c.fillText('RETURN', 0, -58);
  });
}
type PoolBallVisual = PoolState['balls'][number];
function poolTable(v: SceneView, balls: readonly PoolBallVisual[]) {
  // The table, legs and shadow follow the same center and outer half-extents as the collider.
  const [hx, , hz] = POOL.tableHalf, x0 = POOL.centerX - hx, x1 = POOL.centerX + hx, z0 = POOL.centerZ - hz, z1 = POOL.centerZ + hz;
  ellipseWorld(v, POOL.centerX, .012, POOL.centerZ, hx, hz + .02, 'rgba(24,21,29,.25)');
  // Carved tapered legs and brass shoes, viewed under the walnut apron.
  for (const x of [x0 + .55, x1 - .55]) for (const z of [z0 + .55, z1 - .55]) {
    roundedWorldQuad(v, [[x - .24, .02, z], [x + .24, .02, z], [x + .29, 1.03, z], [x - .29, 1.03, z]], '#503a3c', '#302c35', 1.6, .08);
    line(v, [x - .15, .18, z + .01], [x + .15, .18, z + .01], '#c89b6e', 2);
    line(v, [x - .12, .86, z + .01], [x + .12, .86, z + .01], '#9d7462', 1);
  }
  const wood = horizontalGradient(v, [POOL.centerX, 1.65, z1], [POOL.centerX, .72, z1], [[0, '#9a6d5a'], [.22, '#81594e'], [1, '#523b3c']]);
  roundedWorldQuad(v, [[x0, .70, z1], [x1, .70, z1], [x1, 1.62, z1], [x0, 1.62, z1]], wood, '#302d36', 2, .06);
  surface(v, [[x1, .7, z0], [x1, .7, z1], [x1, 1.62, z1], [x1, 1.62, z0]], '#513b3e', '#302d36', 1.8);
  line(v, [x0 + .14, 1.42, z1 + .01], [x1 - .14, 1.42, z1 + .01], '#c69975', 2);
  line(v, [x0 + .14, .82, z1 + .01], [x1 - .14, .82, z1 + .01], '#3b3038', 2);
  for (const offset of [-2.2, -1.1, 0, 1.1, 2.2]) {
    const x = POOL.centerX + offset;
    surface(v, [[x - .08, 1.11, z1 + .015], [x, 1.20, z1 + .015], [x + .08, 1.11, z1 + .015], [x, 1.02, z1 + .015]], '#d3ac7b', '#79594e', 1);
  }
  // Padded rail, bevel and cloth all use the actual shared play bounds.
  roundedWorldQuad(v, [[x0, 1.62, z0], [x1, 1.62, z0], [x1, 1.62, z1], [x0, 1.62, z1]], '#c59a71', '#392f35', 2, .05);
  roundedWorldQuad(v, [[POOL.minX, 1.64, POOL.minZ], [POOL.maxX, 1.64, POOL.minZ], [POOL.maxX, 1.64, POOL.maxZ], [POOL.minX, 1.64, POOL.maxZ]], '#507b72', '#315451', 1.4, .025);
  worldLine(v, [[POOL.minX + .12, 1.65, POOL.minZ + .14], [POOL.maxX - .12, 1.65, POOL.minZ + .14]], 'rgba(223,226,195,.28)', 1);
  for (const x of [POOL.minX, POOL.centerX, POOL.maxX]) for (const z of [POOL.minZ, POOL.maxZ]) {
    ellipseWorld(v, x, 1.66, z, POOL.pocketRadius * 1.12, POOL.pocketRadius * 1.12, '#352d34', '#bd9670', 1);
    ellipseWorld(v, x, 1.67, z, POOL.pocketRadius * .72, POOL.pocketRadius * .72, '#202831');
  }
  for (const ball of balls) {
    const [x, y, z] = ball.position;
    const color = ['#f4e7ce', '#d3aa65', '#62817b', '#ba6b62', '#6c667b', '#c58b64', '#834957'][ball.id % 7];
    billboard(v, x, y, z, c => {
      const shade = c.createRadialGradient(-4, -5, 1, 0, 0, 11);
      shade.addColorStop(0, '#fff4d9'); shade.addColorStop(.35, color); shade.addColorStop(1, '#4f4850');
      c.fillStyle = shade; c.strokeStyle = '#394447'; c.lineWidth = 1.2; c.beginPath(); c.arc(0, 0, 11, 0, Math.PI * 2); c.fill(); c.stroke();
      if (ball.id) { c.fillStyle = '#f4e7ce'; c.beginPath(); c.arc(0, 0, 4, 0, Math.PI * 2); c.fill(); }
    });
  }
}
function arcadeCabinet(v: SceneView, x: number, variant: number) {
  const title = ['STARDUST', 'PINBALL', 'LUCKY 7'][variant];
  const body = ['#58382b', '#743b2d', '#4f392c'][variant];
  billboard(v, x, 0, -6.78, c => {
    shape(c, p => { p.moveTo(-69, 0); p.lineTo(-69, -223); p.lineTo(-58, -260); p.lineTo(58, -260); p.lineTo(69, -223); p.lineTo(69, 0); }, body, C.dark, 4);
    shape(c, p => { p.moveTo(-61, -223); p.lineTo(-52, -252); p.lineTo(52, -252); p.lineTo(61, -223); }, '#d2a66a', C.dark, 3);
    c.textAlign = 'center'; c.fillStyle = '#4d3942'; c.font = 'bold 12px Georgia'; c.fillText(title, 0, -233, 104);
    rr(c, -53, -205, 106, 89, 7, '#2d2924', '#2e2935', 4);
    shape(c, p => { p.moveTo(-46, -125); p.lineTo(-46, -198); p.lineTo(46, -198); p.lineTo(46, -125); }, '#5b5947', '', 0);
    shape(c, p => { p.moveTo(-46, -128); p.lineTo(-18, -164); p.lineTo(5, -144); p.lineTo(26, -177); p.lineTo(46, -151); p.lineTo(46, -128); }, '#a66447', '', 0);
    star(c, 22, -183, 7, '#f7dfac'); star(c, -25, -177, 4, '#f7dfac');
    shape(c, p => { p.moveTo(-62, -103); p.lineTo(62, -103); p.lineTo(72, -82); p.lineTo(-72, -82); }, '#bd9265', C.dark, 3);
    stroke(c, p => { p.moveTo(-29, -91); p.lineTo(-29, -108); }, '#493641', 4);
    shape(c, p => p.arc(-29, -110, 6, 0, Math.PI * 2), '#c46c60', C.dark, 2);
    for (const [x, col] of [[9, '#c46c60'], [26, '#e8cc95'], [43, '#65817f']] as const) shape(c, p => p.ellipse(x, -91, 5, 3, 0, 0, Math.PI * 2), col, '#57444a', 1);
    rr(c, -32, -60, 64, 41, 3, '#544047', '#332d37', 2);
    rr(c, -9, -49, 18, 17, 2, '#c49a71', '#332d37', 1);
    stroke(c, p => { p.moveTo(-48, -12); p.lineTo(-48, -66); p.moveTo(48, -12); p.lineTo(48, -66); }, '#d19880', 2);
  });
}
function clawBack(v: SceneView) {
  // Transparent cabinet: the moving server-owned claw and prize are sorted in front of this back panel.
  surface(v, [[8.8, 1.5, -4.68], [11.2, 1.5, -4.68], [11.2, 4.16, -4.68], [8.8, 4.16, -4.68]], '#3d4942', '#604b4d', 2);
  surface(v, [[8.9, 1.55, -4.64], [11.1, 1.55, -4.64], [11.1, 4.04, -4.64], [8.9, 4.04, -4.64]], '#687165', '', 0);
  line(v, [9.03, 3.95, -4.63], [10.5, 3.95, -4.63], 'rgba(241,229,193,.32)', 2);
  // The bed is behind the server-owned prizes in painter order.
  surface(v, [[8.75, 1.5, -4.7], [11.25, 1.5, -4.7], [11.25, 1.5, -2.48], [8.75, 1.5, -2.48]], '#dfbc89', C.dark, 2);
  // Inside the cabinet a gold ring marks the target under the actual dynamic prize.
  ellipseWorld(v, 10, 1.53, -3.6, .48, .39, '#cbad7a', '#544a45', 1);
  ellipseWorld(v, 10, 1.54, -3.6, .38, .30, '#b8746b');
  for (const [x, z, color] of [[9.25, -3.05, '#d9aa83'], [9.55, -4.15, '#bd786e'], [10.54, -4.05, '#e4c693'], [10.8, -3.12, '#7d9990']] as const) {
    billboard(v, x, 1.5, z, c => {
      shape(c, p => p.arc(0, -20, 20, 0, Math.PI * 2), color, '#584750', 2);
      shape(c, p => p.arc(-6, -26, 4, 0, Math.PI * 2), '#f7dec0', '', 0);
    });
  }
}
function clawFront(v: SceneView) {
  // Base is the collider at x [8.75,11.25], z [-4.7,-2.5], y [0,1.5].
  surface(v, [[8.75, 0, -2.48], [11.25, 0, -2.48], [11.25, 1.5, -2.48], [8.75, 1.5, -2.48]], '#874437', C.dark, 3);
  surface(v, [[11.25, 0, -4.7], [11.25, 0, -2.48], [11.25, 1.5, -2.48], [11.25, 1.5, -4.7]], '#4c342b', C.dark, 2);
  for (const x of [8.8, 11.2]) {
    surface(v, [[x - .06, 1.5, -2.46], [x + .06, 1.5, -2.46], [x + .06, 4.45, -2.46], [x - .06, 4.45, -2.46]], '#d5ad79', C.dark, 1.4);
  }
  billboard(v, 10, 1.33, -2.42, c => {
    rr(c, -95, 4, 190, 105, 9, '#773b30', '#5c3d48', 3);
    shape(c, p => { p.moveTo(-84, 80); p.bezierCurveTo(-30, 50, 20, 102, 85, 63); p.lineTo(85, 103); p.lineTo(-84, 103); }, '#a6533f', '', 0);
    star(c, -69, 29, 10, '#e9c888'); star(c, 63, 76, 8, '#e9c888');
    rr(c, -27, 44, 54, 45, 5, '#493a42', '#302d38', 2);
    rr(c, -18, 51, 36, 7, 2, '#c39a76', '', 0);
  });
  // The exploration-view hatch matches the side opening used by the close-up activity.
  surface(v, [[6.8, 1.43, -4.1], [8.9, 1.43, -4.1], [8.9, 1.43, -2.1], [6.8, 1.43, -2.1]], '#b18a5c', '#60432f', 1.3);
  surface(v, [[6.9, 1.45, -4.0], [8.8, 1.45, -4.0], [8.8, 1.45, -2.2], [6.9, 1.45, -2.2]], '#272320', '#dfbb84', 1.1);
  worldLine(v, [[CLAW.surpriseMinX, 1.47, CLAW.hatchMinZ], [CLAW.hatchMaxX, 1.47, CLAW.hatchMinZ], [CLAW.hatchMaxX, 1.47, CLAW.maxZ], [CLAW.surpriseMinX, 1.47, CLAW.maxZ], [CLAW.surpriseMinX, 1.47, CLAW.hatchMinZ]], '#dbb986', 1);
  // Raised marquee leaves the claw's travel visible from the elevated camera.
  billboard(v, 10, 4.72, -2.46, c => {
    rr(c, -123, -28, 246, 52, 8, '#62352d', C.dark, 3);
    c.strokeStyle = '#e0b77f'; c.lineWidth = 2; c.strokeRect(-116, -21, 232, 38);
    c.textAlign = 'center'; c.fillStyle = '#f4dfb8'; c.font = 'bold 16px Georgia'; c.fillText('THE PRIZE DROP', 0, 5);
    star(c, -103, -2, 5, '#f0cf8f'); star(c, 103, -2, 5, '#f0cf8f');
  });
}
/** Clip an upholstery detail to a depth span without changing its fixed-world shape. */
function clipFaceAtZ(points: P[], near: number, far: number): P[] {
  const clip = (input: P[], boundary: number, keepGreater: boolean): P[] => {
    if (!input.length) return [];
    const output: P[] = [];
    let previous = input[input.length - 1], previousInside = keepGreater ? previous[2] >= boundary : previous[2] <= boundary;
    for (const current of input) {
      const inside = keepGreater ? current[2] >= boundary : current[2] <= boundary;
      if (inside !== previousInside) {
        const t = (boundary - previous[2]) / (current[2] - previous[2]);
        output.push([previous[0] + (current[0] - previous[0]) * t, previous[1] + (current[1] - previous[1]) * t, boundary]);
      }
      if (inside) output.push(current);
      previous = current; previousInside = inside;
    }
    return output;
  };
  return clip(clip(points, near, true), far, false);
}

/** Fixed-world material details are clipped to a z span; cuts add no moving outlines. */
function boothSpan(v: SceneView, x: number, outer: -1 | 1, za: number, zb: number) {
  const half = LOUNGE.benchHalf, a = x - half[0], b = x + half[0];
  const back = LOUNGE.z - half[2], front = LOUNGE.z + half[2];
  const outerX = outer < 0 ? a : b, innerBackX = outerX - outer * .26;
  const seatA = outer < 0 ? innerBackX : a + .08, seatB = outer < 0 ? b - .08 : innerBackX;
  surface(v, [[a, .09, za], [b, .09, za], [b, .09, zb], [a, .09, zb]], '#3c3038');
  surface(v, [[outerX, .12, za], [outerX, .12, zb], [outerX, .54, zb], [outerX, .54, za]], '#4a2d26');
  surface(v, [[seatA, .68, za], [seatB, .68, za], [seatB, .68, zb], [seatA, .68, zb]], '#8a3e32');
  for (const dz of [-1.05, 0, 1.05]) {
    const z = LOUNGE.z + dz; if (z >= za && z < zb) line(v, [seatA + .06, .69, z], [seatB - .06, .69, z], '#5b2e29', 1.3);
  }
  surface(v, [[outerX, .45, za], [outerX, .45, zb], [outerX, 1.2, zb], [outerX, 1.2, za]], '#5c2c29');
  const leather = horizontalGradient(v, [outerX, 1.16, back], [outerX, .53, back], [[0, '#b5654f'], [.3, '#8c4033'], [1, '#572925']]);
  for (let i = 0; i < 6; i++) {
    const channelA = back + .08 + i * ((front - back - .16) / 6), channelB = back + .08 + (i + 1) * ((front - back - .16) / 6);
    const clippedA = Math.max(za, channelA + .02), clippedB = Math.min(zb, channelB - .02);
    if (clippedA >= clippedB) continue;
    // Gradient anchors and channel boundaries are fixed even as the player-depth cuts move.
    surface(v, [[outerX, .53, clippedA], [outerX, .53, clippedB], [outerX, 1.16, clippedB], [outerX, 1.16, clippedA]], leather);
    const hiA = Math.max(clippedA, channelA + .08), hiB = Math.min(clippedB, channelB - .08);
    if (hiA < hiB) line(v, [outerX - outer * .004, 1.08, hiA], [outerX - outer * .004, 1.08, hiB], 'rgba(238,166,127,.34)', 1);
    const mid = (channelA + channelB) / 2;
    const diamond = clipFaceAtZ([[outerX - outer * .006, .82, mid - .035], [outerX - outer * .006, .85, mid], [outerX - outer * .006, .82, mid + .035], [outerX - outer * .006, .79, mid]], za, zb);
    if (diamond.length >= 3) surface(v, diamond, '#d4a27d');
  }
  surface(v, [[innerBackX, .65, za], [innerBackX, .65, zb], [innerBackX, 1.15, zb], [innerBackX, 1.15, za]], '#873d32');
  surface(v, [[outerX, 1.2, za], [innerBackX, 1.2, za], [innerBackX, 1.2, zb], [outerX, 1.2, zb]], '#b8644e');
  for (const dz of [-1.55, -.8, 0, .8, 1.55]) {
    const z = LOUNGE.z + dz; if (z >= za && z < zb) line(v, [innerBackX - outer * .004, .70, z], [innerBackX - outer * .004, 1.09, z], '#b86752', 1.1);
  }
}
function boothEnd(v: SceneView, x: number, z: number) {
  // End caps are drawn exactly once at their real near/far z planes.
  billboard(v, x, 0, z, c => {
    shape(c, p => { p.moveTo(-58, -16); p.lineTo(-58, -66); p.quadraticCurveTo(-58, -77, -46, -77); p.lineTo(46, -77); p.quadraticCurveTo(58, -77, 58, -66); p.lineTo(58, -16); p.quadraticCurveTo(0, -10, -58, -16); }, '#82382e', '#512b25', 2);
    stroke(c, p => { p.moveTo(-44, -65); p.quadraticCurveTo(0, -71, 44, -65); }, '#d09476', 2);
    for (const xx of [-42, 42]) shape(c, p => p.arc(xx, -38, 2.7, 0, Math.PI * 2), '#deb588', '', 0);
    shape(c, p => { p.moveTo(-49, -15); p.lineTo(-43, 0); p.lineTo(-27, 0); p.lineTo(-30, -15); }, '#44343a', '#362d34', 2);
    shape(c, p => { p.moveTo(49, -15); p.lineTo(43, 0); p.lineTo(27, 0); p.lineTo(30, -15); }, '#44343a', '#362d34', 2);
  });
}
function tableSpan(v: SceneView, za: number, zb: number) {
  const x = LOUNGE.tableX, hx = LOUNGE.tableHalf[0], hz = LOUNGE.tableHalf[2], back = LOUNGE.z - hz, front = LOUNGE.z + hz;
  surface(v, [[x - hx, 1.09, za], [x + hx, 1.09, za], [x + hx, 1.09, zb], [x - hx, 1.09, zb]], '#e1bd91');
  const innerA = Math.max(za, back + .1), innerB = Math.min(zb, front - .1);
  if (innerA < innerB) {
    surface(v, [[x - hx + .1, 1.1, innerA], [x + hx - .1, 1.1, innerA], [x + hx - .1, 1.1, innerB], [x - hx + .1, 1.1, innerB]], '#be8b70');
    line(v, [x - hx + .1, 1.11, innerA], [x - hx + .1, 1.11, innerB], '#d6ae86', 1);
    line(v, [x + hx - .1, 1.11, innerA], [x + hx - .1, 1.11, innerB], '#d6ae86', 1);
  }
}
function tableEnd(v: SceneView, z: number) {
  const x = LOUNGE.tableX, hx = LOUNGE.tableHalf[0];
  surface(v, [[x - hx, .94, z], [x + hx, .94, z], [x + hx, 1.09, z], [x - hx, 1.09, z]], '#8b5d51', '#4a3438', 1.4);
  line(v, [x - hx + .04, 1.1, z], [x + hx - .04, 1.1, z], '#e1bd91', 2);
}
function tablePedestal(v: SceneView) {
  const x = LOUNGE.tableX, z = LOUNGE.z;
  surface(v, [[x - .25, .05, z], [x + .25, .05, z], [x + .19, 1.02, z], [x - .19, 1.02, z]], '#5c4243', '#392f36', 1.6);
  ellipseWorld(v, x, .05, z, .65, .36, '#513a3f', '#382d35', 1.5);
}
function tableDetails(v: SceneView) {
  const x = LOUNGE.tableX, z = LOUNGE.z;
  surface(v, [[x - .72, 1.12, z - .75], [x - .3, 1.12, z - .75], [x - .22, 1.12, z - .3], [x - .64, 1.12, z - .3]], '#f0d8b1', '#a27865', 1);
  billboard(v, x, 1.11, z, c => {
    shape(c, p => { p.moveTo(-8, 0); p.lineTo(-11, -21); p.lineTo(11, -21); p.lineTo(8, 0); }, '#d7b68e', '#785751', 2);
    shape(c, p => { p.moveTo(-20, -20); p.quadraticCurveTo(-14, -43, 0, -46); p.quadraticCurveTo(14, -43, 20, -20); p.quadraticCurveTo(0, -14, -20, -20); }, '#f1d39f', '#9a715d', 2);
    for (const xx of [-48, 48]) {
      shape(c, p => { p.moveTo(xx - 8, -3); p.lineTo(xx - 11, -32); p.lineTo(xx + 11, -32); p.lineTo(xx + 8, -3); }, 'rgba(243,225,196,.65)', '#8b695f', 2);
      stroke(c, p => { p.moveTo(xx - 7, -16); p.lineTo(xx + 7, -16); }, '#cc9a7f', 2);
    }
  });
}
function shoeDesk(v: SceneView) {
  // Entrance counter and collider share the same foreground-left footprint.
  const x = DESK.x, z = DESK.z, hx = DESK.half[0], hz = DESK.half[2], height = DESK.half[1] * 2;
  ellipseWorld(v, x, .015, z, hx, hz * 1.25, 'rgba(24,21,29,.20)');
  surface(v, [[x - hx, 0, z - hz], [x + hx, 0, z - hz], [x + hx, height, z - hz], [x - hx, height, z - hz]], '#65474a', C.dark, 2);
  surface(v, [[x - hx, 0, z + hz], [x + hx, 0, z + hz], [x + hx, height, z + hz], [x - hx, height, z + hz]], '#875958', C.dark, 2);
  roundedWorldQuad(v, [[x - hx, height, z - hz], [x + hx, height, z - hz], [x + hx, height, z + hz], [x - hx, height, z + hz]], '#d0aa80', C.dark, 2, .04);
  // Two rows of inset shoe cubbies are drawn on the actual front plane.
  const face = z + hz + .006;
  for (const row of [.22, .71]) for (let column = 0; column < 6; column++) {
    const cx = x - 2.28 + column * .91;
    surface(v, [[cx - .37, row, face], [cx + .37, row, face], [cx + .37, row + .34, face], [cx - .37, row + .34, face]], '#33251f', '#b38661', 1.1);
    line(v, [cx - .36, row + .035, face + .002], [cx + .36, row + .035, face + .002], '#be946c', 1.1);
    billboard(v, cx, row + .06, face + .01, c => {
      shape(c, p => { p.moveTo(-27, -4); p.lineTo(-25, -15); p.quadraticCurveTo(-18, -20, -6, -18); p.lineTo(2, -9); p.lineTo(19, -7); p.quadraticCurveTo(26, -6, 26, -2); p.lineTo(25, 2); p.lineTo(-27, 2); }, '#d8c4a3', '#725744', 1.4);
      shape(c, p => { p.moveTo(-24, -15); p.lineTo(-10, -17); p.lineTo(-5, -9); p.lineTo(-23, -8); }, '#9e4e3d', '', 0);
      stroke(c, p => { p.moveTo(-5, -11); p.lineTo(7, -8); p.moveTo(-4, -7); p.lineTo(8, -5); }, '#f3e3c4', 1);
      stroke(c, p => { p.moveTo(-26, 1); p.lineTo(24, 1); }, '#f1e1c3', 2);
    });
  }
  billboard(v, x, 1.25, face + .015, c => {
    rr(c, -65, -13, 130, 13, 3, '#d8b77f', '#654732', 1);
    c.fillStyle = '#60442e'; c.font = 'bold 8px Georgia'; c.textAlign = 'center'; c.fillText('BOWLING SHOES', 0, -3);
  });
  billboard(v, x - 1.2, height, z, c => {
    shape(c, p => { p.moveTo(-36, 0); p.lineTo(-26, -9); p.lineTo(30, -9); p.lineTo(40, 0); }, '#f1dcb6', '#765e58', 2);
    stroke(c, p => { p.moveTo(0, -8); p.lineTo(0, 0); p.moveTo(-23, -5); p.lineTo(-5, -5); }, '#b79a80', 1);
    shape(c, p => { p.moveTo(58, 0); p.quadraticCurveTo(58, -23, 72, -24); p.quadraticCurveTo(86, -23, 86, 0); }, '#c99e68', '#655050', 2);
    shape(c, p => p.arc(72, -26, 3, 0, Math.PI * 2), '#f6dfaa', '', 0);
  });
}
function plant(v: SceneView, x: number, z: number, size = 1) {
  billboard(v, x, 0, z, c => {
    c.save(); c.scale(size, size);
    shape(c, p => { p.moveTo(-34, -52); p.lineTo(34, -52); p.lineTo(25, -2); p.quadraticCurveTo(0, 5, -25, -2); }, '#c7806e', '#594249', 3);
    shape(c, p => { p.ellipse(0, -51, 34, 8, 0, 0, Math.PI * 2); }, '#8c6056', '#594249', 3);
    for (const [x1, y1, x2, y2] of [[-6, -55, -33, -151], [0, -55, 4, -179], [8, -55, 43, -145], [-5, -55, -70, -117], [5, -55, 72, -110]] as const) {
      stroke(c, p => { p.moveTo(0, -50); p.quadraticCurveTo(x1, y1, x2, y2); }, '#607a70', 4);
      shape(c, p => { p.moveTo(x2, y2); p.quadraticCurveTo(x2 - 30, y2 + 1, x2 - 15, y2 + 32); p.quadraticCurveTo(x2 + 3, y2 + 19, x2, y2); }, '#789187', '#536c68', 2);
      shape(c, p => { p.moveTo(x2, y2); p.quadraticCurveTo(x2 + 30, y2 + 1, x2 + 16, y2 + 32); p.quadraticCurveTo(x2 - 3, y2 + 19, x2, y2); }, '#98a99a', '#536c68', 2);
    }
    c.restore();
  });
}
function wallDetails(v: SceneView) {
  // Asymmetric venue details replace rows of identical decorative frames.
  billboard(v, 5.2, 2.65, -14.5, c => {
    // A brass sunburst around a clock face serves as a physical landmark.
    for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; stroke(c, p => { p.moveTo(Math.cos(a) * 72, -86 + Math.sin(a) * 72); p.lineTo(Math.cos(a) * 94, -86 + Math.sin(a) * 94); }, '#c79d6d', 4); }
    shape(c, p => p.arc(0, -86, 68, 0, Math.PI * 2), '#f4ddba', '#6d5050', 5);
    shape(c, p => p.arc(0, -86, 53, 0, Math.PI * 2), '#e8cda6', '#bb916f', 2);
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; shape(c, p => p.arc(Math.cos(a) * 43, -86 + Math.sin(a) * 43, 2, 0, Math.PI * 2), '#74585a', '', 0); }
    const minute = (v.clockSeconds / 60) % 60, hour = (v.clockSeconds / 3600) % 12;
    const minuteAngle = minute / 60 * Math.PI * 2 - Math.PI / 2, hourAngle = hour / 12 * Math.PI * 2 - Math.PI / 2;
    stroke(c, p => { p.moveTo(0, -86); p.lineTo(Math.cos(hourAngle) * 25, -86 + Math.sin(hourAngle) * 25); p.moveTo(0, -86); p.lineTo(Math.cos(minuteAngle) * 37, -86 + Math.sin(minuteAngle) * 37); }, '#624a50', 4);
    shape(c, p => p.arc(0, -86, 4, 0, Math.PI * 2), '#624a50', '', 0);
  });
}
function pendant(v: SceneView, x: number, z: number) {
  // Near-camera shades would cover the playfield; keep the more distant lamps instead.
  if (v.project(x, 4.15, z).scale > 55) return;
  billboard(v, x, 4.15, z, c => {
    const glow = c.createRadialGradient(0, 2, 2, 0, 2, 90); glow.addColorStop(0, 'rgba(255,216,145,.22)'); glow.addColorStop(1, 'rgba(255,216,145,0)');
    c.fillStyle = glow; c.beginPath(); c.arc(0, 2, 90, 0, Math.PI * 2); c.fill();
    stroke(c, p => { p.moveTo(0, -125); p.lineTo(0, -34); }, '#6f5955', 3);
    shape(c, p => { p.moveTo(-55, 0); p.quadraticCurveTo(-40, -36, 0, -39); p.quadraticCurveTo(40, -36, 55, 0); p.quadraticCurveTo(0, 12, -55, 0); }, '#b58958', '#60462e', 2);
    shape(c, p => p.ellipse(0, 1, 44, 8, 0, 0, Math.PI), '#f3d5a0', '', 0);
    shape(c, p => p.arc(0, 5, 6, 0, Math.PI * 2), '#fff0c4', '', 0);
  });
}

/** Separate objects are depth-sorted with players, physics props, and the moving claw. */
export function venueProps(v: SceneView, poolBalls: readonly PoolBallVisual[] = [], characterDepths: readonly number[] = []): DrawItem[] {
  const item = (depth: number, draw: () => void): DrawItem => ({ depth, draw });
  const items: DrawItem[] = [
    item(-14.5, () => wallDetails(v)),
    item(-13.5, () => { plant(v, -15.5, -13.5, .85); plant(v, 15.5, -13.5, .9); }),
    item(-12.8, () => drawLaneRails(v)),
    item(-8.05, () => { arcadeCabinet(v, 8.4, 0); arcadeCabinet(v, 10, 1); arcadeCabinet(v, 11.6, 2); }),
    item(-4.68, () => clawBack(v)),
    item(-2.45, () => clawFront(v)),
    item(-10, () => pendant(v, -13, -10)),
    item(-10, () => pendant(v, -5, -10)),
    item(-10, () => pendant(v, 3, -10)),
    item(-10, () => pendant(v, 11, -10)),
    item(0, () => pendant(v, -13, 0)),
    item(0, () => pendant(v, -5, 0)),
    item(0, () => pendant(v, 3, 0)),
    item(0, () => pendant(v, 11, 0)),
    item(1.05, () => ballReturn(v)),
    item(POOL.centerZ, () => poolTable(v, poolBalls)),
    item(10, () => pendant(v, -13, 10)),
    item(10, () => pendant(v, -5, 10)),
    item(10, () => pendant(v, 3, 10)),
    item(10, () => pendant(v, 11, 10)),
    item(DESK.z, () => shoeDesk(v)),
  ];
  const spans = (back: number, front: number) => {
    const candidates = [back, ...characterDepths.filter(z => Number.isFinite(z) && z > back && z < front), front].sort((a, b) => a - b);
    const cuts = candidates.filter((z, i) => i === 0 || z - candidates[i - 1] > .00001);
    return cuts.slice(0, -1).map((z, i) => [z, cuts[i + 1]] as const);
  };
  const benchBack = LOUNGE.z - LOUNGE.benchHalf[2], benchFront = LOUNGE.z + LOUNGE.benchHalf[2];
  for (const [x, outer] of [[LOUNGE.leftX, -1], [LOUNGE.rightX, 1]] as const) {
    items.push(item(benchBack - .02, () => { if (benchFront < v.cameraZ - 1.6) ellipseWorld(v, x, .015, LOUNGE.z, .73, 2.15, 'rgba(25,22,31,.22)'); }));
    items.push(item(benchBack, () => boothEnd(v, x, benchBack)));
    for (const [za, zb] of spans(benchBack, benchFront)) items.push(item((za + zb) / 2, () => boothSpan(v, x, outer, za, zb)));
    items.push(item(benchFront, () => boothEnd(v, x, benchFront)));
  }
  const tableBack = LOUNGE.z - LOUNGE.tableHalf[2], tableFront = LOUNGE.z + LOUNGE.tableHalf[2];
  items.push(item(tableBack - .02, () => { if (tableFront < v.cameraZ - 1.6) ellipseWorld(v, LOUNGE.tableX, .015, LOUNGE.z, .85, .58, 'rgba(25,22,31,.24)'); }));
  items.push(item(tableBack, () => tableEnd(v, tableBack)));
  items.push(item(LOUNGE.z, () => tablePedestal(v)));
  for (const [za, zb] of spans(tableBack, tableFront)) items.push(item((za + zb) / 2, () => tableSpan(v, za, zb)));
  items.push(item(LOUNGE.z + .001, () => tableDetails(v)));
  items.push(item(tableFront, () => tableEnd(v, tableFront)));
  return items;
}
