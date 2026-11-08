import * as THREE from 'three';

export type FacePerson = 'p1' | 'p2' | 'mira' | 'dev';
export type FaceOptions = { person: FacePerson; skin: number; skinShadow: number; eyes: number; hair: number };
export type FaceExpression = { blink: number; smile: number; gazeX?: number; gazeY?: number };

type Profile = { jaw: number; cheek: number; nose: number; mouth: number; eyeWidth: number; eyeHeight: number };
const profiles: Record<FacePerson, Profile> = {
  p1: { jaw: 1.05, cheek: .98, nose: 1.02, mouth: .029, eyeWidth: .023, eyeHeight: .0075 },
  p2: { jaw: .94, cheek: 1.04, nose: 1.12, mouth: .030, eyeWidth: .024, eyeHeight: .0078 },
  mira: { jaw: .92, cheek: 1.02, nose: .93, mouth: .028, eyeWidth: .023, eyeHeight: .0076 },
  dev: { jaw: 1.02, cheek: .96, nose: 1.08, mouth: .028, eyeWidth: .022, eyeHeight: .0070 },
};
const profile: [number, number, number][] = [
  [-.125,.012,.018],[-.115,.038,.043],[-.10,.060,.060],[-.08,.077,.074],[-.055,.088,.084],
  [-.03,.096,.090],[0,.103,.096],[.03,.105,.097],[.06,.102,.093],[.09,.092,.085],
  [.115,.072,.069],[.13,.047,.046],[.138,.006,.007],
];
function dimensions(y: number, design: Profile): [number, number] {
  let i = 0; while (i < profile.length-2 && profile[i+1][0] < y) i++;
  const a=profile[i],b=profile[i+1],t=THREE.MathUtils.clamp((y-a[0])/(b[0]-a[0]),0,1);
  // Interpolate the profile with continuous slopes. Restarting smoothstep on
  // each interval forces a flat tangent at every ring and creates visible bands.
  const interpolate=(component: 1|2) => {
    const prev=profile[Math.max(0,i-1)], next=profile[Math.min(profile.length-1,i+2)];
    const span=b[0]-a[0];
    const m0=(b[component]-prev[component])/(b[0]-prev[0]);
    const m1=(next[component]-a[component])/(next[0]-a[0]);
    return (2*t**3-3*t**2+1)*a[component]+(t**3-2*t**2+t)*span*m0+(-2*t**3+3*t**2)*b[component]+(t**3-t**2)*span*m1;
  };
  const jawWeight=1-THREE.MathUtils.smoothstep(y,-.065,.015);
  return [interpolate(1)*THREE.MathUtils.lerp(1,design.jaw,jawWeight), interpolate(2)];
}
const bell = (v: number, center: number, width: number) => Math.exp(-(((v-center)/width)**2));

