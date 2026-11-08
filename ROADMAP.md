# Love at First Strike: development roadmap

## Mobile and professional playability — November 8, 2026

Implemented landscape touch movement/look, safe-area layouts, contextual controls, native typed-input return, gesture cancellation, rotation handling and optional Home Screen setup. Desktop first-time guidance now exposes the actual next step and interaction verb without covering the date. Audio initialization, failed drafts, rejected orders, page return, expired sessions, seated physics and farewell progression have focused regression coverage.

Anthropic remains the AI provider. Free Edge streaming speech is the temporary default, with consistent voices and a device fallback that respects cancellation and server authorization. ElevenLabs is an explicit paid option. Local verification passes 127 unit/server tests, typecheck, production build and ten focused desktop browser checks, plus phone-sized Chromium/WebKit flows. Real iPhone performance, actual local-recognition throughput and human-paced play remain distinct verification work.

The Cloudflare deployment packages the existing live Node server rather than substituting a static preview. Durable Object storage preserves the spending ledger across container restarts; active dinner state remains session-only. See `deployment/cloudflare/README.md` for hosting status and configuration.

## Current restaurant implementation — November 7, 2026

The restaurant has been expanded into a complete evening: course service, actual wrong-dish choices, optional physical coaster rounds, shared drawing, spill cleanup, dessert portions, a bill, entrance farewells, and six outcomes. Three character biographies and persistent social stances support different responses, repairs, refusal, and departure. The browser flow covers a full night, a downloadable memento, and local evening history. Human-paced 20–30 minute playtesting and real-provider voice/dialogue evaluation remain account-dependent verification work.

The restaurant now has three modes: Solo date with a chosen AI and cast, Double date with two real friends and two AI dates plus cast, and Blind date with a surprise seeded personality. Double date uses separate authenticated members, a shared table and conversation scheduler, shared speech production, independently controlled movement and couple outcomes, and peer friend voice. Blind date generates its personality, preferences and biography deterministically without an extra model request. Tripo character work remains deferred. Restaurant rendering, authoritative scene/controller, dinner progression, local recognition, streamed Claude/ElevenLabs integration, hybrid audio caching, saved developer model selection, and cost controls are implemented in their own modules. README.md records setup and verification. Remaining account-dependent work is real Haiku/Sonnet comparison, character voice auditions, pregenerated clip production, and measured provider latency. Bowling is a later venue; the earlier roadmap below is historical and its local code remains accessible through `/?venue=bowling`.

The current expansion shares eleven two-beat scenarios across Solo, Blind and Double: illness, wine on an outfit, over-ordering, staff flirting, an ex, an intrusive family visit, involuntary tics, an allergic reaction, overdrinking, private uncertainty about attraction, and a prejudiced comment. Decisions and character-specific reactions feed factual moments and conversation context. Sensitive branches preserve disclosure/privacy, medical help and the date's boundaries. Taste offers, toasts, water service and check-ins add optional care between courses. Stories and physical incidents share quiet intervals; advancing a course does not force another incident, and billing/farewell prevents new physical interruptions.

Double-date participants can finish independently and remain as wingmen until the other pairing ends. A wingman can move, talk with the remaining date, help at the table and revisit their own ending. Their departed date leaves the scene and conversation targets and retains its completed memory and outcome.

Verification now passes 99 unit/server tests with none skipped, typecheck, production build and the production API/assets smoke check. All 15 focused restaurant browser checks have passing results across a combined run and targeted fresh-process reruns, superseding the 75-unit/12-browser baseline. Coverage includes complete Solo, Double and seeded Blind dinners, both story beats, care persistence and wingman continuation. The final Double route also verifies a usable live chair prompt, stable focused controls while the other pair's coaster moves, and completed-board replay eligibility. Tests use injected provider doubles and made no paid API calls. Native peer voice passed in a fresh browser process; local scheduling stalls in heavier two-browser runs remain a performance investigation, not evidence of real Moonshine throughput.

## Archived bowling roadmap

Status: a local playable venue, classic and cooperative arcade bowling, cooperative pool, cooperative claw activity, clock, and optional mutual midnight ending are implemented; the complete first night is unfinished. The full date and public product remain unfinished. This roadmap preserves the full product while using smaller experiments to resolve risks.

The visual quality gate has not passed. The user rejected the primitive 3D, illustrated, and pixel-art presentations, then supplied **Life Is Strange 2** as the visual reference. A new perspective Three.js proof now connects the code-authored room and characters to all existing activities. Its simplified faces, clothing, and acting still fall short of the reference. Passing networking or physics tests is not visual acceptance. Every visual must be drawn in code: no imported or generated image, sprite, model, or texture assets.

The current venue spans 24 by 24 simulation units with shared physical and rendered boundaries. Pool remains at the back-center and its deck is now near waist height. The pair starts closer together in the concourse with supporting characters nearby. The new renderer uses real depth, an enclosed room, close perspective framing, camera checks against walls and selected opaque furniture, a nearby-pair view, and separate activity cameras. Prop scale and character performance still need art review. In particular, the pool playing surface spans 5.4 by 2.84 units beside characters about 1.78 units tall; correcting this requires coordinated shared-geometry and physics changes.

