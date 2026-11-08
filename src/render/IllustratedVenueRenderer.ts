import type { ObjectState, PlayerId, RoomState, Vec3 } from '../shared/protocol';
import { VENUE } from '../shared/venue';
import { drawArchitecture, venueProps } from './illustrated/environment';
import { drawCharacter } from './illustrated/characters';
import { drawPoolView, poolLayout, poolWorldPoint } from './illustrated/poolView';
import { drawClawView } from './illustrated/clawView';
import { ART, billboard, line, type DrawItem, type SceneView, type ScreenPoint } from './illustrated/types';

type Direction = 'front' | 'back' | 'side';
type Motion = { position: Vec3; previous: Vec3; speed: number; facing: -1 | 1; direction: Direction };
type Focus = 'bowling' | 'claw' | 'pool' | null;

/** Illustrated presentation of the same server-owned, three-dimensional physics room. */
export class VenueRenderer {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private state?: RoomState;
  private localId: PlayerId = 'p1';
  private width = 1280;
  private height = 800;
  private pixelRatio = 1;
  private elapsed = 0;
  private cameraX = .4;
  private cameraZ = 25.5;
  private cameraHeight = 4.4;
  private horizon = .20;
  private lens = 1.9;
  private zoom = 1;
  private inputEnabled = true;
  private activity: Focus = null;
  private poolAngle = 0;
  private poolPower = .55;
  private disposed = false;
  private endingPhase = 'waiting';
  private endingStarted = 0;
  private readonly motions = new Map<string, Motion>();

  constructor(private readonly container: HTMLElement) {
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas is unavailable');
    this.ctx = ctx;
    this.canvas.setAttribute('aria-label', 'Illustrated bowling lounge on New Year’s Eve');
    this.canvas.tabIndex = -1;
    container.append(this.canvas);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.canvas.addEventListener('wheel', this.wheel, { passive: false });
    this.resize();
  }

