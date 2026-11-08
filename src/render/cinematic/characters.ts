import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createFace } from './face';
import { createHair } from './hair';
import type { Reaction } from '../../shared/protocol';

type Person = 'p1' | 'p2' | 'mira' | 'dev';
type Motion = {
  speed: number; time: number; lookAt?: THREE.Vector3; wave?: boolean; kiss?: number;
  reaction?: { kind: Reaction; started: number };
};
type Ring = [number, number, number, number?, number?]; // height, half-width, half-depth, x offset, z offset

type Design = {
  skin: number; skinShadow: number; hair: number; hairLight: number; top: number; topLight: number;
  trousers: number; shoes: number; shirt: number; eyes: number; shoulder: number; waist: number; hips: number;
  hairStyle: 'short' | 'curls' | 'bob' | 'wavy'; topStyle: 'jacket' | 'shirt' | 'dress' | 'vest';
};
const designs: Record<Person, Design> = {
  p1: { skin: 0xb77c5e, skinShadow: 0x875344, hair: 0x272321, hairLight: 0x514039, top: 0x8d4037, topLight: 0xab6651, trousers: 0x30363a, shoes: 0x302622, shirt: 0xd5c6aa, eyes: 0x382a23, shoulder: .235, waist: .157, hips: .181, hairStyle: 'short', topStyle: 'jacket' },
  p2: { skin: 0x80513e, skinShadow: 0x593528, hair: 0x211b1b, hairLight: 0x47312b, top: 0xd8c6a5, topLight: 0xe8d9ba, trousers: 0x325e5a, shoes: 0x362925, shirt: 0xb79776, eyes: 0x211916, shoulder: .215, waist: .145, hips: .19, hairStyle: 'curls', topStyle: 'shirt' },
  mira: { skin: 0xd6a082, skinShadow: 0xa86c58, hair: 0x824a32, hairLight: 0xb6754b, top: 0xb69048, topLight: 0xd1a75d, trousers: 0x514336, shoes: 0x43312a, shirt: 0xe1cdb1, eyes: 0x51503b, shoulder: .207, waist: .145, hips: .185, hairStyle: 'bob', topStyle: 'dress' },
  dev: { skin: 0xa36e52, skinShadow: 0x754a39, hair: 0x302826, hairLight: 0x58433a, top: 0x56373a, topLight: 0x81504c, trousers: 0x41393a, shoes: 0x302722, shirt: 0xc9b49a, eyes: 0x30251f, shoulder: .224, waist: .152, hips: .177, hairStyle: 'wavy', topStyle: 'vest' },
};

// Ring lofts give the garments and anatomy a deliberately shaped silhouette rather
// than stacking spheres or capsules. The seam runs down the unseen back.
function loft(rings: Ring[], sides = 16, caps = true): THREE.BufferGeometry {
  const vertices: number[] = [], indices: number[] = [], uvs: number[] = [];
  for (const [r, [y, rx, rz, cx = 0, cz = 0]] of rings.entries()) for (let i = 0; i < sides; i++) {
    const a = i * Math.PI * 2 / sides;
    vertices.push(cx + Math.sin(a) * rx, y, cz + Math.cos(a) * rz); uvs.push(i / sides, r / Math.max(1, rings.length - 1));
  }
  const ascending = rings[rings.length - 1][0] >= rings[0][0];
  const triangle = (a: number, b: number, c: number) => { if (ascending) indices.push(a, b, c); else indices.push(a, c, b); };
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < sides; i++) {
    const a = r * sides + i, b = r * sides + (i + 1) % sides, c = a + sides, d = b + sides;
    triangle(a, b, c); triangle(b, d, c);
  }
  if (caps) for (let i = 1; i < sides - 1; i++) {
    triangle(0, i + 1, i);
    const end = (rings.length - 1) * sides; triangle(end, end + i, end + i + 1);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(indices); g.computeVertexNormals(); return g;
}

function shape(points: number[][], triangles: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3)); g.setIndex(triangles); g.computeVertexNormals(); return g;
}


