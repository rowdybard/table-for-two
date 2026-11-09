# Table for Two — working context

Read this before changing the project. `README.md` describes setup and the current release. The editable encounter atlas is in `docs/artifacts/Restaurant Encounter Atlas.docx`, with a PDF alongside it.

Canonical source: [rowdybard/table-for-two](https://github.com/rowdybard/table-for-two), branch `main`.

## Product direction

This is a first-person restaurant dating game, not a website with a 3D background. The reference is *Scam With Your Friends*: walking, looking, physical interactions, friends sharing awkward moments. Keep a fun, flirty K-pop mood and a warm, believable restaurant.

- Solo: one human, one AI date, waiter and neighboring diner.
- Double: two real friends, two independent AI dates at one shared table. Each couple has its own agenda, boundaries, chemistry and ending. One completed couple can stay as a wingman while the other continues.
- Blind: solo with a reproducible seeded personality and agenda. It reuses one of the three adult character rigs/voices.

The user has repeatedly rejected SaaS/dashboard styling, landing-page sales copy, equal-sized cards, badges, numbered UI decorations and filler text. Protect faces, tabletop objects and the playfield. Use compact contextual prompts; open notebooks/settings/actions on demand. Do not restart the visual direction from scratch or replace the game with a webpage.

The three preset adults are Mira (27), Jules (29), and Dev (28). Character replacement through Tripo is deferred. Do not spend a large pass rebuilding characters without a new request. Free licensed environment assets and locally served licensed fonts are allowed; preserve attribution. No paid asset generation or synthesis without authorization.

## Stack and layout

TypeScript, plain imperative Three.js, Vite, Node, Rapier and DOM game overlays. No React migration is needed.

| Area | Source of truth |
| --- | --- |
| Client entry, networking, input and playback | `src/restaurant/main.ts` |
| First-person/selection/inspection camera and actor presentation | `src/restaurant/RestaurantRenderer.ts` |
| Restaurant geometry, place settings, food and props | `src/restaurant/render/RestaurantScene.ts`, `TabletopProps.ts`, `EveningTable.ts` |
| Prompt line (course choices, incidents, scenarios, gestures), receipt, notebook and endings | `src/restaurant/EveningInterface.ts` |
| Shared pacing clocks and dessert list | `src/restaurant/evening.ts` |
| Touch input | `MobileControls.ts`, `MobileInput.ts`, `TouchLookTap.ts`, `TouchButtonGesture.ts` |
| Shared protocol/content | `types.ts`, `scenario-types.ts`, `scenarios.ts`, `content.ts`, `story.ts`, `blind-date.ts` |
| Solo/Blind physical authority | `server/restaurant/scene.ts` |
| Courses, incidents, care and ending controllers | `server/restaurant/evening.ts` |
| Mechanical scenario transactions and deferred authored dialogue | `server/restaurant/scenario-effects.ts`, `scenario.ts`, `scenario-cues.ts` |
| Finite table supplies and personal prop state | `server/restaurant/tabletop.ts`, `src/restaurant/tabletop.ts` |
| Goals, skepticism, boundaries and earned chemistry | `server/restaurant/agendas.ts`, `skepticism.ts`, `boundaries.ts`, `chemistry.ts` |
| Solo transport, provider orchestration and spending ledger | `server/restaurant/index.ts` and provider adapters in that directory |
| Shared Double world, story and one-call conversation director | `server/double-date/` |
| Production packaging and hosting | `deployment/cloudflare/` |

The older bowling game remains at `/?venue=bowling`. Its source/tests are still used and must be preserved; its history is documented in `docs/BOWLING_ARCHIVE.md`. The package name is historical.

## Invariants to preserve

- Server state owns movement, seating, courses, decisions, inventory, scoring and endings. Three.js objects adapt that state; mesh visibility must not decide gameplay.
- One completed human turn starts one conversation generation. A Double request serves the table. Do not add background grading, speculative model calls, per-cast requests or paid retries.
- Recognition runs locally in a Moonshine worker. Keep microphone denial, typed input, captions, interruptions and late-audio rejection working. Browser/device fallback is intentional.
- Provider keys, requests and accounting stay on the server. Never use `VITE_` credentials or commit real `.env` files.
- New sessions default to Haiku unless the operator explicitly configures another provider. There is no public Sonnet/Haiku picker. The existing private typed command is reserved control text, not dialogue.
- Dolphin selection and automatic routing to an alternative provider remain chemistry-gated. Confidence requires heard clues plus noticed/understood/respected evidence; two distinct fully delivered reciprocal flirts qualify a couple. Automatic access is per couple, is revoked by boundary disregard, and cannot override an attraction mismatch. A deliberate `/model horde` override is immediately available when Horde is configured; it changes the selected model, not chemistry, boundaries or ending eligibility. Double model controls remain host-only.
- Automatic earned routing uses the completed transcript and recent delivered context locally: ordinary conversation stays on the base model, and eligible adult-topic turns may use the configured earned provider. Unlocking does not pin every later turn to it. A Haiku request retains this automatic topic routing; explicit Sonnet or Horde selection stays on that route until changed or reset. `/model reset` clears the saved choice and pending dialogue, restoring the server default. An operator-selected Horde-only configuration cannot be switched to a paid model. The router adds no classifier request.
- Optional OpenRouter/Dolphin and AI Horde integrations exist. Inspect configuration/status before assuming either is available. Horde can queue and community hosts can see prompts; preserve its existing disclosure and no-paid-fallback behavior. Do not silently change providers, enable anonymous/community inference, or configure keys as part of an unrelated change.
- Edge is the free speech default. It does not offer ElevenLabs-style acting. ElevenLabs is optional and paid. Preserve voice identity, exact audio caching, delivery receipts and cancellation.
- Do not treat ordinary flirting, identities, illness, stutters or transcription corrections as boundary violations. A personal refusal counts only after it was actually delivered. Roleplay framing does not override provider rules.
- No automatic affection/agenda points for food, cleaning, spending, fidgeting or selecting a considerate scenario response. Understanding and attraction are different.
- Solo snapshots have a monotonic revision; discard late older responses. Double uses room revisions. Never let a delayed response roll back a newer prop or course action.
- The evening carries itself on scene time (`EVENING_PACE`): Eli nudges an idle menu, serves, clears the main after a long course, a rested fork or a few bites, offers dessert, and brings one check for the table after dessert ends or is declined. The date picks their favourite dessert when nobody chooses and breaks long silences with authored lines (no model call, four per evening); a human line resets that silence, scripted course asides are dropped while the two are mid-conversation, and routine pacing cues wait for an in-flight reply instead of cancelling it. Do not add player actions that merely advance a course, and do not let an authored beat count as a human turn.

## Current scenario mechanics

The catalogue has 11 two-beat stories, 51 authored choice records and 58 complete choice histories; most opening branches merge into two follow-through choices. These are not 58 separate plots or events in one night. Selection and activation are distinct, and AI conversation/physics have no meaningful finite total path count. Sixteen agendas are independent of the three preset appearances.

`scenarioCare` holds actual kitchen, presence, cleanup, extra-order and location state. Avoid turning its execution IDs or timers into conversation topics; `scenarioMechanicsContext` provides a compact factual view.

- Bathroom/cleanup breaks hold kitchen time. `returnAt` is the earliest return; the physical controller must bring the date back to the seat before presence changes and deferred date callbacks play. Follow-through choices wait for that return; medical staff-care choices remain immediate. Resume dinner is explicit, with a safe automatic fallback after a resolved break.
- Oversized orders have prepared and pending dishes. Pending dishes can be canceled before cooking completes; prepared leftovers are boxed and remain on the fictional receipt. A delayed choice can produce a different bill. Extras belong to the targeted pair, never the friend's meal.
- The receipt is an authoritative cents-based ledger, not provider spend or real payment. A kept wrong replacement is labeled as the actual dish at the original ordered price.
- Medical early exits finalize the affected director's agenda and reflection, revoke chemistry and preserve the other pair's ability to continue. `DoubleTableScene.reconcile()` must invoke each director's finalization path. Do not finalize only one transport path.
- Wine cleanup clears the actual stain and adjusts cloth/glass state. Medical care clears usable space and stops service/drinks without awarding romance.
- A quiet-table choice moves the dining station to the spare area: `dining-space.ts` supplies the +3.85m Z offset. The furniture, props, cameras, interaction targets, seated people and Rapier table collider must all agree. Door/window targets remain in world space. Both Double couples share this table move while retaining personal progress.
- Wrong plates arrive with service before any bites. Never swap an eaten meal later. The spill belongs to the main course (a minute after service, or the next calm moment before dessert reaches the table) and the noisy diner to dessert (half a minute after it is served); each has its own window and calm interval, and neither needs the other to have happened. Interruptions land before a course moves on. New interruptions stop at billing/farewell and during care/quiet periods.
- `incidentOwner` identifies the actual affected Double pair. A friend can help without their own correct food or ticket being rewritten.

The editable atlas and its data are generated from the actual catalogue/controllers. Use `scripts/analyze-encounter-atlas.mjs`, `verify-encounter-atlas-audit.mjs`, `build_encounter_atlas.py` and `verify_encounter_atlas_doc.py` when changing branches. Review the rendered document; do not update only its counts or leave resolved bugs described as current.

## Visual and interaction constraints

WASD/mouse, E use, R or prop click inspection, T typing, 1–4 pick a prompt chip, J journal, M microphone, Escape closes the current surface before pausing. There is no actions drawer, objective bar or event card: one compact prompt line shows the evening’s current choice and hides when there is none. Touch uses drag-to-look and short single-finger tap-to-inspect; drags, second fingers and canceled gestures must not activate props. Desktop inspection and mobile controls share the same server actions.

Keep materials/geometry reusable and dispose GPU resources. Do not allocate textures every frame. Table-height and physical footprints matter: test plates, cutlery, glasses, paper, cloth, food, board and serving trays from table height as well as overhead. Test all four Double settings and both human seats. Do not hide served dishes or shared props to disguise overlap; park them on a clear support surface and move their targets with them. One human's bites must not eat their date's or friend's food.

Use the existing font/token system: Barlow Condensed for display, Inter for reading/controls. Avoid heavy HUD framing, filler labels and decorative animation. Respect reduced motion. Phone targets need usable touch sizes and safe areas. iPhone fullscreen/URL-bar behavior requires physical Safari/Home Screen verification; browser emulation cannot establish it.

## Local work and verification

Node 24+ and pnpm are the intended tools. Install dependencies, copy `.env.example` to `.env` for local configuration, and run `pnpm dev`. `pnpm build` then `pnpm start` serves the production client. Gameplay can be tested with providers disabled.

```sh
pnpm install
pnpm check
pnpm build
pnpm exec tsx --test --test-concurrency=1 tests/*.test.ts
pnpm exec playwright test tests/browser-atlas-fixes.spec.ts tests/browser-encounter-consequences-ui.spec.ts
pnpm exec playwright test tests/browser-restaurant.spec.ts tests/browser-evening.spec.ts tests/browser-double-date.spec.ts
```

Playwright currently uses installed Chrome and one worker. Browser specs that serve `dist` require a fresh production build. Several legacy integration tests use real clocks; do not run a heavy unit suite alongside WebGL/software rendering. Give one agent the browser/GPU at a time. Use `autoTick:false` and the internal runtime `tick()` methods for deterministic controller tests; these are not public debug endpoints. Never weaken ownership, receipt, spending or atomic rejection assertions just to make a route pass.

Relevant focused tests include `atlas-fixes`, `scenario-consequences`, `full-evening`, `restaurant-scenarios`, `double-date-scene-regressions`, `tabletop`, agenda/boundary/chemistry tests, and the tabletop/encounter browser specs. Three.js changes require actual screenshots reviewed internally: DOM visibility alone misses floating meshes, hidden children and clipping. Physical iPhone, speech quality, live-provider latency and internet/NAT behavior still need separate real-world checks.

Paid comparison/clip utilities default to dry runs. Do not run `--run`/`--generate`, live auditions or ElevenLabs synthesis without authorization. Mock providers in automated tests.

## Deployment

Live game: https://table-for-two.maxpug17.workers.dev/

The existing Cloudflare deployment uses Workers Static Assets plus a SQLite-backed named Durable Object and one managed Node container. Preserve the namespace, durable spending ledger, secrets, current plain-text provider settings and container size. Re-read live bindings before publishing so an unrelated UI/gameplay change cannot overwrite operator configuration.

Read `deployment/cloudflare/README.md`. This project uses the pinned official `cf` CLI/build output, not Wrangler; do not add a Wrangler configuration or migrate hosting. Build the client before building the deployment package. Run its typecheck, portable dry run and provider-disabled bundled smoke. The old initial-release `smoke:live` has assumptions that no longer fit a configured Anthropic key; use appropriate current read-only asset/health/status/isolation/private-path checks rather than blindly running it.

Worker/backend updates restart in-memory evenings; players need a fresh date. Verify live asset bytes against the frozen build, keep private backend/internal paths blocked, and report actual verification limits. Deploy only when requested/authorized; do not upgrade paid resources as routine maintenance.

## Repository hygiene

Keep provider secrets, `.env`, attachments, generated deployment output, runtime ledgers, local QA media, node_modules and rendered document preview directories out of Git. Commit the source, lockfiles, tests, asset/font licenses and final atlas DOCX/PDF. Preserve unrelated workspace changes. Do not force-push or replace remote history as an import shortcut.

Older desktop checkouts may retain pre-import or unrelated Git history and uncommitted work. Inspect their status and fetch the canonical remote before pushing. Use an isolated clone when needed rather than resetting local work or force-pushing over either history.
