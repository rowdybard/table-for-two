import * as THREE from 'three';

export type SurfaceKind = 'wood' | 'plaster' | 'linen' | 'velvet' | 'ceramic' | 'terracotta' | 'tile';
export type FabricKind = 'knit' | 'woven' | 'satin' | 'leather';
const patternSources = new Map<string, { color: HTMLCanvasElement; roughness: HTMLCanvasElement; bump: HTMLCanvasElement }>();

/** Reproducible authored marks; textures are drawn locally, never loaded from a file. */
function random(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
}

function canvas(size: number) {
  const image = document.createElement('canvas'); image.width = image.height = size;
  return { image, ctx: image.getContext('2d')! };
}

function texture(image: HTMLCanvasElement, color: boolean) {
  const result = new THREE.CanvasTexture(image);
  result.name = `authored-${color ? 'color' : 'surface'}`;
  result.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  result.wrapS = result.wrapT = THREE.RepeatWrapping;
  result.anisotropy = 4;
  return result;
}

function marks(kind: SurfaceKind | FabricKind, size = 256) {
  const key = kind + ':' + size, cached = patternSources.get(key);
  // Share immutable authored pixels, while each material still owns its GPU maps.
  if (cached) return { map: texture(cached.color, true), roughnessMap: texture(cached.roughness, false), bumpMap: texture(cached.bump, false) };
  const { image, ctx } = canvas(size), surface = canvas(size), bump = canvas(size);
  const rng = random([...kind].reduce((n, c) => n + c.charCodeAt(0), 3571));
  ctx.fillStyle = '#f2f0eb'; ctx.fillRect(0, 0, size, size);
  surface.ctx.fillStyle = '#c4c4c4'; surface.ctx.fillRect(0, 0, size, size);
  bump.ctx.fillStyle = '#808080'; bump.ctx.fillRect(0, 0, size, size);
  const line = (context: CanvasRenderingContext2D, color: string, width: number, x: number, y: number, dx: number, dy: number) => {
    context.strokeStyle = color; context.lineWidth = width; context.beginPath(); context.moveTo(x, y); context.lineTo(dx, dy); context.stroke();
  };
  if (kind === 'wood') {
    // Continuous long grain and staggered boards, with restrained growth rings.
    for (let board = 0; board < 4; board++) {
      const y = board * 64;
      ctx.fillStyle = board % 2 ? '#efede8' : '#f7f3eb'; ctx.fillRect(0, y, size, 64);
      line(ctx, '#bcb5a7', 1.2, 0, y, size, y);
      line(bump.ctx, '#454545', 1.8, 0, y, size, y);
      for (let strand = 0; strand < 26; strand++) {
        const py = y + 2 + strand * 2.25;
        ctx.strokeStyle = `rgba(76,54,33,${.035 + rng() * .055})`; ctx.lineWidth = .4 + rng() * .65;
        ctx.beginPath(); ctx.moveTo(-8, py);
        for (let x = 0; x <= size + 8; x += 8) ctx.lineTo(x, py + Math.sin(x * .043 + strand * .7) * (1.2 + strand % 3));
        ctx.stroke();
      }
      const joint = board % 2 ? 168 : 55;
      line(ctx, '#c7bfb0', 1, joint, y, joint, y + 64);
      line(bump.ctx, '#5d5d5d', 1, joint, y, joint, y + 64);
    }
    surface.ctx.fillStyle = '#a7a7a7'; surface.ctx.fillRect(0, 0, size, size);
  } else if (['linen', 'velvet', 'woven', 'knit', 'satin'].includes(kind)) {
    const spacing = kind === 'knit' ? 8 : kind === 'velvet' ? 3 : 4;
    for (let p = 0; p < size; p += spacing) {
      line(ctx, kind === 'satin' ? '#e3e2df' : '#d4d2cd', .7, p, 0, p, size);
      line(ctx, kind === 'velvet' ? '#e7e5df' : '#e0ded8', .65, 0, p + 1, size, p + 1);
      line(bump.ctx, '#999999', .7, p, 0, p, size);
      if (kind === 'knit') {
        for (let q = 0; q < size; q += spacing) {
          line(ctx, '#c8c6c0', .8, p, q, p + 3, q + 5);
          line(ctx, '#faf8f4', .8, p + 3, q + 5, p + 6, q);
        }
      }
    }
    surface.ctx.fillStyle = kind === 'satin' ? '#747474' : kind === 'velvet' ? '#e3e3e3' : '#d0d0d0'; surface.ctx.fillRect(0, 0, size, size);
  } else if (kind === 'leather') {
    ctx.fillStyle = '#eeeae3'; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 1800; i++) {
      const x = rng() * size, y = rng() * size;
      ctx.fillStyle = 'rgba(60,45,30,.045)'; ctx.fillRect(x, y, .8, 1.3);
      bump.ctx.fillStyle = '#737373'; bump.ctx.fillRect(x, y, 1, 1);
    }
    surface.ctx.fillStyle = '#a4a4a4'; surface.ctx.fillRect(0, 0, size, size);
  } else {
    const count = kind === 'plaster' ? 4500 : kind === 'terracotta' ? 2100 : kind === 'tile' ? 1100 : 500;
    for (let i = 0; i < count; i++) {
      const x = rng() * size, y = rng() * size, r = .35 + rng() * (kind === 'plaster' ? 1.1 : .7);
      ctx.fillStyle = `rgba(${rng() > .45 ? '95,85,70' : '255,255,250'},${.025 + rng() * .055})`;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * .65, 0, 0, Math.PI * 2); ctx.fill();
      bump.ctx.fillStyle = rng() > .5 ? '#898989' : '#787878'; bump.ctx.fillRect(x, y, r, r);
    }
    if (kind === 'tile') {
      // A fine glaze edge reinforces the real geometric grout gaps.
      ctx.strokeStyle = '#d0cec5'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, size - 2, size - 2);
      surface.ctx.fillStyle = '#a0a0a0'; surface.ctx.fillRect(0, 0, size, size);
    }
    if (kind === 'terracotta') {
      for (let y = 5; y < size; y += 10) line(ctx, 'rgba(80,50,30,.045)', .6, 0, y, size, y);
    }
    if (kind === 'ceramic') { surface.ctx.fillStyle = '#858585'; surface.ctx.fillRect(0, 0, size, size); }
  }
  patternSources.set(key, { color: image, roughness: surface.image, bump: bump.image });
  return { map: texture(image, true), roughnessMap: texture(surface.image, false), bumpMap: texture(bump.image, false) };
}

