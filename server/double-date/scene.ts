import RAPIER from '@dimforge/rapier3d-compat';
import { getDate, MENU, RESTAURANT } from '../../src/restaurant/content';
import { createEvening } from '../../src/restaurant/evening';
import { RESTAURANT_BOXES } from '../../src/restaurant/layout';
import { DOUBLE_TABLE, type DoubleDateActorId, type DoubleDateRoomState, type DoubleHumanId } from '../../src/restaurant/double-date-types';
import type { CostUsage, DateId, DinnerCommand, DinnerState, SceneTurn, SceneUtterance } from '../../src/restaurant/types';
import { EveningDirector } from '../restaurant/evening';
import { setActorSeated } from '../restaurant/actor-controller';
import { createSharedTabletopState, createTabletopState } from '../../src/restaurant/tabletop';
import { diningOffsetZ } from '../../src/restaurant/dining-space';
import { ensureScenarioCare } from '../restaurant/scenario-effects';
import { clampMemory } from '../restaurant/memory';
import { EVENING_PACE } from '../../src/restaurant/evening';

const ids: DoubleHumanId[] = ['h1', 'h2'];
const recovery = new Set(['inspect-ticket', 'return-order', 'keep-order', 'wipe', 'steady-glass', 'ask-quiet', 'let-it-go', 'apologize']);
const bodyId = (human: DoubleHumanId): DoubleDateActorId => DOUBLE_TABLE.pairings[human];

export function createPairView(roomId: string, human: DoubleHumanId, name: string, dateId: DateId, usage: CostUsage, sessionLimit: number): DinnerState {
  const seat = DOUBLE_TABLE.seats[human];
  return { id: roomId, generation: 0, mode: 'double-date', phase: 'paused', dateId, stage: 'seated', elapsed: 0,
    participants: [{ id: 'p1', kind: 'human', name, position: [seat[0], 0, seat[2]] }, { id: 'p2', kind: 'ai', name: getDate(dateId)!.name, position: [human === 'h1' ? -1.15 : 1.15, 0, 4.9] }],
    events: [], emotion: 'neutral', seated: true, order: null, glassRaised: false, memory: '', usage, sessionLimit, evening: createEvening(dateId, human === 'h1' ? 0 : 1) };
}

/** One authoritative room world, with the complete existing evening director per pair. */
export class DoubleTableScene {
  private readonly world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  private readonly humans = new Map<DoubleHumanId, RAPIER.RigidBody>();
  private readonly dates = new Map<DoubleHumanId, RAPIER.RigidBody>();
  private readonly inputs = new Map<DoubleHumanId, { x: number; z: number; at: number }>();
  private readonly directors = new Map<DoubleHumanId, EveningDirector>();
  private readonly sharedTabletop = createSharedTabletopState();
  private diningCollider?: RAPIER.RigidBody;
  private tableOffset = 0;
  private incidentOwner: DoubleHumanId | null = null;
  private lastIncidentAt = -1000;
  private freed = false;
  private readonly storyRate: number;

