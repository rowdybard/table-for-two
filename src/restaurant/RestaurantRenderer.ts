import * as THREE from 'three';
import type { RenderItem } from 'three/src/renderers/webgl/WebGLRenderLists.js';
import { RESTAURANT, getDate } from './content';
import type { AudioPlayback, DateId, DateStance, DinnerCommand, DinnerState, Emotion } from './types';
import { calmEnoughForListening, type ListeningPreview } from './ListeningPreview';
import { RestaurantActor } from './render/RestaurantActor';
import { createCharacterEnvironment, prepareCharacterLighting } from './render/CharacterLighting';
import { createRestaurantScene, type RestaurantSet } from './render/RestaurantScene';
import { EveningTable } from './render/EveningTable';
import { createPlaceSettingShadows } from './render/PlaceSettingShadows';
import { waitForEnvironmentAssets } from './render/EnvironmentAssets';
import { waitForRestaurantProps } from './render/RestaurantPropKit';
import { createRestaurantLighting, type RestaurantLighting } from './render/RestaurantLighting';
import { detectRenderQuality } from './render/RenderQuality';
import { DOUBLE_TABLE, type ConversationTarget, type DoubleDateActorId, type DoubleHumanId } from './double-date-types';
import { tableActionForTarget, tabletopActionAvailability } from './tabletop';
import { isInspectionTarget, type InspectionTarget } from './TabletopInspector';
import { diningOffsetZ } from './dining-space';
import { scenePresenceAvailable } from './scenario-care';

type InteractionTarget = Extract<DinnerCommand, { type: 'interact' }>['target'];
export interface RestaurantInteraction { target: InteractionTarget; label: string; actorId?: ConversationTarget }
export type RestaurantPresentation = 'selection' | 'gameplay';
export type TableFocus = 'menu' | 'farewell' | null;

