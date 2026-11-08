import * as THREE from 'three';

/** All variation is authored procedurally, with a stable seed and no imported pixels. */
export function createVenueMaterials() {
  const textures: THREE.Texture[] = [], materials: THREE.Material[] = [];
  function canvasTexture(base:string,paint:(c:CanvasRenderingContext2D,random:()=>number)=>void,repeatX=1,repeatY=1) {
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
    const c=canvas.getContext('2d');if(!c)throw new Error('Canvas is unavailable');
    let seed=17973;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    c.fillStyle=base;c.fillRect(0,0,512,512);paint(c,random);
    const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(repeatX,repeatY);t.anisotropy=4;textures.push(t);return t;
  }
  const wood=canvasTexture('#875936',(c,r)=>{
    for(let i=0;i<155;i++){const x=r()*512;c.beginPath();c.moveTo(x,0);for(let y=0;y<=512;y+=24)c.lineTo(x+Math.sin(y*.012+i)*r()*6,y);c.strokeStyle=i%4?'rgba(53,29,19,.13)':'rgba(233,183,120,.16)';c.lineWidth=.4+r()*1.3;c.stroke();}
    for(let i=0;i<16;i++){c.beginPath();c.ellipse(r()*512,r()*512,2+r()*4,10+r()*22,.1,0,Math.PI*2);c.strokeStyle='rgba(66,38,24,.15)';c.stroke();}
  },2,1);
  const maple=canvasTexture('#c99b66',(c,r)=>{
    for(let i=0;i<18;i++){const x=i*30;c.fillStyle=i%2?'rgba(100,58,30,.04)':'rgba(255,227,171,.09)';c.fillRect(x,0,29,512);c.fillStyle='rgba(77,48,28,.22)';c.fillRect(x,0,1,512);}
    for(let i=0;i<500;i++){const x=r()*512,y=r()*512;c.fillStyle='rgba(94,57,33,.09)';c.fillRect(x,y,.7,4+r()*32);}
  },1,3);
  const plaster=canvasTexture('#d9d1c0',(c,r)=>{
    // Broad, low-contrast hand-painted strokes give plaster a soft surface
    // without simulating dirt or covering it in regular graphic noise.
    for(let i=0;i<420;i++){
      const x=r()*512,y=r()*512,w=10+r()*75,h=2+r()*12;
      c.fillStyle=i%2?'rgba(105,98,83,.012)':'rgba(255,250,238,.021)';
      c.beginPath();c.ellipse(x,y,w,h,(r()-.5)*.16,0,Math.PI*2);c.fill();
    }
    for(let i=0;i<4500;i++){const x=r()*512,y=r()*512;c.fillStyle=i%2?'rgba(85,79,69,.018)':'rgba(255,252,245,.032)';c.fillRect(x,y,1+r()*2,1+r()*2);}
  },2,1);
  const night=canvasTexture('#304049',(c,r)=>{
    const sky=c.createLinearGradient(0,0,0,512);sky.addColorStop(0,'#26363f');sky.addColorStop(1,'#4b5554');c.fillStyle=sky;c.fillRect(0,0,512,512);
    c.fillStyle='rgba(17,27,32,.6)';c.beginPath();c.moveTo(0,380);for(let x=0;x<=512;x+=42)c.lineTo(x,355+r()*45);c.lineTo(512,512);c.lineTo(0,512);c.closePath();c.fill();
    for(let i=0;i<22;i++){c.fillStyle=i%4?'rgba(234,190,128,.35)':'rgba(237,211,166,.55)';c.fillRect(r()*512,375+r()*100,2+r()*3,2+r()*3);}
    c.strokeStyle='rgba(226,224,204,.08)';c.lineWidth=12;c.beginPath();c.moveTo(42,0);c.lineTo(170,512);c.moveTo(294,0);c.lineTo(420,512);c.stroke();
  });
  const leather=canvasTexture('#873e3b',(c,r)=>{for(let i=0;i<2600;i++){const x=r()*512,y=r()*512;c.fillStyle=i%2?'rgba(47,17,17,.04)':'rgba(235,158,130,.035)';c.fillRect(x,y,1+r()*3,1+r()*2);}},1,1);
  const carpet=canvasTexture('#573431',(c,r)=>{for(let i=0;i<5000;i++){c.fillStyle=i%2?'rgba(23,18,17,.10)':'rgba(211,139,105,.06)';c.fillRect(r()*512,r()*512,2,1);}for(let y=12;y<512;y+=64)for(let x=12;x<512;x+=64){c.strokeStyle='rgba(200,149,105,.17)';c.lineWidth=1;c.beginPath();c.moveTo(x,y-5);c.lineTo(x+4,y);c.lineTo(x,y+5);c.lineTo(x-4,y);c.closePath();c.stroke();}},5,5);
  const make=(p:THREE.MeshStandardMaterialParameters)=>{const m=new THREE.MeshStandardMaterial(p);materials.push(m);return m;};
  const m={
    walnut:make({map:wood,color:'#b5875d',roughness:.75}),walnutDark:make({map:wood,color:'#765039',roughness:.82}),
    maple:make({map:maple,color:'#f0d0a4',roughness:.56}),plaster:make({map:plaster,color:'#d9d4c8',roughness:1}),
    leather:make({map:leather,color:'#c57a6c',roughness:.78}),leatherDark:make({map:leather,color:'#8c514a',roughness:.82}),
    carpet:make({map:carpet,color:'#b38c83',roughness:1}),felt:make({color:'#49685a',roughness:1}),
    brass:make({color:'#b28d56',metalness:.7,roughness:.43}),cream:make({color:'#eee0c5',roughness:.86}),
    dark:make({color:'#292526',roughness:.87}),shoe:make({color:'#773a37',roughness:.8}),
    glass:make({color:'#a3bfc0',transparent:true,opacity:.19,roughness:.22,metalness:.06,depthWrite:false,side:THREE.DoubleSide}),
    nightGlass:make({map:night,color:'#d4ddd9',roughness:.48,metalness:.06}),
    light:make({color:'#ffe2aa',emissive:'#e5ae63',emissiveIntensity:.48,roughness:.7}),
    ceiling:make({color:'#b4a995',roughness:1}),black:make({color:'#181817',roughness:1}),
    paper:make({color:'#dcc797',roughness:.95}),
  };
  return { ...m, dispose(){materials.forEach(x=>x.dispose());textures.forEach(x=>x.dispose());} };
}
export type VenueMaterials = ReturnType<typeof createVenueMaterials>;
