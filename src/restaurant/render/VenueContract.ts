/**
 * Shared constants for the venue lighting, surfaces and tabletop layout.
 * Lighting reads the tags; surfaces and tabletop props set them when they build materials.
 */

/** Baked room, furniture and plant meshes that cast into the static key-light shadow. Layer 0 always stays enabled. */
export const STATIC_SHADOW_LAYER = 1;
/** Tabletop casters, table furniture and actor bodies that cast into the table spotlight's shadow. */
export const DYNAMIC_SHADOW_LAYER = 2;

/** Pendant centres [x, z]. Entry 0 is diningRoot-local and travels with the quiet-table move. */
export const PENDANTS = [[0, -1.15], [-3.5, -3.5], [3.5, -3.5], [-3.38, 1.2], [3.38, 1.2]] as const;
export const PENDANT_Y = { cap: 2.9, shadeTop: 2.84, mouth: 2.64, glowDisc: 2.65, light: 2.6, halo: 2.58 } as const;
/** Side-table candle positions [x, z]; flame height .955. */
export const CANDLES = [[-3.3, -3.5], [3.7, -3.5], [-3.18, -.15], [3.58, -.15], [-3.18, 2.1], [3.58, 2.1]] as const;
export const BAR_STRIPS = { y: [1.402, 2.012], z: -6.79, halfLength: 1.49 } as const;

/** Linear RGB for toneMapped:false emissive fixtures (glow discs, bulbs). */
export const GLOW_LINEAR = [1.0, .8, .52] as const;
/** Table-lamp shade emissive intensity by lampLevel 0..2. */
export const LAMP_SHADE_EMISSIVE = [.07, .27, .5] as const;

/**
 * Environment-reflection strengths. scene.environment uses `scene`.
 * A material with `userData.venueEnv = VENUE_ENV.x` gets the venue map as an explicit envMap at that intensity.
 * `userData.venueGlass = true` opts a transparent material into the fresnel-alpha glass hook.
 */
export const VENUE_ENV = { scene: .4, metal: 1.0, glass: 1.2, water: .8, glaze: .6, polished: .5, floor: .35, wood: .3 } as const;

/** `object.userData.contactShadow = { rx, rz, opacity }` requests a soft contact blob under that object. */
export interface ContactShadowTag { rx: number; rz: number; opacity: number }
export const CONTACT_SHADOW_MAX = 64;
