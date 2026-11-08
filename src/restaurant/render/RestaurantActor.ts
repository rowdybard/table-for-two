import * as THREE from 'three';
import type { DateStance, Emotion } from '../types';
import { createCharacterBody, type CharacterBodyRig, type CharacterKind } from './CharacterBody';
import { createCharacterHead, type CharacterHead } from './CharacterHead';
import { FacialPerformance } from './FacialPerformance';

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
  }

  setSeated(value: boolean) {
    this.seated = value;
    this.body.setSeated(value);
  }

  update(time: number, dt: number, emotion: Emotion, speaking: boolean, amplitude: number, gaze: THREE.Vector3, walkingSpeed = 0, performance: { stance?: DateStance; shared?: boolean; phoneActive?: boolean; attentive?: boolean; reducedMotion?: boolean } = {}) {
    if (this.disposed) return;
    const guarded = performance.stance === 'guarded' || performance.stance === 'hurt' || performance.stance === 'leaving';
    const pose = this.performance.update(time, dt, {
      emotion, speaking, amplitude, attentive: !!performance.attentive, reducedMotion: !!performance.reducedMotion,
    });
    // Warmth leans in a little; being on guard sits back. Attention leans in while the other person talks.
    const leanBias = (emotion === 'flirtatious' || emotion === 'warm' || emotion === 'amused' ? .028 : emotion === 'defensive' || emotion === 'angry' ? -.03 : 0)
      + (performance.attentive ? .02 : 0);
    this.body.update(time, dt, this.seated ? 0 : walkingSpeed, {
      guarded, comfortable: performance.stance === 'comfortable', speaking,
      amplitude, shared: !!performance.shared, phoneActive: !!performance.phoneActive, leanBias,
    });
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

