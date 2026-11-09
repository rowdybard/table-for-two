> Written 2026-11-09 against main `ebc491d` before PR #1 merged. Line numbers refer to that commit; find code by content. PR #1 has since merged (coaster board, napkin doodle and dessert portions are gone; TabletopProps, EveningTable and RestaurantRenderer are now LF), so ignore every "avoid PR #1 lines" or "deferred until PR #1 lands" note. Status lives in `ENVIRONMENT_VISUALS.md`.

# Environment visual upgrade and overlap fixes: implementation plan

The plan runs as a contract seed (step 0), then three workstreams that implement in parallel and integrate in a fixed order. Everything below is checked against three r187 in node_modules, main `ebc491d` and PR #1 (`origin/claude/project-thread-reg74n`).

## Decisions

1. **No full-screen post pass.** In r187 an HDR output path (`outputBufferType: HalfFloatType`) runs WebGLOutput on every frame, even with no effects (WebGLOutput.js:198-232). It is fixed when the renderer is constructed. It needs a line-181 edit that touches PR #1's hunk context. It also tone-maps `toneMapped:false` materials, and adds about 80 MB at 1080p (about 180 MB at DPR 1.5). Glow comes from additive halo billboards instead: 3 draws, under 0.1 ms.
2. **`scene.environment` is set** to a venue PMREM at intensity .40. Materials that need a different intensity get an explicit `envMap`, through a userData tag.
3. **Characters keep RoomEnvironment (confirmed).** WebGLRenderer.js:2747-2749 overrides the intensity only when `material.envMap === null`. `prepareCharacterLighting` (CharacterLighting.ts:17-31) sets `envMap` on every Standard/Physical character mesh, at all four call sites (RestaurantRenderer.ts:241, 338, 344, 413). PR #1 leaves CharacterLighting.ts alone, and its character files use only Standard/Physical materials. Residual risk: a character mesh created later without `prepare` would pick up the venue env at .40. That is acceptable.
4. **Shadows are split by layer.**
   - The key light becomes a static shadow (`autoUpdate=false`) whose camera renders only layer 1: baked room and furniture batches.
   - The P0 table pendant becomes a shadowed SpotLight that renders only layer 2: tabletop props and actors.
   - Layer 0 stays enabled everywhere, so a partial merge never hides geometry.
5. **Quality tier is decided once, before the first compile.** Light count and `castShadow` never change at runtime; changing them would change the NUM_* defines and recompile.
6. **New textures are procedural (canvas), with no downloads.** Poly Haven, ambientCG and the CDNs return a proxy 403 from this box. `public/environment-assets/*` stays byte-identical, so the 9 CC0 URLs and the GLB the specs expect are kept.

## Step 0 (lead, before forking): seed `src/restaurant/render/VenueContract.ts`

LF line endings. No workstream edits this file until integration.

```ts
export const STATIC_SHADOW_LAYER = 1;   // B enables on baked batches that cast; never disable layer 0
export const DYNAMIC_SHADOW_LAYER = 2;  // C on castShadow tabletop/evening meshes; A on actor meshes at runtime
export const PENDANTS = [[0,-1.15],[-3.5,-3.5],[3.5,-3.5],[-3.38,1.2],[3.38,1.2]] as const; // [0] is diningRoot-local
export const PENDANT_Y = { cap: 2.9, shadeTop: 2.84, mouth: 2.64, glowDisc: 2.65, light: 2.60, halo: 2.58 } as const;
export const CANDLES = [[-3.3,-3.5],[3.7,-3.5],[-3.18,-.15],[3.58,-.15],[-3.18,2.1],[3.58,2.1]] as const; // flame y .955
export const BAR_STRIPS = { y: [1.402, 2.012], z: -6.79, halfLength: 1.49 } as const;
export const GLOW_LINEAR = [1.0, .80, .52] as const;        // toneMapped:false emissive, linear RGB
export const LAMP_SHADE_EMISSIVE = [.07, .27, .5] as const; // by lampLevel 0..2
export const VENUE_ENV = { scene: .40, metal: 1.0, glass: 1.2, water: .8, glaze: .6, polished: .5, floor: .45, wood: .3 } as const;
// material.userData.venueEnv = VENUE_ENV.k  -> A: material.envMap = venue PMREM, envMapIntensity = value
// material.userData.venueGlass = true       -> A: chained fresnel-alpha onBeforeCompile hook
// object.userData.contactShadow = {rx, rz, opacity} -> C: instanced contact shadow, object-local ellipse
```