[ART_DIRECTION.md](ART_DIRECTION.md) records the supplied reference, code-only constraint, next visual production proof, and historical rejected directions. The earlier illustration remains historical documentation only. Its baked poses, obscured paths, and invented control hint must not be copied into the game.

## 1. Define the first date

Deliver a reviewable venue layout and a short experience script covering arrival, exploration, activity choice, escalation, recovery, and midnight. Establish target devices, session length, controls, camera, supporting characters, and communication behavior. Keep confirmed decisions and proposals distinct in PROJECT.md.

Acceptance: the experience clearly describes a date in a connected venue. It cannot be reduced to completing a bowling match. The user can understand what both players actually do without reading an engineering specification.

## 2. Prove physics and online interaction

Create a focused technical experiment before committing to content production. Evaluate aim, spin, mass, friction, collisions, responsiveness, and two-player interactions with simple geometry. Simulate network delay and test the same activity from two browser clients.

Keep simulation separate from rendering and interface state. Establish server ownership of shared outcomes and a measured approach to interpolation or prediction. Choose the network framework after the device and interaction requirements are settled.

Acceptance: activity-specific physical behavior feels satisfying in playtests, both players see consistent outcomes, and simultaneous interactions do not create duplicate objects or unstable motion. Set numerical performance and latency targets once target devices are chosen. Test recovery from interruption. This experiment is evidence for the product, not the product itself.

## 3. Build a representative night

Build a traversable version of the alley with at least two genuinely playable activities, optional communication, the story clock, and the opening and midnight experience. Include a shared surprise that connects areas and requires both players. Use authored geometry and modest visual scope so interaction quality receives attention first.

Acceptance: two participants can experience the complete arc, choose where to spend time, move between activities, recognize their partner's contribution, and reach a satisfying ending without a forced romantic choice. Clock, pause, disconnect, and exit behavior must work. Evaluate the experience with consenting adults who understand it is a date, not just a generic game test.

## 4. Prepare a controlled stranger-dating pilot

Resolve launch geography, adult access, mutual matching preferences, private profile handling, and consent-based contact exchange. Implement block/report, voice mute, a clear exit, incident handling, and an actual human review process. Review legal, privacy, provider, and platform obligations against the chosen launch scope.

Acceptance: no public stranger launch until these requirements are verified. Social-account linking is not a substitute for age assurance or moderation. A technical test session does not establish launch readiness.

## 5. Expand the venue and operate the product

Use findings from real paired playtests to improve the venue, add activities and events, and support repeat visits. Preserve the New Year's Eve arc unless testing and user direction justify a revision. Develop optional sharing only with both participants' control over their identity, content, and recordings.

Evaluate enjoyment, cooperation, memorable moments, ease of use, safety reports, and interest in another date. Do not use kiss acceptance as a success target or infer romantic compatibility from game performance.

## Immediate planning state

- Confirmed: one pair per room; computer-controlled friends; optional communication; desktop-first browser delivery; a New Year's Eve date from 8 p.m. to midnight; every visual drawn in code.
- Current playtest: the new Three.js perspective presentation with wheel zoom and V for a nearby-pair view; server-authoritative Rapier bowling, pool and cooperative claw physics; text/reactions, optional local voice, synthesized effects, clock, pause, reconnection, and a private mutual midnight choice. Earlier renderers are inactive. Static room and character pieces are batched while animated limbs and eyes remain separate.
- Bowling starts normally. After each participant's warm-up settles, a fresh rack introduces real pinball flippers. Roller and pilot have different controls, swap after one round, and bank actual pins once per settled round toward a shared score out of 20. Both must be present to begin an arcade shot. Pilot input expires after 250 ms and clears on pause, exit, or disconnect. They can return to classic bowling at rest.
- The claw begins as an ordinary two-axis drop. Both players must steer and agree; the captured prize becomes oversized and the pair must align and release it through a side hatch into the venue. The angled close view separates the axes and height, shows the claw's projected position on the bed, and displays an opening large enough for the prize.
- Pool now supports two participants, alternating turns, direct pointer shots, physical cushions and pockets, scratch recovery, a shared six-ball clear, and pause/reconnect. Voice includes mutual opt-in, mute/volume, pause muting, and capture cleanup. Internet voice relay infrastructure, richer arrival and friend behavior, additional events, public matching, identity and age verification, moderation operations, and contact exchange are not implemented. The other arcade cabinets remain scenery.
- The close view now has sculpted faces, animated eyes and lips, and four fitted hairstyles. Reactions have visible gestures on the sender’s character. Review a short exchange between the players in motion before extending the art treatment. Clothing, expression, contact with objects and physical prop scale still need work. The evening also needs a human two-player playtest for pacing, activity feel and readability.

## Current verification boundary