export function createCharacter(person: Person): { root: THREE.Group; update: (dt: number, motion: Motion) => void; dispose: () => void } {
  const d = designs[person], root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>(), skeletons = new Set<THREE.Skeleton>();
  const mat = (color: number, roughness = .91) => { const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 }); materials.add(m); return m; };
  // Subtle, deterministic canvas-painted weave and brush variation; no assets.
  const fabricCanvas = document.createElement('canvas'); fabricCanvas.width = fabricCanvas.height = 128;
  const fabric = fabricCanvas.getContext('2d')!; fabric.fillStyle = '#eeeeee'; fabric.fillRect(0, 0, 128, 128);
  let seed = 13831; const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 800; i++) {
    const x = random() * 128, y = random() * 128, light = Math.floor(212 + random() * 43);
    fabric.globalAlpha = .10 + random() * .12; fabric.strokeStyle = `rgb(${light},${light},${light})`; fabric.lineWidth = .5 + random() * 1.3;
    fabric.beginPath(); fabric.moveTo(x, y); fabric.lineTo(x + (random() - .5) * 7, y + 3 + random() * 12); fabric.stroke();
  }
  fabric.globalAlpha = 1; const clothMap = new THREE.CanvasTexture(fabricCanvas); clothMap.colorSpace = THREE.SRGBColorSpace; clothMap.wrapS = clothMap.wrapT = THREE.RepeatWrapping; textures.add(clothMap);
  const skin = mat(d.skin), top = mat(d.top), topLight = mat(d.topLight), trousers = mat(d.trousers);
  const shoes = mat(d.shoes), shirt = mat(d.shirt), brass = mat(0xc6a16c, .55);
  top.map = clothMap; top.needsUpdate = true;
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) => {
    geometries.add(geo); const mesh = new THREE.Mesh(geo, material); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const bulb = (parent: THREE.Object3D, material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, segments = 12) => {
    const mesh = add(parent, new THREE.SphereGeometry(1, segments, 8), material, x, y, z); mesh.scale.set(sx, sy, sz); return mesh;
  };
  // The jacket and shirt are fitted to a shaped ribcage and sloped shoulders.
  // Their fronts follow the same surface rather than intersecting flat overlays.
  const torso: Ring[] = [[.88,d.hips*.95,.106],[.98,d.hips*.92,.099],[1.05,d.waist*.99,.100],[1.14,d.waist,.098],[1.25,d.waist*1.10,.105],[1.34,d.shoulder*.86,.108],[1.40,d.shoulder*.98,.104],[1.45,d.shoulder*.91,.095],[1.48,d.shoulder*.70,.079],[1.505,.07,.062]];
  add(body, loft(torso, 32, false), top);
  function front(y: number, x: number, offset = .003) {
    let i = 0; while (i < torso.length-2 && torso[i+1][0] < y) i++;
    const a=torso[i], b=torso[i+1], t=THREE.MathUtils.clamp((y-a[0])/(b[0]-a[0]),0,1);
    const rx=THREE.MathUtils.lerp(a[1],b[1],t), rz=THREE.MathUtils.lerp(a[2],b[2],t);
    return rz * Math.sqrt(Math.max(.02, 1 - Math.pow(x / rx, 2))) + offset;
  }
  function panel(rows: [number, number][], material: THREE.Material) {
    const p: number[] = [], idx: number[] = [], columns=8;
    rows.forEach(([y,width]) => { for (let k=0;k<=columns;k++) { const x=width*(2*k/columns-1); p.push(x,y,front(y,x,.004)); } });
    for (let j=0;j<rows.length-1;j++) for (let k=0;k<columns;k++) { const a=j*(columns+1)+k,b=a+columns+1; idx.push(a,b,a+1,a+1,b,b+1); }
    const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3)); geo.setIndex(idx); geo.computeVertexNormals(); add(body,geo,material);
  }
  function seam(points: [number,number][], material: THREE.Material, radius=.0015) {
    const curve = new THREE.CatmullRomCurve3(points.map(([x,y]) => new THREE.Vector3(x,y,front(y,x,.005))));
    add(body,new THREE.TubeGeometry(curve, Math.max(8,points.length*4), radius,5,false),material);
  }
  const seamMat=mat(new THREE.Color(d.top).lerp(new THREE.Color(0x332b27),.25).getHex());
  if (d.topStyle === 'jacket' || d.topStyle === 'vest') {
    panel([[1.48,.040],[1.45,.064],[1.39,.073],[1.27,.076],[1.15,.077],[1.03,.079],[.96,.081],[.90,.081]], shirt);
    for (const side of [-1,1]) {
      seam([[side*.041,1.48],[side*.073,1.39],[side*.076,1.25],[side*.078,1.12],[side*.080,1.00],[side*.081,.90]],seamMat,.0024);
      seam([[side*.10,1.12],[side*.13,1.105],[side*.155,1.11]],seamMat,.0016);
    }
    seam([[-.045,1.47],[0,1.445],[.045,1.47]],seamMat,.0012);
    // Shaped jacket collar folds back toward the shoulder, with the seam
    // following the fitted chest instead of floating as a rectangle.
    const collarMat = mat(new THREE.Color(d.top).lerp(new THREE.Color(d.topLight), .38).getHex());
    for (const side of [-1,1]) {
      const outline: [number,number][] = [[side*.043,1.48],[side*.115,1.465],[side*.104,1.425],[side*.074,1.375],[side*.060,1.423]];
      const vertices=outline.map(([x,y]) => [x,y,front(y,x,.006)]);
      const tris = side === 1 ? [0,4,1,1,4,2,2,4,3] : [0,1,4,1,2,4,2,3,4];
      add(body,shape(vertices,tris),collarMat);
    }
  } else {
    seam([[0,1.43],[0,1.32],[0,1.20],[0,1.08]],seamMat,.0013);
    for (let i=0;i<4;i++) bulb(body, brass, .006, 1.17+i*.07, front(1.17+i*.07,.006,.006), .0035,.0035,.002,8);
    seam([[-.047,1.47],[0,1.445],[.047,1.47]],seamMat,.0012);
  }
  for (const side of [-1,1]) {
    seam([[side*.10,1.34],[side*.14,1.31],[side*.17,1.30]],seamMat,.001);
    seam([[side*.095,1.02],[side*.13,1.045],[side*.16,1.05]],seamMat,.001);
  }
  // A single weighted surface spans each joint. Its surrounding rings blend
  // between the upper and lower bones, avoiding hard circular elbow/knee cuts.
  function limb(parent: THREE.Group, rings: Ring[], split: number, material: THREE.Material, x: number, y: number, caps = true) {
    const geometry = loft(rings, 18, caps), positions = geometry.getAttribute('position');
    const joints: number[] = [], weights: number[] = [];
    for (let i = 0; i < positions.count; i++) {
      const amount = THREE.MathUtils.smoothstep(-positions.getY(i), split - .085, split + .085);
      joints.push(0, 1, 0, 0); weights.push(1 - amount, amount, 0, 0);
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4)); geometries.add(geometry);
    const mesh = new THREE.SkinnedMesh(geometry, material); mesh.position.set(x, y, 0); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    const upper = new THREE.Bone(), lower = new THREE.Bone(); lower.position.y = -split; upper.add(lower); mesh.add(upper); parent.add(mesh);
    const skeleton = new THREE.Skeleton([upper, lower]); skeletons.add(skeleton); mesh.bind(skeleton);
    return { upper, lower };
  }
  const arms: { upper: THREE.Bone; lower: THREE.Bone }[] = [];
  const legs: { upper: THREE.Bone; lower: THREE.Bone; foot: THREE.Group }[] = [];
  for (const side of [-1, 1]) {
    const sleeveMat = d.topStyle === 'vest' ? shirt : top;
    const arm = limb(body, [
      [.043,.014,.022,-side*.016], [.034,.035,.041,-side*.009], [.018,.048,.054,-side*.003],
      [0,.058,.060],[-.04,.068,.067],[-.11,.067,.064],[-.19,.058,.054],[-.24,.052,.05],
      [-.27,.049,.047],[-.30,.047,.045],[-.35,.044,.043],[-.43,.036,.036],[-.49,.031,.031],[-.505,.029,.029],
    ], .275, sleeveMat, side * (d.shoulder - .052), 1.43);
    add(arm.lower, loft([[0,.033,.033],[-.011,.032,.032]], 18, false), topLight, 0, -.209, 0);
    const hand = new THREE.Group(); hand.position.set(0, -.23, .003); arm.lower.add(hand);
    add(hand, loft([[0,.029,.024],[-.045,.032,.019],[-.068,.026,.016],[-.077,.023,.014]], 10), skin);
    const fingerGeos: THREE.BufferGeometry[] = [];
    for (let f = 0; f < 4; f++) {
      const g = new THREE.SphereGeometry(1, 8, 6); g.scale(.006, .023 - Math.abs(f - 1.5) * .003, .008); g.translate((f - 1.5) * .012, -.082, .001); fingerGeos.push(g);
    }
    const thumb = new THREE.SphereGeometry(1, 8, 6); thumb.scale(.009,.025,.01); thumb.rotateZ(-side*.35); thumb.translate(-side*.031,-.04,.008); fingerGeos.push(thumb);
    const fingers = mergeGeometries(fingerGeos)!; fingerGeos.forEach(g => g.dispose()); add(hand, fingers, skin); arms.push(arm);
    const leg = limb(body, [[.07,.060,.038],[.035,.063,.043],[0,.065,.048],[-.025,.081,.074],[-.06,.09,.09],[-.15,.085,.085],[-.26,.076,.075],[-.34,.066,.066],[-.39,.062,.061],[-.425,.06,.059],[-.46,.059,.058],[-.51,.058,.059],[-.60,.052,.053],[-.72,.045,.048],[-.80,.042,.044],[-.81,.041,.043]], .425, trousers, side * d.hips * .52, .88, false);
    const foot = new THREE.Group(); foot.name = side < 0 ? 'left-foot' : 'right-foot'; foot.position.set(0, -.385, 0); leg.lower.add(foot);
    add(foot, loft([[0,.044,.045],[-.025,.047,.065,0,.025],[-.055,.052,.108,0,.059],[-.07,.052,.11,0,.06]], 12), shoes);
    const sole = mat(new THREE.Color(d.shoes).lerp(new THREE.Color(0x9a7b5b),.24).getHex());
    add(foot, loft([[-.059,.050,.102,0,.057],[-.069,.050,.104,0,.058],[-.073,.046,.10,0,.058]],12), sole);
    legs.push({ ...leg, foot });
  }
  add(body, loft([[1.475,.053,.052],[1.55,.052,.05],[1.58,.064,.058]]), skin);
  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = 1.65;
  body.add(head);
  if (person === 'p2') {
    for (const side of [-1, 1]) {
      const hoop = add(head, new THREE.TorusGeometry(.012, .0018, 6, 18), brass, side * .108, -.038, -.003);
      hoop.rotation.y = Math.PI / 2;
    }
  }
  // Batch the clothing before attaching the independently animated face.
  function batchStaticChildren(group: THREE.Object3D) {
    for (const child of [...group.children]) batchStaticChildren(child);
    const batches = new Map<THREE.Material, THREE.Mesh[]>();
    for (const child of group.children) {
      if (!(child instanceof THREE.Mesh) || child instanceof THREE.SkinnedMesh || Array.isArray(child.material)) continue;
      const members = batches.get(child.material) ?? []; members.push(child); batches.set(child.material, members);
    }
    for (const [material, members] of batches) {
      if (members.length < 2) continue;
      const copies = members.map(mesh => {
        mesh.updateMatrix();
        const copy = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        // Keep UVs for the code-painted fabric while allowing unmapped
        // primitives with different generated attributes to share a batch.
        for (const name of Object.keys(copy.attributes)) if (name !== 'position' && name !== 'normal' && !(name === 'uv' && 'map' in material && material.map)) copy.deleteAttribute(name);
        copy.clearGroups(); copy.applyMatrix4(mesh.matrix); return copy;
      });
      const combined = mergeGeometries(copies); copies.forEach(geometry => geometry.dispose());
      if (!combined) continue;
      const mesh = new THREE.Mesh(combined, material); mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh); geometries.add(combined);
      for (const old of members) { group.remove(old); geometries.delete(old.geometry); old.geometry.dispose(); }
    }
  }
  batchStaticChildren(root);
  const face = createFace({ person, skin: d.skin, skinShadow: d.skinShadow, eyes: d.eyes, hair: d.hair });
  const hair = createHair({ style: d.hairStyle, color: d.hair, highlight: d.hairLight });
  head.add(face.root, hair.root);
  face.update({ blink: 0, smile: 0 });
  const [blinkPeriod, blinkOffset] = { p1: [4.7, .3], p2: [5.1, 2.1], mira: [4.3, 1.1], dev: [5.35, 3.4] }[person];
  let kissAmount = 0, waveAmount = 0, smile = 0, gazeX = 0, gazeY = 0;
  const gaze = new THREE.Vector3(), targetFoot = new THREE.Vector3(), inverseBody = new THREE.Matrix4(); let gaitSpeed = 0, walkClock = 0;
  return {
    root,
    update(dt, motion) {
      const delta = Math.min(.1, Math.max(0, dt));
      const speed = Math.max(0, Number.isFinite(motion.speed) ? motion.speed : 0);
      const idleTime = motion.time + blinkOffset;
      const reaction = motion.reaction?.kind;
      const reactionAge = motion.reaction ? Math.max(0, motion.time - motion.reaction.started) : 0;
      const gesture = THREE.MathUtils.smoothstep(reactionAge, 0, .26) * (1 - THREE.MathUtils.smoothstep(reactionAge, .98, 1.8));
      waveAmount = THREE.MathUtils.damp(waveAmount, motion.wave ? 1 : 0, 7, delta);
      gaitSpeed += (speed - gaitSpeed) * (1 - Math.exp(-delta * 14));
      const run = THREE.MathUtils.smoothstep(gaitSpeed, 1.5, 3.6);
      const cadence = THREE.MathUtils.lerp(1.7, 2.8, run);
      const stanceFraction = THREE.MathUtils.lerp(.62, .46, run);
      // In a stance, backwards travel / stance duration equals body speed.
      const travel = Math.min(1.35, gaitSpeed * stanceFraction / cadence);
      walkClock += delta * 2 * Math.PI * (gaitSpeed > .01 ? cadence : 0);
      const stride = Math.sin(walkClock), sway = Math.sin(walkClock * .5);
      const gaitBlend = THREE.MathUtils.smoothstep(gaitSpeed, 0, .5);
      const footTargets = [0,1].map(i => {
        const cycle = ((walkClock / (2*Math.PI) + i * .5) % 1 + 1) % 1;
        const stance = cycle < stanceFraction;
        const t = stance ? cycle / stanceFraction : (cycle - stanceFraction) / (1 - stanceFraction);
        return { stance, z: stance ? travel*(.5-t) : travel*(t-.5), lift: stance ? 0 : (.045 + .025*run)*Math.sin(Math.PI*t)*gaitBlend };
      });
      // Lower the hips only as needed to keep the planted foot reachable. During
      // run flight both feet use their swing targets to bound the same reach.
      const planted = footTargets.filter(f => f.stance);
      const reachTargets = planted.length ? planted : footTargets;
      const extent = Math.max(...reachTargets.map(f => Math.abs(f.z)));
      body.position.y = Math.sqrt(Math.max(.01, .805**2 - Math.min(.79,extent)**2)) - .81;
      body.rotation.z = .010 * Math.sin(idleTime * 1.1) + sway * .012 * gaitBlend;
      kissAmount = THREE.MathUtils.damp(kissAmount, THREE.MathUtils.clamp(motion.kiss ?? 0, 0, 1), 10, delta);
      body.rotation.x = .012 * gaitBlend + kissAmount * .04;
      body.updateMatrix(); inverseBody.copy(body.matrix).invert();
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1, phase = stride * side;
        // Targets are specified in root space, then transformed into the tilted
        // body's coordinates so breathing/sway doesn't lift the planted sole.
        targetFoot.set(side*d.hips*.52, .073 + footTargets[i].lift, footTargets[i].z).applyMatrix4(inverseBody);
        const dy = .88 - targetFoot.y, dx = targetFoot.x - side*d.hips*.52;
        legs[i].upper.rotation.z = Math.atan2(dx, dy);
        const vertical = Math.hypot(dy, dx), upperLength=.425, lowerLength=.385;
        const distance = Math.min(upperLength + lowerLength - .00001, Math.hypot(vertical, targetFoot.z));
        const aim = Math.atan2(-targetFoot.z,vertical);
        const hip = Math.acos(THREE.MathUtils.clamp((upperLength**2+distance**2-lowerLength**2)/(2*upperLength*distance),-1,1));
        const knee = Math.PI-Math.acos(THREE.MathUtils.clamp((upperLength**2+lowerLength**2-distance**2)/(2*upperLength*lowerLength),-1,1));
        legs[i].upper.rotation.x = aim-hip;
        legs[i].lower.rotation.x = knee;
        legs[i].foot.rotation.x = -legs[i].upper.rotation.x - legs[i].lower.rotation.x - body.rotation.x;
        legs[i].foot.rotation.z = -body.rotation.z - legs[i].upper.rotation.z;
        const arm = arms[i];
        const swing = -phase * .28 * gaitBlend + .045 * Math.sin(idleTime * 1.2 + i);
        const relaxed = side * (.11 + .025 * Math.sin(idleTime * 1.1 + i));
        arm.upper.rotation.x = swing;
        arm.upper.rotation.z = relaxed;
        arm.lower.rotation.x = -.16 - Math.max(0, phase) * .12 * gaitBlend;
        arm.lower.rotation.z = 0;
        if (i === 1) {
          const handOnChest = reaction === 'heart' ? gesture : 0;
          arm.upper.rotation.x = THREE.MathUtils.lerp(swing, -.65, handOnChest);
          arm.upper.rotation.z = THREE.MathUtils.lerp(relaxed, .02, handOnChest);
          arm.lower.rotation.x = THREE.MathUtils.lerp(arm.lower.rotation.x, .43, handOnChest);
          arm.lower.rotation.z = -2.32 * handOnChest;
          arm.upper.rotation.z = THREE.MathUtils.lerp(arm.upper.rotation.z, 1.22, waveAmount);
          arm.upper.rotation.x = THREE.MathUtils.lerp(arm.upper.rotation.x, -.40, waveAmount);
          arm.lower.rotation.z = THREE.MathUtils.lerp(arm.lower.rotation.z, 1.47 + .15 * Math.sin(idleTime * 7), waveAmount);
        }
      }
      let yaw = .035 * Math.sin(idleTime * .7), pitch = .012 * Math.sin(idleTime * 1.3);
      if (motion.lookAt) {
        gaze.copy(motion.lookAt);
        body.worldToLocal(gaze).sub(head.position);
        yaw = Math.atan2(gaze.x, gaze.z);
        pitch = -Math.atan2(gaze.y, Math.hypot(gaze.x, gaze.z));
      }
      head.rotation.y = THREE.MathUtils.damp(head.rotation.y, THREE.MathUtils.clamp(yaw, -.55, .55), 8, delta);
      const nod = reaction === 'nice' ? .18 * gesture * (.5 - .5 * Math.cos(reactionAge * 10)) : 0;
      const laugh = reaction === 'laugh' ? gesture : 0;
      const headPitch = THREE.MathUtils.clamp(pitch, -.18, .18) + .08 * kissAmount + nod - laugh * (.09 + .06 * Math.sin(reactionAge * 14));
      head.rotation.x = THREE.MathUtils.damp(head.rotation.x, headPitch, 10, delta);
      head.rotation.z = .12 * kissAmount;
      // Let the eyes find the partner before the neck completes its turn.
      const eyeYaw = motion.lookAt ? THREE.MathUtils.clamp((yaw - head.rotation.y) * 2.6, -1, 1) : 0;
      const eyePitch = motion.lookAt ? THREE.MathUtils.clamp((head.rotation.x - pitch) * 3, -1, 1) : 0;
      gazeX = THREE.MathUtils.damp(gazeX, eyeYaw, 19, delta);
      gazeY = THREE.MathUtils.damp(gazeY, eyePitch, 19, delta);
      const expression = reaction === 'laugh' ? .95 : reaction === 'nice' ? .6 : .45;
      smile = THREE.MathUtils.damp(smile, Math.max(gesture * expression, waveAmount * .35), 9, delta);
      const blinkTime = (motion.time + blinkOffset) % blinkPeriod;
      const blink = Math.max(0, 1 - Math.abs(blinkTime - .09) / .09);
      face.update({ gazeX, gazeY, blink: Math.max(blink, kissAmount), smile });
    },
    dispose() {
      face.dispose(); hair.dispose();
      skeletons.forEach(s => s.dispose()); geometries.forEach(g => g.dispose());
      materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
    },
  };
}