  getMovementVector(horizontal: number, forward: number) { return { x: horizontal, z: forward }; }
  setActivityFocus(focus: Focus) { this.activity = focus; }
  setInputEnabled(enabled: boolean) { this.inputEnabled = enabled; }
  setPoolAim(angle: number, power: number) {
    if (Number.isFinite(angle)) this.poolAngle = angle;
    if (Number.isFinite(power)) this.poolPower = Math.max(0, Math.min(1, power));
  }
  getPoolPoint(clientX: number, clientY: number): { x: number; z: number } | null {
    if (this.activity !== 'pool' || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    const x = (clientX - rect.left) * this.width / rect.width, y = (clientY - rect.top) * this.height / rect.height;
    return poolWorldPoint(poolLayout(this.width, this.height), x, y);
  }
  private wheel = (e: WheelEvent) => {
    if (!this.inputEnabled) return;
    e.preventDefault(); this.zoom = Math.max(.8, Math.min(1.2, this.zoom - e.deltaY * .0007));
  };

  update(state: RoomState, localId: PlayerId, dt: number) {
    this.state = state; this.localId = localId;
    if (state.ending.phase !== this.endingPhase) { this.endingPhase = state.ending.phase; this.endingStarted = this.elapsed; }
    const live = new Set<string>();
    const updateMotion = (id: string, position: Vec3) => {
      live.add(id);
      let m = this.motions.get(id);
      if (!m) { m = { position: [...position], previous: [...position], speed: 0, facing: 1, direction: 'front' }; this.motions.set(id, m); }
      const blend = 1 - Math.exp(-Math.min(.15, dt) * 18);
      m.previous = [...m.position];
      for (let i = 0; i < 3; i++) m.position[i] += (position[i] - m.position[i]) * blend;
      const dx = m.position[0] - m.previous[0], dz = m.position[2] - m.previous[2];
      m.speed += (Math.min(1, Math.hypot(dx, dz) / Math.max(.001, dt) / VENUE.playerSpeed) - m.speed) * blend;
      if (Math.abs(dx) > .002) m.facing = dx < 0 ? -1 : 1;
      if (Math.hypot(dx, dz) > .002) m.direction = Math.abs(dz) > Math.abs(dx) * 1.2 ? dz < 0 ? 'back' : 'front' : 'side';
    };
    state.players.forEach(p => updateMotion(`player:${p.id}`, p.position));
    state.objects.forEach(o => updateMotion(o.id, o.position));
    state.pool?.balls.forEach(ball => updateMotion(`pool:${ball.id}`, ball.position));
    updateMotion('claw-anchor', [state.claw.x, state.claw.y, state.claw.z]);
    for (const id of this.motions.keys()) if (!live.has(id)) this.motions.delete(id);
  }

  private project = (x: number, y: number, z: number): ScreenPoint => {
    const depth = Math.max(1.4, this.cameraZ - z);
    const focal = Math.min(this.height, this.width * .95) * this.zoom * this.lens;
    const scale = focal / depth;
    return { x: this.width * .5 + (x - this.cameraX) * scale, y: this.height * this.horizon + (this.cameraHeight - y) * scale, scale, depth };
  };

  render(dt: number) {
    if (this.disposed) return;
    this.elapsed += Math.min(.15, dt);
    const c = this.ctx, state = this.state;
    const local = this.motions.get(`player:${this.localId}`);
    const endingAge = this.elapsed - this.endingStarted;
    const kissing = state?.ending.phase === 'kiss' && endingAge < 5.5;
    // At a narrow desktop width, stage the preview pair beside the entry card.
    let cx = local?.position[0] ?? (this.width < 1100 ? -.7 : .4), cz = local ? local.position[2] + 14.5 : 25.5, cy = 4.4, horizon = .20, lens = 1.9;
    // A longer lens keeps activity furnishings substantial behind the pair.
    // Frame nearby players from the nearer one's depth so neither is enlarged
    // beyond the lower edge when one walks toward the camera.
    const partner = state?.players.find(p => p.id !== this.localId);
    if (local && partner && partner.connected && Math.hypot(partner.position[0] - local.position[0], partner.position[2] - local.position[2]) < 8) {
      cx = (local.position[0] + partner.position[0]) * .5;
      cz = Math.max(local.position[2], partner.position[2]) + 14.5;
    }
    if (this.activity === 'bowling') { cx = -8.1; cz = 7.2; cy = 3.5; horizon = .16; lens = 1; }
    if (this.activity === 'claw') { cx = 11.5; cz = 7.5; cy = 4.5; horizon = .18; lens = 1; }
    let kissCenter: Vec3 | undefined;
    if (kissing && state && state.players.length === 2) {
      const a = state.players[0].position, b = state.players[1].position;
      kissCenter = [(a[0] + b[0]) / 2, .8, (a[2] + b[2]) / 2];
      cx = kissCenter[0]; cz = kissCenter[2] + 8.4; cy = 3.4; horizon = .18; lens = 1;
    }
    const smooth = 1 - Math.exp(-Math.min(.15, dt) * 9);
    this.cameraX += (cx - this.cameraX) * smooth; this.cameraZ += (cz - this.cameraZ) * smooth;
    this.cameraHeight += (cy - this.cameraHeight) * smooth; this.horizon += (horizon - this.horizon) * smooth;
    this.lens += (lens - this.lens) * smooth;
    c.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    c.clearRect(0, 0, this.width, this.height);
    c.lineJoin = 'round'; c.lineCap = 'round';
    const poolBalls = (state?.pool?.balls ?? []).map(ball => ({ ...ball, position: this.motions.get(`pool:${ball.id}`)?.position ?? ball.position }));
    // Both close views have opaque backdrops; avoid drawing the entire venue
    // underneath them, particularly when two local browser clients are active.
    if (state && (this.activity === 'pool' || this.activity === 'claw')) {
      if (this.activity === 'pool') {
        drawPoolView(c, this.width, this.height, { ...state.pool, balls: poolBalls }, this.localId, this.poolAngle, this.poolPower, this.elapsed, state.players);
      } else {
        const anchor = this.motions.get('claw-anchor')!.position;
        drawClawView(c, this.width, this.height, { ...state,
          claw: { ...state.claw, x: anchor[0], y: anchor[1], z: anchor[2] },
          objects: state.objects.map(object => ({ ...object, position: this.motions.get(object.id)?.position ?? object.position })),
        }, this.localId, this.elapsed);
      }
      this.finishFrame(state, endingAge); return;
    }
    const view: SceneView = { ctx: c, width: this.width, height: this.height, time: this.elapsed, clockSeconds: state?.clockSeconds ?? VENUE.startTime, cameraZ: this.cameraZ, project: this.project };
    drawArchitecture(view);
    const items: DrawItem[] = [];
    const labels: { point: ScreenPoint; name: string }[] = [];
    const character = (x: number, z: number, variant: 'alex' | 'sam' | 'mira' | 'dev', facing: -1 | 1, speed: number, name?: string, mood: 'idle' | 'wave' | 'kiss' = 'idle', direction: Direction = 'front', pose: 'relaxed' | 'lean' | 'talk' = 'relaxed') => {
      if (this.activity === 'pool') return;
      items.push({ depth: z, draw: () => {
        const p = this.project(x, 0, z);
        drawCharacter(c, { x: p.x, y: p.y, scale: p.scale / 100, facing, walk: speed, time: this.elapsed, variant, mood, direction, pose });
        if (name && this.activity === null && !kissing) {
          labels.push({ point: p, name });
        }
      } });
    };
    character(-4.5, 7.5, 'mira', 1, 0, undefined, local && Math.hypot(local.position[0] + 4.5, local.position[2] - 7.5) < 4 ? 'wave' : 'idle', 'side', 'talk');
    character(3.8, 10.6, 'dev', -1, 0, undefined, 'idle', 'side', 'lean');
    if (!state?.players.length) {
      character(VENUE.spawn.p1[0], VENUE.spawn.p1[2], 'alex', 1, 0, undefined, 'idle', 'side');
      character(VENUE.spawn.p2[0], VENUE.spawn.p2[2], 'sam', -1, 0, undefined, 'idle', 'side');
    }
    for (const p of state?.players ?? []) {
      const m = this.motions.get(`player:${p.id}`)!;
      let [x, , z] = m.position, face = m.facing;
      let direction = m.direction;
      let mood: 'idle' | 'kiss' = 'idle';
      if (kissCenter) {
        const amount = Math.min(1, endingAge / 1.2) * Math.min(1, (5.5 - endingAge) / 1.2);
        const offset = p.id === 'p1' ? -.22 : .22;
        x += (kissCenter[0] + offset - x) * amount; z += (kissCenter[2] - z) * amount;
        face = p.id === 'p1' ? 1 : -1; mood = 'kiss'; direction = 'side';
      } else if (m.speed < .05) {
        const partner = state!.players.find(other => other.id !== p.id);
        if (partner && Math.hypot(partner.position[0] - x, partner.position[2] - z) < 7) {
          const dx = partner.position[0] - x, dz = partner.position[2] - z;
          if (Math.abs(dx) > .2) face = dx < 0 ? -1 : 1;
          direction = Math.abs(dz) > Math.abs(dx) * 1.4 ? dz < 0 ? 'back' : 'front' : 'side';
        }
      }
      if (this.activity === 'bowling' && p.id === this.localId) continue;
      character(x, z, p.id === 'p1' ? 'alex' : 'sam', face, m.speed, p.id === this.localId ? `${p.name} · you` : p.name, mood, direction);
    }
    // Use the actual rendered character depths, including cinematic positions,
    // so long furnishings can be split in front of and behind each person.
    items.push(...venueProps(view, poolBalls, items.map(item => item.depth)));
    const objects = state?.players.length ? state.objects : this.previewPins();
    for (const object of objects) {
      const pos = this.motions.get(object.id)?.position ?? object.position;
      items.push({ depth: pos[2], draw: () => this.drawObject(view, object, pos) });
    }
    const claw = state?.claw;
    const clawX = claw?.x ?? 9.2, clawZ = claw?.z ?? -4.15, clawY = claw?.y ?? 3.8;
    items.push({ depth: clawZ + .02, draw: () => this.drawClaw(view, clawX, clawY, clawZ) });
    items.sort((a, b) => a.depth - b.depth);
    for (const item of items) if (item.depth < this.cameraZ - 1.3) item.draw();
    for (const { point: p, name } of labels) {
      c.save(); c.font = '500 11px "Segoe UI", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      const labelWidth = c.measureText(name).width + 18;
      const labelY = Math.max(108, p.y - p.scale * 2.55 - 13);
      c.fillStyle = 'rgba(30, 23, 18, .82)'; c.beginPath(); c.roundRect(p.x - labelWidth / 2, labelY - 10, labelWidth, 21, 10); c.fill();
      c.fillStyle = ART.cream; c.fillText(name, p.x, labelY); c.restore();
    }
    this.finishFrame(state, endingAge);
  }

  private finishFrame(state: RoomState | undefined, endingAge: number) {
    const c = this.ctx;
    if (state && ['kiss', 'celebration'].includes(state.ending.phase) && endingAge < 9) this.drawConfetti(endingAge);
    const vignette = c.createRadialGradient(this.width * .5, this.height * .45, this.width * .25, this.width * .5, this.height * .45, this.width * .76);
    vignette.addColorStop(0, 'rgba(25,17,12,0)'); vignette.addColorStop(1, 'rgba(25,17,12,.28)');
    c.fillStyle = vignette; c.fillRect(0, 0, this.width, this.height);
  }

  private drawObject(v: SceneView, object: ObjectState, pos: Vec3) {
    const c = this.ctx, p = this.project(...pos), ground = this.project(pos[0], .01, pos[2]);
    if (p.x < -160 || p.x > this.width + 160 || p.y < -200 || p.y > this.height + 200) return;
    const radius = object.kind === 'ball' ? .3 : object.kind === 'pin' ? .16 : object.kind === 'giant-prize' ? .75 : .35;
    c.fillStyle = 'rgba(20,21,35,.23)'; c.beginPath(); c.ellipse(ground.x, ground.y, radius * ground.scale * 1.3, radius * ground.scale * .27, 0, 0, Math.PI * 2); c.fill();
    if (object.kind === 'pin') {
      const [x,y,z,w] = object.rotation;
      const axis: Vec3 = [2*(x*y-w*z), 1-2*(x*x+z*z), 2*(y*z+w*x)];
      const top = this.project(pos[0]+axis[0]*.4,pos[1]+axis[1]*.4,pos[2]+axis[2]*.4);
      const bottom = this.project(pos[0]-axis[0]*.4,pos[1]-axis[1]*.4,pos[2]-axis[2]*.4);
      c.save(); c.translate(p.x,p.y); c.rotate(Math.atan2(top.x-bottom.x, bottom.y-top.y));
      c.scale(p.scale/100, Math.max(4,Math.hypot(top.x-bottom.x,top.y-bottom.y))/80);
      const shade=c.createLinearGradient(-15,0,15,0);shade.addColorStop(0,'#d3c7b0');shade.addColorStop(.4,'#fff5da');shade.addColorStop(1,'#d6cbb5');
      c.fillStyle=shade;c.strokeStyle=ART.ink;c.lineWidth=1.2;c.beginPath();c.moveTo(-9,40);c.bezierCurveTo(-22,21,-12,4,-7,-10);c.bezierCurveTo(-6,-20,-13,-30,-8,-37);c.quadraticCurveTo(0,-46,8,-37);c.bezierCurveTo(13,-30,6,-20,7,-10);c.bezierCurveTo(12,4,22,21,9,40);c.closePath();c.fill();c.stroke();
      c.fillStyle=ART.coral;c.fillRect(-8,-18,16,5);c.fillRect(-8,-10,16,3);c.restore();return;
    }
    const r = radius*p.scale;
    c.save();c.translate(p.x,p.y);
    const color=object.kind==='ball'?ART.wine:ART.gold;
    const gradient=c.createRadialGradient(-r*.3,-r*.4,r*.05,0,0,r);gradient.addColorStop(0,object.kind==='ball'?'#d48c89':'#f6d9a0');gradient.addColorStop(.5,color);gradient.addColorStop(1,object.kind==='ball'?'#6b3243':'#ab7349');
    c.fillStyle=gradient;c.strokeStyle=ART.ink;c.lineWidth=1.4;c.beginPath();c.arc(0,0,r,0,Math.PI*2);c.fill();c.stroke();
    if (object.kind==='ball') {
      c.rotate(Math.atan2(object.rotation[2],object.rotation[3])*2);
      c.fillStyle='#392b3c';for(const [xx,yy]of[[-.12,-.2],[.17,-.22],[.03,.05]]){c.beginPath();c.ellipse(r*xx,r*yy,r*.075,r*.1,0,0,Math.PI*2);c.fill();}
      c.strokeStyle='rgba(255,231,201,.45)';c.lineWidth=Math.max(1,r*.06);c.beginPath();c.arc(0,0,r*.75,3.8,4.6);c.stroke();
    } else if (object.kind === 'beach-ball') {
      // Loose lounge balls keep their identity; only machine prizes are bears.
      c.save();c.beginPath();c.arc(0,0,r,0,Math.PI*2);c.clip();
      c.fillStyle=ART.cream;c.beginPath();c.ellipse(0,0,r*.45,r*1.1,-.5,0,Math.PI*2);c.fill();
      c.strokeStyle=ART.wine;c.lineWidth=Math.max(1,r*.13);c.beginPath();c.ellipse(0,0,r*.75,r*1.1,-.5,0,Math.PI*2);c.stroke();c.restore();
    } else {
      c.fillStyle='#c48f5c'; for(const xx of[-.62,.62]){c.beginPath();c.arc(xx*r,-r*.67,r*.25,0,Math.PI*2);c.fill();}
      c.fillStyle='#f4d3a0';c.beginPath();c.ellipse(0,r*.29,r*.35,r*.27,0,0,Math.PI*2);c.fill();
      c.fillStyle=ART.ink;for(const xx of[-.31,.31]){c.beginPath();c.ellipse(xx*r,-r*.1,r*.05,r*.07,0,0,Math.PI*2);c.fill();}
      c.beginPath();c.ellipse(0,r*.2,r*.09,r*.06,0,0,Math.PI*2);c.fill();
      c.strokeStyle=ART.ink;c.lineWidth=1.5;c.beginPath();c.moveTo(0,r*.25);c.quadraticCurveTo(0,r*.43,r*.15,r*.37);c.stroke();
    }
    c.restore();
  }

  private drawClaw(v: SceneView,x:number,y:number,z:number) {
    const c=this.ctx;
    // The cable's base and its shadow make both dimensions of travel visible.
    line(v,[x,4.1,z],[x,y,z],ART.cream,2);
    const p=this.project(x,y,z), shadow=this.project(x,1.52,z);
    c.save();c.strokeStyle='#edc57c';c.lineWidth=1.5;c.setLineDash([4,4]);c.beginPath();c.ellipse(shadow.x,shadow.y,shadow.scale*.23,shadow.scale*.07,0,0,Math.PI*2);c.stroke();c.restore();
    billboard(v,x,y,z,ctx=>{
      ctx.strokeStyle=ART.ink;ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(-19,33);ctx.lineTo(-25,18);ctx.lineTo(-10,0);ctx.lineTo(10,0);ctx.lineTo(25,18);ctx.lineTo(19,33);ctx.stroke();
      ctx.strokeStyle=ART.gold;ctx.lineWidth=4;ctx.stroke();ctx.fillStyle=ART.cream;ctx.beginPath();ctx.arc(0,0,7,0,Math.PI*2);ctx.fill();
    });
    if (this.activity==='claw' && p.scale>20) {
      c.fillStyle=ART.gold;c.beginPath();c.arc(p.x,p.y,2.5,0,Math.PI*2);c.fill();
    }
  }

  private drawConfetti(age:number) {
    const c=this.ctx;c.save();
    for(let i=0;i<75;i++){const x=((i*137.31+Math.sin(age+i)*25)%this.width+this.width)%this.width;const y=((i*77+age*(45+i%15))%(this.height+100))-50;c.save();c.translate(x,y);c.rotate(age*(i%2?1:-1)+i);c.fillStyle=[ART.gold,ART.cream,ART.coral][i%3];c.fillRect(-2,-4,4,8);c.restore();}
    c.restore();
  }
  private previewPins():ObjectState[] {
    const result:ObjectState[]=[];for(let row=0;row<4;row++)for(let col=0;col<=row;col++)result.push({id:`preview-${row}-${col}`,kind:'pin',position:[-9+(col-row/2)*.45,.4,-10.5-row*.45],rotation:[0,0,0,1]});return result;
  }
  private resize() {
    this.width=Math.max(1,this.container.clientWidth);this.height=Math.max(1,this.container.clientHeight);this.pixelRatio=Math.min(window.devicePixelRatio||1,2);
    this.canvas.width=Math.round(this.width*this.pixelRatio);this.canvas.height=Math.round(this.height*this.pixelRatio);
    this.canvas.style.width=`${this.width}px`;this.canvas.style.height=`${this.height}px`;
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.resizeObserver.disconnect();this.canvas.removeEventListener('wheel',this.wheel);this.canvas.remove();this.motions.clear();}
}