B and C create every tagged material in constructors, which is already true today. A applies the tags once, in the constructor, before warmup.

## GPU budget

| | main today | main + PR #1 | **High** | **Low** |
|---|---|---|---|---|
| Pixel-ratio cap / adaptive floor | 1.5 / – | 1.5 / – | 1.5 / 1.0 | 1.25 / .75 |
| Lights (hemi/dir/spot/point) | 1/2/0/8 = 11 | 1/3/0/9 = 13 | 1/2/6/4 = **13** | 1/2/4/3 = **10** |
| Shadow maps | key 1024, re-rendered every frame | same | key 1024 static + P0 spot 1024 every frame | key 1024 static + P0 spot 512 every 2nd frame |
| Shadow draws per frame | 125–204 (172–534k tris) | same | solo ≈115 (≈90k tris), double ≈250 (≈260k) | half of high, on average |
| Static key re-render | – | – | ≈45 draws, only when the layout changes | same |
| Post passes | 0 | 0 | 0 | 0 |
| Main draws, solo / double | 309 / 419 | ≈ | ≈283 / ≈379 | same |
| Managed texture memory | ≈160 MB | ≈ | ≈128 MB | ≈125 MB |
| Per-fragment extras | – | – | env (2 fetches), spot PCF (5 taps on lit receivers) | same |

**Texture memory changes**
- −37 MB: shared procedural Sources (B)
- −5.2 MB: food maps at 128² (C)
- −1.4 MB: baked shadow canvas removed (C)
- −2.1 MB: old tile maps removed (B)
- +6.3 MB: venue PMREM 256 (A)
- +2.8 MB: 512² stone albedo + roughness (B)
- +0.35 MB: tuft bump (B)
- +4 MB high / +1 MB low: spot shadow (A)
- Halo texture: 16 KB

**Draw changes**
- −14 solo / −28 double: utensils merged to one mesh each (C)
- −21: vase merged to one mesh per material (C)
- +3: halos (A)
- +4: P0 fixture batch (B)
- +2: grout and table-top materials (B)

**Fragment cost**
- Low: 3 fewer lights (about −23% light ALU) and about 31% fewer pixels.
- High: about +5–10% fragment ALU against PR #1. This is offset by removing the per-frame full-room shadow pass and 279k plant shadow tris.

## Light rig (owned by A)

Units are r187 physical (candela). Decay is 2 everywhere. Positions are world coordinates unless marked diningRoot-local.

| Light | Tier | Values |
|---|---|---|
| Hemisphere | both | `#e6d6cf` / `#4a3a34`, intensity .36 (was .86) |
| Key, directional | both | `#ffdcc0` .55. Target (0,0,0); position (2.2, 10.74, 4.88), i.e. direction (.183,.895,.407). Ortho L/R ±8, T/B ±8.5, near .5, far 24, map 1024, bias −.0002, normalBias .02, radius 2.5, `shadow.intensity` .8. `shadow.autoUpdate=false`, `needsUpdate=true` at creation. `shadow.camera.layers.set(1)` (WebGLShadowMap.js:293) |
| P0 spot (parent `set.diningRoot`) | both | Local (0, 2.60, −1.15), target local (0, .78, −1.15), `#ffd39a` 8, distance 6, angle 1.15, penumbra .75. `castShadow`; near .4, far 3.2, focus .55 (≈2.6 mm/texel), bias −.00015, radius 2, intensity .85. Shadow camera layers {2}. High: 1024, normalBias .004, every frame. Low: 512, normalBias .008, `autoUpdate=false`, `needsUpdate` on even frames |
| P1, P2 spots | both | (∓3.5, 2.60, −3.5), target (x, 0, z), `#ffd39a` 5.5, distance 5.5, angle 1.05, penumbra .7, no shadow |
| P3, P4 spots | high | (∓3.38, 2.60, 1.2), same values as P1/P2 |
| Bar spot | both | (0, 2.95, −5.75), target (0, 1.5, −6.75), `#ffcf9f` 3.0, distance 4, angle .95, penumbra .8. Replaces barWash, which B deletes |
| Booth point (diningRoot) | high | `#ffdbbd` 2.6, distance 4. Solo local (−1.2, 2.1, −1.3); Double (0, 2.15, −1.45). Position set per frame, which is free and evens out the d1/d2 imbalance |

