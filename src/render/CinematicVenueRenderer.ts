import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ObjectState, PlayerId, Reaction, RoomState, ServerMessage, Vec3 } from '../shared/protocol';
import { CLAW, FLIPPERS, FRIENDS, POOL, VENUE } from '../shared/venue';
import { createCharacter } from './cinematic/characters';
import { buildEnvironment } from './cinematic/environment';

type Focus = 'bowling' | 'pool' | 'claw' | null;
type Actor = ReturnType<typeof createCharacter> & {
  position: THREE.Vector3;
  speed: number;
  heading: number;
  label: HTMLDivElement;
  reaction?: { kind: Reaction; started: number };
};
type Prop = { root: THREE.Group; target: THREE.Vector3; rotation: THREE.Quaternion };
const UP = new THREE.Vector3(0, 1, 0);
export const ENDING_SHOT_SECONDS = 5.5;

/** Perspective view of the authoritative venue. No game outcomes live here. */
export class VenueRenderer {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(49, 1, .08, 70);
  private environment = buildEnvironment();
  private actors = new Map<string, Actor>();
  private props = new Map<string, Prop>();
  private geometries = new Set<THREE.BufferGeometry>();
  private materials = new Set<THREE.Material>();
  private textures = new Set<THREE.Texture>();
  private labels = document.createElement('div');
  private observer: ResizeObserver;
  private state?: RoomState;
  private localId: PlayerId = 'p1';
  private focus: Focus = null;
  private inputEnabled = true;
  private time = 0;
  private width = 1280;
  private height = 800;
  private zoom = 1;
  private conversation = false;
  private conversationSide = new THREE.Vector3(0, 0, 1);
  private disposed = false;
  private contextLost = false;
  private cameraTarget = new THREE.Vector3(0, 1.15, 5);
  private ray = new THREE.Raycaster();
  private poolPlane = new THREE.Plane(UP, -POOL.height);
  private poolAngle = 0;
  private poolPower = .55;
  private poolGuide: THREE.Line;
  private cueStick: THREE.Mesh;
  private claw = new THREE.Group();
  private clawMarker: THREE.Mesh;
  private cable: THREE.Mesh;
  private cranePosition = new THREE.Vector3(CLAW.initialX, CLAW.restY, CLAW.initialZ);
  private confetti: THREE.InstancedMesh;
  private shadowLight: THREE.SpotLight;
  private faceFill = new THREE.PointLight('#e1e8ef', 5.5, 6, 2);

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.canvas = this.renderer.domElement;
    this.canvas.tabIndex = -1;
    this.canvas.setAttribute('aria-label', 'Inside the New Year’s Eve bowling lounge');
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color('#393b3d');
    this.scene.fog = new THREE.Fog('#53453c', 22, 48);
    this.scene.add(this.environment.root);
    this.environment.root.updateMatrixWorld(true);
    this.scene.add(new THREE.HemisphereLight('#dce2e5', '#68616a', 1.25));
    this.shadowLight = new THREE.SpotLight('#ffe9d0', 105, 22, 1.05, .8, 2);
    this.shadowLight.position.set(-1, 5.0, 6);
    this.shadowLight.target.position.set(0, 0, 6);
    this.shadowLight.castShadow = true;
    this.shadowLight.shadow.mapSize.set(1024, 1024);
    this.shadowLight.shadow.normalBias = .025;
    this.shadowLight.shadow.bias = -.0001;
    this.shadowLight.shadow.radius = 3;
    this.shadowLight.shadow.intensity = .78;
    this.scene.add(this.shadowLight, this.shadowLight.target);
    this.scene.add(this.faceFill);
    for (const [x, z, power] of [[-6, -5, 85], [0, -6.5, 75], [5, 5, 65], [8, -4, 65]]) {
      const light = new THREE.PointLight('#ffe6c3', power, 16, 2);
      light.position.set(x, 4, z); this.scene.add(light);
    }
    const cool = new THREE.PointLight('#a8c5df', 24, 14, 2);
    cool.position.set(1, 2.7, 10); this.scene.add(cool);
    this.labels.className = 'world-labels';
    container.append(this.canvas, this.labels);
    for (const person of ['p1', 'p2', 'mira', 'dev'] as const) {
      const actor = createCharacter(person), label = document.createElement('div');
      label.className = 'world-name'; this.labels.append(label);
      const pos = person === 'mira' ? FRIENDS.mira : person === 'dev' ? FRIENDS.dev : VENUE.spawn[person];
      actor.root.position.set(pos[0], 0, pos[2]);
      const heading = person === 'p1' || person === 'mira' ? Math.PI / 2 : -Math.PI / 2;
      actor.root.rotation.y = heading;
      this.actors.set(person, { ...actor, position: actor.root.position.clone(), speed: 0, heading, label });
      this.scene.add(actor.root);
    }
    const brass = this.material('#aa8655', .4, .5);
    this.cable = this.mesh(new THREE.CylinderGeometry(.014, .014, 1, 8), this.material('#3a3430', .6), this.scene);
    this.mesh(new THREE.CylinderGeometry(.12, .16, .15, 16), brass, this.claw);
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3;
      const path = new THREE.CatmullRomCurve3([new THREE.Vector3(Math.cos(a) * .1, -.05, Math.sin(a) * .1), new THREE.Vector3(Math.cos(a) * .23, -.25, Math.sin(a) * .23), new THREE.Vector3(Math.cos(a) * .10, -.39, Math.sin(a) * .10)]);
      this.mesh(new THREE.TubeGeometry(path, 9, .022, 6, false), brass, this.claw);
    }
    this.scene.add(this.claw);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: '#e2b96b', transparent: true, opacity: .8, depthWrite: false, side: THREE.DoubleSide }); this.materials.add(markerMaterial);
    this.clawMarker = this.mesh(new THREE.RingGeometry(.17, .19, 32), markerMaterial, this.scene); this.clawMarker.rotation.x = -Math.PI / 2; this.clawMarker.castShadow = false;
    const guideMaterial = new THREE.LineDashedMaterial({ color: '#ead9a8', dashSize: .10, gapSize: .075, transparent: true, opacity: .75 });
    this.materials.add(guideMaterial);
    const guideGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.geometries.add(guideGeometry);
    this.poolGuide = new THREE.Line(guideGeometry, guideMaterial); this.scene.add(this.poolGuide);
    this.cueStick = this.mesh(new THREE.CylinderGeometry(.012, .025, 1.3, 10), this.material('#b59463', .7), this.scene);
    const paper = this.material('#d8b670', .8);
    const paperGeometry = new THREE.PlaneGeometry(.045, .10); this.geometries.add(paperGeometry);
    paper.side = THREE.DoubleSide;
    this.confetti = new THREE.InstancedMesh(paperGeometry, paper, 70); this.confetti.frustumCulled = false; this.scene.add(this.confetti);
    this.camera.position.set(.3, 2.05, 10.3); this.camera.lookAt(this.cameraTarget);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container); this.resize();
    this.canvas.addEventListener('wheel', this.wheel, { passive: false });
    this.canvas.addEventListener('webglcontextlost', this.lost);
    this.canvas.addEventListener('webglcontextrestored', this.restored);
    window.addEventListener('keydown', this.key);
  }
  private material(color: string, roughness = .75, metalness = 0) { const m = new THREE.MeshStandardMaterial({ color, roughness, metalness }); this.materials.add(m); return m; }
  private mesh(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D): THREE.Mesh { this.geometries.add(g); const o = new THREE.Mesh(g, m); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; }
  getMovementVector(horizontal: number, forward: number) { if (horizontal || forward) this.conversation = false; return { x: horizontal, z: forward }; }
  setActivityFocus(focus: Focus) { this.focus = focus; this.conversation = false; }
  setInputEnabled(enabled: boolean) { this.inputEnabled = enabled; }
  react(message: Extract<ServerMessage, { type: 'reaction' }>) {
    const actor = this.actors.get(message.playerId);
    if (!actor || !this.state?.players.some(p => p.id === message.playerId && p.connected)) return;
    actor.reaction = { kind: message.reaction, started: this.time };
  }
  setPoolAim(angle: number, power: number) { if (Number.isFinite(angle)) this.poolAngle = angle; if (Number.isFinite(power)) this.poolPower = THREE.MathUtils.clamp(power, 0, 1); }
  getPoolPoint(clientX: number, clientY: number) {
    if (this.focus !== 'pool' || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    const r = this.canvas.getBoundingClientRect(); if (!r.width || !r.height) return null;
    this.ray.setFromCamera(new THREE.Vector2((clientX - r.left) / r.width * 2 - 1, 1 - (clientY - r.top) / r.height * 2), this.camera);
    const p = this.ray.ray.intersectPlane(this.poolPlane, new THREE.Vector3());
    return p ? { x: p.x, z: p.z } : null;
  }
  projectWorld(position: Vec3) {
    const point = new THREE.Vector3(...position).project(this.camera), r = this.canvas.getBoundingClientRect();
    return { x: r.left + (point.x + 1) * r.width / 2, y: r.top + (1 - point.y) * r.height / 2, visible: point.z > -1 && point.z < 1 && Math.abs(point.x) < 1 && Math.abs(point.y) < 1 };
  }
  stats() { const i = this.renderer.info, gl = this.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info'); return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, contextLost: this.contextLost, device: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) }; }
  private wheel = (e: WheelEvent) => { if (!this.inputEnabled || this.focus) return; e.preventDefault(); this.zoom = THREE.MathUtils.clamp(this.zoom + e.deltaY * .0006, .8, 1.25); };
  private key = (e: KeyboardEvent) => {
    if (e.code !== 'KeyV' || !this.inputEnabled || this.focus || e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLElement && e.target.isContentEditable)) return;
    if (this.conversation) { this.conversation = false; return; }
    const local = this.actors.get(this.localId)!, partnerId = this.localId === 'p1' ? 'p2' : 'p1';
    if (!this.state?.players.some(p => p.id === partnerId && p.connected)) return;
    const partner = this.actors.get(partnerId)!;
    if (local.position.distanceTo(partner.position) >= 4) return;
    // Choose the existing camera side once. A pair aligned in world Z needs a
    // side view, too; a fixed +Z camera would put one person behind the other.
    const across = partner.position.clone().sub(local.position);
    this.conversationSide.set(across.z, 0, -across.x).normalize();
    const cameraSide = this.camera.position.clone().sub(local.position.clone().add(partner.position).multiplyScalar(.5));
    if (this.conversationSide.dot(cameraSide) < 0) this.conversationSide.negate();
    this.composeConversation(local.position, partner.position);
    this.conversation = true;
  };
  private lost = (e: Event) => { e.preventDefault(); this.contextLost = true; this.canvas.setAttribute('aria-label', 'Graphics interrupted; waiting to restore the lounge'); };
  private restored = () => { this.contextLost = false; this.canvas.setAttribute('aria-label', 'Inside the New Year’s Eve bowling lounge'); };

  private composeConversation(local: THREE.Vector3, partner: THREE.Vector3) {
    const focus = local.clone().add(partner).multiplyScalar(.5).setY(1.37);
    const distance = Math.max(2.45, (local.distanceTo(partner) * .5 + .34) / (Math.tan(THREE.MathUtils.degToRad(17)) * this.camera.aspect * .86));
    const trial = new THREE.PerspectiveCamera(34, this.camera.aspect, .08, 70);
    const base = this.conversationSide.clone(); let bestScore = -Infinity;
    // Select a slight three-quarter angle once, rather than moving characters
    // or hiding friends when a background face lines up with the pair.
    for (const angle of [0, -.14, .14, -.28, .28]) {
      const side = base.clone().applyAxisAngle(UP, angle), position = focus.clone().addScaledVector(side, distance); position.y += .14;
      this.clearCameraPath(focus, position);
      trial.position.copy(position); trial.lookAt(focus); trial.updateMatrixWorld(true);
      const heads = [local, partner].map(p => p.clone().setY(1.67).project(trial));
      let clearance = .6;
      for (const id of ['mira', 'dev']) {
        const head = this.actors.get(id)!.position.clone().setY(1.67).project(trial);
        if (head.z <= -1 || head.z >= 1) continue;
        for (const person of heads) clearance = Math.min(clearance, Math.hypot((person.x - head.x) * this.camera.aspect, person.y - head.y));
      }
      const clipped = heads.some(head => Math.abs(head.x) > .87 || Math.abs(head.y) > .70);
      const score = clearance - Math.abs(angle) * .18 - (clipped ? 2 : 0) - Math.max(0, distance - position.distanceTo(focus)) * .4;
      if (score > bestScore) { bestScore = score; this.conversationSide.copy(side); }
    }
  }

  update(state: RoomState, localId: PlayerId, dt: number) {
    for (const [id, actor] of this.actors) {
      if (actor.reaction && (state.room !== this.state?.room || !state.players.some(p => p.id === id && p.connected))) actor.reaction = undefined;
    }
    this.state = state; this.localId = localId;
    const blend = 1 - Math.exp(-Math.min(.15, dt) * 18);
    for (const p of state.players) {
      const a = this.actors.get(p.id)!;
      const old = a.position.clone(), target = new THREE.Vector3(p.position[0], Math.max(0, p.position[1] - .75), p.position[2]);
      a.position.lerp(target, blend);
      const movement = a.position.clone().sub(old), speed = Math.hypot(movement.x, movement.z) / Math.max(.001, dt);
      a.speed += (speed - a.speed) * blend;
      if (speed > .12) a.heading = Math.atan2(movement.x, movement.z);
      else {
        const partner = state.players.find(q => q.id !== p.id && q.connected);
        if (partner && Math.hypot(partner.position[0] - p.position[0], partner.position[2] - p.position[2]) < 4) {
          const gaze = Math.atan2(partner.position[0] - p.position[0], partner.position[2] - p.position[2]);
          // Relax the torso toward the open room; the neck completes the gaze.
          a.heading = gaze - Math.sign(gaze) * Math.min(Math.abs(gaze), .6);
        }
      }
    }
    const live = new Set<string>();
    const sync = (id: string, position: Vec3, rotation: number[], create: () => THREE.Group) => {
      live.add(id); let p = this.props.get(id);
      if (!p) { p = { root: create(), target: new THREE.Vector3(...position), rotation: new THREE.Quaternion(...rotation as [number, number, number, number]) }; p.root.position.copy(p.target); this.props.set(id, p); this.scene.add(p.root); }
      p.target.set(...position); p.rotation.set(...rotation as [number, number, number, number]);
      p.root.position.lerp(p.target, blend); p.root.quaternion.slerp(p.rotation, blend);
    };
    const objects = state.players.length ? state.objects : this.previewObjects();
    for (const o of objects) sync(o.id, o.position, o.rotation, () => this.makeObject(o));
    for (const b of state.pool.balls) sync(`pool:${b.id}`, b.position, b.rotation, () => this.makePoolBall(b.id));
    for (const [id, p] of this.props) if (!live.has(id)) { this.scene.remove(p.root); this.disposeProp(p.root); this.props.delete(id); }
    this.cranePosition.lerp(new THREE.Vector3(state.claw.x, state.claw.y, state.claw.z), blend);
    this.environment.clock(state.clockSeconds);
  }

  render(dt: number, age: number) {
    if (this.disposed || this.contextLost) return false;
    this.time += Math.min(.15, dt);
    const state = this.state;
    const ending = !!state && (state.ending.phase === 'kiss' || state.ending.phase === 'celebration') && age < ENDING_SHOT_SECONDS;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // All positions must be current before either player tracks the other.
    // Updating position and gaze together gives the first actor stale targets.
    for (const [id, a] of this.actors) {
      a.root.position.copy(a.position);
      if (ending && (id === 'p1' || id === 'p2')) {
        const mutual = state.ending.phase === 'kiss', approach = reduceMotion ? 1 : THREE.MathUtils.smoothstep(age, .3, 1.4);
        a.root.position.set((id === 'p1' ? -1 : 1) * THREE.MathUtils.lerp(.7, mutual ? .18 : .65, approach), 0, 6.0);
      }
    }
    for (const [id, a] of this.actors) {
      const p = state?.players.find(p => p.id === id), friend = id === 'mira' || id === 'dev';
      a.root.visible = friend || !state?.players.length || !!p;
      let heading = a.heading;
      if (ending && !friend) {
        heading = id === 'p1' ? Math.PI / 2 : -Math.PI / 2;
      }
      const turn = Math.atan2(Math.sin(heading - a.root.rotation.y), Math.cos(heading - a.root.rotation.y));
      a.root.rotation.y += turn * (1 - Math.exp(-dt * 9));
      a.root.updateMatrixWorld(true);
      const otherId = friend ? this.localId : id === 'p1' ? 'p2' : 'p1';
      const other = this.actors.get(otherId);
      const otherPresent = !state?.players.length || state.players.some(player => player.id === otherId && player.connected);
      const lookAt = otherPresent && other && other.root.position.distanceTo(a.root.position) < 4.5 ? other.root.position.clone().add(new THREE.Vector3(0, 1.65, 0)) : undefined;
      const wave = (friend && !!lookAt && this.time % 14 < 1.2) || (ending && state.ending.phase === 'celebration');
      const kiss = !friend && ending && state.ending.phase === 'kiss' && age > 1.3 && age < 4.6;
      if (a.reaction && (ending || this.time - a.reaction.started >= 1.8)) a.reaction = undefined;
      a.update(dt, { speed: ending ? 0 : a.speed, time: this.time, lookAt, wave, reaction: a.reaction, kiss: kiss ? 1 : 0 });
      a.label.textContent = friend ? `${id === 'mira' ? 'Mira' : 'Dev'} · character friend` : p ? `${p.name}${p.id === this.localId ? ' · you' : ''}` : id === 'p1' ? 'Alex' : 'Sam';
    }
    this.claw.position.copy(this.cranePosition);
    this.clawMarker.visible = this.focus === 'claw' && (state?.claw.phase === 'aiming' || state?.claw.phase === 'surprise');
    this.clawMarker.position.set(this.cranePosition.x, state?.claw.phase === 'surprise' ? .045 : CLAW.bedY + .07, this.cranePosition.z);
    const cableHeight = Math.max(.03, 4.05 - this.cranePosition.y);
    this.cable.position.set(this.cranePosition.x, this.cranePosition.y + cableHeight / 2, this.cranePosition.z); this.cable.scale.y = cableHeight;
    this.updateCamera(dt, ending);
    this.updatePoolGuide();
    this.confetti.visible = ending;
    if (ending) {
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 70; i++) { const t = reduceMotion ? .7 : age; dummy.position.set(Math.sin(i * 7.31) * 2.7, 3.6 - (i * .171 + t * .5) % 3.5, 6 + Math.cos(i * 1.7) * 1.5); dummy.rotation.set(i + t, i * .3, i - t); dummy.updateMatrix(); this.confetti.setMatrixAt(i, dummy.matrix); }
      this.confetti.instanceMatrix.needsUpdate = true;
    }
    this.renderer.render(this.scene, this.camera);
    for (const a of this.actors.values()) {
      const point = this.projectWorld([a.root.position.x, a.root.position.y + 1.84, a.root.position.z]);
      a.label.hidden = !a.root.visible || ending || !!this.focus || !point.visible || point.y < 108 || point.y > this.height - 72;
      if (!a.label.hidden) {
        const head = a.root.position.clone().add(new THREE.Vector3(0, 1.72, 0));
        const sightline = head.sub(this.camera.position), distance = sightline.length();
        this.ray.set(this.camera.position, sightline.normalize()); this.ray.far = Math.max(0, distance - .12);
        a.label.hidden = this.ray.intersectObjects(this.environment.cameraObstacles, false).length > 0;
        this.ray.far = Infinity;
      }
      a.label.style.transform = `translate(${Math.round(point.x)}px,${Math.round(point.y)}px) translate(-50%,-100%)`;
    }
    return true;
  }
  private updateCamera(dt: number, ending: boolean) {
    const local = this.actors.get(this.localId)!, partner = this.actors.get(this.localId === 'p1' ? 'p2' : 'p1')!;
    let focus = local.root.position.clone().add(new THREE.Vector3(0, 1.05, 0)), position: THREE.Vector3;
    const joined = this.state?.players.length === 2;
    const separation = local.root.position.distanceTo(partner.root.position);
    if (this.conversation && (!this.state?.players.some(p => p.id !== this.localId && p.connected) || separation >= 4)) this.conversation = false;
    if (joined && separation < 3.5) focus.lerp(partner.root.position.clone().add(new THREE.Vector3(0, 1.05, 0)), .38);
    let fov = 49, shifted = false;
    if (ending) { focus.set(0, 1.18, 6); position = new THREE.Vector3(.4, 1.8, 9.4); fov = 43; }
    else if (this.focus === 'pool') { focus.set(POOL.centerX, POOL.height, POOL.centerZ); position = new THREE.Vector3(POOL.centerX, 5.05, POOL.centerZ + 4.9); fov = 54; shifted = true; }
    else if (this.focus === 'bowling') { focus.set(VENUE.laneX, .45, -4.8); position = new THREE.Vector3(VENUE.laneX + .6, 2.7, 7.4); fov = 58; shifted = true; }
    else if (this.focus === 'claw') { const surprise = this.state?.claw.phase === 'surprise'; focus.set(CLAW.centerX - (surprise ? 1.1 : .7), 2.0, CLAW.centerZ + .3); position = new THREE.Vector3(CLAW.centerX + 2.5, 3.7, CLAW.centerZ + 8); fov = 50; shifted = true; }
    else if (this.conversation && joined && separation < 4) {
      focus.set((local.root.position.x + partner.root.position.x) / 2, 1.37, (local.root.position.z + partner.root.position.z) / 2);
      fov = 34;
      // Frame the pair's width with a margin at both desktop aspect ratios.
      // This is a medium two-shot; exploration retains the view of their feet.
      const distance = Math.max(2.45, (separation * .5 + .34) / (Math.tan(THREE.MathUtils.degToRad(fov * .5)) * this.camera.aspect * .86));
      position = focus.clone().addScaledVector(this.conversationSide, distance * Math.max(1, this.zoom)); position.y += .14;
    }
    else position = focus.clone().add(new THREE.Vector3(.35, .85, (joined ? 4.6 : 4.3) * this.zoom));
    if (!this.focus) {
      const requested = position.clone(), desiredDistance = requested.distanceTo(focus);
      this.clearCameraPath(focus, position);
      if (!this.conversation && !ending && position.distanceTo(focus) < desiredDistance * .72) {
        // At the counter or a room corner, try looking over the obstruction
        // before accepting a close crop of the player's head and feet.
        const raised = requested.clone().add(new THREE.Vector3(0, 1.4, 0));
        this.clearCameraPath(focus, raised);
        if (raised.distanceTo(focus) > position.distanceTo(focus) + .35) position.copy(raised);
      }
      if (!ending && position.distanceTo(focus) < .65) {
        // A midpoint can be inside furniture when players stand on opposite
        // sides. Recover from the local player's head, which is outside the
        // shared collision bounds, rather than ignoring a nearby obstacle.
        this.conversation = false;
        focus.copy(local.root.position).add(new THREE.Vector3(0, 1.65, 0));
        position.copy(focus).add(new THREE.Vector3(.35, 1.5, 3.8 * this.zoom));
        this.clearCameraPath(focus, position);
      }
    }
    const blend = 1 - Math.exp(-Math.min(dt, .15) * (ending ? 12 : 8));
    this.cameraTarget.lerp(focus, blend); this.camera.position.lerp(position, blend);
    // Check the interpolated position too: blending around a booth corner must
    // not cut through the booth even when both desired endpoints were clear.
    if (!this.focus) this.clearCameraPath(this.cameraTarget, this.camera.position);
    this.camera.lookAt(this.cameraTarget);
    if (!this.focus && !this.conversation && !ending) {
      const distance = this.camera.position.distanceTo(this.cameraTarget);
      fov = Math.max(fov, Math.min(76, THREE.MathUtils.radToDeg(2 * Math.atan(1.3 / Math.max(.1, distance)))));
    }
    this.camera.fov = fov; this.camera.clearViewOffset();
    if (shifted) this.camera.setViewOffset(this.width, this.height, this.width * .105, this.height * .025, this.width, this.height);
    this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld(true);
    // The key follows the active part of the room, with its shadow always inside the ceiling.
    this.shadowLight.position.lerp(new THREE.Vector3(focus.x - 2, 4.9, focus.z + 2), blend);
    this.shadowLight.target.position.copy(focus).setY(0);
    // A weak, cool bounce keeps the eye sockets readable without flattening
    // the warm room or casting a second set of moving shadows.
    this.faceFill.position.copy(this.camera.position).lerp(focus, .35).setY(2.2);
    this.faceFill.intensity = this.focus ? 0 : 5.5;
  }
  private clearCameraPath(focus: THREE.Vector3, position: THREE.Vector3) {
    position.x = THREE.MathUtils.clamp(position.x, VENUE.minX + .45, VENUE.maxX - .45);
    position.z = THREE.MathUtils.clamp(position.z, VENUE.minZ + .45, VENUE.maxZ - .45);
    const direction = position.clone().sub(focus), length = direction.length();
    if (length < .001) return;
    direction.divideScalar(length);
    const right = new THREE.Vector3().crossVectors(direction, UP).normalize();
    const offsets = [new THREE.Vector3(), right.clone().multiplyScalar(.16), right.clone().multiplyScalar(-.16), new THREE.Vector3(0, .12, 0), new THREE.Vector3(0, -.12, 0)];
    let clearDistance = length;
    this.ray.far = length;
    for (const offset of offsets) {
      this.ray.set(focus.clone().add(offset), direction);
      const hit = this.ray.intersectObjects(this.environment.cameraObstacles, false)[0];
      if (hit) clearDistance = Math.min(clearDistance, Math.max(.02, hit.distance - .20));
    }
    this.ray.far = Infinity;
    if (clearDistance < length) position.copy(focus).addScaledVector(direction, clearDistance);
  }
  private updatePoolGuide() {
    const cue = this.state?.pool.balls.find(b => b.id === 0), active = this.focus === 'pool' && !!cue && this.state?.pool.phase === 'aiming';
    this.poolGuide.visible = this.cueStick.visible = active;
    if (!cue || !active) return;
    const direction = new THREE.Vector3(Math.cos(this.poolAngle), 0, Math.sin(this.poolAngle)), start = new THREE.Vector3(...cue.position);
    const attr = this.poolGuide.geometry.getAttribute('position') as THREE.BufferAttribute;
    const end = start.clone().addScaledVector(direction, 1 + this.poolPower * 1.1);
    attr.setXYZ(0, start.x, start.y, start.z); attr.setXYZ(1, end.x, end.y, end.z); attr.needsUpdate = true; this.poolGuide.computeLineDistances();
    this.cueStick.position.copy(start).addScaledVector(direction, -.85 - this.poolPower * .12); this.cueStick.quaternion.setFromUnitVectors(UP, direction);
  }
  private makePoolBall(id: number) {
    const root = new THREE.Group(), colors = ['#ede6d7', '#bd9447', '#45617c', '#923d35', '#6b5067', '#b46d3b', '#365f50'];
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64; const c = canvas.getContext('2d')!;
    c.fillStyle = colors[id] || colors[1]; c.fillRect(0, 0, 128, 64);
    if (id) for (const x of [32, 96]) { c.beginPath(); c.fillStyle = '#ece2cb'; c.arc(x, 32, 13, 0, Math.PI * 2); c.fill(); c.fillStyle = '#34302b'; c.font = 'bold 20px Georgia'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(id), x, 33); }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; this.textures.add(texture);
    const m = this.material('#ffffff', .25); m.map = texture;
    this.mesh(new THREE.SphereGeometry(POOL.radius, 20, 14), m, root); return root;
  }
  private makeObject(o: ObjectState) {
    const root = new THREE.Group();
    if (o.kind === 'pin') {
      const profile = [[.0,-.4],[.105,-.4],[.138,-.34],[.153,-.2],[.138,-.08],[.084,.1],[.055,.24],[.07,.30],[.074,.35],[.04,.40],[0,.41]].map(([r,y]) => new THREE.Vector2(r,y));
      this.mesh(new THREE.LatheGeometry(profile, 20), this.material('#eee5d3', .34), root);
      for (const y of [.20,.25]) { const ring = this.mesh(new THREE.CylinderGeometry(.061,.061,.025,20), this.material('#93463d', .5), root); ring.position.y = y; }
    } else if (o.kind === 'lane-flipper') {
      const x = o.id.endsWith('left') ? FLIPPERS.halfLength : -FLIPPERS.halfLength;
      const body = this.mesh(new RoundedBoxGeometry(FLIPPERS.halfLength*2, FLIPPERS.halfHeight*2, FLIPPERS.halfWidth*2, 3, .08), this.material('#d2af73', .4, .25), root); body.position.x = x;
      const strip = this.mesh(new RoundedBoxGeometry(FLIPPERS.halfLength*1.8, .045, FLIPPERS.halfWidth*1.7, 2, .02), this.material('#99473d', .5), root); strip.position.set(x, FLIPPERS.halfHeight + .016, 0);
    } else if (o.kind === 'ball' || o.kind === 'beach-ball') {
      const r = o.kind === 'ball' ? .3 : .6;
      this.mesh(new THREE.SphereGeometry(r, 26, 18), this.material(o.kind === 'ball' ? '#663d3c' : '#e7cfa4', .22), root);
      if (o.kind === 'ball') for (const [x,y] of [[-.06,.055],[.06,.055],[0,-.06]]) { const hole = this.mesh(new THREE.SphereGeometry(.031,10,8), this.material('#191a19', .9), root); hole.position.set(x,y, Math.sqrt(r*r-x*x-y*y)-.009); hole.scale.z = .35; }
    } else {
      const r = o.kind === 'giant-prize' ? .75 : .35, fur = this.material('#b59262', .95), dark = this.material('#392e28', .7);
      this.mesh(new THREE.SphereGeometry(r, 22, 16), fur, root);
      for (const sign of [-1,1]) { const ear = this.mesh(new THREE.SphereGeometry(r*.27, 12, 10), fur, root); ear.position.set(sign*r*.65,r*.72,0); const eye = this.mesh(new THREE.SphereGeometry(r*.055,10,8), dark, root); eye.position.set(sign*r*.27,r*.12,r*.94); }
      const muzzle = this.mesh(new THREE.SphereGeometry(r*.25, 14,10), this.material('#dfc799', .95), root); muzzle.position.set(0,-r*.2,r*.88); muzzle.scale.z = .45;
      const nose = this.mesh(new THREE.SphereGeometry(r*.09,10,8), dark, root); nose.position.set(0,-r*.12,r*1.02);
    }
    return root;
  }
  private previewObjects(): ObjectState[] { const objects: ObjectState[] = []; for(let row=0;row<4;row++)for(let col=0;col<=row;col++)objects.push({id:`preview:${row}:${col}`,kind:'pin',position:[VENUE.laneX+(col-row/2)*.42,.42,VENUE.pinZ-row*.38],rotation:[0,0,0,1]}); return objects; }
  private disposeProp(root: THREE.Object3D) {
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      if (this.geometries.delete(object.geometry)) object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) if (this.materials.delete(material)) {
        const map = (material as THREE.MeshStandardMaterial).map;
        if (map && this.textures.delete(map)) map.dispose();
        material.dispose();
      }
    });
  }
  private resize() { this.width = Math.max(1, this.container.clientWidth); this.height = Math.max(1, this.container.clientHeight); this.renderer.setSize(this.width, this.height, false); this.camera.aspect = this.width / this.height; this.camera.updateProjectionMatrix(); }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.observer.disconnect();
    this.canvas.removeEventListener('wheel', this.wheel); this.canvas.removeEventListener('webglcontextlost', this.lost); this.canvas.removeEventListener('webglcontextrestored', this.restored); window.removeEventListener('keydown', this.key);
    this.environment.dispose(); for (const a of this.actors.values()) a.dispose(); this.geometries.forEach(g => g.dispose()); this.materials.forEach(m => m.dispose()); this.textures.forEach(t => t.dispose());
    this.renderer.dispose(); this.canvas.remove(); this.labels.remove();
  }
}