  constructor(readonly state: DoubleDateRoomState, storyRate = 1) {
    this.storyRate = Math.max(.1, Math.min(120, Number.isFinite(storyRate) ? storyRate : 1));
    this.world.timestep = 1 / 60;
    const bounds = RESTAURANT.bounds;
    for (const box of [...RESTAURANT_BOXES,
      { x: bounds.minX - .15, z: 0, hx: .15, hz: bounds.maxZ }, { x: bounds.maxX + .15, z: 0, hx: .15, hz: bounds.maxZ },
      { x: 0, z: bounds.minZ - .15, hx: bounds.maxX, hz: .15 }, { x: 0, z: bounds.maxZ + .15, hx: bounds.maxX, hz: .15 }]) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(box.x, 0, box.z));
      if ('id' in box && box.id === 'date-table') { this.diningCollider = body; this.world.createCollider(RAPIER.ColliderDesc.cylinder(2, 1.30), body); }
      else this.world.createCollider(RAPIER.ColliderDesc.cuboid(box.hx, 2, box.hz), body);
    }
    for (const human of ids) {
      state.views[human].evening.tabletop = createTabletopState(this.sharedTabletop);
      const position = state.views[human].participants;
      this.humans.set(human, this.actor(position[0].position));
      setActorSeated(this.humans.get(human)!, true, { x: position[0].position[0], y: 0, z: position[0].position[2] });
      this.dates.set(human, this.actor(position[1].position));
      this.directors.set(human, new EveningDirector(state.views[human], { humanId: human }));
      this.inputs.set(human, { x: 0, z: 0, at: 0 });
    }
  }

  private actor(position: [number, number, number]) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...position).lockRotations().enabledTranslations(true, false, true).setCcdEnabled(true));
    this.world.createCollider(RAPIER.ColliderDesc.ball(.23).setFriction(0), body);
    return body;
  }

  chooseDate(human: DoubleHumanId, dateId: DateId) {
    const member = this.state.members.find(item => item.id === human)!;
    this.directors.get(human)!.free();
    this.state.views[human] = createPairView(this.state.id, human, member.name, dateId, this.state.usage, this.state.sessionLimit);
    this.state.views[human].evening.tabletop = createTabletopState(this.sharedTabletop);
    this.directors.set(human, new EveningDirector(this.state.views[human], { humanId: human }));
    const existing = this.state.dates.find(item => item.humanId === human);
    const position = this.state.views[human].participants[1].position;
    const actor = { id: bodyId(human), humanId: human, dateId, position, seated: false, departed: false, emotion: 'neutral' as const, stance: 'curious' as const };
    if (existing) Object.assign(existing, actor); else this.state.dates.push(actor);
    this.dates.get(human)!.setTranslation({ x: position[0], y: 0, z: position[2] }, true);
    this.syncPositions();
  }

  setPhase(phase: 'playing' | 'paused' | 'ended') {
    this.state.phase = phase;
    for (const human of ids) {
      if (this.state.views[human].phase !== 'ended') this.state.views[human].phase = phase;
      this.inputs.set(human, { x: 0, z: 0, at: 0 });
      this.humans.get(human)!.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.dates.get(human)!.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  command(human: DoubleHumanId, command: DinnerCommand, _now: number) {
    const view = this.state.views[human], member = this.state.members.find(item => item.id === human)!;
    if (command.type === 'pause') { this.setPhase(command.paused ? 'paused' : 'playing'); return; }
    if (command.type === 'finish') {
      if (view.phase === 'ended') member.viewingEnding = true;
      else this.directors.get(human)!.earlyExit();
      this.finishIfBoth(); this.syncPositions(); return;
    }
    if (this.state.phase !== 'playing' || member.viewingEnding) throw new Error('Resume the evening first.');
    if (command.type === 'move') { if (![command.x, command.z, command.yaw].every(Number.isFinite) || Math.abs(command.x) > 1 || Math.abs(command.z) > 1) throw new Error('Invalid movement.'); return; }
    throw new Error('This date takes place at the table.');
  }

  private eveningAction(human: DoubleHumanId, command: Extract<DinnerCommand, { type: 'evening' }>, now: number) {
    this.finishIfBoth();
    const view = this.state.views[human], wingman = view.phase === 'ended';
    const otherHuman = human === 'h1' ? 'h2' : 'h1';
    if (wingman && !recovery.has(command.action) && !['request-water', 'check-in', 'resume-dinner', 'settle-bill'].includes(command.action)) throw new Error('Your date’s outcome is settled. Help your friend or enjoy their company.');
    if (wingman && recovery.has(command.action) && !this.incidentOwner) throw new Error('There is no active table interruption to help with.');
    if (wingman && !view.seated) throw new Error('Take your seat before helping at the table.');
    if (wingman && ['request-water', 'check-in', 'resume-dinner'].includes(command.action)) {
      const other = this.state.views[otherHuman];
      if (other.phase === 'ended') throw new Error('Both dates are complete.');
      const seated = other.seated; other.seated = true;
      try { this.directors.get(otherHuman)!.action(command, now, this.state.members.find(member => member.id === human)!.name); }
      finally { other.seated = seated; }
      const momentId = `wingman-${command.action}-${human}`;
      if (!view.evening.moments.some(moment => moment.id === momentId)) view.evening.moments.push({ id: momentId, title: 'Stayed for a friend', description: `${this.state.members.find(member => member.id === human)!.name} stayed after their goodbye and ${command.action === 'request-water' ? 'asked for water for the remaining pair' : 'checked that the remaining pair wanted to continue'}.` });
      return;
    }
    if (this.incidentOwner && recovery.has(command.action)) {
      if (!view.seated) throw new Error('Take a seat before helping at the table.');
      const owner = this.state.views[this.incidentOwner], previousSeat = owner.seated;
      owner.seated = true;
      try { this.directors.get(this.incidentOwner)!.action(command, now); }
      finally { owner.seated = previousSeat; }
      this.shareIncident(); return;
    }
    if (command.action === 'settle-bill') {
      const active = ids.filter(id => this.state.views[id].phase !== 'ended');
      // The bill is one table action. Check every recipient before either
      // director can mutate its bill, moments or authored dialogue.
      for (const id of active) {
        const pair = this.state.views[id], evening = pair.evening;
        if (!evening.bill.requested) throw new Error('Eli brings one check for the table once both dinners are finished.');
        if (evening.scenarioCare?.kitchen.held || evening.scenarioCare && evening.scenarioCare.presence !== 'at-table') throw new Error('Let your friend return and resume dinner before settling the shared bill.');
        if (!pair.seated) throw new Error('Take your seats before settling the table’s bill.');
        if (evening.stance === 'leaving' || evening.farewell.ending) throw new Error('Let the goodbye finish before changing the table’s bill.');
        if (evening.incident || evening.scenario?.phase === 'active') throw new Error('Finish the interruption before settling the table’s bill.');
        if (evening.bill.settlement || !['split', 'treat', 'separate'].includes(command.choice || '')) throw new Error('Choose how to settle the check.');
      }
      for (const id of active) this.directors.get(id)!.action(command, now);
    } else this.directors.get(human)!.action(command, now);
    this.captureIncident(human); this.shareIncident(); this.finishIfBoth();
  }

  private captureIncident(human: DoubleHumanId) {
    if (!this.incidentOwner && this.state.views[human].evening.incident) this.incidentOwner = human;
    if (this.incidentOwner) this.state.incidentOwner = this.incidentOwner; else delete this.state.incidentOwner;
  }
  private shareIncident() {
    if (!this.incidentOwner) return;
    const source = this.state.views[this.incidentOwner];
    for (const human of ids) if (human !== this.incidentOwner) {
      const view = this.state.views[human];
      view.evening.incident = view.phase !== 'ended' && view.evening.stance !== 'leaving' && source.evening.incident ? { ...source.evening.incident } : null;
      view.events = [...source.events]; view.evening.resolutions = { ...source.evening.resolutions }; view.evening.lastInterruptionAt = source.evening.lastInterruptionAt;
      for (const moment of source.evening.moments) if (['wrong-order', 'spilled-drink', 'disruptive-diner'].includes(moment.id)) {
        moment.owner ??= this.incidentOwner!; // written in the owner's second person, so only their pair's view of the table tells it
        if (!view.evening.moments.some(item => item.id === moment.id)) view.evening.moments.push({ ...moment });
      }
    }
    if (!source.evening.incident) { this.lastIncidentAt = source.elapsed; this.incidentOwner = null; }
    if (this.incidentOwner) this.state.incidentOwner = this.incidentOwner; else delete this.state.incidentOwner;
  }

  /** Private agenda context is sent to the model, never included in room snapshots. */
  agendaContext(human: DoubleHumanId) { return this.directors.get(human)!.agenda.promptContext(); }
  boundaryContext(human: DoubleHumanId) { return this.directors.get(human)!.boundaries.promptContext(); }
  /** Someone at the table spoke, so no date fills a silence or drops an aside over them. */
  noteHumanTurn(text = '', speaker?: DoubleHumanId) { for (const director of this.directors.values()) director.noteHumanTurn(text, speaker); }
  /** A question this pair's date asked their own friend that is still waiting for an answer. */
  pendingQuestion(human: DoubleHumanId) { return this.directors.get(human)!.pendingQuestion; }
  replyEnded() { for (const director of this.directors.values()) director.replyEnded(); }
  clearPendingBoundaries() { for (const director of this.directors.values()) { director.boundaries.clearPending(); director.chemistry.clearPending(); } }
  redirectConversation(human: DoubleHumanId) { this.directors.get(human)!.redirectConversation(false); }
  social(human: DoubleHumanId, turn: SceneTurn, humanText = '', speaker: DoubleHumanId = human, memoryHumanText = humanText) {
    const view = this.state.views[human];
    view.emotion = turn.emotion; view.memory = clampMemory(turn.memory, view.memory, memoryHumanText); this.directors.get(human)!.social(turn, humanText, { humanId: speaker, paired: speaker === human, name: this.state.members.find(member => member.id === speaker)?.name });
  }
  viewEnding(human: DoubleHumanId, show: boolean) {
    if (this.state.views[human].phase !== 'ended') throw new Error('Finish your date before viewing its ending.');
    if (!show && this.state.phase === 'ended') throw new Error('The whole evening is complete.');
    this.state.members.find(member => member.id === human)!.viewingEnding = show;
    this.inputs.set(human, { x: 0, z: 0, at: 0 });
    this.humans.get(human)!.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }
  reconcile() { for (const director of this.directors.values()) director.reconcileScenarioState(); this.syncDiningArea(); this.finishIfBoth(); this.syncPositions(); }
  private syncDiningArea() {
    if (!ids.some(id => diningOffsetZ(this.state.views[id]) > 0)) return;
    for (const id of ids) ensureScenarioCare(this.state.views[id]).table = 'quiet';
    const offset = diningOffsetZ(this.state.views.h1), change = offset - this.tableOffset;
    if (!change) return;
    this.tableOffset = offset;
    this.diningCollider?.setTranslation({ x: 0, y: 0, z: -1.15 + offset }, true);
    for (const id of ids) {
      const bodies = [...(this.state.members.find(member => member.id === id)?.seated ? [this.humans.get(id)!] : []), ...(this.state.views[id].phase !== 'ended' ? [this.dates.get(id)!] : [])];
      for (const body of bodies) { const p = body.translation(); body.setTranslation({ x: p.x, y: 0, z: p.z + change }, true); body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
      this.inputs.set(id, { x: 0, z: 0, at: 0 });
    }
  }
  acknowledge(human: DoubleHumanId, line: SceneUtterance, listener: DoubleHumanId = human) { this.directors.get(human)!.acknowledge(line, listener); }
  private finishIfBoth() {
    if (this.incidentOwner && (this.state.views[this.incidentOwner].phase === 'ended' || this.state.views[this.incidentOwner].evening.stance === 'leaving')) {
      const oldOwner = this.incidentOwner, nextOwner = ids.find(id => this.state.views[id].phase !== 'ended' && this.state.views[id].evening.stance !== 'leaving');
      if (nextOwner) {
        const previous = this.state.views[oldOwner], next = this.state.views[nextOwner];
        next.events = [...previous.events]; next.evening.resolutions = { ...previous.evening.resolutions };
        if (previous.evening.incident?.event === 'wrong-order') {
          const departedName = this.state.members.find(member => member.id === oldOwner)!.name;
          const fact = `Eli cleared ${departedName}’s unexpected ${previous.evening.main.servedDish ?? 'plate'} after their date ended. The remaining diner’s meal was left unchanged.`;
          previous.evening.main.servedDish = null; previous.evening.main.status = 'finished';
          next.evening.incident = null; next.evening.resolutions['wrong-order'] = fact;
          next.evening.lastInterruptionAt = next.elapsed; this.lastIncidentAt = next.elapsed;
          if (!next.evening.moments.some(moment => moment.id === 'wrong-order')) next.evening.moments.push({ id: 'wrong-order', title: 'A plate cleared away', description: fact });
          next.evening.cues.push({ id: `wrong-order-cleared-${oldOwner}`, key: 'wrong-order-cleared', utterances: [{ speaker: 'waiter', text: `I’ll clear ${departedName}’s plate. There’s nothing you need to send back.`, emotion: 'neutral' }] });
        } else next.evening.incident = previous.evening.incident ? { ...previous.evening.incident } : null;
        previous.evening.incident = null; this.incidentOwner = next.evening.incident ? nextOwner : null;
      } else this.incidentOwner = null;
    }
    // An ended view never shows a mirrored interruption; the active pair keeps the real one.
    for (const id of ids) if (id !== this.incidentOwner && this.state.views[id].phase === 'ended') this.state.views[id].evening.incident = null;
    if (ids.every(human => this.state.views[human].phase === 'ended')) this.state.phase = 'ended';
    if (this.incidentOwner) this.state.incidentOwner = this.incidentOwner; else delete this.state.incidentOwner;
  }

  step(dt: number, now: number) {
    if (this.freed || this.state.phase !== 'playing') return;
    this.syncDiningArea();
    dt = Math.max(1 / 120, Math.min(1 / 20, dt));
    // One check for the table: Eli waits until every pair still dining has finished dessert and nothing is being mopped up.
    const dining = ids.filter(id => this.state.views[id].phase !== 'ended');
    const holdBill = dining.some(id => { const view = this.state.views[id], dessert = view.evening.dessert; return !!view.evening.incident || !['finished', 'skipped'].includes(dessert.status) || dessert.finishedAt === undefined || view.elapsed - dessert.finishedAt < EVENING_PACE.checkDelay; });
    for (const human of ids) {
      const view = this.state.views[human], member = this.state.members.find(item => item.id === human);
      if (!member) continue;
      if (view.phase !== 'ended') view.elapsed += dt * this.storyRate;
      const input = this.inputs.get(human)!, fresh = !member.seated && !member.viewingEnding && now - input.at < 300;
      const body = this.humans.get(human)!;
      const humanSeat = DOUBLE_TABLE.seats[human];
      setActorSeated(body, member.seated, { x: humanSeat[0], y: 0, z: humanSeat[2] + this.tableOffset });
      if (!member.seated) body.setLinvel({ x: fresh ? input.x * 2.8 : 0, y: 0, z: fresh ? input.z * 2.8 : 0 }, true);
      const date = this.dates.get(human)!, d = date.translation(), h = body.translation(), side = human === 'h1' ? -1 : 1;
      if (view.phase === 'ended' && (view.evening.care.assistedExit || Math.hypot(d.x-side*.65,d.z-5.25)<.8)) { date.setEnabled(false); continue; }
      const departing = this.directors.get(human)!.departing;
      const seat = DOUBLE_TABLE.dateSeats[bodyId(human)];
      const away = ['privacy-break', 'cleanup-break'].includes(view.evening.scenarioCare?.presence ?? 'at-table');
      const returning = away && view.evening.scenarioCare?.returnAt !== null && view.elapsed >= (view.evening.scenarioCare?.returnAt ?? Infinity);
      date.collider(0).setSensor(away);
      const target = departing ? { x: side * .65, z: 5.25 } : away && !returning ? { x: side * 2.4, z: 4.8 } : member.seated || returning ? { x: seat[0], z: seat[2] + this.tableOffset } : { x: h.x + side * .8, z: h.z - .65 };
      let dx = target.x - d.x, dz = target.z - d.z;
      if (d.z < -.1 + this.tableOffset && target.z > -.1 + this.tableOffset || d.z > -2.5 + this.tableOffset && target.z < -2.5 + this.tableOffset || !departing && (!away || returning) && (member.seated || returning) && d.z > seat[2] + this.tableOffset) {
        if (Math.abs(d.x) < 1.4) { dx = side * 1.65 - d.x; dz = 0; }
        else { dx = side * 1.65 - d.x; dz = target.z + (target.z < -1 ? -.24 : .2) - d.z; }
      }
      const distance = Math.hypot(dx, dz), speed = distance > .11 ? Math.min(2.35, distance * 3) : 0;
      const dateSeated = !departing && (!away || returning) && (member.seated || returning) && Math.hypot(d.x - seat[0], d.z - seat[2] - this.tableOffset) < .14;
      setActorSeated(date, dateSeated, { x: seat[0], y: 0, z: seat[2] + this.tableOffset });
      if (!dateSeated) date.setLinvel({ x: distance ? dx / distance * speed : 0, y: 0, z: distance ? dz / distance * speed : 0 }, true);
      if (view.phase !== 'ended') this.directors.get(human)!.step(dt, { holdBill, dateReturned: Math.hypot(d.x - seat[0], d.z - seat[2] - this.tableOffset) < .14, allowScenarios: false, allowIncidents: this.state.scenario?.phase !== 'active' && !this.incidentOwner && view.elapsed - this.lastIncidentAt > 25 && ids.filter(id => this.state.views[id].phase !== 'ended').every(id => this.state.views[id].elapsed >= this.state.views[id].evening.care.quietUntil && this.state.views[id].elapsed - this.state.views[id].evening.lastInterruptionAt > 25) });
      this.captureIncident(human);
    }
    // Eli serves the table in one trip: a wrong plate for one pair reaches the other pair's view only after both directors have stepped, so the second plate still arrives.
    this.shareIncident();
    this.world.timestep = dt; this.world.step(); this.syncPositions(); this.finishIfBoth();
  }

  private syncPositions() {
    for (const human of ids) {
      const view = this.state.views[human], h = this.humans.get(human)!.translation(), d = this.dates.get(human)!.translation();
      view.participants[0].position = [h.x, 0, h.z]; view.participants[1].position = [d.x, 0, d.z];
      const member = this.state.members.find(item => item.id === human); if (member) { member.position = [...view.participants[0].position]; member.seated = view.seated; }
      const actor = this.state.dates.find(item => item.humanId === human);
      if (actor) {
        actor.position = [...view.participants[1].position];
        actor.departed = view.phase === 'ended' && (!!view.evening.care.assistedExit || Math.hypot(d.x-(human === 'h1' ? -.65 : .65),d.z-5.25)<.8);
        actor.seated = view.phase !== 'ended' && view.evening.stance !== 'leaving' && !['privacy-break', 'cleanup-break'].includes(view.evening.scenarioCare?.presence ?? 'at-table') && view.seated && Math.hypot(d.x - DOUBLE_TABLE.dateSeats[actor.id][0], d.z - DOUBLE_TABLE.dateSeats[actor.id][2] - this.tableOffset) < .4;
        actor.emotion = view.emotion; actor.stance = view.evening.stance;
      }
    }
  }
  free() { if (this.freed) return; this.freed = true; for (const director of this.directors.values()) director.free(); this.world.free(); }
}