- **Removed:** window-fill directional, the fixtureless (0, 2.9, 4) point, barWash.
- **Unchanged:** farewell light (renderer :62, :481), lamp point (TabletopProps), PR #1's faceFill and rim.
- **Renderer settings:** exposure 1.03 → 1.10, fog 14/34 → 16/36, ACES and PCFShadowMap kept.
- **Static key refresh:** set `needsUpdate` when `set.diningRoot.position.z` changes, when `!!state.doubleDate` changes, and once each when `waitForEnvironmentAssets()` and `waitForRestaurantProps()` resolve.

### Venue environment
- Built once with `PMREMGenerator.fromScene(proxy, .02, .1, 30, {size: 256, position: (0, 1.2, −1.15)})`.
- Proxy scene, all MeshBasic:
  - a BackSide box 13.5×3.5×14.5 centred at (0, 1.75, 0): floor linear .10, walls warm .30, ceiling .06;
  - 5 downward discs (r .3, y 2.64) at the PENDANTS, colour GLOW_LINEAR ×10;
  - 2 bar strips ×4;
  - window cards (.07, .11, .20) at x −6.74 for z [−6.21, −3.09], [−2.36, .76], [1.64, 4.76], and at back-wall x ±4.4, y 1.07–2.97;
  - rose booth blocks ×.25.
- The proxy is disposed after baking.
- Apply `scene.environment` and `environmentIntensity = .40`, then traverse the scene to apply the `venueEnv` and `venueGlass` tags.
- Glass hook: replace `#include <opaque_fragment>`:
  - `f = pow(1 − saturate(abs(dot(normal, geometryViewDir))), 3)`;
  - `a = mix(diffuseColor.a, .7, f)`;
  - `gl_FragColor = vec4((totalDiffuse·a + totalSpecular)/max(a, 1e-3) + totalEmissiveRadiance, a)`.
  - Chain any previous `onBeforeCompile`; cache key suffix `venue-glass-1`.

### Halos (`VenueGlow.ts`)
- One 64² radial CanvasTexture. Additive blending, depthWrite off, depthTest on, toneMapped off, fog off.
- **Room InstancedMesh** (billboard ShaderMaterial, 1 draw):
  - P1–P4 at (x, 2.58, z), size .45, opacity .55;
  - candles at (x, .965, z), size .12, opacity .7, ±6% flicker driven by `uTime` (held constant under reduced motion);
  - bar strips at x ∈ {−1, 0, 1} × y ∈ {1.402, 2.012}, z −6.77, size 1.1×.16, opacity .35.
- **P0 halo:** a Sprite in diningRoot at (0, 2.58, −1.15), size .45.
- **Lamp halo:** a Sprite added as a child of `set.flame`, size .30 × [0, .55, 1][lampLevel]. As a Sprite it is excluded from the tabletop-art `supportRadius` check.

### Other A runtime duties
- Each frame, scan `scene.children` (WeakSet of roots already seen) and call `layers.enable(2)` on meshes of new actor roots that cast shadows.
- Adaptive DPR:
  - starts 4 s after the first `phase==='playing'` frame;
  - if the median dt exceeds 22 ms over a 3 s window, lower DPR by .25, stopping at the floor;
  - it never raises DPR;
  - it is disabled for `?quality=` overrides and when `navigator.webdriver` is set.

