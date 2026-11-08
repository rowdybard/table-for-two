import RAPIER from '@dimforge/rapier3d-compat';
import type { PlayerId, PoolState, Quat, Vec3 } from '../src/shared/protocol';
import { POOL } from '../src/shared/venue';

const DT = 1 / 60;
const pockets: [number, number][] = [
  [POOL.minX, POOL.minZ], [POOL.centerX, POOL.minZ], [POOL.maxX, POOL.minZ],
  [POOL.minX, POOL.maxZ], [POOL.centerX, POOL.maxZ], [POOL.maxX, POOL.maxZ],
];
type Ball = { id: number; body: RAPIER.RigidBody };
type Shot = { playerId: PlayerId; potted: number; scratch: boolean };

/** Isolated table simulation: nothing in the walking world can hit a ball. */
export class PoolGame {
  private world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  private balls: Ball[] = [];
  private participants: PlayerId[] = [];
  private turn: PlayerId | null = null;
  private rolling = false;
  private won = false;
  private shots = 0;
  private pocketed = 0;
  private lastShot: Shot | null = null;
  private activeShot: Shot | null = null;
  private stillTime = 0;
  get isRolling() { return this.rolling; }
  constructor() {
    this.world.timestep = DT;
    // Discontinuous cushions leave physical openings around all six pockets.
    const rail = (x: number, z: number, hx: number, hz: number) => {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, POOL.height, z));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, .15, hz).setRestitution(.9).setFriction(.05), body);
    };
    for (const z of [POOL.minZ, POOL.maxZ]) {
      for (const [a, b] of [[POOL.minX + POOL.cushionOpening, POOL.centerX - POOL.cushionOpening], [POOL.centerX + POOL.cushionOpening, POOL.maxX - POOL.cushionOpening]]) rail((a + b) / 2, z, (b - a) / 2, .04);
    }
    for (const x of [POOL.minX, POOL.maxX]) rail(x, POOL.centerZ, .04, (POOL.maxZ - POOL.minZ) / 2 - POOL.cushionOpening);
    this.rack();
  }
  private ball(id: number, x: number, z: number) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, POOL.height, z).enabledTranslations(true, false, true).setLinearDamping(.7).setAngularDamping(1).setCcdEnabled(true));
    this.world.createCollider(RAPIER.ColliderDesc.ball(POOL.radius).setMass(.17).setRestitution(.94).setFriction(.05), body);
    this.balls.push({ id, body });
  }
  private rack() {
    for (const b of this.balls) this.world.removeRigidBody(b.body);
    this.balls = []; this.ball(0, POOL.centerX - 1.55, POOL.centerZ);
    // Three-row triangle, apex facing the cue ball.
    let id = 1;
    for (let row = 0; row < 3; row++) for (let col = 0; col <= row; col++) this.ball(id++, POOL.centerX + .9 + row * .194, POOL.centerZ + (col - row / 2) * .224);
    this.rolling = false; this.won = false; this.shots = 0; this.pocketed = 0; this.lastShot = null; this.activeShot = null; this.stillTime = 0;
    this.turn = this.participants[0] ?? null;
  }
  join(id: PlayerId) {
    if (this.participants.includes(id)) return false;
    this.participants.push(id); if (!this.turn) this.turn = id; return true;
  }
  leave(id: PlayerId) { this.participants = this.participants.filter(p => p !== id); }
  pass(id: PlayerId) {
    if (this.participants.length !== 2 || this.rolling || this.won || this.turn !== id) return false;
    this.turn = id === 'p1' ? 'p2' : 'p1'; return true;
  }
  rerack(id: PlayerId) {
    if (!this.participants.includes(id) || this.participants.length !== 2 || !this.won) return false;
    this.rack(); return true;
  }
  shoot(id: PlayerId, angle: number, power: number) {
    if (this.participants.length !== 2 || this.rolling || this.won || this.turn !== id || !Number.isFinite(angle) || Math.abs(angle) > Math.PI || !Number.isFinite(power) || power < .1 || power > 1) return false;
    const cue = this.balls.find(b => b.id === 0); if (!cue) return false;
    const speed = 1 + power * 3.5;
    cue.body.setLinvel({ x: Math.cos(angle) * speed, y: 0, z: Math.sin(angle) * speed }, true);
    cue.body.setAngvel({ x: Math.sin(angle) * speed / POOL.radius, y: 0, z: -Math.cos(angle) * speed / POOL.radius }, true);
    this.rolling = true; this.shots++; this.activeShot = { playerId: id, potted: 0, scratch: false }; this.stillTime = 0; return true;
  }
  step() {
    if (!this.rolling) return;
    this.world.step();
    for (const b of [...this.balls]) {
      const p = b.body.translation();
      if (pockets.some(([x, z]) => Math.hypot(p.x - x, p.z - z) < POOL.pocketRadius) || p.x < POOL.minX || p.x > POOL.maxX || p.z < POOL.minZ || p.z > POOL.maxZ) {
        this.world.removeRigidBody(b.body); this.balls.splice(this.balls.indexOf(b), 1);
        if (b.id === 0) this.activeShot!.scratch = true;
        else { this.pocketed++; this.activeShot!.potted++; }
      }
    }
    if (this.balls.every(b => { const v = b.body.linvel(); return Math.hypot(v.x, v.z) < .035; })) this.stillTime += DT; else this.stillTime = 0;
    if (this.stillTime >= .3) {
      for (const b of this.balls) { b.body.setLinvel({ x: 0, y: 0, z: 0 }, true); b.body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
      if (!this.balls.some(b => b.id === 0)) this.respot();
      this.rolling = false; this.lastShot = this.activeShot; this.activeShot = null;
      this.won = this.pocketed === POOL.total;
      this.turn = this.lastShot!.playerId === 'p1' ? 'p2' : 'p1';
    }
  }
  private respot() {
    // Prefer the normal cue spot, then search a bounded grid for a clear position.
    const clear = (x: number, z: number) => this.balls.every(b => { const p = b.body.translation(); return Math.hypot(p.x - x, p.z - z) > POOL.radius * 2 + .02; });
    if (clear(POOL.centerX - 1.55, POOL.centerZ)) { this.ball(0, POOL.centerX - 1.55, POOL.centerZ); return; }
    for (let x = POOL.centerX - 1.55; x <= POOL.maxX - .3; x += .24) for (let z = POOL.minZ + .3; z <= POOL.maxZ - .3; z += .24) {
      if (clear(x, z)) { this.ball(0, x, z); return; }
    }
    throw new Error('No room to respot the cue ball');
  }
  snapshot(): PoolState {
    return { phase: this.participants.length < 2 ? 'waiting' : this.won ? 'won' : this.rolling ? 'rolling' : 'aiming', participants: [...this.participants], turn: this.turn, shots: this.shots, total: POOL.total, pocketed: this.pocketed,
      balls: this.balls.map(({ id, body }) => { const p = body.translation(), q = body.rotation(); return { id, position: [p.x, p.y, p.z] as Vec3, rotation: [q.x, q.y, q.z, q.w] as Quat }; }), lastShot: this.lastShot ? { ...this.lastShot } : null };
  }
  free() { this.world.free(); }
}
