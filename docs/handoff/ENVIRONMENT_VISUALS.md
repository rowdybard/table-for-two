# Environment visual upgrade: handoff

Daniel asked for an AAA pass on the restaurant environment (lighting, shaders, textures, anything visual) that stays GPU-budget friendly on phones, plus a fix for props that overlap, starting with the silverware sitting in the napkin. This file says what has shipped, what is half-built, and how to pick it up.

- Reviewed plan: [`environment-visual-plan.md`](environment-visual-plan.md). Its "Final corrected plan" section is authoritative.
- Detailed first draft (the "as planned" values the reviewed plan refers to): [`environment-visual-plan-detail.md`](environment-visual-plan-detail.md).
- Shared constants: `src/restaurant/render/VenueContract.ts`.

## Status

| Workstream | Scope | Status |
| --- | --- | --- |
| Seed | `VenueContract.ts`; bill folio moved out of the bread basket to (.31, -1.04) | Done |
| A, lighting | Spotlit table pendant, static key shadow, venue reflection map, glow halos, phone tier, adaptive pixel ratio | See the pull request that carries this file |
| C, layout | Napkin off the silverware, plate winding, cutlery resting on the rim, glasses, cloth and stain off the menu, contact shadows that follow props, `tests/tabletop-layout.test.ts` | See the pull request that carries this file |
| B, surfaces | Stone floor shader, velvet sheen and tufted booths, brass and silver, polished table top, glass and bottles, plaster AO, neon exterior, shared procedural texture sources | Not started |

The pull request description is updated with the final status of A and C when it merges. Anything listed there as "not done" belongs here.

## Picking up workstream B

Owner files: `ProceduralMaterials.ts`, `EnvironmentAssets.ts`, `RestaurantScene.ts` (CRLF), `NightExterior.ts`, `RestaurantPropKit.ts`, and a new `tests/venue-surfaces.test.ts`. The full list of changes is under "Workstream B: surfaces" in the reviewed plan. Points that are easy to get wrong:

- `createFabricMaterial` and `disposeProceduralMaterial` feed the character wardrobe. Their output must stay byte-identical.
- Pendant meshes should stop casting by baking them into their own builders with `castShadow = false`. Turning shadows off on the shared `dark`, `brass`, `ceramic` materials would also stop table bases and side plates from casting.
- Table and chair furniture needs `DYNAMIC_SHADOW_LAYER` as well as `STATIC_SHADOW_LAYER`, or the table spotlight lights the floor through the table top.
- `barWash` goes away only once lighting adds the bar spotlight.
- `public/` stays byte-identical. Texture sites were blocked from the cloud box, so new maps are canvas-authored.
- Every `onBeforeCompile` hook chains the previous one and sets a unique `customProgramCacheKey`. Check the chunk names against `node_modules/three/src/renderers/shaders`.

## Budget rules (Daniel's standing request)

- No full-screen post pass. Glow comes from additive halos.
- No extra shadow-casting point lights. One static key shadow and one table spotlight shadow (512 and every second frame on the low tier).
- Textures 1K or smaller. Prefer shared canvas sources over new downloads.
- The quality tier is fixed before the first shader compile. `?quality=high|low` forces a tier for testing.

## Checks only Daniel can do

These cannot be measured in the cloud box, which has software WebGL only:

- Phone frame rate on the low tier, and iPhone loading time.
- Shadows and metals after backgrounding the iPhone page and coming back (context restore).
- Date faces in the booth, solo and with both Double dates, now that faces are not shadowed by the spotlight.
- The quiet-table move: the table pendant, spotlight and halo should travel with the table.
- All four Double settings from both human seats; cutlery sitting clear of the napkin.
- The waiter no longer casts a shadow away from the table. That is an accepted trade-off.