## Workstream A, lighting

**Owns**
- New: `render/RenderQuality.ts`, `render/RestaurantLighting.ts`, `render/VenueEnvironment.ts`, `render/VenueGlow.ts`, `tests/render-quality.test.ts`, `tests/venue-lighting-rig.test.ts`.
- `RestaurantRenderer.ts`, at the hunks listed below only.

**RenderQuality**
- `detectRenderQuality(env?)` returns `{tier, pixelRatioCap, pixelRatioFloor, adaptive}`.
- Low when any of these hold: `(pointer: coarse)`; `maxTouchPoints > 0 && innerWidth <= 1100`; `navigator.deviceMemory <= 4`.
- `?quality=high|low` overrides detection.

**RestaurantRenderer.ts hunks** (CRLF; main line numbers):
1. After line 11: imports for `createRestaurantLighting`/`RestaurantLighting` and `detectRenderQuality`.
2. After line 32: `private readonly quality = detectRenderQuality();` and `private readonly lighting: RestaurantLighting;`.
3. Delete line 108 (`if (!this.parallelCompile) {...}`). Without the extension, `compileAsync` compiles synchronously behind the loading screen, instead of during gameplay.
4. Line 183: change the cap to `this.quality.pixelRatioCap`.
5. Line 186: `toneMappingExposure = 1.10`.
6. Line 199: `Fog('#172536', 16, 36)`.
7. Delete lines 203–224 (`const sky` through `this.roomLights.add(boothLight)`). Lines 225–226 stay unchanged.
8. After line 241: `this.lighting = createRestaurantLighting({renderer: this.renderer, scene: this.scene, camera: this.camera, roomLights: this.roomLights, set: this.set, quality: this.quality});`
9. After line 441: `this.lighting.update(state, dt, this.time, this.reducedMotion.matches);`
10. After line 700: `this.lighting.dispose();`

**Lines PR #1 changes, which A must not touch:** 18–24, 60–66, 129–151, 169–181, 224–229, 381–387, 478–506, 542–577 and 636–652.
- The budget audit's `git merge-tree` run showed that deleting 203–224 and editing 183 merge cleanly with `-X ignore-cr-at-eol`.
- If PR #1 lands first, rebase onto it and write these hunks in LF.

## Workstream B, surfaces

**Owns:** `ProceduralMaterials.ts`, `EnvironmentAssets.ts`, `RestaurantScene.ts` (CRLF), `NightExterior.ts`, `RestaurantFoliage.ts` (no change required), `RestaurantPropKit.ts`, `tests/venue-surfaces.test.ts` (with its own inline canvas stub). It does **not** touch `public/`.

**B0, the first standalone commit** (C cherry-picks it):
- Bill group at (.31, ·, −1.04), `rotation.y = π/2`. Today it sits at (.28, −1.12), inside the bread basket.
- `target('bill', .31, .85, −1.04, .30, .13, .24)`.

**Material and scene changes**
1. **Procedural textures** (`ProceduralMaterials.ts:29, 98`):
   - cache one base CanvasTexture per (kind, size, role) and return `.clone()`, which shares the Source;
   - draw `marks()` wrap-around so tiles are seamless;
   - new kinds: `stone` (512² albedo + roughness), velvet as mottled noise in place of the 3 px grid, and `tuft` (256² bump for booth backs).
2. **Layers and casting** (`Builder.bake`, RestaurantScene.ts:94-95):
   - every batch mesh with `castShadow` gets `layers.enable(STATIC_SHADOW_LAYER)`;
   - pendant cord, cap, shade and glow materials get `userData.shadowCaster = false`.