The midnight shot and ending card share a local presentation clock. A two-client regression suspends animation callbacks on one browser while room updates continue. The other player can finish and open chat. When rendering resumes, the suspended player sees their shot before their card. Production captures show the mutual kiss and the separate celebration wave before the card in each case.

On November 5 the new face and hair geometry, player reactions and movement were exercised with two local browser clients at 1280×800 and 1000×700. The receiving client showed the sender’s hand gesture and the matching heart toast. The hair covered the scalp from both viewpoints. A five-second foreground sample with the second client closed produced 274 frames in 5.02 seconds, with a longest interval of 41.4 ms. Two active browsers on the same machine experienced longer stalls. Full-evening performance on separate devices remains open. The production build, TypeScript check and all 24 server/physics tests passed during this pass.

The current renderer builds and typechecks. The preceding integration pass ran all **24 server/physics tests** with the new arrival positions and lower pool surface. They cover the listed room, lane, claw, pool, clock, consent, interruption, and voice-signaling rules. The current art/camera pass does not change those simulation rules; it does move a render-only friend. Grounded-pin damping and latched resets remain verified; these checks do not establish that every shot feels satisfying.

All **six focused gameplay browser tests** passed in that integration baseline on the browser's native graphics path: general session interaction, cooperative arcade bowling, the complete claw surprise/release, pool including a real pointer drag projected through the 3D camera, and two midnight cases. The midnight tests run the production client against isolated real servers and cover privacy, dismiss/reopen, pause clearing, in-flight rolls crossing the prompt threshold and midnight, and temporary shot blocking. The lane test includes a coordinated real pin hit and role swap. Its final coordinated roll invokes the actual button handler without stealing focus from the pilot's held keys in the shared browser. Physical-device multiplayer has not been verified.

After the latest character and camera changes, **the new camera browser regression and the existing pool browser test passed**. The camera check uses real movement to verify that pressing V while far apart does not arm a later close view, a pair separated mainly along room depth remains visible in close view, and the booth/counter positions keep the projected head and feet within the viewport and away from the HUD. It waits for the actual camera transition rather than sampling its old pose. Captures were separately inspected: solid furniture can still correctly obscure the lower body, and the counter fallback uses a steeper view. These checks cover those paths, not every possible camera obstruction. Pool again exercised a real mouse drag mapped through the active perspective camera.

Actual paired captures at 1280×800 and 1000×700 were inspected. The review corrected the initial steep camera, detached labels, capped limb seams, pool surface z-fighting, a lane pendant obstruction, and the missing claw release target. Walking reached bowling, pool, claw, and lounge; the large prize remained visible through release. There were no page exceptions or WebGL context-loss events. Initial console 404s were attributed to the missing favicon; the final HTML declares an empty favicon. These captures do not establish visual acceptance; faces, clothing, acting, material richness, and prop scale remain below the intended bar.

Short two-client native-ANGLE samples reported AMD Radeon Vega 8 D3D11. The integration baseline was about 26–27 frames per second; samples during the latest art iteration varied from 24 to 59 frames per second with longest frames between about 42 and 117 ms. This variability is not a representative five-minute benchmark or proof of the proposed 60 Hz target. Forced SwiftShader rendered only about 3–4 frames per second in the earlier local workflow and is recorded separately. Static geometry batching reduced draw overhead while preserving detail; further performance work remains. Browser tests now use native graphics by default, with `LFS_SOFTWARE_GPU=1` available for explicit software-path diagnostics.

The revised forward gait was also sampled from actual shoe mesh transforms at steady speeds of 1.4 and 4.3 units per second after warmup. Maximum drift within a detected floor-contact interval was below 0.0004 units, with sole penetration below 0.00004 units. This controlled check verifies the speed-derived stance calculation, not turns, acceleration, dropped frames, or the complete networked animation. Those can still produce transient sliding because feet are not locked to world-space contacts.

Both 3D midnight outcomes were separately exercised through real private UI choices against the production bundle, with the pair far apart before the outcome. They were repeated after this character/camera pass at both desktop sizes without page errors, showing the staged mutual kiss or neutral celebration with confetti and without traversal/activity prompts. The earlier integration capture exposed overlapping feet and a lingering lane prompt; those fixes remain in place. The latest neutral-case setup initially overshot a lane rail during a long held input; shorter real-key pulses completed the capture without a product change. Character acting remains stiff. The QA browser processes and isolated servers were closed after completion.

The three voice browser tests previously passed with synthetic microphones for opt-in, bidirectional packets, mute/pause, capture release, reconnect, denied permission, and cancellation. They were not rerun for this renderer change; human-perceived sound and voice quality remain unassessed.

To verify locally: run `pnpm check`, `pnpm test`, and `pnpm build`; with the development server running, run the selected Playwright tests. The focused midnight tests require the production bundle and start their own loopback server.

The full evening, public stranger matching, age/identity handling, reporting and moderation operations, internet voice relay, optional contact exchange, real-world network performance, and final visual quality remain unfinished. Passing these checks establishes only the covered mechanics and renderer integration.
