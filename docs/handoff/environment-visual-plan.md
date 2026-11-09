> Written 2026-11-09 against main `ebc491d` before PR #1 merged. Line numbers refer to that commit; find code by content. PR #1 has since merged (coaster board, napkin doodle and dessert portions are gone; TabletopProps, EveningTable and RestaurantRenderer are now LF), so ignore every "avoid PR #1 lines" or "deferred until PR #1 lands" note. Status lives in `ENVIRONMENT_VISUALS.md`.

# Adversarial review: environment visual upgrade plan

I checked each claim against main `ebc491d`, three r187 in `node_modules/three/src`, PR #1 (diffs and file contents), and the existing overlap harness. Most of the plan holds, but 25 problems need fixing before the engineers start. These are the serious ones:

- **Pendant shadow flag:** turning off shadows on the pendant materials would also stop the table bases, side-table plates and most brass from casting shadows (finding 1).
- **Light through the table:** the new table spotlight would shine through the table top onto the floor (finding 2).
- **Lamp glow breaks a test:** attaching the glow to the lamp makes `browser-tabletop-art.spec.ts:116` fail (finding 3).
- **Napkin regression:** moving the date's napkin while the dessert fix waits for PR #1 creates a new 8 mm overlap in solo (finding 9).
- **iPhone context loss:** after a lost graphics context (common when iOS backgrounds the page), shadows would vanish and metals would go black (finding 6).

## Findings

**Verified correct:**
- Characters keep their own environment map. Explicit `envMap` wins over `scene.environment` (WebGLRenderer.js:2747-2749), all four `prepareCharacterLighting` calls exist (:241, 338, 344, 413), and PR #1 leaves CharacterLighting.ts byte-identical.
- Shadow-camera layers work as planned (WebGLShadowMap.js:293, :524).
- `receiveShadow` is a uniform in r187 (WebGLRenderer.js:2740-2743), so mixing it on shared materials does not force shader recompiles.
- The plan's lists of PR #1 lines to avoid match PR #1's actual changes in TabletopProps and EveningTable.
- I applied A's ten renderer edits in a scratch clone. `git merge-tree -X ignore-cr-at-eol` merges cleanly. A plain merge conflicts, and the merged file has mixed line endings (665 of 688 lines CRLF), so it must be normalized to LF afterwards.
- I added six edge-case scenarios to the harness. The proposed layout clears all of them: crossed cutlery with plated dessert, crossed cutlery with a taste offer, spill with cleared glasses, quiet table with the bill, both desserts with the bill, and both desserts with extras.
- With the far settings rotated, the furthest Double prop vertex is about 1.263 m from the table centre, under the 1.30 limit.

**Problems:**

1. **Pendant shadow flag hits shared materials.** The pendants are built from `dark`, `brass`, `ceramic` and `glow` (RestaurantScene.ts:360-365). Those materials also make the table bases (:247-248), side-table plates (:275-276), bowl (:380) and receipt (:407). Setting `shadowCaster=false` on them stops all of that from casting.
2. **The spotlight lights the floor under the table.** The table spotlight's shadow sees only layer 2, but the table and chairs are baked into layers 0 and 1. The floor and the diners' laps under the table get about 8/2.6² ≈ 1.18 of unshadowed light.
3. **Lamp glow sprite breaks the Double dessert test.** Bounding boxes include sprite geometry and ignore visibility (Box3.js:303-345). At the Double clear position (−.18, −1.65) the lamp's box grows from x [−.265, −.095] to [−.33, −.03]. It then overlaps the parked dessert tray at (−.45, −1.55), radius .18, so the `dessert-` check at spec line 116 fails.
4. **The spot shadow's far plane is ignored.** SpotLightShadow.js:52 sets `far = light.distance`, so "far 3.2" becomes 6.
5. **The table move is detected one frame late.** `lighting.update` runs at :441, before the table offset is set (:448) and before solo/double furniture is swapped (:443→:322). `setDate` (:442) also adds a new actor after it. The fix is `scene.onBeforeRender`, which runs before the shadow pass (WebGLRenderer.js:1682 vs :1750) and is unused anywhere in `src`.
6. **No context-restore handling.** RestaurantRenderer never listens for `webglcontextrestored`. After a lost context, the static key shadow (`autoUpdate=false`) and the baked environment map are not regenerated.
7. **Contact-shadow mesh details:**
   - An InstancedMesh frustum-culled by its initial bounds never runs `onBeforeRender`; it needs `frustumCulled=false`.
   - Instance matrices upload during render-list building, before `onBeforeRender`, so positions lag one frame. That is acceptable.
   - Per-instance opacity needs its own instanced attribute.
   - Tagged sources total exactly 48: 10 solo place parts, 20 Double place parts, 3 date glasses, 2 human glasses, 6 shared props, 2 trays, 4 extras and the bell. A 48 cap leaves no room.
   - The overhead spot already darkens the area under each caster, so blobs under casters double-darken.