3. **P0 pendant:** pass a `builder` argument to `pendant()` and bake P0 into a new `fixture` Builder added to `diningRoot`, so it follows the +3.85 m quiet-table move. P1–P4 stay in `b`. Delete barWash (:318-319).
4. **Glow:** `glow` (:162) becomes MeshBasic with `toneMapped: false` and colour `setRGB(...GLOW_LINEAR)`.
5. **Floor:**
   - shared `stone` maps, tinted per tile material;
   - a floor `onBeforeCompile` hook with its own world-position varying. Per tile hash of `floor(world.xz/.47)`: ±5% tint, UV rotation in 90° steps, roughness .30–.45. Cache key `venue-floor-1`;
   - the slab at :167 becomes grout `#57514a`, roughness .95;
   - `venueEnv` floor.
6. **Velvet** (both burgundy materials): a cheap grazing-angle sheen on Standard, not Physical: `totalDiffuse *= 1 + .55·pow(1−NdotV, 3)·tint(#f0b4bc)`. Cache key `venue-velvet-1`. Tuft bump on the booth backs.
7. **Metals:**
   - brass `#d2ad6a`, metalness 1, roughness .32;
   - silver `#d9d8d3`, metalness 1, roughness .22;
   - both `venueEnv` metal.
   - Main table top split from `woodEdge`: roughness .32, `venueEnv` polished.
8. **Glass and bottles:**
   - `glassMat`: roughness .05, opacity .12, `venueGlass` + glass;
   - bottles stay opaque: roughness .08, colours `#2f4a32` / `#3b241d` / `#8a6235`, `venueEnv` glass;
   - door panes: emissive `#1b3350` .22, roughness .05, `venueEnv` metal.
9. **Plaster** (`EnvironmentAssets.ts:74-88`):
   - restore the warm `#e3d6c2` base;
   - world-Y AO: −15% over 0–.4 m and −12% over 3.0–3.48 m;
   - bump `customProgramCacheKey`;
   - walnut gets `venueEnv` wood.
10. **Night exterior:** recolour about 8% of lit panes to `#5fd1ff` and about 7% to `#ff5fa2`, and add 4 vertical neon sign blades. All of it is vertex colour inside existing geometry, so there are 0 new draws.
11. **Plant GLB** (`RestaurantPropKit.ts:41`): `castShadow = false`.
12. **Child order:** keep `spill.children[0]` as the puddle.

## Workstream C, layout

**Owns:** `TabletopProps.ts` (CRLF), `EveningTable.ts` (CRLF), `PlaceSettingShadows.ts` (rewritten in LF), `tests/tabletop-layout.test.ts`, `tests/fixtures/tabletop-layout-harness.ts`.

**PR #1 lines to avoid**
- TabletopProps: 2–14 and 176–180.
- EveningTable: 1–5, 75–116, 151–165, 210–250 and 290–350.

**Corrected place settings.** Group origins are unchanged: solo (0, .782, −.64)/(0, .782, −1.67); double (±.57, .782, −.32)/(±.57, .782, −1.98). Settings with z < −1.15 get `group.rotation.y = π`, which puts the date's fork on their left. Coordinates are setting-local.

| Item | Current | New |
|---|---|---|
| Plate lathe (:52) | inside-out (negative volume) | reverse the point array |
| Napkin (:55, 62-63) | .085×.012×.205 at (.265, .004, 0), rot .12 | .072×.008×.17 at **(−.305, .004, −.05)**, rot 0 |
| Napkin fold | .075×.004×.09 at (0, .008, −.05), rot .08 | .066×.004×.085 at (0, .008, −.02), rot 0 |
| Folded state (:164) | rot .55, scale z .65 | rot 0, scale z .55 |
| Fork / knife / spoon x, z | −.235, .01 / .22, 0 / .265, 0 | unchanged |
| Utensil geometry | 18 mm capsules, many meshes | handles flattened to 6 mm vertically; every part re-seated to rest on the table (lowest point at local 0, ≤2 mm float); each utensil merged into one mesh (child order kept) |
| Rested cutlery (:163) | sinks 4–6 mm into the plate | yaw .5 for both; fork (.0983, y, −.0537), knife (.1264, y, −.0690); y re-derived by the harness clearance search so each rests on the rim |
| Rested cutlery target (:183) | x − .035 | (x + .11, .82, z − .06); the unrested target is unchanged |
| Double date glass (:89, 153) | z −1.86 | **z −1.80** |
| Cleared glass, double (:143-144; Evening :275) | (sign·.70, −1.0) | (sign·.78, −1.12) |
| Spilled glass (:146; Evening :276) | rot z −.95 | rot z −(π/2 − .04), y .8245 |
| Offered bite (Evening :268) | (x+.085, .851, z+.07) | (x+.105, .818, z+.105) |
| Double cleanup cloth (:263) | stainX∓.20, −.75 | dx .06, z −.66 (`PROPOSAL.clothDouble`) |
| Chicken pieces (:140) | y .031 | +.003 |

