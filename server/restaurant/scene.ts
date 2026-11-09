import type { RestaurantScenarioId } from '../../src/restaurant/scenario-types';
import RAPIER from '@dimforge/rapier3d-compat';
import { randomBytes } from 'node:crypto';
import { getDate, MENU, RESTAURANT } from '../../src/restaurant/content';
import { RESTAURANT_BOXES } from '../../src/restaurant/layout';
import { createEvening } from '../../src/restaurant/evening';
import type { CostUsage, DateId, DinnerCommand, DinnerState, SceneTurn, SceneUtterance } from '../../src/restaurant/types';
import { EveningDirector } from './evening';
import { setActorSeated } from './actor-controller';
import { diningOffsetZ } from '../../src/restaurant/dining-space';

export const emptyUsage = (): CostUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, speechCharacters: 0, cacheHits: 0, claudeRequests: 0, claudeCost: 0, speechCost: 0, totalCost: 0, responseMs: null, firstAudioMs: null });

/** The scene owns physical positions and progression; generated text cannot skip them. */
export class DinnerScene {
  readonly state: DinnerState;
  private world: RAPIER.World;
  private human: RAPIER.RigidBody;
  private date: RAPIER.RigidBody;
  private input = { x: 0, z: 0, at: 0 };
  private eventIndex = 0;
  private moving = false;
  private seatedClock = 0;
  private freed = false;
  private actorMode: 'follow' | 'sit' = 'follow';
  private diningCollider?: RAPIER.RigidBody;
  private tableOffset = 0;
  readonly director: EveningDirector;
  private storyRate: number;
  constructor(dateId: DateId, sessionLimit: number, opts: { storyRate?: number; variation?: number; blindDate?: { seed: string }; scenarioId?: RestaurantScenarioId } = {}) {
    const date = getDate(dateId)!;
    this.state = { id: randomBytes(12).toString('hex'), generation: 0, mode: opts.blindDate ? 'blind-date' : 'ai-date', ...(opts.blindDate ? { blindDate: { ...opts.blindDate } } : {}), phase: 'playing', dateId, stage: 'arrival', elapsed: 0,
      participants: [{ id: 'p1', kind: 'human', name: 'You', position: [RESTAURANT.spawn[0], 0, RESTAURANT.spawn[2]] }, { id: 'p2', kind: 'ai', name: date.name, position: [1.15, 0, 4.9] }],
      events: [], emotion: 'neutral', seated: false, order: null, glassRaised: false, memory: '', usage: emptyUsage(), sessionLimit, evening: createEvening(dateId, opts.variation ?? randomBytes(1)[0] % 3) };
    this.storyRate = Number.isFinite(opts.storyRate) ? Math.max(.1, Math.min(120, opts.storyRate!)) : 1;
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 }); this.world.timestep = 1 / 60;
    const b = RESTAURANT.bounds;
    for (const box of [...RESTAURANT_BOXES,
      { x: b.minX - .15, z: 0, hx: .15, hz: b.maxZ }, { x: b.maxX + .15, z: 0, hx: .15, hz: b.maxZ },
      { x: 0, z: b.minZ - .15, hx: b.maxX, hz: .15 }, { x: 0, z: b.maxZ + .15, hx: b.maxX, hz: .15 }]) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(box.x, 0, box.z));
      if ('id' in box && box.id === 'date-table') { this.diningCollider = body; this.world.createCollider(RAPIER.ColliderDesc.cylinder(2, .9), body); }
      else this.world.createCollider(RAPIER.ColliderDesc.cuboid(box.hx, 2, box.hz), body);
    }
    const actor = (x: number, z: number) => { const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0, z).lockRotations().enabledTranslations(true, false, true).setCcdEnabled(true)); this.world.createCollider(RAPIER.ColliderDesc.ball(.23).setFriction(0), body); return body; };
    this.human = actor(RESTAURANT.spawn[0], RESTAURANT.spawn[2]); this.date = actor(1.15, 4.9);
    this.director = new EveningDirector(this.state, { scenarioId: opts.scenarioId });
  }
  snapshot(): DinnerState { this.state.revision = (this.state.revision ?? 0) + 1; return structuredClone(this.state); }
  private near(x: number, z: number, radius: number) { const p = this.human.translation(); return Math.hypot(p.x - x, p.z - z) <= radius; }
  command(command: DinnerCommand, now = Date.now()): void {
    if (this.state.phase === 'ended') throw new Error('This date has ended.');
    if (command.type === 'finish') { this.director.earlyExit(); return; }
    if (command.type === 'pause') { this.state.phase = command.paused ? 'paused' : 'playing'; this.input = { x: 0, z: 0, at: 0 }; return; }
    if (this.state.phase !== 'playing') throw new Error('Resume the date first.');
    if (command.type === 'move') {
      if (!Number.isFinite(command.x) || !Number.isFinite(command.z) || !Number.isFinite(command.yaw) || Math.abs(command.x) > 1 || Math.abs(command.z) > 1) throw new Error('Invalid movement.');
      const n = Math.max(1, Math.hypot(command.x, command.z)); this.input = { x: command.x / n, z: command.z / n, at: now }; return;
    }
    if (command.type === 'scenario') { this.director.scenario(command.choice); this.syncDiningArea(); this.syncPositions(); return; }
    if (command.type === 'evening') { this.director.action(command, now); return; }
    if (command.type === 'tabletop') { this.director.tabletop.action(command.action); return; }
    const { target, choice } = command;
    const offset = diningOffsetZ(this.state);
    if (target === 'exit') { if (!this.near(RESTAURANT.entrance[0], RESTAURANT.entrance[2], RESTAURANT.entranceRadius)) throw new Error('Walk to the entrance to leave.'); if (!this.state.evening.bill.settlement) this.director.earlyExit(); }
    else if (target === 'seat') {
      if (this.state.seated) { this.state.seated = false; this.actorMode = 'follow'; setActorSeated(this.human, false); this.human.setTranslation({ x: 1.2, y: 0, z: .8 + offset }, true); }
      else { if (!this.near(RESTAURANT.seat[0], RESTAURANT.seat[2] + offset, 2.1)) throw new Error('Approach your table to sit.'); this.state.seated = true; this.state.stage = this.state.order ? this.state.stage : 'seated'; const position = { x: RESTAURANT.seat[0], y: 0, z: RESTAURANT.seat[2] + .28 + offset }; setActorSeated(this.human, true, position); this.human.setTranslation(position, true); this.actorMode = 'sit'; this.director.seated(); }
      this.input = { x: 0, z: 0, at: 0 };
    } else if (target === 'menu') {
      if (!this.state.seated) throw new Error('Sit down before ordering.');
      if (!choice) return;
      if (!MENU.includes(choice)) throw new Error('Choose a dish from the menu.');
      if (this.state.order) throw new Error('Your order is already with the kitchen.');
      this.state.order = choice; this.state.stage = 'ordered'; this.seatedClock = this.state.elapsed; this.director.ordered();
    } else if (target === 'glass') { if (!this.state.seated) throw new Error('Your glass is at the table.'); if (this.state.evening.incident?.event === 'spilled-drink') this.director.action({ type: 'evening', action: 'steady-glass' }, now); else { this.director.tabletop.cancelSip(); this.state.glassRaised = !this.state.glassRaised; } }
    else if (target === 'meal' || target === 'dessert') this.director.action({ type: 'evening', action: 'taste' }, now);
    else if (target === 'bill') { if (!this.state.seated) throw new Error('Take your seat at the table first.'); }
    else if (target === 'ticket') this.director.action({ type: 'evening', action: 'inspect-ticket' }, now);
    else if (target === 'napkin') { if (!this.state.seated) throw new Error('Take your seat at the table first.'); if (this.state.evening.incident?.event === 'spilled-drink') this.director.action({ type: 'evening', action: 'wipe' }, now); }
    else if (['service-bell', 'carafe', 'bread', 'salt', 'pepper', 'cutlery', 'lamp', 'vase', 'plate'].includes(target)) { if (!this.state.seated) throw new Error('Take your seat at the table first.'); }
    else if (target === 'window') { if (!this.near(-5.5, -1, 3)) throw new Error('Walk to the window to look outside.'); this.director.window(); }
    else if (target === 'date') { const p = this.date.translation(); if (!this.near(p.x, p.z, 3)) throw new Error('Move closer to your date.'); }
    else throw new Error('Unknown interaction.');
    this.syncPositions();
  }
  applyTurn(turn: SceneTurn, humanText = '') {
    this.state.emotion = turn.emotion; this.state.memory = turn.memory;
    this.director.social(turn, humanText);
    if (turn.action === 'follow' && !this.state.seated) this.actorMode = 'follow';
    if (turn.action === 'sit' && this.state.seated) this.actorMode = 'sit';
    // Ordering and leaving require a physical human interaction. A model proposal
    // never submits an order, teleports the player, or ends the session.
  }
  finish(reason: string) { this.state.phase = 'ended'; this.state.stage = 'finished'; this.state.reason = reason; this.input = { x: 0, z: 0, at: 0 }; }
  acknowledge(line: SceneUtterance) { this.director.acknowledge(line); }
  private syncDiningArea() {
    const offset = diningOffsetZ(this.state), change = offset - this.tableOffset;
    if (!change) return;
    this.tableOffset = offset;
    this.diningCollider?.setTranslation({ x: 0, y: 0, z: -1.15 + offset }, true);
    for (const body of this.state.seated ? [this.human, this.date] : [this.date]) {
      const p = body.translation(); body.setTranslation({ x: p.x, y: 0, z: p.z + change }, true); body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.input = { x: 0, z: 0, at: 0 };
  }
  step(dt: number, now = Date.now()) {
    if (this.freed || this.state.phase !== 'playing') return;
    this.state.elapsed += dt * this.storyRate;
    this.syncDiningArea();
    const offset = this.tableOffset, seatZ = RESTAURANT.dateSeat[2] + offset;
    const away = ['privacy-break', 'cleanup-break'].includes(this.state.evening.scenarioCare?.presence ?? 'at-table');
    const returning = away && this.state.evening.scenarioCare?.returnAt !== null && this.state.elapsed >= (this.state.evening.scenarioCare?.returnAt ?? Infinity);
    this.date.collider(0).setSensor(away);
    const fresh = now - this.input.at < 300 && !this.state.seated;
    setActorSeated(this.human, this.state.seated, { x: RESTAURANT.seat[0], y: 0, z: RESTAURANT.seat[2] + .28 + offset });
    if (!this.state.seated) this.human.setLinvel({ x: fresh ? this.input.x * 2.8 : 0, y: 0, z: fresh ? this.input.z * 2.8 : 0 }, true);
    const h = this.human.translation(), d = this.date.translation();
    const departing = this.director.departing;
    const target = departing ? { x: .8, z: 5.5 } : away && !returning ? { x: 2.4, z: 4.8 } : this.actorMode === 'sit' || returning ? { x: RESTAURANT.dateSeat[0], z: seatZ } : { x: h.x + 1.0, z: h.z - .65 };
    let dx = target.x - d.x, dz = target.z - d.z;
    // A waypoint beyond the destination edge makes the side traversal finite:
    // steering at the exact seat Z would approach it forever without crossing.
    if (!departing && (!away || returning) && (this.actorMode === 'sit' || returning) && d.z > seatZ) {
      if (d.x < 1.12) { dx = 1.3 - d.x; dz = 0; }
      else { dx = 1.3 - d.x; dz = seatZ - .25 - d.z; }
    } else if ((departing || away || this.actorMode === 'follow') && d.z < -.1 + offset && target.z > -.1 + offset) {
      if (d.x < 1.12) { dx = 1.3 - d.x; dz = 0; }
      else { dx = 1.3 - d.x; dz = .2 + offset - d.z; }
    } else if (this.actorMode === 'follow' && d.z > -2.25 + offset && target.z < -2.25 + offset) {
      if (d.x < 1.12) { dx = 1.3 - d.x; dz = 0; }
      else { dx = 1.3 - d.x; dz = -2.5 + offset - d.z; }
    }
    const dist = Math.hypot(dx, dz), speed = dist > .12 ? Math.min(2.35, dist * 3) : 0;
    const dateSeated = !departing && (!away || returning) && (this.actorMode === 'sit' || returning) && Math.hypot(d.x - RESTAURANT.dateSeat[0], d.z - seatZ) < .14;
    setActorSeated(this.date, dateSeated, { x: RESTAURANT.dateSeat[0], y: 0, z: seatZ });
    if (!dateSeated) this.date.setLinvel({ x: dist ? dx / dist * speed : 0, y: 0, z: dist ? dz / dist * speed : 0 }, true);
    this.moving = fresh && Math.hypot(this.input.x, this.input.z) > 0;
    this.world.timestep = Math.min(1 / 20, Math.max(1 / 120, dt)); this.world.step();
    this.syncPositions();
    const returnedPosition = this.date.translation();
    this.director.step(Math.min(1 / 20, Math.max(1 / 120, dt)), { dateReturned: Math.hypot(returnedPosition.x - RESTAURANT.dateSeat[0], returnedPosition.z - seatZ) < .14 });
  }
  private syncPositions() { const h = this.human.translation(), d = this.date.translation(); this.state.participants[0].position = [h.x, 0, h.z]; this.state.participants[1].position = [d.x, 0, d.z]; }
  free() { if (!this.freed) { this.freed = true; this.director.free(); this.world.free(); } }
}
