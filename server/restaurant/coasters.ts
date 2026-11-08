import RAPIER from '@dimforge/rapier3d-compat';
import type { CoasterState, DateId } from '../../src/restaurant/types';

/** A small independent planar world; every visible shot is a real damped collision. */
export class TableCoasters {
  private world: RAPIER.World;
  private disc: RAPIER.RigidBody;
  private still = 0;
  private shotAge = 0;
  private wait = 0;
  private seed: number;
  constructor(private state: CoasterState, private dateId: DateId, variation: number) {
    this.seed = variation + 71;
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 }); this.world.timestep = 1 / 60;
    for (const [x, z, hx, hz] of [[-.47, 0, .02, .57], [.47, 0, .02, .57], [0, -.57, .49, .02], [0, .57, .49, .02]]) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0, z)); this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, .1, hz).setRestitution(.5), body);
    }
    this.disc = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0, .43).lockRotations().enabledTranslations(true, false, true).setLinearDamping(1.7).setCcdEnabled(true));
    this.world.createCollider(RAPIER.ColliderDesc.ball(.035).setRestitution(.5).setMass(.05), this.disc);
  }
  start() { if (this.state.phase === 'rolling') throw new Error('Let the coaster settle first.'); Object.assign(this.state, { phase: 'aiming', turn: 'human', round: 1, shots: 0, humanScore: 0, dateScore: 0, lastResult: '', disc: { x: 0, z: .43 } }); this.resetDisc(); }
  shoot(angle: number, power: number, actor: 'human' | 'date' = 'human') {
    if (this.state.phase !== 'aiming' || this.state.turn !== actor || !Number.isFinite(angle) || Math.abs(angle) > 1.2 || !Number.isFinite(power) || power < 0 || power > 1) throw new Error('Aim between the table edges and use power from zero to one.');
    this.resetDisc(); const speed = .45 + power * 1.35; this.disc.setLinvel({ x: Math.sin(angle) * speed, y: 0, z: -Math.cos(angle) * speed }, true); this.state.phase = 'rolling'; this.shotAge = this.still = 0; this.state.shots++;
  }
  private random() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 0x100000000; }
  private resetDisc() { this.disc.setTranslation({ x: 0, y: 0, z: .43 }, true); this.disc.setLinvel({ x: 0, y: 0, z: 0 }, true); this.state.disc = { x: 0, z: .43 }; this.wait = 0; }
  step(dt: number, allowNewShots: boolean) {
    if (this.state.phase === 'aiming' && this.state.turn === 'date' && allowNewShots) {
      this.wait += dt;
      if (this.wait >= 1) { const error = this.dateId === 'dev' ? .06 : this.dateId === 'jules' ? .10 : .16; this.shoot(Math.atan2(this.state.target.x, .73) + (this.random() - .5) * error, .59 + (this.random() - .5) * error, 'date'); }
    }
    if (this.state.phase !== 'rolling') return false;
    this.world.timestep = dt; this.world.step(); this.shotAge += dt;
    const p = this.disc.translation(), v = this.disc.linvel(); this.state.disc = { x: p.x, z: p.z }; this.still = Math.hypot(v.x, v.z) < .025 ? this.still + dt : 0;
    if (this.still < .25 && this.shotAge < 8) return false;
    this.disc.setLinvel({ x: 0, y: 0, z: 0 }, true);
    const distance = Math.hypot(p.x - this.state.target.x, p.z - this.state.target.z), points = distance < .08 ? 3 : distance < .16 ? 2 : distance < .27 ? 1 : 0;
    if (this.state.turn === 'human') this.state.humanScore += points; else this.state.dateScore += points;
    this.state.lastResult = `${this.state.turn === 'human' ? 'You' : 'Your date'} landed ${distance.toFixed(2)} from the target: ${points} ${points === 1 ? 'point' : 'points'}.`;
    if (this.state.turn === 'date' && this.state.round === 3) { this.state.phase = 'complete'; return true; }
    if (this.state.turn === 'date') this.state.round++;
    this.state.turn = this.state.turn === 'human' ? 'date' : 'human'; this.state.phase = 'aiming'; this.resetDisc(); return false;
  }
  free() { this.world.free(); }
}
