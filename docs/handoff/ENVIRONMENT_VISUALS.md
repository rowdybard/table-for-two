# Environment visual upgrade: handoff

Daniel asked for an AAA pass on the restaurant environment (lighting, shaders, textures, anything visual) that stays GPU-budget friendly on phones, plus a fix for props that overlap, starting with the silverware sitting in the napkin. This file says what has shipped, what is half-built, and how to pick it up.

- Reviewed plan: [`environment-visual-plan.md`](environment-visual-plan.md). Its "Final corrected plan" section is authoritative.
- Detailed first draft (the "as planned" values the reviewed plan refers to): [`environment-visual-plan-detail.md`](environment-visual-plan-detail.md).
- Shared constants: `src/restaurant/render/VenueContract.ts`.

## Status

| Workstream | Scope | Status |
| --- | --- | --- |
| Seed | `VenueContract.ts`; bill folio moved out of the bread basket to (.31, -1.04) | Done |
| A, lighting | Spotlit table pendant (no shadow since the frame-rate pass), static fitted key shadow on High only, venue reflection map on tagged metal, glass, glaze and water, glass fresnel, glow halos (pendants, candles, bar strips, table lamp), booth fill on both tiers, phone tier, adaptive pixel ratio that undoes steps that do not help, WebGL context-restore handling | Shipped |
| C, layout | Napkin beside the fork and off the silverware in every seat, far settings mirrored so each date's fork is on their left, plate winding fixed, finished cutlery resting on the rim, Double date glasses off the forks, tipped glass lying on the cloth, cloth and stain off the menu, contact shadows that follow props and the quiet table, `tests/tabletop-layout.test.ts` over 206 states | Shipped |
| B, surfaces | Stone floor shader, velvet sheen and tufted booths, brass and silver, polished table top, glass and bottles, plaster AO, neon exterior, shared procedural texture sources, removing `barWash` | Not started (only the spill puddle was raised to .7843) |

### Frame-rate pass (9 Nov 2026)

After the first deploy Daniel reported major frame-rate lag and said the shadows were not adding much. A GL-call trace showed the pass drew less than before (194 screen draws against 236, a 48-draw shadow pass against 142), so the cost was per-pixel shading. A fill-bound software-renderer timing at 960x540 put the live build 32-45% slower per frame than the build before the pass. Removing the table spot's shadow recovered the table view; removing the scene-wide reflection map recovered most of the room (to within about 8% of before). Changes:

- The table spotlight casts no shadow. The key shadow is the only shadow map, on High only, re-rendered only when the layout changes. Low has no shadow maps at all. Tabletop props and actors cast nothing; contact blobs (now at full strength) ground the props. A soft floor shade under the pedestal table (`createFloorShade`, one transparent draw per layout) replaces the dark pool the table's shadow used to leave, so the spot no longer lights the floor under the tabletop.
- No `scene.environment`. Only materials tagged with `userData.venueEnv` (metal, glass, glaze, water) sample the venue map. The hemisphere was raised to keep the room's brightness.
- Per-frame waste removed: the crosshair interaction is computed once per frame without extra full-scene matrix passes, invisible hit boxes are no longer drawn, thin glass draws in one pass instead of two, contact shadows upload only when a blob changes, opaque draws are grouped by shader program, and the face expression runs on GPU morph targets instead of rewriting and re-uploading the face every frame while someone talks.
- Hair was checked: 2-3 opaque draws per head with alpha-to-coverage, no per-frame work. The 9 texture uploads per frame are three's bone matrices (3 skeletons per actor).

Further headroom if a device still struggles, from the audit: merge each actor's head and limb meshes (35-41 draws per actor today), share one skeleton per actor, delete the always-zero `farewellLight` by reusing an existing light for the farewell shot, fold `barWash` into the bar spot, decimate the potted plant's 54k-triangle soil mesh, and instance the meal pieces.

### Known follow-ups from review

- The room away from the table is darker than before by design (pools of light). The ceiling is close to black because no light points up; lifting the hemisphere ground colour is the cheapest fix if Daniel wants it brighter.
- On the Low tier the P3/P4 halos and glow discs still glow although those two spotlights only exist on High.
- The `!parallelCompile` early return in `RestaurantRenderer.requestWarmup` was kept. Removing it needs a bounded asset wait and an iPhone check.
- Until workstream B lands, `ensureVenueShadowLayers` in `RestaurantLighting.ts` assigns the baked `restaurant-*` batches, dining furniture included, to the static key layer. B should put that layer on its batches directly.
- The table pendant fixture now lives in `diningRoot` (its own builder, casting nothing), so it travels with the quiet table. P1 to P4 are still baked into the room batches.

- `barWash` (a point light over the bar in `RestaurantScene.ts`) is still there alongside the new bar spotlight, so the low tier has 12 lights against main's 13 rather than the planned 10. Delete it with workstream B and re-check the bar on both tiers, because the bar spot (4.5) was tuned with it present.
- Found during review, not caused by this pass: while a main is served the meal target box also covers the crossed-cutlery target, so rested cutlery cannot be picked back up; and the bill target is hit before the bread when the check is on the table.
- `browser-tabletop-art.spec.ts` still passes, but the lemon posset sits only 1 mm above its lower height limit. Comparing against the plate top (.794) would make that check less brittle.

## Picking up workstream B

Owner files: `ProceduralMaterials.ts`, `EnvironmentAssets.ts`, `RestaurantScene.ts` (CRLF), `NightExterior.ts`, `RestaurantPropKit.ts`, and a new `tests/venue-surfaces.test.ts`. The full list of changes is under "Workstream B: surfaces" in the reviewed plan. Points that are easy to get wrong:

- `createFabricMaterial` and `disposeProceduralMaterial` feed the character wardrobe. Their output must stay byte-identical.
- Pendant meshes should stop casting by baking them into their own builders with `castShadow = false`. Turning shadows off on the shared `dark`, `brass`, `ceramic` materials would also stop table bases and side plates from casting.
- `barWash` goes away only once lighting adds the bar spotlight.
- `public/` stays byte-identical. Texture sites were blocked from the cloud box, so new maps are canvas-authored.
- Every `onBeforeCompile` hook chains the previous one and sets a unique `customProgramCacheKey`. Check the chunk names against `node_modules/three/src/renderers/shaders`.

## Budget rules (Daniel's standing request)

- No full-screen post pass. Glow comes from additive halos.
- No live shadows. One static key shadow on High, re-rendered only on layout changes; no shadow maps on Low.
- No scene-wide environment map. Tag the few materials that should reflect.
- Every light is shaded on every lit pixel in three, whatever its range or intensity, so a new light costs the whole screen. Remove one before adding one.
- Textures 1K or smaller. Prefer shared canvas sources over new downloads.
- The quality tier is fixed before the first shader compile. `?quality=high|low` forces a tier for testing.

## Checks only Daniel can do

These cannot be measured in the cloud box, which has software WebGL only:

- Phone frame rate on the low tier, and iPhone loading time.
- Shadows and metals after backgrounding the iPhone page and coming back (context restore).
- Date faces in the booth, solo and with both Double dates, and expressions while they talk (now GPU morph targets).
- The quiet-table move: the table pendant, spotlight and halo should travel with the table.
- All four Double settings from both human seats; cutlery sitting clear of the napkin.
- Actors cast no shadow-map shadows. That is an accepted trade-off.