The exact values for the rows above are in `PROPOSAL` (`.qa/overlap-audit.ts`, lines 476-494).

**Contact shadows** (rewrite `PlaceSettingShadows.ts`; it keeps returning `{mesh, dispose}`):
- One InstancedMesh (≤48 instances, 1 draw) with an analytic ShaderMaterial: no texture, tint `#351a1b`, `smoothstep(1, .18, d)`.
- `onBeforeRender` discovers `userData.contactShadow` objects once. Each frame it computes `inverse(mesh.matrixWorld) × source.matrixWorld`, keeping only the yaw. Instances sit at local y .7824, below the paper props at .783.
- Scale is 0 when the source or any ancestor is hidden. Opacity fades over 15 cm of lift.
- This fixes the 1.15 m offset bug and the solo-only layout, and it follows the quiet table and every moving prop with no renderer edit.
- Tags (rx × rz, opacity):

| Object | Tag |
|---|---|
| plate | .20 × .20, .55 |
| fork | .024 × .11, .45 |
| knife | .017 × .12, .45 |
| spoon | .017 × .11, .45 |
| napkin | .045 × .095, .5 |
| glasses | .06, .45 |
| carafe | .075, .5 |
| lamp | .06, .55 |
| vase | .07, .55 |
| basket | .14 × .10, .5 |
| shakers | .03, .45 |
| dessert tray | .20, .5 |
| extras | .12, .5 |

**Shadow flags**
- `castShadow` + `layers.enable(2)`: plates, utensils, food, bread and basket, vase, lamp base and stem (not the shade), shakers, tray, extras, bell.
- `receiveShadow`: plates, napkins, menu, cloths, paper, tray.
- Glasses and carafe cast nothing.

**Material changes handed over from B** (contract values):
- steel `#d9d8d3`, metalness 1, roughness .2; gold `#d2ad6a`, metalness 1, roughness .3; both `venueEnv` metal.
- ceramic: `venueEnv` glaze.
- glass (TabletopProps :44 and Evening :206): roughness .05, opacity .14, `venueGlass` + glass.
- water: roughness .05, opacity .38, `venueEnv` water.
- lamp shade emissive by level = LAMP_SHADE_EMISSIVE (:96-97, :149); bulb `toneMapped: false`, colour GLOW_LINEAR.
- `foodMaterial` (:11-45): cache by kind and colour, roughness and bump maps at 128².
- vase merged to one mesh per material.
- Bell gold (:107) is untouched because of PR #1.

