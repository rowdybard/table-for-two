import { RestaurantRenderer } from '../../src/restaurant/RestaurantRenderer';
import type { DinnerState } from '../../src/restaurant/types';
import type { InspectionTarget } from '../../src/restaurant/TabletopInspector';
import * as THREE from 'three';

const container = document.querySelector<HTMLElement>('#stage')!;
const renderer = new RestaurantRenderer(container, 'mira');
renderer.setPresentation('gameplay');
const internal = renderer as unknown as { renderer: THREE.WebGLRenderer; set: { spill:THREE.Group;diningRoot: THREE.Group; targets: THREE.Object3D[]; playerGlass: THREE.Group; menu: THREE.Mesh }; table: { friendGlass:THREE.Group;root:THREE.Group;targets: THREE.Object3D[]; dessert:THREE.Group;otherDessert:THREE.Group;portions:THREE.Group[];otherPortions:THREE.Group[];ticket: THREE.Group;ticketSignature:string; coasterBoard: THREE.Group;coasterStack:THREE.Group; napkin:THREE.Mesh; meals: THREE.Group[][]; extraOrders: {root:THREE.Group;serving:THREE.Group;carton:THREE.Group}[];cleanupCloth:THREE.Group;wineStain:THREE.Group } };
let state: DinnerState | null = null, running = true, frames = 0, overview = false;
const playback = { speaker: null, amplitude: 0, emotion: 'neutral', caption: '' } as const;
function frame() {
  if (!running) return;
  if (state) { renderer.update(.1, state, playback); if (renderer.isReady) { frames++; if (overview) { renderer.camera.position.set(0, 3.4, .2+internal.set.diningRoot.position.z); renderer.camera.fov=54; renderer.camera.updateProjectionMatrix(); renderer.camera.lookAt(0,.79,-1.15+internal.set.diningRoot.position.z); internal.renderer.render(renderer.scene,renderer.camera); } } }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
const target = (name: string) => [...internal.set.targets, ...internal.table.targets].find(t => t.userData.target === name);
Object.assign(window, { tabletopFixture: {
  renderer,
  setState(value: DinnerState) { state = value; frames = 0; renderer.setInspectionTarget(null); renderer.setTableFocus(null); renderer.update(.1, state, playback); },
  inspect(name: InspectionTarget | null) { overview=false; renderer.setInspectionTarget(name); },
  overview(enabled:boolean) { overview=enabled; renderer.setInspectionTarget(null); },
  info() {
    const info = internal.renderer.info;
    return { spill:{visible:internal.set.spill.visible,position:internal.set.spill.children[0]!.getWorldPosition(new THREE.Vector3()).toArray()},ownGlass:{angle:internal.set.playerGlass.rotation.z,position:internal.set.playerGlass.getWorldPosition(new THREE.Vector3()).toArray()},friendGlass:{angle:internal.table.friendGlass.rotation.z,position:internal.table.friendGlass.getWorldPosition(new THREE.Vector3()).toArray()},desserts:[{root:internal.table.dessert,portions:internal.table.portions},{root:internal.table.otherDessert,portions:internal.table.otherPortions}].map(x=>({visible:x.root.visible,trayVisible:x.root.children[0]!.visible,trayBottom:new THREE.Box3().setFromObject(x.root.children[0]!).min.y,portions:x.portions.map(p=>({visible:p.visible,bottom:new THREE.Box3().setFromObject(p).min.y}))})), ticketVisible:internal.table.ticket.visible,ticketSignature:internal.table.ticketSignature,stationOffset:internal.set.diningRoot.position.z, meals:internal.table.meals.map(course=>course.find(group=>group.visible)?.children.filter(part=>part.userData.bite!==undefined&&part.visible).length??0), extra:internal.table.extraOrders.map(x=>({visible:x.root.visible,serving:x.serving.visible,carton:x.carton.visible})),clothVisible:internal.table.cleanupCloth.visible,wineVisible:internal.table.wineStain.visible, ready: renderer.isReady, frames, calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures,
      shared: internal.set.playerGlass.parent?.children[2]?.children.map(o=>({visible:o.visible,position:o.getWorldPosition(new THREE.Vector3()).toArray(),children:o.children.length})),
      waterScale: internal.set.playerGlass.children[1]?.scale.y, waterVisible: internal.set.playerGlass.children[1]?.visible,
      menu: internal.set.menu.position.toArray(), targets: Object.fromEntries([...internal.set.targets, ...internal.table.targets].map(t => [t.userData.target, {visible:t.visible, position:t.getWorldPosition(new THREE.Vector3()).toArray(), radius:t.userData.inspectRadius ?? null}])) };
  },
  target(name: string) { const t = target(name); return t ? { visible: t.visible, position: t.getWorldPosition(new THREE.Vector3()).toArray() } : null; },
  intersections() {
    const root=internal.set.playerGlass.parent!, shared=root.children[2]!, settings=(root.children[1]!.visible?root.children[1]:root.children[0])!;
    const entries: {name:string;object:THREE.Object3D}[]=[...shared.children.map((object,i)=>({name:['carafe','lamp','vase','bread','salt','pepper'][i]??`shared-${i}`,object})),{name:'playerGlass',object:internal.set.playerGlass},{name:'menu',object:internal.set.menu},{name:'napkin',object:internal.table.napkin},...settings.children.map((object,i)=>({name:`plate-${i}`,object:object.children[0]!}))];
    if(internal.table.dessert.visible)entries.push({name:'dessert-own',object:internal.table.dessert.children[0]!});
    if(internal.table.otherDessert.visible)entries.push({name:'dessert-other',object:internal.table.otherDessert.children[0]!});
    if(internal.table.ticket.visible)entries.push({name:'ticket',object:internal.table.ticket});
    if(internal.table.coasterStack.visible)entries.push({name:'coasters-stack',object:internal.table.coasterStack});
    if(internal.table.coasterBoard.visible)entries.push({name:'board',object:internal.table.coasterBoard});
    internal.table.extraOrders.forEach((x,i)=>{if(x.root.visible)entries.push({name:`extra-${i}`,object:x.root});});
    const box=(o:THREE.Object3D)=>new THREE.Box3().setFromObject(o), result:string[]=[];
    for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){const a=entries[i]!,b=entries[j]!;if(box(a.object).intersectsBox(box(b.object)))result.push(`${a.name}/${b.name}`);}
    return result;
  },
  supportRadius() {
    renderer.scene.updateMatrixWorld(true); const centerZ=-1.15+internal.set.diningRoot.position.z;
    const point=new THREE.Vector3(), transform=new THREE.Matrix4(), instance=new THREE.Matrix4();let maximum=0;
    for(const root of [internal.set.playerGlass.parent!,internal.table.root]) root.traverseVisible(object=>{
      if(!(object instanceof THREE.Mesh)||object.userData.target)return;const positions=object.geometry.getAttribute('position');if(!positions)return;
      const count=object instanceof THREE.InstancedMesh?object.count:1;
      for(let k=0;k<count;k++){if(object instanceof THREE.InstancedMesh){object.getMatrixAt(k,instance);transform.multiplyMatrices(object.matrixWorld,instance);}else transform.copy(object.matrixWorld);
        for(let i=0;i<positions.count;i++){point.fromBufferAttribute(positions,i).applyMatrix4(transform);maximum=Math.max(maximum,Math.hypot(point.x,point.z-centerZ));}}
    });return maximum;
  },
  footprints() {
    const root=internal.set.playerGlass.parent!,shared=root.children[2]!;
    const entries=[{name:'salt',object:shared.children[4]!},{name:'pepper',object:shared.children[5]!},{name:'menu',object:internal.set.menu},...(internal.table.ticket.visible?[{name:'ticket',object:internal.table.ticket}]:[])];
    const boxes=entries.map(x=>({name:x.name,box:new THREE.Box3().setFromObject(x.object)})),pairs:string[]=[];
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i]!,b=boxes[j]!;if(a.box.min.x<=b.box.max.x&&a.box.max.x>=b.box.min.x&&a.box.min.z<=b.box.max.z&&a.box.max.z>=b.box.min.z)pairs.push(`${a.name}/${b.name}`);}
    return pairs;
  },
  aimAt(name: string) { const t=target(name); if(!state||!t)return null;renderer.camera.lookAt(t.getWorldPosition(new THREE.Vector3()));renderer.camera.updateMatrixWorld();return renderer.getInteraction(state); },
  dispose() { running = false; renderer.dispose(); },
} });
