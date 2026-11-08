import RAPIER from '@dimforge/rapier3d-compat';
import { CLAW } from '../src/shared/venue';
import type { ObjectState, PlayerId, RoomState } from '../src/shared/protocol';

type Entity = { id: string; kind: ObjectState['kind']; body: RAPIER.RigidBody };
type Axis = 'x' | 'z';
const q = { x: 0, y: 0, z: 0, w: 1 };
const v = (x: number, y: number, z: number) => ({ x, y, z });

/** The claw anchor is kinematic; the captured prize stays a dynamic Rapier body on a joint. */
export class ClawGame {
  phase: RoomState['claw']['phase'] = 'idle';
  operators: Record<Axis, PlayerId | null> = { x: null, z: null };
  ready: Record<PlayerId, boolean> = { p1: false, p2: false };
  moved: Record<Axis, boolean> = { x: false, z: false };
  x: number = CLAW.initialX; z: number = CLAW.initialZ; y: number = CLAW.restY; attempts = 0;
  private movement: Record<PlayerId, { direction: number; at: number }> = { p1: { direction: 0, at: 0 }, p2: { direction: 0, at: 0 } };
  private anchor: RAPIER.RigidBody;
  private joint: RAPIER.ImpulseJoint | null = null;
  private prize: Entity;
  constructor(private world: RAPIER.World, private entities: Entity[]) {
    this.anchor = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.x, this.y, this.z));
    this.prize = this.makePrize('claw-prize', CLAW.prizeX, CLAW.prizeY, CLAW.prizeZ, CLAW.prizeRadius);
  }
  private makePrize(kind: 'claw-prize' | 'giant-prize', x: number, y: number, z: number, radius: number): Entity {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(.25).setAngularDamping(.25).setCcdEnabled(true));
    this.world.createCollider(RAPIER.ColliderDesc.ball(radius).setMass(kind === 'giant-prize' ? 5 : .6).setRestitution(.25), body);
    const entity = { id: kind, kind, body }; this.entities.push(entity); return entity;
  }
  private attach() {
    const p = this.prize.body.translation();
    this.joint = this.world.createImpulseJoint(RAPIER.JointData.fixed(v(0, 0, 0), q, v(this.x - p.x, this.y - p.y, this.z - p.z), q), this.anchor, this.prize.body, true);
  }
  private detach() { if (this.joint) { this.world.removeImpulseJoint(this.joint, true); this.joint = null; } }
  get prizeHeld() { return this.joint !== null; }
  join(id: PlayerId) {
    if (this.phase === 'won' || this.operators.x === id || this.operators.z === id) return false;
    if (!this.operators.x) this.operators.x = id; else if (!this.operators.z) this.operators.z = id; else return false;
    if (this.phase === 'idle') this.phase = 'aiming'; this.moved = { x: false, z: false }; this.clearInputs(); return true;
  }
  leave(id: PlayerId) { if (this.operators.x !== id && this.operators.z !== id) return; if (this.operators.x === id) this.operators.x = null; if (this.operators.z === id) this.operators.z = null; this.moved = { x: false, z: false }; this.clearInputs(); }
  clearInputs() { this.ready.p1 = this.ready.p2 = false; this.movement.p1.direction = this.movement.p2.direction = 0; }
  swap(id: PlayerId) {
    if ((!this.operators.x && !this.operators.z) || (this.operators.x !== id && this.operators.z !== id) || !['aiming', 'surprise'].includes(this.phase)) return false;
    [this.operators.x, this.operators.z] = [this.operators.z, this.operators.x]; this.moved = { x: false, z: false }; this.clearInputs(); return true;
  }
  move(id: PlayerId, direction: number, now: number) {
    if ((this.operators.x !== id && this.operators.z !== id) || !['aiming', 'surprise'].includes(this.phase)) return false;
    this.movement[id] = { direction, at: now }; if (direction) this.ready.p1 = this.ready.p2 = false; return true;
  }
  setReady(id: PlayerId, ready: boolean) {
    if ((this.operators.x !== id && this.operators.z !== id) || !this.operators.x || !this.operators.z || !this.moved.x || !this.moved.z || !['aiming', 'surprise'].includes(this.phase)) return false;
    this.ready[id] = ready;
    if (this.ready.p1 && this.ready.p2) {
      if (this.phase === 'aiming') { this.phase = 'dropping'; this.attempts++; this.clearInputs(); }
      else if (this.x <= CLAW.hatchMaxX && this.z >= CLAW.hatchMinZ) { this.detach(); this.phase = 'won'; this.prize.body.applyImpulse(v(-2, 0, 2), true); this.clearInputs(); }
      // The alternate opening is at the left-front edge; retain readiness so either can withdraw.
    }
    return true;
  }
  step(dt: number, now: number) {
    if (this.phase === 'aiming' || this.phase === 'surprise') {
      for (const axis of ['x', 'z'] as const) {
        const player = this.operators[axis]; if (!player) continue;
        const m = this.movement[player]; const amount = now - m.at < 250 ? m.direction * dt * 1.5 : 0;
        const before = this[axis];
        if (axis === 'x') this.x = Math.max(this.phase === 'surprise' ? CLAW.surpriseMinX : CLAW.minX, Math.min(CLAW.maxX, this.x + amount));
        else this.z = Math.max(CLAW.minZ, Math.min(CLAW.maxZ, this.z + amount));
        if (Math.abs(this[axis] - before) > 0.0001) this.moved[axis] = true;
      }
    } else if (this.phase === 'dropping') {
      this.y = Math.max(CLAW.dropY, this.y - 1.35 * dt);
      if (this.y <= CLAW.dropY) {
        const p = this.prize.body.translation();
        if (Math.hypot(p.x - this.x, p.z - this.z) < CLAW.captureRadius && Math.abs(p.y - CLAW.prizeY) < .4) this.attach();
        this.phase = 'lifting';
      }
    } else if (this.phase === 'lifting') {
      this.y = Math.min(CLAW.restY, this.y + dt);
      if (this.y >= CLAW.restY) {
        if (this.prizeHeld) {
          this.detach(); this.world.removeRigidBody(this.prize.body); this.entities.splice(this.entities.indexOf(this.prize), 1);
          this.prize = this.makePrize('giant-prize', this.x, CLAW.giantY, this.z, CLAW.giantRadius); this.attach(); this.phase = 'surprise';
        } else this.phase = 'aiming';
        this.moved = { x: false, z: false }; this.clearInputs();
      }
    }
    this.anchor.setNextKinematicTranslation(v(this.x, this.y, this.z));
  }
  snapshot(): RoomState['claw'] { return { phase: this.phase, operators: { ...this.operators }, x: this.x, z: this.z, y: this.y, ready: { ...this.ready }, moved: { ...this.moved }, attempts: this.attempts, prizeHeld: this.prizeHeld }; }
}
