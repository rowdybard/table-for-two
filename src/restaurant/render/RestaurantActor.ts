import * as THREE from 'three';
import type { DateStance, Emotion } from '../types';
import { createCharacterBody, type CharacterBodyRig, type CharacterKind } from './CharacterBody';
import { createCharacterHead, type CharacterHead } from './CharacterHead';

/** Authored adult anatomy, tailored clothing, facial performance, and deterministic seating. */
export class RestaurantActor {
  readonly root = new THREE.Group();
  readonly head: THREE.Group;
  private readonly body: CharacterBodyRig;
  private readonly face: CharacterHead;
  private readonly localGaze = new THREE.Vector3();
  private seated = false;
  private disposed = false;

  constructor(readonly kind: CharacterKind) {
    this.root.name = 'character-' + kind;
    this.body = createCharacterBody(kind);
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

  update(time: number, dt: number, emotion: Emotion, speaking: boolean, amplitude: number, gaze: THREE.Vector3, walkingSpeed = 0, performance: { stance?: DateStance; shared?: boolean; phoneActive?: boolean } = {}) {
    if (this.disposed) return;
    const guarded = performance.stance === 'guarded' || performance.stance === 'hurt' || performance.stance === 'leaving';
    this.body.update(time, dt, this.seated ? 0 : walkingSpeed, {
      guarded, comfortable: performance.stance === 'comfortable', speaking,
      amplitude, shared: !!performance.shared, phoneActive: !!performance.phoneActive,
    });
    this.head.position.copy(this.body.headAnchor);
    this.root.updateMatrixWorld(true);
    this.localGaze.copy(gaze); this.root.worldToLocal(this.localGaze); this.localGaze.sub(this.head.position);
    const yaw = Math.atan2(this.localGaze.x, this.localGaze.z);
    const pitch = -Math.atan2(this.localGaze.y, Math.max(.1, Math.hypot(this.localGaze.x, this.localGaze.z)));
    const targetYaw = performance.stance === 'hurt' ? -.2 : performance.phoneActive && !speaking ? .26 : THREE.MathUtils.clamp(yaw, -.38, .38);
    const blend = 1 - Math.exp(-Math.max(0, dt) * 7);
    this.head.rotation.y = THREE.MathUtils.lerp(this.head.rotation.y, targetYaw, blend);
    this.head.rotation.x = THREE.MathUtils.lerp(this.head.rotation.x, THREE.MathUtils.clamp(pitch, -.18, .18), blend);
    this.head.rotation.z = THREE.MathUtils.lerp(this.head.rotation.z, emotion === 'flirtatious' ? -.035 : emotion === 'defensive' ? .025 : Math.sin(time * .7 + this.kind.length) * .008, blend);
    this.face.update(time, dt, emotion, speaking, amplitude, (yaw - this.head.rotation.y) * 2.5, (-pitch + this.head.rotation.x) * 2);
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.body.dispose(); this.face.dispose(); this.root.clear();
  }
}