/** Client-only cast portraits and first-person presentation. The server owns movement and dinner. */
export class RestaurantRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(61, 1, .035, 45);
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  /** Replaced after a WebGL context restore, when the old render target's texture is gone. */
  private characterEnvironment: THREE.WebGLRenderTarget;
  private readonly set: RestaurantSet;
  private readonly table = new EveningTable();
  private readonly placeSettingShadows = createPlaceSettingShadows();
  /** Chosen once, before the first shader compile: light count and shadow casters depend on it. */
  private readonly quality = detectRenderQuality();
  private readonly lighting: RestaurantLighting;
  private readonly waiter = new RestaurantActor('waiter');
  private readonly diner = new RestaurantActor('diner');
  private date: RestaurantActor;
  private dateId: DateId;
  private dateTarget: THREE.Mesh;
  private otherDate: RestaurantActor | null = null;
  private otherDateId: DateId | null = null;
  private otherDateTarget: THREE.Mesh | null = null;
  private friend: RestaurantActor | null = null;
  private friendTarget: THREE.Mesh | null = null;
  private doubleLayout = false;
  private readonly ray = new THREE.Raycaster();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly gaze = new THREE.Vector3();
  private readonly center = new THREE.Vector2();
  /** True from a render until the next update(): world matrices are what is on screen, so raycasts need not recompute them. */
  private sceneMatricesFresh = false;
  /** The crosshair interaction, computed at most once per frame for a given state snapshot. */
  private centerInteraction: { state: DinnerState; hit: RestaurantInteraction | null } | null = null;
  private readonly resizeObserver: ResizeObserver;
  private yaw = 0;
  private pitch = -.025;
  private time = 0;
  private lastSeated = false;
  private lastRoom = '';
  private lastDiningOffset = 0;
  private disposed = false;
  private readonly datePosition = new THREE.Vector3();
  private serviceUntil = 0;
  private serviceRoom = '';
  private lastServiceCues: string[] = [];
  private presentation: RestaurantPresentation = 'gameplay';
  private readonly roomLights = new THREE.Group();
  private readonly farewellLight = new THREE.PointLight('#ffdcbb', 0, 4, 2);
  /** A soft fill that travels with the viewer, so faces across the table keep their eyes and lips readable. */
  private readonly faceFill = new THREE.PointLight('#ffeedd', .55, 2.4, 2);
  private readonly faceFillOffset = new THREE.Vector3(.18, .12, 0);
  private readonly selectionGaze = new THREE.Vector3();
  private tableFocus: TableFocus = null;
  private inspectionTarget: InspectionTarget | null = null;
  private readonly inspectionAnchor = new THREE.Vector3();
  private readonly inspectionOffset = new THREE.Vector3();
  private listeningPreview: ListeningPreview | null = null;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly previousView = new THREE.Quaternion();
  private focusTransition = 0;
  private ready = false;
  private compiled = false;
  private warmupRevision = 0;
  private warmupTask: Promise<void> | null = null;
  private readonly parallelCompile: boolean;
  private cancelWarmup!: () => void;
  private readonly warmupCancelled = new Promise<void>(resolve => { this.cancelWarmup = resolve; });

  get isReady() { return this.ready && !this.disposed; }

  setInspectionTarget(target: InspectionTarget | null) {
    if (target === this.inspectionTarget) return;
    this.previousView.copy(this.camera.quaternion);
    this.focusTransition = this.reducedMotion.matches ? 0 : 1;
    this.inspectionTarget = target;
    if (target) this.listeningPreview = null;
  }

  private inspectionObject() {
    return this.set.targets.find(object => object.userData.target === this.inspectionTarget)
      ?? this.table.targets.find(object => object.userData.target === this.inspectionTarget);
  }

  hasTableTarget(target: InspectionTarget) {
    let object: THREE.Object3D | null = this.set.targets.find(object => object.userData.target === target)
      ?? this.table.targets.find(object => object.userData.target === target) ?? null;
    if (!object) return false;
    while (object) { if (!object.visible) return false; object = object.parent; }
    return true;
  }

  /** three restores its own state first (its listener was added at construction), then this rebakes the cast probe. */
  private readonly restoreCharacterEnvironment = () => {
    if (this.disposed) return;
    try {
      // The old target's GL objects died with the lost context; let it be collected rather than
      // deleting stale handles on the new context.
      this.characterEnvironment = createCharacterEnvironment(this.renderer);
      for (const actor of [this.date, this.waiter, this.diner, this.otherDate, this.friend]) {
        if (actor) prepareCharacterLighting(actor.root, this.characterEnvironment.texture);
      }
    } catch (error) {
      console.warn('Cast reflections could not be rebuilt after the WebGL context returned.', error);
    }
  };

  /** Coalesce cast changes and wait for scene assets before using compiled programs. */
  private requestWarmup() {
    if (this.disposed) return;
    ++this.warmupRevision;
    this.ready = false; this.compiled = false; this.canvas.setAttribute('aria-busy', 'true');
    if (!this.parallelCompile) { this.compiled = true; return; }
    if (this.warmupTask) return;
    this.warmupTask = (async () => {
      // Yield until the title controls have installed their handlers before preparing shaders.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      await Promise.race([Promise.all([waitForEnvironmentAssets(), waitForRestaurantProps()]), this.warmupCancelled]);
      while (!this.disposed) {
        const revision = this.warmupRevision;
        await Promise.race([this.renderer.compileAsync(this.scene, this.camera), this.warmupCancelled]);
        if (this.disposed) break;
        if (revision === this.warmupRevision) {
          this.compiled = true;
          break;
        }
      }
    })().catch(error => {
      if (!this.disposed) { console.warn('Restaurant shader warmup failed; continuing with normal rendering.', error); this.compiled = true; }
    }).finally(() => {
      this.warmupTask = null;
      if (!this.disposed && !this.compiled) this.requestWarmup();
    });
  }

  private renderScene() {
    this.faceFill.position.copy(this.faceFillOffset).applyQuaternion(this.camera.quaternion).add(this.camera.position);
    this.renderer.render(this.scene, this.camera);
    this.sceneMatricesFresh = true;
    if (!this.ready && this.compiled && !this.disposed) { this.ready = true; this.canvas.setAttribute('aria-busy', 'false'); }
  }

  setTableFocus(focus: TableFocus) {
    if (this.tableFocus === focus) return;
    if ([focus, this.tableFocus].some(view => view === 'farewell')) {
      this.previousView.copy(this.camera.quaternion);
      this.focusTransition = this.reducedMotion.matches ? 0 : 1;
    }
    this.tableFocus = focus;
    if (focus) this.listeningPreview = null;
    const labels: Record<Exclude<TableFocus, null>, string> = {
      menu: 'Reading the dinner menu at the table',
      farewell: 'Facing your date by the restaurant door',
    };
    this.canvas.setAttribute('aria-label', focus ? labels[focus] : 'First-person view of Table for Two restaurant');
  }

  /** A view-only first impression; never changes authoritative emotion, dialogue or memory. */
  setListeningPreview(preview: ListeningPreview | null) {
    if (!this.disposed) this.listeningPreview = preview;
  }

  private listeningFor(target: ListeningPreview['target'], state: DinnerState, playback: AudioPlayback, current: Emotion, stance: DateStance, view = state) {
    const preview = this.listeningPreview;
    if (!preview || preview.target !== target || preview.expiresAt <= performance.now()
      || this.presentation !== 'gameplay' || state.phase !== 'playing' || view.phase !== 'playing'
      || this.tableFocus || playback.speaker || !calmEnoughForListening(current)
      || stance === 'guarded' || stance === 'hurt' || stance === 'leaving'
      || view.evening.incident || (state.doubleDate?.scenario ?? view.evening.scenario)?.phase === 'active'
      || view.evening.chapter === 'bill' || view.evening.chapter === 'farewell'
      || view.stage === 'farewell' || view.stage === 'finished'
      || ['d1', 'd2', 'waiter', 'diner'].includes(state.doubleDate?.speakingActor ?? '')) return null;
    return preview;
  }

  constructor(private readonly container: HTMLElement, dateId: DateId) {
    this.dateId = dateId;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.parallelCompile = this.renderer.extensions.has('KHR_parallel_shader_compile');
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.10;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // three orders opaque draws by material id, so ~25 programs alternate and every switch re-uploads all
    // light uniforms. Grouping by the program each material last used keeps the same pixels with far fewer switches.
    // Read renderer.properties at sort time: a context restore replaces it.
    const programOf = (item: RenderItem) => (this.renderer.properties.get(item.material) as { currentProgram?: { id: number } }).currentProgram?.id ?? 0;
    this.renderer.setOpaqueSort((a: RenderItem, b: RenderItem) => a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder
      || programOf(a) - programOf(b) || a.material.id - b.material.id || a.materialVariant - b.materialVariant || a.z - b.z || a.id - b.id);
    this.renderer.setClearColor('#172536');
    this.characterEnvironment = createCharacterEnvironment(this.renderer);
    this.canvas = this.renderer.domElement;
    this.canvas.addEventListener('webglcontextrestored', this.restoreCharacterEnvironment);
    this.canvas.className = 'restaurant-canvas';
    this.canvas.setAttribute('aria-label', 'First-person view of Table for Two restaurant');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    container.appendChild(this.canvas);
    this.scene.background = new THREE.Color('#172536');
    this.scene.fog = new THREE.Fog('#172536', 16, 36);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(...RESTAURANT.spawn);

    this.scene.add(this.roomLights);
    this.roomLights.add(this.farewellLight);
    this.roomLights.add(this.faceFill);
    // A cool rim from the window side lifts a seated date off the dark booth.
    const rim = new THREE.DirectionalLight('#b7c7f0', .5);
    rim.position.set(-1.6, 2.6, -4.8);
    rim.target.position.set(0, 1.1, -1.4);
    this.roomLights.add(rim, rim.target);
    this.set = createRestaurantScene();
    this.scene.add(this.set.root);
    this.scene.add(this.table.root, this.placeSettingShadows.mesh);
    this.date = new RestaurantActor(dateId);
    this.date.root.position.set(...RESTAURANT.dateSeat);
    this.date.setSeated(true);
    this.scene.add(this.date.root);
    this.dateTarget = this.createDateTarget();
    this.waiter.root.position.set(...RESTAURANT.waiter);
    this.waiter.root.rotation.y = -.4;
    this.scene.add(this.waiter.root);
    this.diner.root.position.set(-3.5, 0, -4.6);
    this.diner.setSeated(true);
    this.scene.add(this.diner.root);
    for (const actor of [this.date, this.waiter, this.diner]) prepareCharacterLighting(actor.root, this.characterEnvironment.texture);
    this.lighting = createRestaurantLighting({ renderer: this.renderer, scene: this.scene, camera: this.camera, roomLights: this.roomLights, set: this.set, quality: this.quality });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.setPresentation('selection');
    this.resize();
    this.requestWarmup();
  }

  /** Local presentation only. No participant, physics, or session state is changed. */
  setPresentation(presentation: RestaurantPresentation) {
    if (this.presentation === presentation) return;
    this.presentation = presentation;
    this.listeningPreview = null;
    const selection = presentation === 'selection';
    if (selection) {
      this.lastDiningOffset = 0;
      this.set.diningRoot.position.z = 0; this.table.root.position.z = 0; this.placeSettingShadows.mesh.position.z = 0;
    }
    this.waiter.root.visible = !selection;
    this.table.root.visible = !selection;
    this.set.menu.visible = true;
    this.camera.fov = selection ? 41 : 61;
    this.camera.updateProjectionMatrix();
    this.canvas.setAttribute('aria-label', selection ? 'Selected date character preview' : 'First-person view of Table for Two restaurant');
    this.yaw = 0; this.pitch = -.025;
    this.lastRoom = '\0';
    if (selection) { this.date.root.position.set(...RESTAURANT.dateSeat); this.date.setSeated(true); }
  }

  private renderSelection(dt: number, state: DinnerState) {
    if (state.doubleDate) {
      const double = state.doubleDate;
      this.table.root.visible = true;
      if (this.camera.fov !== 49) { this.camera.fov = 49; this.camera.updateProjectionMatrix(); }
      this.camera.position.set(-2.45, 1.8, 1.55);
      this.camera.lookAt(-.85, 1.02, -1.65);
      const localDate = double.dates.find(date => date.humanId === double.localHumanId);
      if (localDate) this.date.root.position.set(localDate.id === 'd1' ? -.57 : .57, 0, -2.5);
      this.date.root.rotation.y = 0;
      this.date.setSeated(true);
      this.date.update(this.time, dt, localDate?.emotion ?? 'neutral', false, 0, this.camera.position);
      this.updateDoubleActors(dt, state, { speaker: null, amplitude: 0, emotion: 'neutral', caption: '' }, true);
      this.table.update(state);
      this.diner.update(this.time, dt, 'neutral', false, 0, this.date.root.position);
      this.renderScene();
      return;
    }
    this.table.root.visible = false;
    if (this.camera.fov !== 41) { this.camera.fov = 41; this.camera.updateProjectionMatrix(); }
    const wide = this.camera.aspect >= 1.12;
    this.camera.position.set(1.0, 1.33, -.76);
    this.camera.lookAt(wide ? -.6 : -.12, 1.12, -2.21);
    this.date.root.position.set(...RESTAURANT.dateSeat);
    this.date.root.rotation.y = .33;
    this.date.setSeated(true);
    this.diner.update(this.time, dt, 'neutral', false, 0, this.date.root.position);
    this.selectionGaze.copy(this.camera.position);
    this.date.update(this.time, dt, this.dateId === 'jules' ? 'neutral' : this.dateId === 'dev' ? 'amused' : 'warm', false, 0, this.selectionGaze);
    this.date.head.rotation.z = (this.dateId === 'mira' ? -.025 : this.dateId === 'jules' ? .012 : -.008) + Math.sin(this.time * .7) * .008;
    this.renderScene();
  }

  private createActorTarget(actor: RestaurantActor, actorId?: ConversationTarget) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(.55, 1.07, .42), new THREE.MeshBasicMaterial({ visible: false, transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
    mesh.position.set(0, 1.16, .025);
    mesh.userData.target = 'date';
    mesh.userData.actorId = actorId;
    actor.root.add(mesh);
    return mesh;
  }

  private createDateTarget() { return this.createActorTarget(this.date); }

  private disposeTarget(target: THREE.Mesh | null) {
    if (!target) return;
    target.geometry.dispose(); (target.material as THREE.Material).dispose();
  }

  private syncDoubleActors(state: DinnerState) {
    const double = state.doubleDate;
    const enabled = !!double;
    if (enabled !== this.doubleLayout) { this.doubleLayout = enabled; this.set.setDoubleDate(enabled); }
    if (!double) {
      this.date.root.visible = true;
      if (this.otherDate) this.otherDate.root.visible = false;
      if (this.friend) this.friend.root.visible = false;
      this.dateTarget.userData.actorId = undefined;
      return;
    }
    const localDate = double.dates.find(date => date.humanId === double.localHumanId);
    const otherDate = double.dates.find(date => date.humanId !== double.localHumanId);
    const otherHuman = double.members.find(member => member.id !== double.localHumanId);
    this.dateTarget.userData.actorId = localDate?.id;
    if (otherDate && this.otherDateId !== otherDate.dateId) {
      if (this.otherDate) { this.scene.remove(this.otherDate.root); this.disposeTarget(this.otherDateTarget); this.otherDate.dispose(); }
      this.otherDate = new RestaurantActor(otherDate.dateId); this.otherDateId = otherDate.dateId;
      this.otherDateTarget = this.createActorTarget(this.otherDate, otherDate.id);
      prepareCharacterLighting(this.otherDate.root, this.characterEnvironment.texture);
      this.scene.add(this.otherDate.root);
      this.requestWarmup();
    }
    if (!this.friend) {
      this.friend = new RestaurantActor('friend'); this.friendTarget = this.createActorTarget(this.friend);
      prepareCharacterLighting(this.friend.root, this.characterEnvironment.texture);
      this.scene.add(this.friend.root);
      this.requestWarmup();
    }
    const playing = this.presentation !== 'selection' && state.phase !== 'ended';
    this.date.root.visible = !(playing && localDate?.departed);
    if (this.otherDate) this.otherDate.root.visible = !!otherDate && (this.presentation === 'selection' || !otherDate.departed);
    if (this.otherDateTarget) this.otherDateTarget.userData.actorId = otherDate?.id;
    this.friend.root.visible = !!otherHuman?.connected;
    if (this.friendTarget) this.friendTarget.userData.actorId = otherHuman?.id;
  }

  private updateDoubleActors(dt: number, state: DinnerState, playback: AudioPlayback, preview = false) {
    const double = state.doubleDate;
    if (!double) return;
    const otherDate = double.dates.find(date => date.humanId !== double.localHumanId);
    const otherHuman = double.members.find(member => member.id !== double.localHumanId);
    const speaker = playback.actorId ?? double.speakingActor;
    const speakerPosition = speaker === double.localHumanId ? this.camera.position
      : speaker === otherHuman?.id ? this.friend?.root.position
      : speaker === otherDate?.id ? this.otherDate?.root.position
      : speaker === double.dates.find(date => date.humanId === double.localHumanId)?.id ? this.date.root.position
      : undefined;
    const gazeAt = speakerPosition ? new THREE.Vector3(speakerPosition.x, 1.3, speakerPosition.z) : this.camera.position;
    const partnerGaze = otherHuman ? new THREE.Vector3(preview ? (otherHuman.id === 'h1' ? -.57 : .57) : otherHuman.position[0], 1.3, preview ? .2 : otherHuman.position[2]) : this.camera.position;
    if (otherDate && this.otherDate) {
      const actor = this.otherDate;
      if (!preview && double.otherView && ['privacy-break', 'cleanup-break'].includes(double.otherView.evening.scenarioCare?.presence ?? 'at-table')) actor.root.visible = false;
      const previous = actor.root.position.clone();
      const position = preview ? (otherDate.id === 'd1' ? [-.57, 0, -2.5] : [.57, 0, -2.5]) : otherDate.position;
      actor.root.position.lerp(new THREE.Vector3(...position as [number, number, number]), preview ? 1 : 1 - Math.exp(-dt * 9));
      const seated = preview || otherDate.seated;
      actor.setSeated(seated);
      const speed = !seated && dt > 0 ? actor.root.position.distanceTo(previous) / dt : 0;
      const facing = seated ? 0 : speed > .12 ? Math.atan2(actor.root.position.x - previous.x, actor.root.position.z - previous.z) : Math.atan2(this.camera.position.x - actor.root.position.x, this.camera.position.z - actor.root.position.z);
      actor.root.rotation.y += Math.atan2(Math.sin(facing - actor.root.rotation.y), Math.cos(facing - actor.root.rotation.y)) * (preview ? 1 : 1 - Math.exp(-dt * 5));
      if (this.otherDateTarget) this.otherDateTarget.position.y = seated ? 1.15 : 1.4;
      const speaking = playback.actorId === otherDate.id || (!playback.actorId && playback.speaker === 'other-date');
      const listening = this.listeningFor(otherDate.id, state, playback, otherDate.emotion, otherDate.stance, double.otherView ?? state);
      const resting = listening && listening.cue !== 'attentive' ? listening.emotion : otherDate.emotion;
      actor.update(this.time, dt, speaking ? playback.emotion : resting, speaking, speaking ? playback.amplitude : 0, speaking || listening ? this.camera.position : speakerPosition ? gazeAt : partnerGaze, speed, { stance: otherDate.stance, attentive: !!listening, reducedMotion: this.reducedMotion.matches });
    }
    if (otherHuman && this.friend) {
      const actor = this.friend;
      const previous = actor.root.position.clone();
      const position = preview ? (otherHuman.id === 'h1' ? [-.57, 0, .2] : [.57, 0, .2]) : otherHuman.position;
      actor.root.position.lerp(new THREE.Vector3(position[0], 0, position[2]), preview ? 1 : 1 - Math.exp(-dt * 12));
      const seated = preview || otherHuman.seated;
      actor.setSeated(seated);
      const speed = !seated && dt > 0 ? actor.root.position.distanceTo(previous) / dt : 0;
      const facing = seated ? Math.PI : Math.PI - otherHuman.yaw;
      actor.root.rotation.y += Math.atan2(Math.sin(facing - actor.root.rotation.y), Math.cos(facing - actor.root.rotation.y)) * (preview ? 1 : 1 - Math.exp(-dt * 5));
      if (this.friendTarget) this.friendTarget.position.y = seated ? 1.15 : 1.4;
      const friendGaze = !speakerPosition && this.otherDate ? new THREE.Vector3(this.otherDate.root.position.x, 1.3, this.otherDate.root.position.z) : gazeAt;
      actor.update(this.time, dt, 'neutral', false, 0, speaker === otherHuman.id ? this.camera.position : friendGaze, speed);
    }
  }

  setDate(dateId: DateId) {
    if (dateId === this.dateId) return;
    this.listeningPreview = null;
    this.dateId = dateId;
    const old = this.date;
    const position = old.root.position.clone();
    const rotation = old.root.rotation.y;
    this.scene.remove(old.root);
    this.disposeTarget(this.dateTarget);
    old.dispose();
    this.date = new RestaurantActor(dateId);
    prepareCharacterLighting(this.date.root, this.characterEnvironment.texture);
    this.date.root.position.copy(position);
    this.date.root.rotation.y = rotation;
    this.date.setSeated(this.lastSeated);
    this.dateTarget = this.createDateTarget();
    this.scene.add(this.date.root);
    this.requestWarmup();
  }

  look(dx: number, dy: number) {
    if (this.presentation === 'selection') return;
    this.focusTransition = 0;
    this.yaw += dx * .002;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * .002, -1.2, 1.13);
  }

  getYaw() { return this.yaw; }

  getMovement(horizontal: number, forward: number) {
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    return { x: horizontal * cos + forward * sin, z: horizontal * sin - forward * cos };
  }

  update(dt: number, state: DinnerState, playback: AudioPlayback) {
    if (this.disposed) return;
    dt = Math.min(Math.max(dt, 0), .1);
    this.time += dt;
    this.sceneMatricesFresh = false;
    this.centerInteraction = null;
    if (state.phase !== 'playing') this.listeningPreview = null;
    this.set.update(this.time, this.reducedMotion.matches);
    this.lighting.update(state, dt, this.time, this.reducedMotion.matches, this.presentation === 'gameplay');
    if (state.dateId !== this.dateId) this.setDate(state.dateId);
    this.syncDoubleActors(state);
    if (!this.compiled) return;
    if (this.presentation === 'selection') { this.renderSelection(dt, state); return; }
    const diningOffset = diningOffsetZ(state), movedTables = this.lastDiningOffset !== diningOffset;
    this.lastDiningOffset = diningOffset;
    this.set.diningRoot.position.z = diningOffset;
    this.table.root.position.z = diningOffset;
    this.placeSettingShadows.mesh.position.z = diningOffset;
    const seatTarget = this.set.targets.find(target => target.userData.target === 'seat');
    const seatX = state.doubleDate ? (state.doubleDate.localHumanId === 'h1' ? -.57 : .57) : 0;
    if (seatTarget) seatTarget.position.set(seatX, .61, state.doubleDate ? .2 : .1);
    this.set.updateTabletop(state, dt, this.reducedMotion.matches);
    const human = state.participants.find(participant => participant.kind === 'human');
    const companion = state.participants.find(participant => participant.kind === 'ai');
    if (human) {
      this.cameraTarget.set(human.position[0], state.seated ? RESTAURANT.seat[1] : RESTAURANT.spawn[1], human.position[2]);
    } else this.cameraTarget.set(...RESTAURANT.spawn);
    if (state.id !== this.lastRoom) {
      this.listeningPreview = null;
      this.lastRoom = state.id;
      this.camera.position.copy(this.cameraTarget);
      this.yaw = 0;
      this.pitch = state.seated ? -.095 : -.025;
      if (companion) this.date.root.position.set(companion.position[0], 0, companion.position[2]);
    }
    if (state.seated !== this.lastSeated) {
      this.lastSeated = state.seated;
      this.yaw = 0;
      this.pitch = state.seated ? -.095 : -.025;
    }
    // Keep the doorway two-shot when the player's farewell becomes a keepsake.
    const focus = state.phase === 'ended' ? 'farewell' : this.tableFocus;
    if (!state.seated || state.phase !== 'playing' || focus) this.inspectionTarget = null;
    const inspecting = this.inspectionTarget ? this.inspectionObject() : undefined;
    if (inspecting) {
      inspecting.updateWorldMatrix(true, false);
      inspecting.getWorldPosition(this.inspectionAnchor);
    }
    this.farewellLight.intensity = focus === 'farewell' ? 2 : 0;
    if (focus === 'farewell' && companion) this.farewellLight.position.set(companion.position[0] - .3, 2.05, companion.position[2] - 1.2);
    const fov = inspecting ? 40 : state.doubleDate && state.seated ? 57 : state.seated || focus === 'farewell' ? 43 : 61;
    if (Math.abs(this.camera.fov - fov) > .01) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, 1 - Math.exp(-dt * 12));
      this.camera.updateProjectionMatrix();
    }
    if (state.seated) {
      if (state.doubleDate) { this.cameraTarget.y += .075; this.cameraTarget.z -= .06; }
      else { this.cameraTarget.x += .51; this.cameraTarget.y += .075; this.cameraTarget.z -= .28; }
    }
    if (focus === 'farewell' && companion) {
      this.cameraTarget.set(companion.position[0] + .55, 1.56, companion.position[2] - 1.65);
    }
    if (inspecting) {
      const radius = THREE.MathUtils.clamp(Number(inspecting.userData.inspectRadius) || .19, .09, .4);
      this.inspectionOffset.set(.035, Math.max(.36, radius * 3.6), Math.max(.26, radius * 2.4));
      this.cameraTarget.copy(this.inspectionAnchor).add(this.inspectionOffset);
    }
    if (movedTables && state.seated) this.camera.position.copy(this.cameraTarget);
    this.camera.position.lerp(this.cameraTarget, this.reducedMotion.matches && (focus || inspecting) ? 1 : 1 - Math.exp(-dt * 14));
    this.camera.rotation.set(this.pitch, -this.yaw + (state.seated && !state.doubleDate ? .245 : 0), 0, 'YXZ');
    if (focus === 'farewell' && companion) this.camera.lookAt(companion.position[0] + .47, 1.39, companion.position[2]);
    if (inspecting) this.camera.lookAt(this.inspectionAnchor);
    if (this.focusTransition > 0) {
      this.focusTransition = Math.max(0, this.focusTransition - dt * 5);
      this.camera.quaternion.slerp(this.previousView, this.focusTransition ** 2);
    }
    this.set.menu.visible = focus !== 'menu';
    const previousDateX = this.date.root.position.x;
    const previousDateZ = this.date.root.position.z;
    if (companion) {
      this.datePosition.set(companion.position[0], 0, companion.position[2]);
      this.date.root.position.lerp(this.datePosition, 1 - Math.exp(-dt * 9));
    }
    const evening = state.evening;
    const takingBreak = ['privacy-break', 'cleanup-break'].includes(evening.scenarioCare?.presence ?? 'at-table');
    if (state.phase === 'playing' && takingBreak) this.date.root.visible = false;
    else if (!state.doubleDate) this.date.root.visible = true;
    const foreignIncident = state.doubleDate?.incidentOwner && state.doubleDate.incidentOwner !== state.doubleDate.localHumanId;
    const serviceEvening = state.doubleDate?.role === 'wingman' || foreignIncident ? state.doubleDate?.otherView?.evening ?? evening : evening;
    const localDoubleDate = state.doubleDate?.dates.find(date => date.humanId === state.doubleDate?.localHumanId);
    const dateSeated = state.phase === 'ended' && evening.care.assistedExit || (localDoubleDate ? localDoubleDate.seated : !takingBreak && state.seated && evening.stance !== 'leaving' && !evening.farewell.ending && Math.hypot(this.date.root.position.x - RESTAURANT.dateSeat[0], this.date.root.position.z - RESTAURANT.dateSeat[2] - diningOffset) < .35);
    this.date.setSeated(dateSeated);
    const motionX = this.date.root.position.x - previousDateX;
    const motionZ = this.date.root.position.z - previousDateZ;
    const walkingSpeed = dt > 0 && state.phase === 'playing' && !dateSeated ? Math.hypot(motionX, motionZ) / dt : 0;
    const facing = dateSeated ? 0 : walkingSpeed > .12 ? Math.atan2(motionX, motionZ) : Math.atan2(this.camera.position.x - this.date.root.position.x, this.camera.position.z - this.date.root.position.z);
    const delta = Math.atan2(Math.sin(facing - this.date.root.rotation.y), Math.cos(facing - this.date.root.rotation.y));
    this.date.root.rotation.y += delta * (1 - Math.exp(-dt * 5));
    this.dateTarget.position.y = dateSeated ? 1.15 : 1.4;
    this.gaze.copy(this.camera.position);
    if (state.doubleDate) {
      const speaking = playback.actorId ?? state.doubleDate.speakingActor;
      const otherDate = state.doubleDate.dates.find(date => date.id === speaking);
      const otherHuman = state.doubleDate.members.find(member => member.id === speaking && member.id !== state.doubleDate?.localHumanId);
      if (otherDate && otherDate.humanId !== state.doubleDate.localHumanId) this.gaze.set(otherDate.position[0], 1.3, otherDate.position[2]);
      else if (otherHuman) this.gaze.set(otherHuman.position[0], 1.3, otherHuman.position[2]);
    }
    const restingEmotion = evening.stance === 'hurt' ? 'embarrassed' : evening.stance === 'guarded' ? 'defensive' : evening.stance === 'comfortable' && state.emotion === 'neutral' ? 'warm' : state.emotion;
    const dateSpeaking = playback.actorId ? playback.actorId === localDoubleDate?.id : playback.speaker === 'date';
    const listening = this.listeningFor(localDoubleDate?.id ?? 'date', state, playback, restingEmotion, evening.stance);
    if (listening) this.gaze.copy(this.camera.position);
    const firstImpression = listening && listening.cue !== 'attentive' ? listening.emotion : restingEmotion;
    this.date.update(this.time, dt, dateSpeaking ? playback.emotion : firstImpression, dateSpeaking, dateSpeaking ? playback.amplitude : 0, this.gaze, walkingSpeed, { stance: evening.stance, shared: evening.sharedActivities.length > 0, attentive: !!listening, reducedMotion: this.reducedMotion.matches });
    if (state.doubleDate) this.updateDoubleActors(dt, state, playback);
    const scenarioService = (state.doubleDate?.scenario ?? evening.scenario)?.effects.service;
    const serviceCues = [
      serviceEvening.main.status === 'served' ? 'main' : '',
      serviceEvening.dessert.status === 'served' ? 'dessert' : '',
      serviceEvening.bill.requested ? 'bill' : '',
      serviceEvening.incident?.event ?? '',
      serviceEvening.care.water.status !== 'none' ? `water-${serviceEvening.care.water.status}` : '',
      scenarioService && scenarioService !== 'none' ? `scenario-service-${scenarioService}` : '',
    ].filter(Boolean);
    if (state.id !== this.serviceRoom) {
      this.serviceRoom = state.id;
      this.serviceUntil = 0;
    } else if (serviceCues.some(cue => !this.lastServiceCues.includes(cue))) {
      this.serviceUntil = this.time + 7;
    }
    this.lastServiceCues = serviceCues;
    const serving = this.time < this.serviceUntil || playback.speaker === 'waiter' || serviceEvening.scenarioCare?.presence === 'staff-care' || state.doubleDate?.otherView?.evening.scenarioCare?.presence === 'staff-care';
    const waiterTarget = new THREE.Vector3(serving ? 1.14 : RESTAURANT.waiter[0], 0, serving ? -2.82 + diningOffset : RESTAURANT.waiter[2]);
    const waiterDistance = this.waiter.root.position.distanceTo(waiterTarget), waiterStep = Math.min(waiterDistance, state.phase === 'playing' ? dt * 1.1 : 0);
    const waiterDirection = waiterTarget.clone().sub(this.waiter.root.position).normalize();
    this.waiter.root.position.addScaledVector(waiterDirection, waiterStep);
    const waiterFacing = waiterDistance > .06 ? Math.atan2(waiterDirection.x, waiterDirection.z) : Math.atan2(this.gaze.x - this.waiter.root.position.x, this.gaze.z - this.waiter.root.position.z);
    this.waiter.root.rotation.y += Math.atan2(Math.sin(waiterFacing - this.waiter.root.rotation.y), Math.cos(waiterFacing - this.waiter.root.rotation.y)) * (1 - Math.exp(-dt * 4));
    const waiterEmotion = playback.speaker === 'waiter' ? playback.emotion : serviceEvening.incident?.event === 'spilled-drink' ? 'embarrassed' : 'neutral';
    this.waiter.update(this.time, dt, waiterEmotion, playback.speaker === 'waiter', playback.amplitude, this.gaze, dt > 0 ? waiterStep / dt : 0, { shared: serving, reducedMotion: this.reducedMotion.matches });
    const phoneActive = serviceEvening.incident?.event === 'disruptive-diner';
    this.diner.update(this.time, dt, playback.speaker === 'diner' ? playback.emotion : phoneActive ? 'annoyed' : 'neutral', playback.speaker === 'diner', playback.amplitude, this.gaze, 0, { phoneActive, reducedMotion: this.reducedMotion.matches });
    this.table.update(state);
    const windowTarget = this.table.targets.find(target => target.userData.target === 'window');
    if (windowTarget) windowTarget.position.z = -.8 - diningOffset;
    this.set.food.visible = false;
    this.set.bill.visible = serviceEvening.bill.requested;
    const spilled = serviceEvening.incident?.event === 'spilled-drink';
    this.set.spill.visible = spilled && serviceEvening.incident!.progress < 3;
    const spillSeatX = state.doubleDate ? (state.doubleDate.incidentOwner ?? state.doubleDate.localHumanId) === 'h1' ? -.57 : .57 : 0;
    this.set.spill.position.x = state.doubleDate ? spillSeatX + .1 - .37 : 0;
    this.set.spill.position.z = state.doubleDate ? .32 : 0;
    const remainingWater = spilled ? Math.max(.05, 1 - serviceEvening.incident!.progress / 3) : 1;
    this.set.spill.children[0]!.scale.set(remainingWater, remainingWater * .65, 1);
    this.renderScene();
  }

  private conversationActors(state: DinnerState): THREE.Mesh[] {
    const double = state.doubleDate;
    const local = double?.dates.find(date => date.humanId === double.localHumanId);
    const other = double?.dates.find(date => date.humanId !== double.localHumanId);
    const localAvailable = this.date.root.visible && scenePresenceAvailable(state) && double?.role !== 'wingman' && local?.stance !== 'leaving';
    const otherAvailable = this.otherDate?.root.visible && double?.otherView && scenePresenceAvailable(double.otherView) && other?.stance !== 'leaving';
    return [...(localAvailable ? [this.dateTarget] : []), ...(otherAvailable && this.otherDateTarget ? [this.otherDateTarget] : []), ...(this.friend?.root.visible && this.friendTarget ? [this.friendTarget] : [])];
  }

  getInteractionAt(state: DinnerState, clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    return this.getInteraction(state, new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2));
  }

  /** The camera may turn between frames; the rest of the scene only moves in update(). */
  private refreshRayMatrices() {
    this.camera.updateMatrixWorld();
    if (this.sceneMatricesFresh) return;
    this.scene.updateMatrixWorld(true);
    this.sceneMatricesFresh = true;
  }

  getInteraction(state: DinnerState, point = this.center): RestaurantInteraction | null {
    if (point !== this.center) return this.findInteraction(state, point);
    // The frame loop asks twice (touch prompt and crosshair); both get the same answer.
    const cached = this.centerInteraction;
    if (cached && cached.state === state) return cached.hit;
    const hit = this.findInteraction(state, point);
    this.centerInteraction = { state, hit };
    return hit;
  }

  private findInteraction(state: DinnerState, point: THREE.Vector2): RestaurantInteraction | null {
    if (this.disposed || this.presentation === 'selection' || state.phase !== 'playing') return null;
    const interactionEvening = state.doubleDate?.role === 'wingman' ? state.doubleDate.otherView?.evening ?? state.evening : state.evening;
    const seat = state.doubleDate ? DOUBLE_TABLE.seats[state.doubleDate.localHumanId] : RESTAURANT.seat;
    const humanPosition = state.doubleDate?.members.find(member => member.id === state.doubleDate?.localHumanId)?.position
      ?? state.participants.find(participant => participant.kind === 'human')?.position;
    const nearSeat = !!humanPosition && Math.hypot(humanPosition[0] - seat[0], humanPosition[2] - seat[2] - diningOffsetZ(state)) <= 2.1;
    const nearEntrance = !!humanPosition && Math.hypot(humanPosition[0] - RESTAURANT.entrance[0], humanPosition[2] - RESTAURANT.entrance[2]) <= RESTAURANT.entranceRadius;
    this.refreshRayMatrices();
    this.ray.setFromCamera(point, this.camera);
    const actors = this.conversationActors(state);
    const objects = [...this.set.targets.filter(target => {
      const name = target.userData.target;
      if (name === 'seat') return state.seated || nearSeat;
      if (name === 'exit') return nearEntrance;
      if (isInspectionTarget(name) && !state.seated) return false;
      if (name === 'plate' && state.evening.main.status === 'served') return false;
      if (!target.visible) return false;
      return name !== 'bill' || interactionEvening.bill.requested;
    }), ...this.table.targets.filter(target => (state.seated || target.userData.target === 'window') && target.visible), ...actors].filter(target => {
      let object: THREE.Object3D | null = target;
      while (object) { if (!object.visible) return false; object = object.parent; }
      return true;
    });
    const hits = this.ray.intersectObjects(objects, false);
    const hit = hits.find(candidate => candidate.distance < 2.8);
    if (hit) {
      const target = hit.object.userData.target as InteractionTarget;
      const labels: Record<InteractionTarget, string> = {
        seat: state.seated ? 'Stand up' : 'Take your seat',
        menu: state.order ? 'Look at the menu' : 'Read the menu',
        glass: state.evening.incident?.event === 'spilled-drink' ? 'Set the glass upright' : 'Take a sip',
        carafe: 'Pour some water', bread: 'Take a piece of bread', salt: 'Add a little salt', pepper: 'Grind some pepper',
        cutlery: 'Arrange your cutlery', lamp: 'Adjust the light', vase: 'Turn the flowers', plate: 'Turn your plate',
        date: `Talk to ${getDate(state.dateId)?.name ?? 'your date'}`,
        exit: 'Leave the restaurant',
        bill: 'Read the check',
        ticket: 'Check the order ticket',
        napkin: 'Wipe the spill',
        meal: state.evening.main.bites ? 'Another bite' : 'Try a bite',
        dessert: state.evening.dessert.bites ? 'Another spoonful' : 'Take a spoonful',
        'service-bell': interactionEvening.incident?.event === 'disruptive-diner' ? 'Ask for a little quiet' : interactionEvening.incident?.event === 'wrong-order' ? 'Ask for the right dish' : 'Ask for water',
        window: 'Watch the rain together',
      };
      const actorId = hit.object.userData.actorId as ConversationTarget | undefined;
      const actorName = state.doubleDate && actorId ? state.doubleDate.members.find(member => member.id === actorId)?.name ?? getDate(state.doubleDate.dates.find(date => date.id === actorId)?.dateId ?? state.dateId)?.name : undefined;
      const action = (target === 'napkin' || target === 'glass') && interactionEvening.incident?.event === 'spilled-drink' ? null : tableActionForTarget(target);
      const label = action ? tabletopActionAvailability(state, action).label : labels[target];
      return { target, label: actorName ? `Talk to ${actorName}` : label, ...(actorId ? { actorId } : {}) };
    }
    // Walking up to a chair should not require aiming at one tiny part of its upholstery.
    if (!state.seated) {
      const toSeat = new THREE.Vector3(seat[0], this.camera.position.y - .5, seat[2] + diningOffsetZ(state)).sub(this.camera.position);
      if (nearSeat && this.ray.ray.direction.dot(toSeat.normalize()) > .52) return { target: 'seat', label: 'Take your seat' };
    } else if (point === this.center && this.ray.ray.direction.y < -.88) return { target: 'seat', label: 'Stand up' };
    return null;
  }

  /** Attribute speech to the person in the crosshair; otherwise address the table. */
  getConversationTarget(state: DinnerState): ConversationTarget {
    if (!state.doubleDate || this.presentation === 'selection') return 'table';
    this.refreshRayMatrices();
    this.ray.setFromCamera(this.center, this.camera);
    const actors = this.conversationActors(state);
    const hit = this.ray.intersectObjects(actors, false).find(candidate => candidate.distance < 4);
    return hit?.object.userData.actorId as ConversationTarget | undefined ?? 'table';
  }

  resize() {
    if (this.disposed) return;
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || window.innerWidth));
    const height = Math.max(1, Math.round(rect.height || window.innerHeight));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.listeningPreview = null;
    this.cancelWarmup();
    this.resizeObserver.disconnect();
    this.disposeTarget(this.dateTarget);
    this.disposeTarget(this.otherDateTarget); this.disposeTarget(this.friendTarget);
    this.otherDate?.dispose(); this.friend?.dispose();
    this.date.dispose();
    this.waiter.dispose();
    this.diner.dispose();
    this.set.dispose();
    this.table.dispose();
    this.placeSettingShadows.dispose();
    this.lighting.dispose();
    const renderer = this.renderer, pending = this.warmupTask;
    const disposeRenderer = () => { this.characterEnvironment.dispose(); renderer.dispose(); };
    if (pending) void pending.then(disposeRenderer); else disposeRenderer();
    this.canvas.removeEventListener('webglcontextrestored', this.restoreCharacterEnvironment);
    this.canvas.remove();
    this.scene.clear();
  }
}

