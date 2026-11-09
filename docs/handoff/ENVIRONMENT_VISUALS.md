# Environment visual upgrade: handoff

Daniel asked for an AAA pass on the restaurant environment (lighting, shaders, textures, anything visual) that stays GPU-budget friendly on phones, plus a fix for props that overlap, starting with the silverware sitting in the napkin. This file says what has shipped, what is half-built, and how to pick it up.

- Reviewed plan: [`environment-visual-plan.md`](environment-visual-plan.md). Its "Final corrected plan" section is authoritative.
- Detailed first draft (the "as planned" values the reviewed plan refers to): [`environment-visual-plan-detail.md`](environment-visual-plan-detail.md).
- Shared constants: `src/restaurant/render/VenueContract.ts`.

## Status

| Workstream | Scope | Status |
| --- | --- | --- |
| Seed | `VenueContract.ts`; bill folio moved out of the bread basket to (.31, -1.04) | Done |
| A, lighting | Spotlit table pendant with its own shadow, static fitted key shadow, venue reflection map, glass fresnel, glow halos (pendants, candles, bar strips, table lamp), booth fill on both tiers, phone tier, adaptive pixel ratio that undoes steps that do not help, WebGL context-restore handling | Shipped |
| C, layout | Napkin beside the fork and off the silverware in every seat, far settings mirrored so each date's fork is on their left, plate winding fixed, finished cutlery resting on the rim, Double date glasses off the forks, tipped glass lying on the cloth, cloth and stain off the menu, contact shadows that follow props and the quiet table, `tests/tabletop-layout.test.ts` over 206 states | Shipped |
| B, surfaces | Stone floor shader, velvet sheen and tufted booths, brass and silver, polished table top, glass and bottles, plaster AO, neon exterior, shared procedural texture sources, removing `barWash` | Not started (only the spill puddle was raised to .7843) |

### Known follow-ups from review

- The room away from the table is darker than before by design (pools of light). The ceiling is close to black because no light points up; lifting the hemisphere ground colour is the cheapest fix if Daniel wants it brighter.
- On the Low tier the P3/P4 halos and glow discs still glow although those two spotlights only exist on High.
- The table spotlight's shadow frustum (focus .55) is narrower than its lit cone; raising focus to about .7 softens tabletop shadows slightly but removes the hard arc at the edge of the shadowed area.
- The `!parallelCompile` early return in `RestaurantRenderer.requestWarmup` was kept. Removing it needs a bounded asset wait and an iPhone check.
- Until workstream B lands, `ensureVenueShadowLayers` in `RestaurantLighting.ts` assigns the baked `restaurant-*` batches to the static layer and the dining furniture to the spotlight layer. B should put those layers on its batches directly.
- The table pendant fixture now lives in `diningRoot` (its own builder, casting nothing), so it travels with the quiet table. P1 to P4 are still baked into the room batches.

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
