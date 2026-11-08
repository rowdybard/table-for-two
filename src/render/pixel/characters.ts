import { pixel } from './world';

export type PixelDirection = 'front' | 'back' | 'side';
export type PixelPerson = 'p1' | 'p2' | 'mira' | 'dev';
type Outfit = { skin: string; skinLight: string; shade: string; hair: string; hairLight: string; cloth: string; seam: string; light: string; pants: string; trouserLight: string };
const OUTFITS: Record<PixelPerson, Outfit> = {
  p1: { skin: '#dca47c', skinLight: '#edbd91', shade: '#a86950', hair: '#422c27', hairLight: '#6e4430', cloth: '#94483b', seam: '#60332f', light: '#bc7157', pants: '#35393c', trouserLight: '#505354' },
  p2: { skin: '#a97255', skinLight: '#c78d66', shade: '#774d3b', hair: '#282322', hairLight: '#4b3730', cloth: '#d8bd90', seam: '#99805e', light: '#efdab2', pants: '#354e48', trouserLight: '#4f6c5b' },
  mira: { skin: '#bb805b', skinLight: '#d59d71', shade: '#8b573f', hair: '#352723', hairLight: '#684535', cloth: '#af7d42', seam: '#75532f', light: '#d5a568', pants: '#663e39', trouserLight: '#825447' },
  dev: { skin: '#9f6b51', skinLight: '#be8764', shade: '#724b3c', hair: '#282422', hairLight: '#635044', cloth: '#496d5d', seam: '#2e4b42', light: '#6a8b70', pants: '#343c44', trouserLight: '#4d555a' },
};