export function createProceduralMaterial(kind: SurfaceKind, color: string, options: { roughness?: number; metersPerTile?: number; bumpScale?: number } = {}) {
  const maps = marks(kind);
  const material = new THREE.MeshStandardMaterial({ color, ...maps, roughness: options.roughness ?? .85, bumpScale: options.bumpScale ?? (kind === 'wood' ? .0025 : kind === 'plaster' ? .003 : .001) });
  material.name = `authored-${kind}`;
  material.userData.metersPerTile = options.metersPerTile ?? ({ wood: .8, plaster: .6, linen: .2, velvet: .16, ceramic: .25, terracotta: .35, tile: .47 }[kind]);
  return material;
}

/** Caller owns the returned material and maps; use disposeProceduralMaterial at teardown. */
export function createFabricMaterial(color: string, kind: FabricKind): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color, ...marks(kind), roughness: kind === 'satin' ? .68 : kind === 'leather' ? .75 : .92, bumpScale: kind === 'knit' ? .0014 : .0006 });
  material.name = `authored-fabric-${kind}`;
  return material;
}

export function disposeProceduralMaterial(material: THREE.MeshStandardMaterial) {
  new Set([material.map, material.roughnessMap, material.bumpMap]).forEach(map => map?.dispose());
  material.dispose();
}