**Deferred until PR #1 lands** (recorded as `test.todo` with the reason):
- dessert vs extras parking;
- solo dessert park x;
- paper napkin (.39, −.50), on line 303;
- coaster-board pairs (PR #1 removes the board).

**`tests/tabletop-layout.test.ts`**
- Ported from `.qa/overlap-audit.ts` in fast mode: canvas stub, `buildState`, the 91 scenarios, `applyFrame` (copying renderer lines 322, 446-450 and 579-587), triangle-triangle and inside-solid checks.
- It asserts:
  - no interpenetration beyond 0.5 mm of resting contact;
  - nothing below the table top beyond 0.5 mm;
  - nothing past the flat top (solo .885, double 1.285);
  - every prop and target offset by exactly 3.85 m on the quiet table (1e-6);
  - napkin to utensil clearance ≥ 10 mm;
  - the far-side fork on the date's left;
  - each contact-shadow instance within 5 mm of its source and hidden with it.
- It skips Sprites and anything with `userData.decor`.
- Runtime target ≤ 20 s.

## Constraints to keep

- Full unit suite: 334/334.
- Hard-coded solo points in browser-tabletop.spec:17-24 are unchanged: glass, carafe, bread, salt, pepper, cutlery [−.235, .84, −.535], lamp, vase, plate, menu, napkin [.40, .85, −.48].
- Fixture private field names and child-index contracts (`playerGlass.children[1]`, the shared order `[carafe, lamp, vase, basket, salt, pepper]`, the plate at `children[0]`, `dessert.children[0]`).
- Double `supportRadius` ≤ 1.30.
- Asset URLs at browser-restaurant:39-42.
- The console regex `THREE.WebGLProgram|INVALID_OPERATION|shader error`.
- `aria-busy=false` within 30 s.
- browser-mobile alpha 255 and null framebuffer.
- Aria-label strings.
- Each file's line endings (CRLF: RestaurantRenderer, RestaurantScene, TabletopProps, EveningTable).
- No gameplay depends on mesh visibility. GPU resources are disposed. No per-frame allocation.

## Acceptance checks (in this box)

**All workstreams**
- `pnpm check` and `pnpm build` pass.
- CRLF files: `git diff main -- F | grep '^+[^+]' | grep -vc $'\r$'` returns 0.
- PR #1: `git merge-tree --write-tree -X ignore-cr-at-eol HEAD origin/claude/project-thread-reg74n` reports no conflicts.

**A**
- `pnpm exec tsx --test tests/render-quality.test.ts tests/venue-lighting-rig.test.ts tests/tabletop.test.ts tests/double-date-scene-regressions.test.ts`.
- The rig test asserts:
  - 9 A-owned lights on high and 6 on low;
  - spot positions equal PENDANTS at y 2.60;
  - P0 and booth are parented to `diningRoot`;
  - shadow layer masks are 2 (key) and 4 (spot);
  - map sizes.
- The renderer diff touches only the 10 hunks above.

**B**
- `pnpm exec tsx --test tests/venue-surfaces.test.ts tests/tabletop.test.ts`. The surfaces test asserts:
  - every cast-enabled batch tests layer 1 and layer 0;
  - no PointLight under `set.root` except the lamp;
  - `glow.toneMapped === false`;
  - the P0 fixture sits under `diningRoot`;
  - bill and target coordinates.
- `git diff --quiet main -- public/` passes.
- A copied `.qa/count-scene3.ts` reports ≤40 procedural GPU Sources, ≤130 MB managed texture and 0 plant shadow tris.

**C**
- `pnpm exec tsx --test tests/tabletop-layout.test.ts tests/tabletop.test.ts tests/double-date-scene-regressions.test.ts tests/full-evening.test.ts tests/restaurant-scenarios.test.ts tests/scenario-consequences.test.ts tests/atlas-fixes.test.ts`, run with B0 cherry-picked.
- A copied `.qa/overlap-audit.ts` in full mode reports zero findings apart from the deferred todos.

**Integration** (lead): merge B, then C, then A. Run the full unit suite once, alone.

**Shader smoke run** (A, after B has merged): a single `.qa/visual-smoke.mjs` run against `dist`, loading `/?quality=high` and `/?quality=low`.
- It waits for `aria-busy=false` (up to 90 s) and requires zero shader or console errors.
- It saves one screenshot, of the high tier, for internal review only.
- This is the only in-box check that the shader hooks compile. Software WebGL timing is not performance evidence.

## For Daniel's playtest

- Phone frame rate on the low tier.
- Date faces in the booth, solo and with both Double dates.
- The quiet-table move: pendant, spot and halo should travel with the table.
- All four Double settings from both human seats.
- Cutlery sitting clear of the napkin.
- The waiter no longer has a cast shadow away from the table. This is an accepted trade-off.