/** Sculpted adult face in head-pivot space (+Z forward). Hair is a separate layer. */
export function createFace(options: FaceOptions): { root: THREE.Group; update: (expression: FaceExpression) => void; dispose: () => void } {
  const design=profiles[options.person], root=new THREE.Group();
  const geometries: THREE.BufferGeometry[]=[], materials: THREE.Material[]=[];
  const skinColor=new THREE.Color(options.skin), shadowColor=new THREE.Color(options.skinShadow);
  const material=(color: THREE.Color | number, vertexColors=false) => { const m=new THREE.MeshStandardMaterial({color,vertexColors,roughness:.95,metalness:0}); materials.push(m); return m; };
  const skinMat=material(0xffffff,true), earMat=material(skinColor), socketMat=material(skinColor.clone().lerp(shadowColor,.30));
  const lipMat=material(skinColor.clone().lerp(shadowColor,.42)), nostrilMat=material(skinColor.clone().lerp(shadowColor,.68));
  const whiteMat=material(0xd6cbbd), irisMat=material(options.eyes), pupilMat=material(0x211b1a), browMat=material(options.hair);
  function add(g: THREE.BufferGeometry, m: THREE.Material) { geometries.push(g); const mesh=new THREE.Mesh(g,m); mesh.castShadow=true; mesh.receiveShadow=true; root.add(mesh); return mesh; }
  function depth(x: number,y: number) {
    const [rx,rz]=dimensions(y,design), n=Math.max(-.999,Math.min(.999,x/rx));
    let z=rz*Math.sqrt(Math.max(0,1-n*n));
    // Soft contiguous planes rather than pasted-on features: a bridge and tip,
    // orbital hollows, cheekbones, mouth cushion and chin share the head mesh.
    z += design.nose*(.008*bell(x,0,.018)*bell(y,.023,.052)+.014*bell(x,0,.015)*bell(y,-.012,.018));
    z += .0032*design.cheek*(bell(x,-.055,.026)+bell(x,.055,.026))*bell(y,-.008,.028);
    z -= .0065*(bell(x,-.042,.025)+bell(x,.042,.025))*bell(y,.016,.014);
    z += .003*(bell(x,-.042,.027)+bell(x,.042,.027))*bell(y,.043,.011);
    z += .0028*bell(x,0,.028)*bell(y,-.055,.012)+.003*bell(x,0,.025)*bell(y,-.09,.020);
    z += .0015*(bell(x,-.006,.004)+bell(x,.006,.004))*bell(y,-.041,.009);
    return z;
  }
  // Animation repeatedly samples small regions of the same fixed surface.
  // Cache only the eye and mouth motion bounds; static sculpture still uses
  // the exact function, as do any future animated points outside these bounds.
  function depthGrid(minX:number,maxX:number,minY:number,maxY:number,columns:number,rows:number) {
    const values=new Float32Array((columns+1)*(rows+1));
    const scaleX=columns/(maxX-minX),scaleY=rows/(maxY-minY);
    for(let j=0;j<=rows;j++) for(let i=0;i<=columns;i++)
      values[j*(columns+1)+i]=depth(minX+i/scaleX,minY+j/scaleY);
    return {minX,maxX,minY,maxY,columns,rows,scaleX,scaleY,values};
  }
  const eyeLeft=depthGrid(-.070,-.014,.004,.028,28,12);
  const eyeRight=depthGrid(.014,.070,.004,.028,28,12);
  const mouthGrid=depthGrid(-.031,.031,-.067,-.045,31,11);
  function dynamicDepth(x:number,y:number) {
    const grid=y>=.004 && y<=.028 ? (x<0?eyeLeft:eyeRight) : mouthGrid;
    if(x<grid.minX || x>grid.maxX || y<grid.minY || y>grid.maxY) return depth(x,y);
    const u=(x-grid.minX)*grid.scaleX,v=(y-grid.minY)*grid.scaleY;
    const i=Math.min(grid.columns-1,Math.floor(u)),j=Math.min(grid.rows-1,Math.floor(v));
    const fx=u-i,fy=v-j,k=j*(grid.columns+1)+i,values=grid.values;
    const lower=values[k]+(values[k+1]-values[k])*fx;
    const upper=values[k+grid.columns+1]+(values[k+grid.columns+2]-values[k+grid.columns+1])*fx;
    return lower+(upper-lower)*fy;
  }
  // A closed indexed head shell. The outer rings shape the jaw, cheek, temple,
  // cranium and rear skull; smoothly shaded vertices preserve profile volume.
  const headVertices: number[]=[], headColors: number[]=[], headIndices: number[]=[];
  const rows=48, sides=64, color=new THREE.Color();
  for(let j=0;j<=rows;j++) {
    const y=-.125+j/rows*.263, [rx,rz]=dimensions(y,design);
    for(let i=0;i<=sides;i++) {
      const angle=i/sides*Math.PI*2, x=Math.sin(angle)*rx, c=Math.cos(angle);
      const z=c>=0 ? THREE.MathUtils.lerp(rz*c,depth(x,y),THREE.MathUtils.smoothstep(c,.12,.5)) : rz*c;
      headVertices.push(x,y,z);
      const eyeShade=(bell(x,-.042,.027)+bell(x,.042,.027))*bell(y,.012,.016)*Math.max(0,c)*.10;
      const templeShade=bell(Math.abs(x),.087,.020)*bell(y,-.015,.09)*Math.max(0,c)*.035;
      const warm=bell(Math.abs(x),.057,.028)*bell(y,-.025,.025)*Math.max(0,c)*.025;
      color.copy(skinColor).lerp(shadowColor,eyeShade+templeShade); color.r=Math.min(1,color.r+warm*.16); color.g=Math.min(1,color.g+warm*.04);
      headColors.push(color.r,color.g,color.b);
    }
  }
  for(let j=0;j<rows;j++) for(let i=0;i<sides;i++){const a=j*(sides+1)+i,b=a+sides+1; headIndices.push(a,a+1,b,a+1,b+1,b);}
  const head=new THREE.BufferGeometry(); head.setAttribute('position',new THREE.Float32BufferAttribute(headVertices,3)); head.setAttribute('color',new THREE.Float32BufferAttribute(headColors,3)); head.setIndex(headIndices); head.computeVertexNormals();
  // The longitudinal seam duplicates its vertices for indexing; share their
  // averaged normals so light does not reveal a line down the center of the face.
  const normals=head.getAttribute('normal') as THREE.BufferAttribute;
  for(let j=0;j<=rows;j++) {
    const a=j*(sides+1),b=a+sides;
    const n=new THREE.Vector3(normals.getX(a)+normals.getX(b),normals.getY(a)+normals.getY(b),normals.getZ(a)+normals.getZ(b)).normalize();
    normals.setXYZ(a,n.x,n.y,n.z);normals.setXYZ(b,n.x,n.y,n.z);
  }
  add(head,skinMat);
  function surface(points: number[], indices: number[]) { const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(points,3)); g.setIndex(indices); g.computeVertexNormals(); return g; }
  // Ears have volume in the side/profile plane as well as the front plane.
  const earPoints: number[]=[], earInner: number[]=[], earIndices: number[]=[], innerIndices: number[]=[];
  const earSides=20, earRows=12;
  for(const side of [-1,1]) {
    const base=earPoints.length/3;
    for(let j=0;j<=earRows;j++) for(let i=0;i<=earSides;i++) {
      const phi=Math.PI*j/earRows, theta=2*Math.PI*i/earSides, s=Math.sin(phi);
      earPoints.push(side*(.102+.012*s*Math.cos(theta)),-.008+.027*Math.cos(phi),-.009+.013*s*Math.sin(theta));
    }
    for(let j=0;j<earRows;j++) for(let i=0;i<earSides;i++){const a=base+j*(earSides+1)+i,b=a+earSides+1;earIndices.push(a,b,a+1,a+1,b,b+1);}
    const innerBase=earInner.length/3;
    earInner.push(side*.115,-.008,-.008);
    for(let i=0;i<20;i++){const a=2*Math.PI*i/20;earInner.push(side*(.113+.0015*Math.cos(a)),-.008+.017*Math.cos(a),-.008+.007*Math.sin(a));}
    for(let i=0;i<20;i++)innerIndices.push(innerBase,innerBase+1+i,innerBase+1+(i+1)%20);
  }
  earMat.side=THREE.DoubleSide; socketMat.side=THREE.DoubleSide;
  const ears=surface(earPoints,earIndices); ears.computeVertexNormals(); add(ears,earMat);
  add(surface(earInner,innerIndices),socketMat);
  const segments=20, eyeY=.016, eyeCenters=[-.042,.042];
  function dynamicGeometry(rings: number) {
    const n=2*(1+segments*rings), p=new Float32Array(n*3), idx:number[]=[];
    for(let eye=0;eye<2;eye++) {
      const base=eye*(1+segments*rings);
      if(rings===1) for(let i=0;i<segments;i++) idx.push(base,base+1+i,base+1+(i+1)%segments);
      else for(let i=0;i<segments;i++){const a=base+1+i,b=base+1+(i+1)%segments,c=a+segments,d=b+segments; idx.push(a,c,b,b,c,d);}
    }
    const g=new THREE.BufferGeometry();const attr=new THREE.BufferAttribute(p,3);attr.setUsage(THREE.DynamicDrawUsage);g.setAttribute('position',attr);g.setIndex(idx);return g;
  }
  const whites=dynamicGeometry(1), irises=dynamicGeometry(1), pupils=dynamicGeometry(1), lids=dynamicGeometry(2);
  add(whites,whiteMat);add(irises,irisMat);add(pupils,pupilMat);add(lids,earMat);
  function write(g: THREE.BufferGeometry,index: number,x:number,y:number,z:number) { (g.getAttribute('position') as THREE.BufferAttribute).setXYZ(index,x,y,z); }
  // Eyebrows follow the frontal surface and taper at either end.
  const brows:number[]=[], browIndex:number[]=[];
  for(const side of [-1,1]) {
    const start=brows.length/3;
    for(let i=0;i<=12;i++) {
      const t=i/12, x=side*(.019+t*.048), y=.040+.004*Math.sin(Math.PI*t)+(side===1?.001:0), thickness=.0008+.0024*Math.sin(Math.PI*t);
      for(const offset of [-thickness,thickness]) brows.push(x,y+offset,depth(x,y+offset)+.003);
    }
    for(let i=0;i<12;i++){ const a=start+i*2; if(side===1) browIndex.push(a,a+2,a+1,a+1,a+2,a+3); else browIndex.push(a,a+1,a+2,a+1,a+3,a+2); }
  }
  add(surface(brows,browIndex),browMat);
  // Small nostril wings conform to the sculpted nose, avoiding a separate wedge.
  const nostrils:number[]=[], nostrilIndices:number[]=[];
  for(const side of [-1,1]) {
    const base=nostrils.length/3;
    for(let i=0;i<12;i++){const a=i*Math.PI*2/12,x=side*.010+Math.cos(a)*.0044,y=-.024+Math.sin(a)*.0016; nostrils.push(x,y,depth(x,y)+.0007);}
    for(let i=1;i<11;i++) nostrilIndices.push(base,base+i,base+i+1);
  }
  add(surface(nostrils,nostrilIndices),nostrilMat);
  function dynamicStrip(bands:number) {
    const g=new THREE.BufferGeometry(),p=new THREE.BufferAttribute(new Float32Array(bands*(segments+1)*2*3),3),idx:number[]=[];
    p.setUsage(THREE.DynamicDrawUsage);g.setAttribute('position',p);
    for(let band=0;band<bands;band++) for(let i=0;i<segments;i++) {
      const a=band*(segments+1)*2+i*2;idx.push(a,a+2,a+1,a+1,a+2,a+3);
    }
    g.setIndex(idx);return g;
  }
  const lips=dynamicStrip(2);add(lips,lipMat);
  const mouthSeam=dynamicStrip(1);add(mouthSeam,nostrilMat);
  function paintDisc(g: THREE.BufferGeometry, eye:number, cx:number, cy:number, width:number, height:number, zOffset:number, almond=false, clipToEye=false, opening=0) {
    const base=eye*(1+segments);write(g,base,cx,cy,dynamicDepth(cx,cy)+zOffset);
    for(let i=0;i<segments;i++) { const a=i*Math.PI*2/segments, c=Math.cos(a), x=cx+c*width; let y=cy+Math.sin(a)*height*(almond?1-.25*Math.abs(c):1); if(clipToEye) { const q=THREE.MathUtils.clamp((x-eyeCenters[eye])/design.eyeWidth,-1,1); const limit=opening*.80*Math.sqrt(Math.max(0,1-q*q))*(1-.25*Math.abs(q)); y=THREE.MathUtils.clamp(y,eyeY-limit,eyeY+limit); } write(g,base+1+i,x,y,dynamicDepth(x,y)+zOffset); }
  }
  let lastBlink=NaN,lastSmile=NaN,lastGazeX=NaN,lastGazeY=NaN;
  return { root,
    update(expression) {
      const blink=THREE.MathUtils.clamp(expression.blink,0,1), open=1-blink;
      const gx=THREE.MathUtils.clamp(expression.gazeX ?? 0,-1,1), gy=THREE.MathUtils.clamp(expression.gazeY ?? 0,-1,1);
      const smile=THREE.MathUtils.clamp(expression.smile,-1,1);
      const eyesDirty=Math.abs(blink-lastBlink)>=.001 || Math.abs(gx-lastGazeX)>=.002 || Math.abs(gy-lastGazeY)>=.002 || Number.isNaN(lastBlink);
      const mouthDirty=Math.abs(smile-lastSmile)>=.001 || Number.isNaN(lastSmile);
      if(!eyesDirty && !mouthDirty) return;
      if(eyesDirty) for(let e=0;e<2;e++) {
        const cx=eyeCenters[e], eyeHeight=design.eyeHeight*open;
        paintDisc(whites,e,cx,eyeY,design.eyeWidth,eyeHeight,.0014,true);
        const px=cx+gx*.006, py=eyeY+gy*eyeHeight*.28;
        paintDisc(irises,e,px,py,.0085,Math.min(eyeHeight*.95,.0085),.0021,false,true,eyeHeight);
        paintDisc(pupils,e,px,py,.0035,Math.min(eyeHeight*.65,.0035),.0027,false,true,eyeHeight);
        const base=e*(1+segments*2);write(lids,base,cx,eyeY,dynamicDepth(cx,eyeY)+.001);
        for(let i=0;i<segments;i++) {
          const a=i*Math.PI*2/segments,c=Math.cos(a),sn=Math.sin(a), innerX=cx+c*design.eyeWidth, innerY=eyeY+sn*eyeHeight*(1-.25*Math.abs(c));
          const outerX=cx+c*(design.eyeWidth+.003),outerY=eyeY+sn*(eyeHeight+.003)*(1-.2*Math.abs(c));
          write(lids,base+1+i,innerX,innerY,dynamicDepth(innerX,innerY)+.0019);
          write(lids,base+1+segments+i,outerX,outerY,dynamicDepth(outerX,outerY)+.0013);
        }
      }
      if(eyesDirty) {
        lastBlink=blink;lastGazeX=gx;lastGazeY=gy;
        for(const g of [whites,irises,pupils,lids]) {const p=g.getAttribute('position') as THREE.BufferAttribute;p.needsUpdate=true;g.computeVertexNormals();g.computeBoundingSphere();}
      }
      if(mouthDirty) {
      const mouthY=-.056, width=design.mouth;
      // Continuous strips avoid overlapping fan triangles as the corners rise.
      for(let i=0;i<=segments;i++) {
        const t=i/segments,x=(2*t-1)*width,arch=Math.sin(Math.PI*t),seamY=mouthY+smile*.005*Math.abs(2*t-1);
        const lower=seamY-.005*arch,upper=seamY+.004*arch;
        write(lips,i*2,x,lower,dynamicDepth(x,lower)+.0055);
        write(lips,i*2+1,x,seamY,dynamicDepth(x,seamY)+.0065);
        const top=(segments+1)*2+i*2;
        write(lips,top,x,seamY,dynamicDepth(x,seamY)+.0065);
        write(lips,top+1,x,upper,dynamicDepth(x,upper)+.0055);
        const thickness=.00065*arch;
        write(mouthSeam,i*2,x,seamY-thickness,dynamicDepth(x,seamY-thickness)+.0075);
        write(mouthSeam,i*2+1,x,seamY+thickness,dynamicDepth(x,seamY+thickness)+.0075);
      }
      lastSmile=smile;
      for(const g of [lips,mouthSeam]) {const p=g.getAttribute('position') as THREE.BufferAttribute;p.needsUpdate=true;g.computeVertexNormals();g.computeBoundingSphere();}
      }
    },
    dispose() { geometries.forEach(g=>g.dispose()); materials.forEach(m=>m.dispose()); },
  };
}
