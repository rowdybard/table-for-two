import RAPIER from '@dimforge/rapier3d-compat';
import type { ObjectState, PlayerId } from '../src/shared/protocol';
import { FLIPPERS, VENUE } from '../src/shared/venue';

type Entity = { id: string; kind: ObjectState['kind']; body: RAPIER.RigidBody };
type LaneMode = 'classic' | 'arcade';
type Side = 'left' | 'right';
const TTL = 250;
const rotation = (angle: number) => ({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) });

/** Extra damping approximates ground contact only while a fallen pin rests near the floor. */
export function updatePinGroundDamping(body: RAPIER.RigidBody) {
  const q = body.rotation();
  const grounded = body.translation().y < .23 && Math.abs(1 - 2 * (q.x * q.x + q.z * q.z)) < .4;
  const linear = grounded ? .7 : .35, angular = grounded ? 1.5 : .35;
  if (Math.abs(body.linearDamping() - linear) > .001) body.setLinearDamping(linear);
  if (Math.abs(body.angularDamping() - angular) > .001) body.setAngularDamping(angular);
}

/** Shared date activity rules and two real position-controlled Rapier flippers. */
export class LaneGame {
  mode: LaneMode = 'classic';
  participants: PlayerId[] = [];
  warmups: Record<PlayerId, boolean> = { p1: false, p2: false };
  roller: PlayerId | null = null;
  pilot: PlayerId | null = null;
  round = 0;
  score = 0;
  complete = false;
  roundSettled = false;
  private autoSuppressed = false;
  private pending: PlayerId | null = null;
  private stillTime = 0;
  private held: Record<Side, boolean> = { left: false, right: false };
  private inputAt = 0;
  private positions: Record<Side, number> = { left: 0, right: 0 };
  private flippers: Partial<Record<Side, RAPIER.RigidBody>> = {};
  constructor(private world: RAPIER.World, private entities: Entity[]) {}
  join(id: PlayerId) { if (this.participants.includes(id)) return false; this.participants.push(id); return true; }
  leave(id: PlayerId) { if (!this.participants.includes(id)) return; this.participants = this.participants.filter(p => p !== id); this.clearInputs(); }
  get bothJoined() { return this.participants.includes('p1') && this.participants.includes('p2'); }
  get unlocked() { return this.warmups.p1 && this.warmups.p2; }
  get hasPendingRoll() { return this.pending !== null; }
  canResetShot(rolled: boolean) { return rolled && this.pending === null; }
  beginRoll(id: PlayerId) { this.pending = id; this.stillTime = 0; this.roundSettled = false; }
  canRoll(id: PlayerId, pairPresent: boolean) { return this.mode === 'classic' || (pairPresent && this.bothJoined && !this.complete && !this.roundSettled && this.roller === id); }
  observe(stopped: boolean, dt: number, pinsDown: number) {
    if (!this.pending) return;
    this.stillTime = stopped ? this.stillTime + dt : 0;
    if (this.stillTime >= .5) this.settled(pinsDown);
  }
  settled(pinsDown: number) {
    if (!this.pending) return;
    if (this.mode === 'classic') this.warmups[this.pending] = true;
    else { this.score += Math.max(0, Math.min(10, pinsDown)); this.roundSettled = true; this.clearInputs(); if (this.round === 2) this.complete = true; }
    this.pending = null;
  }
  reset(pairPresent: boolean) {
    if (this.pending) return false;
    if (this.mode === 'arcade') {
      if (!this.bothJoined || !pairPresent || !this.roundSettled) return false;
      if (this.complete) this.startArcade();
      else { this.round = 2; [this.roller, this.pilot] = [this.pilot, this.roller]; this.roundSettled = false; this.clearInputs(); }
    } else if (!this.autoSuppressed && this.unlocked && this.bothJoined && pairPresent) this.startArcade();
    return true;
  }
  selectMode(mode: LaneMode, pairPresent: boolean) {
    if (this.pending) return false;
    if (mode === 'classic') {
      this.autoSuppressed = true; this.mode = 'classic'; this.round = 0; this.score = 0; this.complete = false; this.roundSettled = false; this.roller = this.pilot = null; this.removeFlippers(); return true;
    }
    if (!this.unlocked || !this.bothJoined || !pairPresent) return false;
    this.autoSuppressed = false; this.startArcade(); return true;
  }
  private startArcade() {
    this.mode = 'arcade'; this.round = 1; this.score = 0; this.complete = false; this.roundSettled = false; this.roller = 'p1'; this.pilot = 'p2'; this.clearInputs(); this.createFlippers();
  }
  setFlippers(id: PlayerId, left: boolean, right: boolean, now: number, pairPresent: boolean) {
    if (this.mode !== 'arcade' || this.complete || this.roundSettled || !pairPresent || !this.bothJoined || id !== this.pilot) return false;
    this.held = { left, right }; this.inputAt = now; return true;
  }
  clearInputs() { this.held = { left: false, right: false }; this.inputAt = 0; }
  private createFlippers() {
    if (this.flippers.left && this.flippers.right) return;
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? -1 : 1;
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(VENUE.laneX + sign * FLIPPERS.pivotX, FLIPPERS.y, FLIPPERS.pivotZ).setRotation(rotation(sign * FLIPPERS.rest)));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(FLIPPERS.halfLength, FLIPPERS.halfHeight, FLIPPERS.halfWidth).setTranslation(-sign * FLIPPERS.halfLength, 0, 0).setRestitution(.65).setFriction(.4), body);
      this.flippers[side] = body;
      this.entities.push({ id: `lane-flipper-${side}`, kind: 'lane-flipper', body });
    }
  }
  private removeFlippers() {
    this.clearInputs();
    for (const side of ['left', 'right'] as const) {
      const body = this.flippers[side]; if (!body) continue;
      this.world.removeRigidBody(body); const index = this.entities.findIndex(e => e.body === body); if (index >= 0) this.entities.splice(index, 1); delete this.flippers[side]; this.positions[side] = 0;
    }
  }
  step(dt: number, now: number, pairPresent: boolean) {
    if (this.mode !== 'arcade') return;
    for (const side of ['left', 'right'] as const) {
      const body = this.flippers[side]; if (!body) continue;
      const active = pairPresent && this.bothJoined && now - this.inputAt < TTL && this.held[side];
      const target = active ? 1 : 0, old = this.positions[side];
      const next = old + Math.max(-FLIPPERS.angularSpeed * dt / (FLIPPERS.rest + FLIPPERS.active), Math.min(FLIPPERS.angularSpeed * dt / (FLIPPERS.rest + FLIPPERS.active), target - old));
      this.positions[side] = next;
      const sign = side === 'left' ? -1 : 1;
      body.setNextKinematicRotation(rotation(sign * (FLIPPERS.rest - (FLIPPERS.rest + FLIPPERS.active) * next)));
    }
  }
}