/** Authored parts on a 60-unit grid; feet and physical height retain the 30-pixel contract. */
export function drawPixelCharacter(c: CanvasRenderingContext2D, x: number, y: number, person: PixelPerson, direction: PixelDirection = 'front', facing: 1 | -1 = 1, walk = 0, time = 0, scale = 1, wave = false, kiss = false) {
  const p = OUTFITS[person], unit = scale / 2, flip = direction === 'side' ? facing : 1;
  const seed = person === 'p1' ? 0 : person === 'p2' ? 1.6 : person === 'mira' ? 3.1 : 4.4;
  const moving = Math.max(0, Math.min(1, walk)), phase = time * 9 + seed;
  const step = Math.round(Math.sin(phase) * moving * 3);
  const leftLift = moving > .15 && Math.sin(phase) > .55 ? 2 : 0;
  const rightLift = moving > .15 && Math.sin(phase) < -.55 ? 2 : 0;
  const bob = moving > .15 && Math.abs(step) > 1 ? -1 : 0;
  const blink = (time + seed) % 4.7 > 4.52;
  const r = (dx: number, dy: number, w: number, h: number, color: string) => pixel(c, Math.round(x) + (flip === 1 ? dx : -dx - w) * unit, Math.round(y) + dy * unit, w * unit, h * unit, color);
  const upper = (dx: number, dy: number, w: number, h: number, color: string) => r(dx, dy + bob, w, h, color);

  // A planted shadow, separate knees and alternating heels keep the feet grounded.
  r(-11, -1, 22, 2, '#38231f'); r(-8, 1, 16, 1, '#452823');
  const leftX = -7 + (direction === 'side' ? step : 0), rightX = 2 - (direction === 'side' ? step : 0);
  r(leftX, -22, 6, 21 - leftLift, p.pants); r(rightX, -22, 6, 21 - rightLift, p.pants);
  r(leftX + 1, -18, 2, 12 - leftLift, p.trouserLight); r(rightX + 1, -18, 1, 11 - rightLift, p.trouserLight);
  r(leftX - 1, -3 - leftLift, 8, 3, '#262424'); r(rightX - 1, -3 - rightLift, 8, 3, '#262424');
  r(leftX, -1 - leftLift, 7, 1, '#8c7760'); r(rightX, -1 - rightLift, 7, 1, '#8c7760');

  // Shoulder slope, tucked waist and cuffs distinguish clothing from a rectangular torso.
  upper(-8, -42, 16, 3, p.seam); upper(-10, -39, 20, 14, p.seam);
  upper(-9, -40, 18, 17, p.cloth); upper(-7, -24, 14, 3, p.seam);
  upper(-8, -38, 2, 12, p.light); upper(7, -37, 2, 12, p.seam);
  if (direction !== 'back') {
    upper(-2, -41, 4, 16, person === 'p2' ? '#49675b' : '#e9d7b4');
    upper(-4, -41, 3, 3, p.light); upper(1, -41, 3, 3, p.light);
    upper(-3, -37, 1, 10, p.seam); upper(3, -37, 1, 10, p.light);
    if (person === 'p1') {
      upper(-7, -29, 4, 1, p.light); upper(4, -29, 3, 1, p.light);
      upper(-8, -24, 16, 1, '#d8b891'); upper(-8, -22, 16, 1, '#d8b891');
    } else if (person === 'p2') {
      upper(-6, -33, 1, 9, p.light); upper(6, -33, 1, 9, p.light);
      upper(-7, -23, 14, 1, p.light);
    } else if (person === 'mira') {
      upper(-2, -40, 4, 7, '#8b4338'); upper(1, -35, 3, 7, '#c07553');
      upper(-6, -28, 4, 2, p.seam);
    } else {
      upper(-7, -38, 4, 13, '#354d43'); upper(3, -38, 4, 13, '#354d43');
      for (const yy of [-35, -31, -27]) upper(0, yy, 1, 1, '#d9ba82');
    }
  } else {
    upper(-7, -38, 14, 1, p.light); upper(-1, -36, 1, 12, p.seam);
    upper(-7, -25, 14, 1, p.seam);
  }

  const armSwing = direction === 'side' ? step : Math.round(step / 2);
  upper(-12, -38, 4, 12 + armSwing, p.seam); upper(-11, -37, 3, 11 + armSwing, p.cloth);
  upper(-11, -27 + armSwing, 3, 2, p.light); upper(-11, -25 + armSwing, 3, 5, p.skin);
  upper(-10, -25 + armSwing, 1, 3, p.skinLight);
  if (wave) {
    const tilt = Math.sin(time * 6) > 0 ? 1 : -1;
    upper(8, -41, 4, 9, p.cloth); upper(11, -47, 3, 9, p.seam);
    upper(12, -48, 2, 8, p.light); upper(11 + tilt, -53, 4, 6, p.skin);
    upper(11 + tilt, -54, 1, 3, p.skinLight);
  } else {
    upper(8, -38, 4, 12 - armSwing, p.seam); upper(8, -37, 3, 11 - armSwing, p.cloth);
    upper(8, -27 - armSwing, 3, 2, p.light); upper(8, -25 - armSwing, 3, 5, p.skin);
    upper(8, -25 - armSwing, 1, 3, p.skinLight);
  }

  upper(-3, -45, 6, 5, p.shade); upper(-2, -44, 4, 3, p.skin);
  upper(-6, -57, 12, 11, p.skin); upper(-5, -47, 10, 3, p.skin);
  upper(-6, -56, 2, 9, p.shade); upper(-3, -56, 7, 3, p.skinLight);
  if (direction === 'back') {
    upper(-5, -60, 10, 3, p.hair); upper(-7, -57, 14, 10, p.hair);
    upper(-5, -48, 10, 3, p.hair); upper(-5, -57, 1, 8, p.hairLight);
    if (person === 'p2' || person === 'mira') upper(-6, -48, 12, 6, p.hair);
  } else {
    // Each person has an authored hair silhouette rather than a palette-swapped head.
    if (person === 'p1') {
      upper(-5, -60, 10, 3, p.hair); upper(-7, -58, 14, 3, p.hair);
      upper(0, -61, 5, 2, p.hair); upper(-6, -58, 3, 2, p.hairLight);
      upper(-7, -56, 2, 6, p.hair);
    } else if (person === 'p2') {
      upper(-4, -61, 8, 2, p.hair); upper(-7, -59, 14, 4, p.hair);
      upper(-8, -56, 3, 5, p.hair); upper(5, -56, 3, 5, p.hair);
      upper(-7, -51, 2, 6, p.hair); upper(5, -51, 2, 6, p.hair);
      upper(-4, -59, 2, 1, p.hairLight); upper(2, -58, 2, 1, p.hairLight);
    } else if (person === 'mira') {
      upper(-6, -60, 12, 3, p.hair); upper(-8, -57, 3, 13, p.hair);
      upper(5, -57, 3, 13, p.hair); upper(-5, -57, 4, 2, p.hair);
      upper(-7, -55, 1, 9, p.hairLight);
    } else {
      upper(-5, -60, 10, 3, p.hair); upper(-7, -57, 14, 2, p.hair);
      upper(-7, -55, 2, 5, p.hairLight); upper(5, -55, 2, 5, p.hairLight);
      upper(-4, -46, 8, 1, p.shade);
    }
    if (direction === 'side') {
      upper(-7, -55, 2, 7, p.hair); upper(-5, -52, 2, 4, p.skinLight);
      upper(1, -54, 3, 1, p.hair);
      upper(2, -52, 2, 1, blink || kiss ? p.shade : '#2c2623');
      upper(6, -52, 2, 4, p.skinLight); upper(5, -49, 2, 2, p.skin);
      upper(kiss ? 7 : 3, -47, kiss ? 2 : 3, 1, p.shade);
      if (person === 'p2') upper(-5, -48, 1, 2, '#e3b95e');
    } else {
      upper(-4, -54, 3, 1, p.hair); upper(2, -54, 3, 1, p.hair);
      upper(-4, -52, 2, 1, blink ? p.shade : '#2b2624'); upper(3, -52, 2, 1, blink ? p.shade : '#2b2624');
      upper(0, -51, 1, 3, p.shade); upper(-2, -47, 4, 1, p.shade);
      upper(-1, -46, 2, 1, p.skinLight);
      if (person === 'p2') { upper(-7, -48, 1, 2, '#e3b95e'); upper(6, -48, 1, 2, '#e3b95e'); }
    }
  }
}