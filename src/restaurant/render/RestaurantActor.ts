import * as THREE from 'three';
import type { DateStance, Emotion } from '../types';
import { createCharacterBody, type CharacterBodyRig, type CharacterKind } from './CharacterBody';
import { createCharacterHead, type CharacterHead } from './CharacterHead';
import { FacialPerformance } from './FacialPerformance';
import { DateBehaviour, type DateBehaviourOutput, type DateGesture } from './DateBehaviour';

/** What a seated date knows about the table this frame; world positions are converted to the actor's space here. */
export interface DateTableContext {
  interest?: number; thinking: boolean; mainServed: boolean; dateBites: number; quietFor: number;
  glass: THREE.Vector3 | null; plate: THREE.Vector3 | null;
}

/** Authored adult anatomy, tailored clothing, facial performance, and deterministic seating. */
export class RestaurantActor {
  readonly root = new THREE.Group();
  readonly head: THREE.Group;
  private readonly body: CharacterBodyRig;
  private readonly face: CharacterHead;
  private readonly localGaze = new THREE.Vector3();
  private readonly performance: FacialPerformance;
  private seated = false;
  private disposed = false;
  /** Only the three dates have table business; staff and neighbours keep the plain rig. */
  readonly behaviour?: DateBehaviour;
  private readonly localGlass = new THREE.Vector3();
  private readonly localPlate = new THREE.Vector3();
  /** The date's glass while it is in their hand, in world space. */
  readonly heldGlass = { weight: 0, position: new THREE.Vector3(), tilt: 0, toward: new THREE.Vector3() };
  private behaviourTime = 0;

  constructor(readonly kind: CharacterKind) {
    this.root.name = 'character-' + kind;
    this.body = createCharacterBody(kind);
    this.performance = new FacialPerformance(kind.split('').reduce((sum, c) => sum * 31 + c.charCodeAt(0), 7) >>> 0);
    this.face = createCharacterHead(kind, this.body.skinColor);
    this.head = this.face.root;
    this.head.name = 'head-' + kind;
    this.head.scale.setScalar(.97);
    this.head.position.copy(this.body.headAnchor);
    this.root.add(this.body.root, this.head);
    if (kind === 'mira' || kind === 'jules' || kind === 'dev') this.behaviour = new DateBehaviour(kind.length * 977 + kind.charCodeAt(0));
  }

  /** QA and tests: play one gesture now. */
  playGesture(kind: DateGesture) { this.behaviour?.force(kind, this.behaviourTime); }
  get gesture() { return this.behaviour?.output.gesture ?? null; }
  get fork(): DateBehaviourOutput['fork'] { return this.behaviour?.output.fork ?? 'table'; }

  setSeated(value: boolean) {
    this.seated = value;
    this.body.setSeated(value);
  }

  update(time: number, dt: number, emotion: Emotion, speaking: boolean, amplitude: number, gaze: THREE.Vector3, walkingSpeed = 0, performance: { stance?: DateStance; shared?: boolean; phoneActive?: boolean; attentive?: boolean; reducedMotion?: boolean; table?: DateTableContext } = {}) {
    if (this.disposed) return;
    this.behaviourTime = time;
    const guarded = performance.stance === 'guarded' || performance.stance === 'hurt' || performance.stance === 'leaving';
    let business: DateBehaviourOutput | undefined;
    if (this.behaviour && performance.table) {
      const table = performance.table;
      this.root.updateMatrixWorld(true);
      const glass = table.glass ? this.root.worldToLocal(this.localGlass.copy(table.glass)) : null;
      const plate = table.plate ? this.root.worldToLocal(this.localPlate.copy(table.plate)) : null;
      business = this.behaviour.update(time, dt, {
        interest: table.interest, stance: performance.stance ?? 'curious', emotion, seated: this.seated, speaking, listening: !!performance.attentive,
        thinking: table.thinking, mainServed: table.mainServed, dateBites: table.dateBites, quietFor: table.quietFor, reducedMotion: !!performance.reducedMotion,
        glass, plate, head: this.body.headAnchor,
      });
    }
    const pose = this.performance.update(time, dt, {
      emotion, speaking, amplitude, attentive: !!performance.attentive, reducedMotion: !!performance.reducedMotion,
      smileBias: business?.smile, wander: business?.wander, lookUp: business?.lookUp, lookDown: business?.lookDown,
    });
    // Warmth leans in a little; being on guard sits back. Attention leans in while the other person talks.
    const leanBias = (emotion === 'flirtatious' || emotion === 'warm' || emotion === 'amused' ? .028 : emotion === 'defensive' || emotion === 'angry' ? -.03 : 0)
      + (performance.attentive ? .02 : 0) + (business?.lean ?? 0);
    this.body.update(time, dt, this.seated ? 0 : walkingSpeed, {
      guarded, comfortable: performance.stance === 'comfortable', speaking,
      amplitude, shared: !!performance.shared, phoneActive: !!performance.phoneActive, leanBias, beat: pose.beat, beatHand: pose.beatHand,
      arms: business?.arms, bounce: business?.bounce, fork: business?.fork === 'hand', phone: business?.phone, gripGlass: (business?.glass.weight ?? 0) > .05,
    });
    this.heldGlass.weight = business?.glass.weight ?? 0;
    if (business && this.heldGlass.weight > 0) {
      this.root.updateMatrixWorld(true);
      this.heldGlass.position.copy(business.glass.position); this.root.localToWorld(this.heldGlass.position);
      this.heldGlass.tilt = business.glass.tilt;
      this.heldGlass.toward.copy(this.body.headAnchor); this.root.localToWorld(this.heldGlass.toward);
    }
    this.head.position.copy(this.body.headAnchor);
    this.root.updateMatrixWorld(true);
    this.localGaze.copy(gaze); this.root.worldToLocal(this.localGaze); this.localGaze.sub(this.head.position);
    const yaw = Math.atan2(this.localGaze.x, this.localGaze.z);
    const pitch = -Math.atan2(this.localGaze.y, Math.max(.1, Math.hypot(this.localGaze.x, this.localGaze.z)));
    const trackedYaw = performance.stance === 'hurt' ? -.2 : performance.phoneActive && !speaking ? .26 : THREE.MathUtils.clamp(yaw, -.38, .38);
    const blend = 1 - Math.exp(-Math.max(0, dt) * 7);
    this.head.rotation.y = THREE.MathUtils.lerp(this.head.rotation.y, trackedYaw + pose.headYaw, blend);
    this.head.rotation.x = THREE.MathUtils.lerp(this.head.rotation.x, THREE.MathUtils.clamp(pitch, -.18, .18) + pose.headPitch, blend);
    this.head.rotation.z = THREE.MathUtils.lerp(this.head.rotation.z, pose.headRoll, blend);
    // The eyes lead the head: whatever the neck has not turned yet, the eyes cover.
    // Both eyes converge on the person they are looking at; across a table that is visible.
    const converge = THREE.MathUtils.clamp(0.00038 / Math.max(.25, this.localGaze.length()), 0, 0.0013);
    this.face.update(time, dt, pose, speaking, amplitude, (yaw - this.head.rotation.y) * 2.5, (-pitch + this.head.rotation.x) * 2, converge);
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.body.dispose(); this.face.dispose(); this.root.clear();
  }
}

