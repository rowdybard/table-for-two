import * as THREE from 'three';
import type { ObjectState, PlayerId, RoomState } from '../shared/protocol';
import { VENUE } from '../shared/venue';

type Visual = { root: THREE.Group; target: THREE.Vector3; rotation: THREE.Quaternion; label?: THREE.Sprite; limbs?: THREE.Group[]; last: THREE.Vector3 };

/** A presentation adapter for the authoritative room simulation. */
export class VenueRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, .1, 100);
  private readonly visuals = new Map<string, Visual>();
  private readonly names = new Map<string, string>();
  private readonly resizeObserver: ResizeObserver;
  private readonly clockCanvas = document.createElement('canvas');
  private readonly clockTexture: THREE.CanvasTexture;
  private clockMinute = -1;
  private elapsed = 0;
  private localId: PlayerId = 'p1';
  private yaw = 1.75;
  private activityFocus: 'bowling' | 'claw' | null = null;
  private readonly clawVisual = new THREE.Group();
  private ballTarget = new THREE.Vector3(-9, .3, .5);
  private ballMoving = false;
  private clawOperators = new Set<PlayerId>();
  private endingPhase: RoomState['ending']['phase'] = 'waiting';
  private endingTime = 0;
  private readonly confetti = new THREE.Group();
  private readonly friendLabels: THREE.Sprite[] = [];
  private zoom = 7.3;
  private cameraFocus = new THREE.Vector3(0, 1.2, 10);
  private inputEnabled = true;
  private dragging = false;
  private disposed = false;
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute('aria-label', 'A shared New Year’s Eve bowling alley');
    Object.assign(this.canvas.style, { width: '100%', height: '100%', display: 'block', touchAction: 'none' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.camera.position.set(4, 3.4, 10.5);
    this.camera.lookAt(0, 1.3, -5);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.canvas);
    this.scene.background = new THREE.Color('#211714');
    this.scene.fog = new THREE.Fog('#382822', 30, 57);
    this.scene.add(new THREE.HemisphereLight('#ffe5c1', '#463029', 2.0));
    const light = new THREE.DirectionalLight('#ffe0ad', 2.4);
    light.position.set(-8, 14, 8); light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    Object.assign(light.shadow.camera, { left: -19, right: 19, top: 19, bottom: -19, near: 1, far: 45 });
    light.shadow.bias = -.0004;
    this.scene.add(light);
    this.clockCanvas.width = 512; this.clockCanvas.height = 256;
    this.clockTexture = new THREE.CanvasTexture(this.clockCanvas);
    this.clockTexture.colorSpace = THREE.SRGBColorSpace;
    this.buildVenue();
    this.drawClock(VENUE.startTime);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.canvas.addEventListener('pointerdown', this.pointerDown);
    window.addEventListener('pointermove', this.pointerMove);
    window.addEventListener('pointerup', this.pointerUp);
    this.canvas.addEventListener('contextmenu', this.contextMenu);
    this.canvas.addEventListener('wheel', this.wheel, { passive: false });
  }

  private mat(color: string, roughness = .75, metalness = 0) {
    const key = `${color}:${roughness}:${metalness}`;
    let m = this.materials.get(key);
    if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness, metalness }); this.materials.set(key, m); }
    return m;
  }
  private box(x: number, y: number, z: number, w: number, h: number, d: number, color: string, parent: THREE.Object3D = this.scene, roughness = .75, metalness = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.mat(color, roughness, metalness));
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  private sphere(x: number, y: number, z: number, radius: number, color: string, parent: THREE.Object3D = this.scene, scale?: [number, number, number]) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), this.mat(color));
    mesh.position.set(x, y, z); if (scale) mesh.scale.set(...scale); mesh.castShadow = true; parent.add(mesh); return mesh;
  }
  private cylinder(x: number, y: number, z: number, top: number, bottom: number, height: number, color: string, parent: THREE.Object3D = this.scene) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, 16), this.mat(color));
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  private textTexture(text: string, sub = '') {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#3b211b'; c.fillRect(0, 0, 1024, 256);
    c.strokeStyle = '#c6a36b'; c.lineWidth = 8; c.strokeRect(12, 12, 1000, 232);
    c.textAlign = 'center'; c.fillStyle = '#f4dfb3'; c.font = 'bold 100px Georgia, serif'; c.fillText(text, 512, sub ? 123 : 158, 960);
    if (sub) { c.font = '30px Georgia, serif'; c.letterSpacing = '6px'; c.fillText(sub, 512, 185, 920); }
    const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  private wallSign(text: string, sub: string, x: number, y: number, z: number, w: number, rotation = 0) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: this.textTexture(text, sub), side: THREE.DoubleSide }));
    plane.position.set(x, y, z); plane.rotation.y = rotation; this.scene.add(plane);
  }
  private label(text: string, _width = 2.1) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128; const c = canvas.getContext('2d')!;
    c.fillStyle = 'rgba(40,24,20,.88)'; c.beginPath(); c.roundRect(4, 14, 504, 100, 30); c.fill();
    c.strokeStyle = '#b7955b'; c.lineWidth = 3; c.stroke(); c.fillStyle = '#fff0d3'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 36px Georgia'; c.fillText(text, 256, 64, 475);
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, sizeAttenuation: false })); sprite.scale.set(.20, .05, 1); sprite.renderOrder = 10; return sprite;
  }
  private carpet() {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128; const c = canvas.getContext('2d')!;
    c.fillStyle = '#4a2929'; c.fillRect(0, 0, 128, 128); c.strokeStyle = '#69413c'; c.lineWidth = 3;
    for (let x = -64; x <= 192; x += 64) for (let y = -64; y <= 192; y += 64) { c.beginPath(); c.moveTo(x, y - 26); c.lineTo(x + 26, y); c.lineTo(x, y + 26); c.lineTo(x - 26, y); c.closePath(); c.stroke(); c.fillStyle = '#a17a57'; c.beginPath(); c.arc(x, y, 2, 0, Math.PI * 2); c.fill(); }
    const t = new THREE.CanvasTexture(canvas); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(17, 15); t.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(34, 30), new THREE.MeshStandardMaterial({ map: t, roughness: 1 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);
  }
  private buildVenue() {
    this.carpet();
    // The room is fully enclosed. The doors and glazing are set into the entrance wall.
    this.box(0, 5.85, 0, 34, .3, 30, '#c7b49b');
    this.box(0, 2.75, -14.85, 34, 5.5, .3, '#d6c4a8');
    this.box(-16.85, 2.75, 0, .3, 5.5, 30, '#d6c4a8');
    this.box(16.85, 2.75, 0, .3, 5.5, 30, '#d6c4a8');
    // Front entry has real openings framed by a transom and tall glazing.
    this.box(-10.8, 2.75, 14.85, 12.4, 5.5, .3, '#d6c4a8');
    this.box(10.8, 2.75, 14.85, 12.4, 5.5, .3, '#d6c4a8');
    this.box(0, 4.9, 14.85, 9.2, 1.2, .3, '#d6c4a8');
    this.box(0, 2.1, 14.94, 9.2, 4.2, .08, '#29332e');
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(9.1, 4.05), new THREE.MeshStandardMaterial({ color: '#a4b0a0', transparent: true, opacity: .22, roughness: .12, metalness: .2, side: THREE.DoubleSide }));
    glass.position.set(0, 2.1, 14.7); this.scene.add(glass);
    for (const x of [-3.6, -1.2, 1.2, 3.6]) { const glint = this.box(x, 2.8, 14.66, .025, 1.7, .01, '#b4b4a0'); glint.rotation.z = -.25; }
    for (const x of [-4.55, -2.35, 0, 2.35, 4.55]) this.box(x, 2.1, 14.76, .09, 4.2, .16, '#9f8558');
    this.box(0, 4.15, 14.76, 9.2, .1, .16, '#9f8558');
    for (const x of [-.3, .3]) this.box(x, 1.15, 14.68, .045, .55, .1, '#d0ac6c');
    // Walnut wainscot, vertical stiles, and mouldings give the walls a human scale.
    for (const z of [-14.65, 14.65]) {
      if (z < 0) this.box(0, .8, z, 33.6, 1.6, .08, '#503022');
      else for (const x of [-10.8, 10.8]) this.box(x, .8, z, 12, 1.6, .08, '#503022');
      for (let x = -16; x <= 16; x += 1.6) if (z < 0 || Math.abs(x) > 4.6) this.box(x, .8, z + (z < 0 ? .06 : -.06), .045, 1.48, .05, '#8d633e');
      for (const y of [.12, 1.58, 5.45]) this.box(0, y, z, 33.6, .12, .14, '#795333');
    }
    for (const x of [-16.65, 16.65]) {
      this.box(x, .8, 0, .08, 1.6, 29.2, '#503022');
      for (let z = -14; z <= 14; z += 1.6) this.box(x + (x < 0 ? .06 : -.06), .8, z, .05, 1.48, .045, '#8d633e');
      for (const y of [.12, 1.58, 5.45]) this.box(x, y, 0, .14, .12, 29.2, '#795333');
    }
    // Lane and approach: plank seams, gutters, arrows, foul line, return and seating.
    this.box(-9, .025, -6.1, 4.1, .05, 13.4, '#dba76c');
    this.box(-9, .025, 2.3, 4.1, .05, 3.5, '#c68f58');
    for (let x = -10.95; x < -7; x += .22) this.box(x, .056, -4.4, .012, .006, 16.7, '#ac774b');
    this.box(-9, .065, .55, 4.1, .015, .1, '#563c2c');
    for (const x of [-11.1, -6.9]) { this.box(x, .25, -6.1, .3, .5, 13.4, '#6d4930'); this.box(x, .52, -6.1, .34, .05, 13.4, '#a77b4c'); }
    for (let x = -10.4; x <= -7.6; x += .7) { const arrow = this.box(x, .068, -2, .12, .01, .38, '#75472e'); arrow.rotation.y = Math.PI / 4; }
    this.box(-5.95, .52, 1.0, .8, .65, 2.3, '#594034');
    this.box(-5.95, .87, 1.0, .83, .12, 2.3, '#bb9c6d');
    for (let i = 0; i < 3; i++) this.sphere(-5.95, 1.05, .25 + i * .7, .27, ['#6e332b', '#393c36', '#be8950'][i]);
    for (let x = -12; x <= -7; x += 2.5) { this.cylinder(x, .28, 4.1, .12, .22, .55, '#a98a5b'); this.cylinder(x, .58, 4.1, .52, .52, .14, '#853b31'); }
    this.wallSign('THE LANES', 'GOOD COMPANY · GOOD ROLLS', -9, 4.45, -14.65, 6);
    // Pool table, built around its server-side footprint.
    this.box(-9, .83, 6.5, 5.9, 1.35, 3.3, '#513124'); this.box(-9, 1.56, 6.5, 5.75, .13, 3.15, '#a77a49');
    this.box(-9, 1.64, 6.5, 5.35, .05, 2.75, '#3f6045');
    for (const x of [-11.65, -6.35]) for (const z of [5.15, 7.85]) this.cylinder(x, 1.69, z, .15, .15, .05, '#261b17');
    for (const [x, z, color] of [[-10, 6.2, '#f2dfbf'], [-9.4, 6.9, '#a5382d'], [-8.8, 6.3, '#cba75e'], [-7.9, 6.8, '#343d31']] as const) this.sphere(x, 1.75, z, .12, color);
    // Arcade: individual cabinets, bezels, marquees, controls, and prize case.
    for (let i = 0; i < 3; i++) {
      const x = 8.4 + i * 1.6;
      this.box(x, 1.3, -8, 1.48, 2.6, 2.25, ['#593526', '#744234', '#4e3c2c'][i]);
      this.box(x, 2.16, -6.84, 1.28, .35, .08, '#c8a671');
      this.wallSign(['STAR BOWL', 'HIGH SCORE', 'LUCKY STRIKE'][i], '', x, 2.16, -6.78, 1.23);
      this.box(x, 1.6, -6.8, 1.1, .8, .06, '#171c19');
      this.box(x, 1.6, -6.75, .85, .55, .025, ['#8c6742', '#755d40', '#887944'][i]);
      this.box(x, 1.06, -6.7, 1.2, .16, .45, '#c09b68');
      this.sphere(x - .25, 1.19, -6.5, .07, '#452b22'); this.sphere(x + .15, 1.17, -6.48, .05, '#9a342a'); this.sphere(x + .33, 1.17, -6.48, .05, '#d1ad66');
      this.box(x, .45, -6.82, .45, .42, .08, '#261e19');
    }
    this.wallSign('THE ARCADE', 'PLAY A LITTLE LONGER', 10, 4.5, -14.64, 5);
    this.box(10, .75, -3.6, 2.5, 1.5, 2.2, '#6c3d2d');
    this.box(10, 4.2, -4.6, 2.5, .22, .2, '#6c3d2d');
    for (const x of [8.85, 11.15]) for (const z of [-4.6, -2.6]) this.box(x, 3.0, z, .12, 3.0, .12, '#be9b62');
    this.box(10, 2.8, -4.62, 2.25, 2.6, .06, '#7a7057');
    for (let i = 0; i < 5; i++) { const x = 9.2 + i * .4; this.sphere(x, 1.72, -3.1 - (i % 2) * .5, .22, ['#c59962', '#8d5542', '#e1c48c', '#746c4a', '#b9704b'][i]); }
    this.cylinder(0, .25, 0, .035, .035, .5, '#c3a06c', this.clawVisual);
    this.cylinder(0, 0, 0, .1, .1, .14, '#c3a06c', this.clawVisual);
    for (const dx of [-.2, .2]) { const claw = this.box(dx, -.22, 0, .07, .48, .07, '#c3a06c', this.clawVisual); claw.rotation.z = dx * 1.8; }
    this.clawVisual.position.set(10, 3.8, -3.6); this.scene.add(this.clawVisual);
    this.wallSign('THE PRIZE DROP', '', 10, 4.65, -2.47, 2.2);
    // The gold ring marks the capture position; the open side tray marks the alternate exit.
    const targetRing = new THREE.Mesh(new THREE.RingGeometry(.46, .52, 40), this.mat('#d3ae68', .45, .5));
    targetRing.rotation.x = -Math.PI / 2; targetRing.position.set(10, 1.515, -3.6); this.scene.add(targetRing);
    this.box(7.9, 1.47, -3.05, 1.55, .1, 1.35, '#9d784a');
    this.box(7.9, 1.53, -3.05, 1.25, .03, 1.05, '#332820');
    const exitRing = new THREE.Mesh(new THREE.RingGeometry(.38, .46, 40), this.mat('#e5bd71', .4, .5));
    exitRing.rotation.x = -Math.PI / 2; exitRing.position.set(7.9, 1.55, -3.05); this.scene.add(exitRing);
    this.wallSign('EXIT', '', 7.9, 1.78, -2.49, 1.1);
    for (const z of [-3.55, -2.55]) this.box(8.65, 1.59, z, 1.5, .12, .08, '#c49b5e');
    // Oxblood booth seating, tabletop and small table lamp.
    for (const x of [7.5, 12]) {
      this.box(x, .5, 7.2, 1.3, .65, 4.4, '#6b2828'); this.box(x, 1.2, 7.2, .38, 1.4, 4.4, '#642526');
      for (let z = 5.35; z < 9.2; z += .55) this.box(x, 1.25, z, .4, 1.15, .035, '#9c4a3b');
    }
    this.box(9.75, .58, 7.2, .25, 1.15, .25, '#866343'); this.box(9.75, 1.17, 7.2, 2.5, .13, 2.9, '#8a5936');
    this.cylinder(9.75, 1.3, 7.2, .1, .15, .2, '#c8a56e'); this.cylinder(9.75, 1.55, 7.2, .23, .37, .36, '#e7c98f');
    this.wallSign('THE LOUNGE', 'STAY FOR MIDNIGHT', 16.64, 3.6, 7, 4, -Math.PI / 2);
    // Welcome desk and shoe cubbies, facing the room.
    this.box(0, .7, 13.7, 5.6, 1.4, 1.3, '#5f3928'); this.box(0, 1.43, 13.7, 5.8, .12, 1.4, '#bc9465');
    for (let x = -2.4; x <= 2.4; x += .6) this.box(x, .72, 13.01, .04, 1.2, .05, '#98704a');
    this.wallSign('WELCOME', 'SHOES · SCORES · GOOD TIMES', 0, 3.45, 14.68, 4.7, Math.PI);
    // Pendants and brass New Year decorations.
    for (const x of [-13, -5, 3, 11]) for (const z of [-10, 0, 10]) {
      this.cylinder(x, 5.18, z, .025, .025, 1.3, '#8a7252');
      this.cylinder(x, 4.48, z, .17, .48, .35, '#bb9a65'); this.sphere(x, 4.29, z, .18, '#ffe4a9');
    }
    for (let x = -15; x <= 15; x += 1.5) {
      const star = this.sphere(x, 4.9 + Math.sin(x) * .15, -14.42, .085, '#d3af6b'); star.scale.set(1, 1.7, .4);
    }
    // Framed print panels and brass wall lights break up the plaster at eye level.
    for (const z of [-9, -4, 1, 6, 11]) {
      this.box(-16.62, 3.0, z, .1, 1.55, 1.2, '#60412d');
      this.box(-16.55, 3.0, z, .03, 1.35, 1.0, '#c5a77a');
      this.box(-16.52, 2.9, z, .02, .78, .7, '#845842');
      this.cylinder(16.55, 3.05, z, .1, .25, .35, '#b4935f');
      this.sphere(16.5, 3.3, z, .12, '#f3d59d');
    }
    this.wallSign('HAPPY NEW YEAR', 'TONIGHT IS OURS', 0, 4.55, -14.64, 6.2);
    const clock = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: this.clockTexture })); clock.position.set(0, 3.15, -14.63); this.scene.add(clock);
    // Gold paper pieces are hidden until the shared midnight outcome.
    for (let i = 0; i < 54; i++) {
      const bit = this.box((i * 2.73) % 18 - 9, 2 + (i * .37) % 3, (i * 3.17) % 14 - 7, .1, .04, .16, i % 3 === 0 ? '#f1dab0' : '#c49c56', this.confetti);
      bit.rotation.set(i * .37, i * .81, i * .51);
    }
    this.confetti.visible = false; this.scene.add(this.confetti);
    this.npc(-2.4, 9.1, '#b97854', '#52372a', 'MIRA · FRIEND');
    this.npc(5.2, 5, '#5e6c50', '#2e2520', 'DEV · FRIEND');
  }
  private character(coat: string, skin: string, hair: string) {
    const root = new THREE.Group();
    const trousers = '#3e3931';
    // Torso, collar and head are built as separate volumes with articulated limbs.
    this.sphere(0, 1.12, 0, .34, coat, root, [1.08, 1.35, .6]);
    this.box(0, .84, 0, .54, .18, .34, coat, root);
    this.cylinder(0, 1.48, 0, .11, .12, .18, skin, root);
    this.sphere(0, 1.69, 0, .245, skin, root, [1, 1.15, .9]);
    this.sphere(0, 1.86, -.025, .245, hair, root, [1.04, .66, .93]);
    this.sphere(-.20, 1.68, -.03, .07, skin, root); this.sphere(.20, 1.68, -.03, .07, skin, root);
    this.sphere(-.085, 1.72, .207, .022, '#29231e', root); this.sphere(.085, 1.72, .207, .022, '#29231e', root);
    this.box(0, 1.61, .215, .09, .018, .01, '#944e43', root);
    this.box(-.14, 1.37, .17, .16, .13, .03, '#e4cfaa', root).rotation.z = -.35;
    this.box(.14, 1.37, .17, .16, .13, .03, '#e4cfaa', root).rotation.z = .35;
    const limbs: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group(); arm.position.set(side * .34, 1.32, 0); root.add(arm);
      this.sphere(0, -.24, 0, .13, coat, arm, [1, 2.1, .9]); this.sphere(0, -.51, 0, .105, skin, arm, [1, 1.2, .8]); limbs.push(arm);
      const leg = new THREE.Group(); leg.position.set(side * .16, .8, 0); root.add(leg);
      this.sphere(0, -.31, 0, .16, trousers, leg, [.9, 2.2, .9]); this.box(0, -.69, .075, .25, .16, .42, '#28231e', leg); limbs.push(leg);
    }
    return { root, limbs };
  }
  private npc(x: number, z: number, coat: string, hair: string, name: string) {
    const { root } = this.character(coat, '#d8a17c', hair); root.position.set(x, 0, z); root.rotation.y = 2.3; this.scene.add(root);
    const label = this.label(name, 2.3); label.position.set(x, 2.3, z); this.scene.add(label); this.friendLabels.push(label);
  }
  private makeObject(object: ObjectState) {
    const root = new THREE.Group();
    if (object.kind === 'pin') {
      const points = [[0, -.4], [.11, -.4], [.15, -.3], [.14, -.1], [.085, .12], [.09, .23], [.12, .3], [.09, .39], [0, .4]];
      const mesh = new THREE.Mesh(new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), 16), this.mat('#f2e9d8')); mesh.castShadow = true; root.add(mesh);
      this.cylinder(0, .18, 0, .093, .09, .075, '#a3302b', root);
    } else {
      const radius = object.kind === 'ball' ? .3 : object.kind === 'claw-prize' ? .35 : object.kind === 'giant-prize' ? .75 : .45;
      this.sphere(0, 0, 0, radius, object.kind === 'ball' ? '#70342b' : object.kind === 'giant-prize' ? '#c99a60' : '#d2ab72', root);
      if (object.kind === 'claw-prize' || object.kind === 'giant-prize') { this.sphere(-radius * .38, radius * .72, 0, radius * .25, '#aa7650', root); this.sphere(radius * .38, radius * .72, 0, radius * .25, '#aa7650', root); this.sphere(-radius * .25, radius * .12, radius * .9, radius * .07, '#2f2720', root); this.sphere(radius * .25, radius * .12, radius * .9, radius * .07, '#2f2720', root); }
      if (object.kind === 'ball') for (const x of [-.09, .09]) this.sphere(x, radius * .96, 0, .035, '#2b211d', root);
    }
    return root;
  }
  update(state: RoomState, localId: PlayerId, _dt: number) {
    this.localId = localId; this.drawClock(state.clockSeconds); const live = new Set<string>();
    if (state.ending && state.ending.phase !== this.endingPhase) { this.endingPhase = state.ending.phase; this.endingTime = 0; }
    if (state.claw) {
      this.clawVisual.position.set(state.claw.x, state.claw.y, state.claw.z);
      this.clawOperators = new Set([state.claw.operators.x, state.claw.operators.z].filter((id): id is PlayerId => id !== null));
    }
    const ball = state.objects.find(object => object.id === 'bowling-ball');
    if (ball) this.ballTarget.fromArray(ball.position);
    this.ballMoving = !state.lane.canBowl;
    for (const player of state.players) {
      const key = `player:${player.id}`; live.add(key); let visual = this.visuals.get(key);
      if (!visual) {
        const c = this.character(player.id === 'p1' ? '#a04b3a' : '#657454', player.id === 'p1' ? '#e0ab85' : '#af7656', player.id === 'p1' ? '#443026' : '#211d1b');
        c.root.position.set(player.position[0], player.position[1] - .8, player.position[2]); this.scene.add(c.root);
        visual = { root: c.root, target: c.root.position.clone(), rotation: c.root.quaternion.clone(), limbs: c.limbs, last: c.root.position.clone() }; this.visuals.set(key, visual);
      }
      visual.target.set(player.position[0], player.position[1] - .8, player.position[2]); visual.rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), player.rotation);
      const name = `${player.name}${player.id === localId ? ' · YOU' : ''}${player.connected ? '' : ' · AWAY'}`;
      if (this.names.get(key) !== name) { if (visual.label) { this.scene.remove(visual.label); this.disposeSprite(visual.label); } visual.label = this.label(name); this.scene.add(visual.label); this.names.set(key, name); }
    }
    for (const object of state.objects) {
      const key = `object:${object.id}`; live.add(key); let visual = this.visuals.get(key);
      if (!visual) { const root = this.makeObject(object); root.position.fromArray(object.position); root.quaternion.fromArray(object.rotation); this.scene.add(root); visual = { root, target: root.position.clone(), rotation: root.quaternion.clone(), last: root.position.clone() }; this.visuals.set(key, visual); }
      visual.target.fromArray(object.position); visual.rotation.fromArray(object.rotation);
    }
    for (const [key, visual] of this.visuals) if (!live.has(key)) { this.scene.remove(visual.root); this.disposeObject(visual.root); if (visual.label) { this.scene.remove(visual.label); this.disposeSprite(visual.label); } this.visuals.delete(key); this.names.delete(key); }
  }
  private drawClock(seconds: number) {
    const minutes = Math.floor(seconds / 60); if (minutes === this.clockMinute) return; this.clockMinute = minutes;
    const c = this.clockCanvas.getContext('2d')!; const hour = Math.floor(minutes / 60) % 24;
    c.fillStyle = '#35241c'; c.fillRect(0, 0, 512, 256); c.strokeStyle = '#c5a46b'; c.lineWidth = 12; c.strokeRect(10, 10, 492, 236);
    c.textAlign = 'center'; c.fillStyle = '#f6e3ba'; c.font = 'bold 36px Georgia'; c.fillText('NEW YEAR’S EVE', 256, 67);
    c.font = 'bold 105px Georgia'; c.fillText(`${hour % 12 || 12}:${String(minutes % 60).padStart(2, '0')}`, 256, 177); c.font = '28px Georgia'; c.fillText(hour < 12 ? 'AM' : 'PM', 256, 223); this.clockTexture.needsUpdate = true;
  }
  getMovementVector(horizontal: number, forward: number) {
    return { x: horizontal * Math.cos(this.yaw) + forward * Math.sin(this.yaw), z: -horizontal * Math.sin(this.yaw) + forward * Math.cos(this.yaw) };
  }
  setActivityFocus(focus: 'bowling' | 'claw' | null) { this.activityFocus = focus; }
  setInputEnabled(enabled: boolean) { this.inputEnabled = enabled; if (!enabled) this.dragging = false; }
  private pointerDown = (event: PointerEvent) => { if (this.inputEnabled && event.button === 2) { this.dragging = true; event.preventDefault(); } };
  private pointerMove = (event: PointerEvent) => { if (this.dragging && this.inputEnabled) this.yaw -= event.movementX * .005; };
  private pointerUp = () => { this.dragging = false; };
  private contextMenu = (event: MouseEvent) => { event.preventDefault(); };
  private wheel = (event: WheelEvent) => { if (this.inputEnabled) { event.preventDefault(); this.zoom = THREE.MathUtils.clamp(this.zoom + event.deltaY * .004, 5.2, 9); } };
  render(dt: number) {
    if (this.disposed) return; const step = Math.min(dt, .1); this.elapsed += step; this.endingTime += step;
    this.confetti.visible = (this.endingPhase === 'kiss' || this.endingPhase === 'celebration') && this.endingTime < 9;
    if (this.confetti.visible) this.confetti.children.forEach((bit, i) => { bit.position.y = 1.5 + ((i * .37 - this.endingTime * .48 + 12) % 4.4); bit.rotation.y += step * .5; });
    const blend = 1 - Math.exp(-step * 15);
    for (const [key, visual] of this.visuals) {
      const isLocal = key === `player:${this.localId}`;
      visual.root.visible = !(isLocal && this.activityFocus === 'bowling');
      if (visual.label) visual.label.visible = !(isLocal && this.activityFocus !== null);
      const distance = visual.root.position.distanceTo(visual.target); visual.root.position.lerp(visual.target, blend);
      const playerId = key.startsWith('player:') ? key.slice(7) as PlayerId : null;
      const facing = playerId && this.activityFocus === 'claw' && this.clawOperators.has(playerId)
        ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(10 - visual.root.position.x, -3.6 - visual.root.position.z))
        : visual.rotation;
      visual.root.quaternion.slerp(facing, blend);
      if (visual.label) visual.label.position.set(visual.root.position.x, visual.root.position.y + 2.27, visual.root.position.z);
      if (visual.limbs) { const walk = Math.min(1, distance * 8); visual.limbs.forEach((limb, index) => { const sign = index === 0 || index === 3 ? 1 : -1; limb.rotation.x = Math.sin(this.elapsed * 9) * .55 * walk * sign; }); }
    }
    const local = this.visuals.get(`player:${this.localId}`);
    const first = this.visuals.get('player:p1'), second = this.visuals.get('player:p2');
    const kissing = this.endingPhase === 'kiss' && this.endingTime < 5 && !!first && !!second;
    let kissCenter: THREE.Vector3 | undefined;
    if (kissing && first && second) {
      kissCenter = first.target.clone().add(second.target).multiplyScalar(.5);
      kissCenter.x = THREE.MathUtils.clamp(kissCenter.x, -13.5, 13.5); kissCenter.z = THREE.MathUtils.clamp(kissCenter.z, -12, 9.5);
      const approach = THREE.MathUtils.smoothstep(this.endingTime, 0, 1.5);
      const depart = 1 - THREE.MathUtils.smoothstep(this.endingTime, 3.8, 5);
      const amount = approach * depart;
      for (const [visual, side] of [[first, -1], [second, 1]] as const) {
        visual.root.visible = true; if (visual.label) visual.label.visible = false;
        const destination = kissCenter.clone().add(new THREE.Vector3(side * .25, 0, 0));
        visual.root.position.lerp(destination, amount);
        const facing = new THREE.Quaternion().setFromEuler(new THREE.Euler(.11 * amount, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0));
        visual.root.quaternion.slerp(facing, amount);
      }
    }
    if (local) {
      const focus = local.root.position.clone().add(new THREE.Vector3(0, 1.25, 0)); this.cameraFocus.lerp(focus, 1 - Math.exp(-step * 8));
      let target = this.cameraFocus.clone();
      let desired = target.clone().add(new THREE.Vector3(Math.sin(this.yaw) * this.zoom, 2.7, Math.cos(this.yaw) * this.zoom));
      if (this.activityFocus === 'bowling') {
        const ballZ = this.ballMoving ? Math.min(.5, this.ballTarget.z) : .5;
        desired = new THREE.Vector3(-9, 3.0, Math.min(5.0, ballZ + 5.3));
        target = new THREE.Vector3(-9, .6, ballZ - 3.5);
      } else if (this.activityFocus === 'claw') {
        desired = new THREE.Vector3(8.2, 5.0, 3.5); target = new THREE.Vector3(10.7, 2.25, -3.5);
      }
      if (kissing && kissCenter) {
        desired = kissCenter.clone().add(new THREE.Vector3(0, 2.4, 5.0));
        target = kissCenter.clone().add(new THREE.Vector3(0, 1.35, 0));
      }
      desired.x = THREE.MathUtils.clamp(desired.x, -16.2, 16.2); desired.z = THREE.MathUtils.clamp(desired.z, -14.2, 14.2); desired.y = Math.min(5.3, desired.y);
      this.camera.position.lerp(desired, 1 - Math.exp(-step * 5)); this.camera.lookAt(target); this.camera.updateMatrixWorld();
      const inFrame = (label: THREE.Sprite) => { const p = label.position.clone().project(this.camera); return p.z > -1 && p.z < 1 && Math.abs(p.x) < .88 && Math.abs(p.y) < .9; };
      for (const label of this.friendLabels) label.visible = inFrame(label);
      for (const visual of this.visuals.values()) if (visual.label) visual.label.visible = visual.label.visible && inFrame(visual.label);
    }
    this.renderer.render(this.scene, this.camera);
  }
  private resize() { const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight); this.renderer.setSize(width, height, false); this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); }
  private disposeSprite(sprite: THREE.Sprite) { sprite.material.map?.dispose(); sprite.material.dispose(); }
  private disposeObject(root: THREE.Object3D) { root.traverse(child => { if (child instanceof THREE.Mesh) child.geometry.dispose(); else if (child instanceof THREE.Sprite) this.disposeSprite(child); }); }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.pointerDown); window.removeEventListener('pointermove', this.pointerMove); window.removeEventListener('pointerup', this.pointerUp); this.canvas.removeEventListener('contextmenu', this.contextMenu); this.canvas.removeEventListener('wheel', this.wheel);
    this.disposeObject(this.scene); for (const material of this.materials.values()) material.dispose(); this.clockTexture.dispose(); this.visuals.clear(); this.renderer.dispose(); this.canvas.remove();
  }
}