8. **Some of C's planned edits sit inside PR #1's changes.** The tray (EveningTable.ts:156, inside PR #1's 154-159), the bell (:223-225, between PR #1's 213-222 and 226-230) and the paper napkin (:229) would conflict. New import lines must also be placed away from PR #1's edits: TabletopProps after line 2 (PR #1 edits line 5), EveningTable after line 7 (PR #1 removes line 2).
9. **The deferral creates a regression.** I ran the harness with the proposal minus the deferred items. In solo with coasters and dessert, the date napkin and the parked dessert tray overlap: 8 mm deep, 21 mm wide. The cause is the napkin moving to (.305, −1.62) while the tray parks at (.50, −1.55). PR #1 only parks the dessert when both are served, so this exists only until PR #1 lands.
10. **Cherry-picking B0 can conflict.** If B edits the bill lines again after B0, C's copied commit conflicts with B at merge.
11. **ProceduralMaterials is used by PR #1's characters.** CharacterBody.ts:3, 374 and 529 in PR #1 call `createFabricMaterial` and `disposeProceduralMaterial`. Fabric textures must stay byte-identical.
12. **Caching food materials by (kind, colour) is unsafe.** `dessertColor` is recoloured every frame (:306) and the other dessert is a clone of it. The canvases depend only on kind.
13. **The rig test cannot run in Node.** Building the environment map needs a real WebGLRenderer.
14. **Faces would shadow themselves.** `prepareCharacterLighting` turns shadows on for every non-hair-card mesh, eyes and teeth included. A spot shadow at 2.6 mm per texel would self-shadow PR #1's faces. Actor roots are named `character-*` and heads `head-*` (RestaurantActor.ts:17/21, the same in PR #1), so A can skip heads.
15. **Food shadows blow the draw budget.** About 24 meshes per meal puts spot-shadow draws at roughly 145 solo and 280 Double, against the plan's 115 and 250.
16. **Plants can keep their shadows.** With a static key light, plant shadows cost nothing per frame.
17. **The harness misses decals lying on paper.**
    - The Double wine stain at (stainX + .17, −.72) (:255-256) lies on h1's menu at (−.36, −.76).
    - The spill puddle at y .783 (RestaurantScene.ts:416; renderer :584 places it at (−.47, −.66) for h1) sits at the same height as the menu (.783) and will flicker.
18. **Glass highlights are capped.** Tone mapping happens before blending, so a reflection at the centre of the glass adds at most about α (.12–.14). That is physically plausible, but pendant highlights will not sparkle.
19. **Line endings after merging PR #1.** The merged files must be normalized to LF (see the merge check above).
20. **Deleting renderer line 108 changes loading on browsers without `KHR_parallel_shader_compile`.** The loading screen will wait for the CC0 maps and the plant model, then compile shaders synchronously. This needs an iPhone check.
21. **The key light's shadow box misses room corners.** On its vertical axis, the corner (−6.75, 3.5, −7.25) projects to 9.96, outside ±8.5.
22. **Two small extra items.** The tufted booth backs need their own material (+1 draw), and the bar glow strips must be axis-aligned rather than spherical billboards.
23. **Environment map size.** A 256 cube map in r187 is about 4.2 MB, not 6.3 MB.
24. **Shader smoke run timing.** It must run after A merges (last), because C also adds a ShaderMaterial.
25. **Budget table.** The shadow draw counts need revising (done in the corrected table below).

## Final corrected plan

### Decisions
1. No full-screen post pass. Glow comes from additive halos.
2. `scene.environment` is a venue environment map at intensity .40. Materials needing their own intensity get an explicit `envMap` through a userData tag.
3. Characters keep RoomEnvironment (verified).
4. Shadows are split by layer:
   - **Key light:** a static shadow (`autoUpdate=false`) that renders layer 1 only: baked room, furniture and plant models.
   - **Table spotlight (P0):** a SpotLight with shadows that renders layer 2 only: tabletop props, actor bodies (not heads) and the table furniture.
   - Layer 0 stays on everywhere.
5. The quality tier is fixed before the first shader compile. Light count and `castShadow` never change at runtime.
6. Textures are procedural (canvas). `public/` stays byte-identical.

### Step 0 (lead, before forking)
- Seed `src/restaurant/render/VenueContract.ts` (LF) with the constants and tags below.
- Commit the bill fix **B0** in the same seed commit: folio at (.31, .795, −1.04) rotated `y = π/2`; receipt at (.31, .808, −1.04) rotated (−π/2, 0, π/2); bill group stays at the origin; `target('bill', .31, .85, −1.04, .30, .13, .24)`.
- All three branches fork from this commit.

```ts
export const STATIC_SHADOW_LAYER = 1;   // B: baked batches, plant GLB meshes
export const DYNAMIC_SHADOW_LAYER = 2;  // C: tabletop casters; B: furniture builders; A: actor bodies
export const PENDANTS = [[0,-1.15],[-3.5,-3.5],[3.5,-3.5],[-3.38,1.2],[3.38,1.2]] as const; // [0] diningRoot-local
export const PENDANT_Y = { cap: 2.9, shadeTop: 2.84, mouth: 2.64, glowDisc: 2.65, light: 2.60, halo: 2.58 } as const;
export const CANDLES = [[-3.3,-3.5],[3.7,-3.5],[-3.18,-.15],[3.58,-.15],[-3.18,2.1],[3.58,2.1]] as const; // flame y .955
export const BAR_STRIPS = { y: [1.402, 2.012], z: -6.79, halfLength: 1.49 } as const;
export const GLOW_LINEAR = [1.0, .80, .52] as const;
export const LAMP_SHADE_EMISSIVE = [.07, .27, .5] as const;
export const VENUE_ENV = { scene: .40, metal: 1.0, glass: 1.2, water: .8, glaze: .6, polished: .5, floor: .35, wood: .3 } as const;
export const CONTACT_SHADOW_MAX = 64;
// material.userData.venueEnv = number; material.userData.venueGlass = true;
// object.userData.contactShadow = {rx, rz, opacity}
```

### GPU budget

| | main | main + PR #1 | **High** | **Low** |
|---|---|---|---|---|
| Pixel-ratio cap / adaptive floor | 1.5 / – | 1.5 / – | 1.5 / 1.0 | 1.25 / .75 |
| Lights (hemi/dir/spot/point) | 11 | 13 | 1/2/6/4 = 13 | 1/2/4/3 = 10 |
| Shadow maps | key 1024, every frame | same | key 1024 static + spot 1024 every frame | key 1024 static + spot 512 every 2nd frame |
| Spot-shadow draws per frame | – | – | solo ≈100 (≈70k tris), Double ≈190 (≈170k) | half of High, on average |
| Static key re-render | – | – | ≈50 draws + 279k plant tris, only on layout change or context restore | same |
| Post passes | 0 | 0 | 0 | 0 |
| Main draws, solo / Double | 309 / 419 | ≈ | ≈288 / ≈384 | same |
| Managed textures | ≈160 MB | ≈ | ≈126 MB | ≈123 MB |

**Texture memory:**
- Removed: shared procedural Sources −37 MB, food roughness/bump maps at 128² −5.2 MB, baked shadow canvas −1.4 MB, old tile maps −2.1 MB.
- Added: environment map +4.2 MB, stone maps +2.8 MB, tuft bump +0.35 MB, spot shadow +4 MB (High) / +1 MB (Low), halo texture 16 KB.

**Draws:**
- Removed: utensil merge −14 solo / −28 Double, vase merge −21.
- Added: halos +3, P0 fixture +4, P1–P4 non-casting pendant builder +4, grout/table-top/booth-back materials +3, each material its own batch.

### Light rig (A)
Decay is 2 everywhere. Every spot target is added next to its light.

| Light | Tier | Values |
|---|---|---|
| Hemisphere | both | `#e6d6cf` / `#4a3a34`, .36 |
| Key, directional | both | `#ffdcc0` .55 from (2.2, 10.74, 4.88) toward (0,0,0). Ortho bounds fitted once from the 8 room corners in light space, plus .3 m margin. Near .5, far 24, map 1024, bias −.0002, normalBias .02, radius 2.5, shadow intensity .8. `autoUpdate=false`; shadow camera layers {1} |
| P0 spot, in `diningRoot` with its target | both | (0, 2.60, −1.15) → (0, .78, −1.15); `#ffd39a` 8, distance 6, angle 1.15, penumbra .75. Shadow camera far = distance (6; three overrides it). Focus .55, bias −.00015, radius 2, shadow intensity .85, layers {2}. High: 1024, normalBias .004, every frame. Low: 512, normalBias .008, updates every 2nd frame |
| P1, P2 spots | both | (∓3.5, 2.60, −3.5) → (x, 0, z); 5.5, distance 5.5, angle 1.05, penumbra .7, no shadow |
| P3, P4 spots | High | (∓3.38, 2.60, 1.2), same values as P1/P2 |
| Bar spot | both | (0, 2.95, −5.75) → (0, 1.5, −6.75); `#ffcf9f` 3.0, distance 4, angle .95, penumbra .8 |
| Booth point, in `diningRoot` | High | `#ffdbbd` 2.6, distance 4. Solo (−1.2, 2.1, −1.3); Double (0, 2.15, −1.45) |

- **Removed:** window fill, the fixtureless (0, 2.9, 4) point light, barWash (B deletes it).
- **Unchanged:** farewell light, lamp light, PR #1's faceFill and rim.
- **Renderer settings:** exposure 1.10, fog 16/36.

**Venue environment (`VenueEnvironment.ts`):**
- `fromScene(proxy, .02, .1, 30, {size: 256, position: (0, 1.2, −1.15)})`.
- Proxy: a MeshBasic room box (floor .10, walls .30, ceiling .06), pendant discs ×6, bar strips ×4, window cards, booths ×.25.
- Keep the proxy for rebuilding. On `webglcontextrestored`, rebuild the map and reassign `scene.environment` and every tagged `envMap` (same program, no recompile).
- Glass hook as planned (chained, cache key `venue-glass-1`). Known limit: centre highlights cap near α.

**Halos (`VenueGlow.ts`):**
- One 64² radial texture.
- One room InstancedMesh with `frustumCulled=false` and a per-instance mode attribute:
  - billboard mode for P1–P4 and the candles (candle flicker frozen under reduced motion);
  - world-X-aligned quads for the bar strips.
- P0 halo: a Sprite in `diningRoot`.
- **Lamp halo:** a Sprite at scene level, outside TabletopProps.root. Each frame it copies `set.flame`'s world position into a preallocated vector, hides when the flame or an ancestor is hidden, and scales by `[0, .55, 1][lampLevel]`.

**Other A runtime duties (`scene.onBeforeRender`, set by RestaurantLighting):**
- Layout signature: `diningRoot.matrixWorld` z, the last Double flag, and a "props ready" counter. A change sets key `needsUpdate`.
- Context restore sets key and spot `needsUpdate`.
- Low tier spot cadence.
- Actor scan: for roots named `character-*`, enable layer 2 on meshes with `castShadow` that are not under a `head-*` node.
- Adaptive pixel ratio as planned, sampling only frames that actually rendered while the page is visible; reset the window after each step.

### Workstream A: lighting
**Owns:** `RenderQuality.ts`, `RestaurantLighting.ts` (split into a pure, Node-testable `buildLightRig(quality, roomLights, diningRoot)` and the WebGL environment bake), `VenueEnvironment.ts`, `VenueGlow.ts`, `tests/render-quality.test.ts`, `tests/venue-lighting-rig.test.ts`, and the ten renderer edits below.

**RenderQuality:** low when any of `(pointer: coarse)`, `maxTouchPoints > 0 && innerWidth <= 1100`, or `deviceMemory <= 4`. `?quality=high|low` overrides.

**RestaurantRenderer.ts edits** (main line numbers; CRLF, or LF if PR #1 lands first):
1. Imports after line 11.
2. `quality` and `lighting` fields after line 32.
3. Delete line 108 (flagged for iPhone playtest).
4. Line 183: pixel-ratio cap from `quality`.
5. Line 186: exposure 1.10.
6. Line 199: fog 16/36.
7. Delete lines 203–224.
8. Create the lighting after line 241.
9. `lighting.update` after line 441 (time, tier and adaptive pixel ratio only).
10. `lighting.dispose()` after line 700.

### Workstream B: surfaces
**Owns:** `ProceduralMaterials.ts`, `EnvironmentAssets.ts`, `RestaurantScene.ts` (CRLF), `NightExterior.ts`, `RestaurantPropKit.ts`, `tests/venue-surfaces.test.ts`.

1. **Procedural textures:** share one Source per (kind, size, role) via `.clone()`. Draw wrap-around marks for venue kinds only; fabric kinds stay byte-identical. Keep the `createFabricMaterial` and `disposeProceduralMaterial` APIs. Add `stone` (512²) and `tuft` (256² bump); replace the velvet grid with mottled noise.
2. **Bake layers:** batches that cast get layer 1. The furniture builders also get layer 2.
3. **Pendants:** P0 goes in a `fixture` builder inside `diningRoot`; P1–P4 go in a `pendants` builder in `b.root`. Set `castShadow=false` on both builders' baked meshes. Shared materials keep casting. `glow` may take `shadowCaster=false`. Delete barWash.
4. **Glow material:** MeshBasic, `toneMapped:false`, colour `GLOW_LINEAR`.
5. **Floor:** stone maps; floor shader hook (`venue-floor-1`) with per-tile tint ±5%, 90° rotations and roughness .38–.48; grout slab `#57514a`; floor env .35.
6. **Velvet:** sheen hook on Standard (`venue-velvet-1`); booth backs get their own tufted material.
7. **Metals:** values as planned. Main table top is its own material.
8. **Glass, bottles and door panes:** as planned. Puddle y .7843.
9. **Plaster:** warm base restored; world-Y AO through a varying set from `modelMatrix` in the vertex shader; new cache key.
10. **Night exterior:** neon panes and sign blades as planned.
11. **Plants:** the GLB keeps `castShadow` and gets layer 1 only (it never enters the spot pass).
12. Keep the puddle as `spill.children[0]`.

### Workstream C: layout
**Owns:** `TabletopProps.ts` and `EveningTable.ts` (both CRLF), `PlaceSettingShadows.ts` (LF), `tests/tabletop-layout.test.ts`, `tests/fixtures/tabletop-layout-harness.ts`.

- **PR #1 lines to avoid:** as planned. Imports go after line 2 (TabletopProps) and after line 7 (EveningTable).
- **Place-setting table:** all rows as planned.
- **Extra fixes:**
  - Double wine stain at (stainX + sign(stainX)·.17, −.72), verified against the menu and the cleaning cloth.
  - Food meshes receive shadows but do not cast.
  - Bread: only the roll bodies cast, not the scoring marks.
- **Contact shadows:**
  - Up to 64 instances, `frustumCulled=false`, `renderOrder −1`, instanced opacity attribute.
  - Exported `sync()`, called from `onBeforeRender`; one frame of lag accepted.
  - Blob opacity ×.6 for objects that cast spot shadows; non-casters (glasses, carafe, utensils, napkins) keep full opacity.
- **Shadow flags:** apply only at lines outside PR #1's changes.
- **Deferred until PR #1 lands:** the tray, bell and paper-napkin flags and tags; tags for PR #1's new dessert meshes; dessert-vs-extras parking; the solo dessert-park x; the paper napkin move.
  - The interim solo napkin/park overlap (coasters + dessert, 8 mm) is recorded as a `test.todo`. It disappears with PR #1's dual-only parking. If PR #1 lands first, rebase C onto it and do these items directly in LF.
- **Tests:** port the harness's 91 scenarios plus my 9 extra scenarios (6 with solo variants, 3 Double-only), and add a check for flat items stacked within 0.5 mm of each other with overlapping footprints. The other assertions are as planned.

### Constraints
As planned. The four CRLF files stay CRLF until PR #1 is merged, then everything is normalized to LF.

### Acceptance checks
- **All workstreams:** `pnpm check`, `pnpm build`, CRLF line check, and `merge-tree -X ignore-cr-at-eol` against PR #1 reports no conflicts.
- **After merging PR #1:** `git ls-files --eol` shows no mixed line endings.
- **A:** the rig test (Node, pure builder) checks 9 lights on High and 6 on Low, layer masks 2 and 4, the P0 spot and booth light under `diningRoot`, and that spot targets are parented.
- **B:** the surfaces test (layers, no PointLight under `set.root` except the lamp, `toneMapped`, P0 fixture under `diningRoot`, pendant meshes do not cast, furniture has layer 2); `public/` unchanged; at most 40 procedural Sources and 130 MB.
- **C:** the focused tests plus the full harness: zero findings except the documented `test.todo` items.
- **Integration:** merge B, then C, then A. Normalize line endings. Run the full unit suite once, alone. Then run the shader smoke test once on `dist` at `?quality=high` and `?quality=low`.

### For Daniel's playtest
The plan's items, plus:
- the iPhone loading time after the line-108 change;
- shadows and metals after backgrounding the iPhone page and coming back;
- whether face lighting still reads well with faces never shadowed by the spot.

## Changes made to the original plan
1. Pendants use dedicated builders with `castShadow=false`, instead of turning off shadows on shared materials.
2. The table furniture is added to layer 2, so the spotlight no longer lights the floor through the table.
3. The lamp halo moved out of the lamp hierarchy, so the Box3 test passes.
4. Dropped "far 3.2" for the spot shadow; three uses the light's distance.
5. Layout checks and the actor scan run in `scene.onBeforeRender` (same frame).
6. Added context-restore handling for the static shadows and the environment map.
7. Contact shadows: no frustum culling, 64-instance cap, instanced opacity, render order, opacity ×.6 for casters, exported `sync()`.
8. Moved the tray, bell and paper-napkin tags to the deferred list, and moved the import lines.
9. Documented the interim napkin/park regression (or rebase C onto PR #1).
10. B0 moved into step 0.
11. Fabric textures and API frozen for PR #1's characters.
12. Food textures cached by kind, not materials by (kind, colour).
13. Pure rig builder so the rig test runs in Node.
14. Actor heads excluded from spot shadows.
15. Food does not cast shadows; only the roll bodies in the basket cast.
16. Plant models keep their shadows in the static layer.
17. Double wine stain moved, puddle raised, and a flat-stacking check added to the harness.
18. Key-light shadow box fitted to the room.
19. Booth-back material and axis-aligned bar halos added.
20. Environment map corrected to 4.2 MB; shadow-draw estimates and the budget table revised.
21. Shader smoke run moved to after integration; line-ending normalization step added.

Scratch files:
- .qa/review/extra-scenarios.ts (extra scenarios)
- .qa/review/audit-deferred.ts (proposal without the deferred items)
- <session scratch>/mt (merge-simulation clone)
- <session scratch>/merged.ts (merged renderer)