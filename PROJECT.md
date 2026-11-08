# Love at First Strike

## Mobile and playability pass — November 8, 2026

Anthropic remains the dialogue provider. Runtime speech now defaults to free Edge neural voices, with an optional device-voice fallback during outages; ElevenLabs requires explicit opt-in. Spoken text goes to Microsoft, while recognition remains local. No runtime path silently falls back to paid synthesis.

Landscape phone controls provide independent move/look thumbs, contextual interaction, Actions, Talk, microphone and Pause. Layouts use safe areas and the visible viewport, with accessible controls for keyboard return and rotation. The browser remains the delivery format; an optional Home Screen web app provides the iPhone route without browser chrome. Physical iPhone Safari is not yet verified.

The pass also repairs sound-start failures, lost drafts, false order logs, interrupted device speech, page return and expired-session handling, late service during farewells, chair drift, and inconsistent farewell ranges. Arrival guidance and interaction verbs are visible, with a compact desktop command strip. Current local verification is 127 passing unit/server tests, typecheck, production build, ten focused desktop browser checks and landscape Chromium/WebKit checks. Cloudflare packaging preserves the Node simulation in a managed container and the spending ledger in private Durable Object storage; live hosting verification is recorded separately in the deployment notes.

## Current product direction — November 7, 2026

The active restaurant has three modes: Solo date (one human, one chosen AI date and cast), Double date (two real friends, two independently chosen AI dates and cast), and Blind date (solo with a random seeded personality). The seed fixes personality, preferences, boundaries and biography for that evening; it reuses existing appearance/voice assets. Tripo and further character modeling remain deferred.

Double date now has a private invitation room, per-member authentication, distinct choices/readiness, independent first-person movement/seating, a shared authoritative four-actor Rapier world, friend voice, and the complete restaurant course/farewell systems. Each couple retains its own stance and ending. After one pairing ends, that human can remain as a wingman while the other evening continues: move, speak with the remaining date, help with recovery, request water or check in. Their own ending can be viewed and closed without ending the room. Departed dates leave the scene, disappear from conversation targets and cannot receive later dialogue or memory updates. Public friend-directed turns can create exclusion and sincere inclusion can repair it; silence, menus, microphone errors and disconnect time do not count as neglect.

A room uses one conversation scheduler and one Claude request per completed human turn. Both character identities and attributed shared dialogue are supplied together. Zero spoken lines can leave room for friend banter; at most two short lines and one supporting-cast reaction are allowed. Complete validated utterances stream before emotional/memory updates finish. One in-flight speech producer serves both clients without duplicate synthesis billing; receipts remain per listener and global barge-in cancels stale audio. Solo and double modes share the same cache and persistent account budget ledger.

Gameplay snapshots/signaling use authenticated bounded HTTP polling, and speech has its own streaming response. Friend voice uses the existing peer transport with configured ICE servers. Recognition and friend voice lease independent cloned tracks from one physical microphone grant. HTTPS and appropriate TURN configuration are needed for hosted use; localhost peer tests do not establish internet/NAT reliability. Reconnect preserves the member token and seat for a grace period, pauses the table, and requires a fresh voice opt-in.

Solo, Blind and Double dates now use the same eleven story tracks: feeling unwell, red wine on clothing, an oversized order, flirting with staff, an awkward ex, an intrusive family visit, involuntary tics, an allergic reaction, too many drinks, private uncertainty about attraction, and an unwelcome prejudiced comment. One is selected per evening and Double date shares it across the table. Each story has two playable beats, character-specific reactions, factual decisions and a remembered resolution. Voluntary disclosure, staff boundaries and medical assistance keep the core awkward situations without making disability, identity or a guest's body the joke. A stated attraction mismatch remains nonromantic.

Offer a taste, choose a toast, request water or check in with the date. These once-per-evening gestures reflect character preferences and current context; refusal is respected and care does not buy affection. Water has service time, and slowing down creates a quiet interval. Timed wrong orders, spills and noisy diners share a calm-period clock with stories. Course progression no longer force-spawns all three incidents; active interruptions still need recovery, and new physical incidents stop during billing/farewell. Table games have explicit ownership so the other client watches the same physical board instead of issuing competing shots. The archived bowling workspace remains preserved.

Production startup profiling found shader first use blocking the menu. The renderer now prepares programs asynchronously when KHR_parallel_shader_compile is available, waits for shared assets, coalesces cast changes, and cancels pending waits on disposal. Canvas aria-busy remains true until the first completed draw; DOM menus stay interactive and world input waits for readiness. Two local production comparisons measured Play dispatch at 1.59–1.71 seconds (previously 6.11–6.86), largest long task 1.04–1.07 seconds (previously 3.73–4.05), and the first completed draw around 4.1 seconds. These are local startup measurements, not provider latency or steady-state frame-rate guarantees. Unsupported browsers retain ordinary rendering.

Current verification: all 99 unit/server tests pass, with no skipped tests. Typecheck, production build and production API/assets smoke checks pass. All 15 focused restaurant browser checks have passing results across a combined run and targeted fresh-process reruns; this supersedes the preceding 75-unit/12-browser baseline. Coverage includes complete Solo, Double and seeded Blind dinners, both story decisions, care/reload persistence, wingman help and history after an independent ending, live usable chair prompts, stable action-node focus during the other pair's physical coaster motion, shared billing/receipts, keyboard settings, warmup disposal and speech lifecycle failures. Native bidirectional peer RTP passed before/after pause and reconnect in an isolated browser run. Two-browser runs also exposed local scheduling stalls; passing isolated checks does not establish steady-state rendering performance or real recognition throughput. Tests use injected provider doubles and made no paid API calls; the local preview currently has no Claude or ElevenLabs keys. Real provider quality/latency, real Moonshine throughput alongside the scene, human-paced playtesting, and internet TURN reliability remain unverified.

Speech research: the user means the OpenWhispr dictation app (OpenWhispr/openwhispr), whose current source is MIT and uses native desktop speech engines. It is an engine/pipeline reference, not a drop-in browser recognizer; the existing Moonshine baseline is already local and avoids transcription API charges. Compare recognition quality, turn-finalization latency and rendering load before replacing it. Free edge-tts lacks supported emotional SSML/acting controls, so ElevenLabs remains the character-voice default under the user's expressivity requirement. Azure expressive/DragonHD voices are a separate service and would need their own audition. A bounded free Edge audition exists under .qa/edge-tts-audition; no runtime provider change or paid speech request was made.

Terra 6.1 at the highest available reasoning setting leads the approved title/menu and minimal gameplay UI direction. The user requested phased implementation and then explicitly said to build it. No numbered interface decoration, filler copy or persistent app toolbar. The current visual pass keeps the restaurant layout, finishes cocoa/rose materials and practical lighting, and replaces photographic windows with subdued 3D buildings and animated rain. Tripo is explicitly deferred; a small CC0 plant/vase kit and replaceable prop slots support the room now. Runtime screenshots and complete gameplay checks remain distinct from concept approval.

The Game Studio workflow follows the Scam With Your Friends reference and fun, flirty K-pop tone. Selection, close conversation, held ordering menu, physical coaster board, lifted napkin/dessert view and door farewell stay visually connected to the restaurant. Free licensed environment assets are authorized and retain provenance/license records. The earlier Astra/web-panel treatment is superseded. Character rigs remain replaceable and further character polishing is deferred. Visual acceptance remains the user's judgment.

The restaurant now contains a complete evening arc: independent meal choices, playable coaster physics, shared drawing, food and dessert serving, recoverable incidents, a bill, a walk to the entrance, and six categorical ending outcomes. Three deeper character stories drive authored cues and the single-call Claude director. Conversation can change a persistent stance, acknowledge a repair, or lead to an NPC departure. Completed-night mementos and local history support replay. Live provider quality and human pacing still require configured accounts and a full human playtest.

The user approved a single-player first-person AI restaurant date, with a reactive AI cast, the stylized format of Scam With Your Friends, and code-authored visuals. The default experience is now **Table for Two**: a new restaurant, three adult date presets, natural spoken or typed conversation, physical table interactions, and escalating dinner interruptions. One Claude request per player turn directs the date and optional cast response. Local Moonshine recognition and hybrid cached/live ElevenLabs speech are selected. The developer can save Haiku/Sonnet selection and inspect usage and costs.

The older two-human bowling-alley, Life Is Strange 2 visual target, stranger-matching and midnight arc below are historical. They are preserved in the archived prototype at `/?venue=bowling`; they do not constrain the restaurant mode. See README.md for current implementation, setup, verification, and limits. Real-provider voice quality and dialogue evaluation require configured API accounts.

## Historical bowling-alley brief

Long-term project brief. Updated November 2, 2026.

## Product

A multiplayer first date inside a bowling alley on New Year's Eve. Two real people arrive with romantic intent, explore the venue together, and experience familiar activities becoming surprising cooperative situations. Story time begins at 8 p.m. and builds toward midnight.

The bowling alley is the experience. Bowling, pool, the arcade, and the spaces between them give the date variety. Shared action, humor, improvisation, and recovery let people discover how their date behaves. The viral hypothesis is the concept of a gamified date; it remains to be tested.

## Archived bowling direction

- One matched pair of real players per session. Starting with known partners is not the intended product; stranger dating remains central.
- The opening friends are computer-controlled human characters around the two real players. They are not additional real guests.
- Browser-native delivery, desktop first, with mobile planned later. The current presentation uses a new perspective Three.js renderer; Rapier owns shared physical interactions on the server.
- A consistent visual identity is required. The user rejected the primitive 3D, illustrated, and pixel-art presentations. The user supplied **Life Is Strange 2** as the visual reference. A color palette alone does not satisfy this requirement.
- Optional voice, text, and reactions.
- Activities and excellent physics are fundamental. This is not a questionnaire or a sequence of conversation prompts.
- Begin with understandable, ordinary situations. Introduce chaos after players understand the activity, using controls they already know.
- Maintain room to explore, interact, and enjoy calmer moments between surprises.
- Use a large, always-visible clock to build anticipation toward midnight.
- The midnight ending includes an optional private mutual kiss choice; the room remains open after the celebration.
- Every game visual must be drawn in code. The user explicitly confirmed this requirement. Use authored drawing commands, procedural geometry, and inline vector paths; do not introduce imported or generated image, texture, sprite-sheet, or model assets, including encoded copies embedded in source.
- The project should preserve the cooperative design principles of It Takes Two without copying its characters, story, levels, or assets.

## Art direction

A bowling lounge on New Year's Eve: intimate, lived-in, and ready for an absurd night. The user supplied Life Is Strange 2 as the visual reference. The new Three.js proof pursues painterly perspective 3D, human-scale framing, adult characters, and motivated lighting. It is integrated with the existing activities, but its simplified faces, clothing, and character performance have not met the intended visual bar. The previous renderers are inactive historical work. Every visual is still drawn in code.

[ART_DIRECTION.md](ART_DIRECTION.md) records the researched reference, code-only implementation approach, next production proof, and historical rejected presentations. The old generated concept is historical documentation only.

- Materials: walnut paneling and cabinetry, oxblood upholstery, cream plaster, brass trim, honey-colored lanes, and burgundy patterned carpet. Muted green is reserved for pool felt and restrained clothing accents.
- Color hierarchy: dark warm architecture frames the scene; cream identifies readable signs and text; brass marks controls and activity targets. Props inherit the palette of the place they belong to.
- Forms: original adult characters with authored anatomy, facial features, clothing, hair, grounded movement, and subtle reactions; furnishings with recognizable construction. Character modeling and animation are substantial unfinished work.
- Light: amber pendants and warm pools of light, with enough fill to see faces and physical targets. Celebration effects stay cream and gold.
- Typography: restrained venue signage and legible interface controls that leave the room visible. The pixel lettering belongs to the rejected playtest presentation.
- Camera: close perspective framing during exploration, with collision-aware movement and composed views for shared interactions. Activity views must keep both players' contributions and physical targets readable. Review with the actual interface visible at desktop window sizes; fix wall, prop, and label occlusion before accepting a scene.

## Current design proposals

These are recommendations, not all approved implementation decisions.

- Continue the new Three.js visual proof over the existing authoritative simulation. Movement currently remains aligned with venue axes; V opens a close view when a connected partner is nearby, with framing based on the pair's positions, and movement returns to exploration. Camera clearance includes selected opaque furniture. Pool input uses the actual camera ray and table plane. Further camera changes must preserve clear movement and pointer mapping. Character anatomy and acting remain unfinished; prop proportions require changes to both shared physical dimensions and render geometry.
- Treat 8 p.m. to midnight as a compressed story clock, not a four-hour real-time session. Use 30 minutes as a provisional playtest duration; the user has not yet confirmed the duration.
- Use authored behavior and dialogue for supporting characters initially. Generative AI is not required to make these characters act as friends.
- Have the venue's New Year's Eve preparations and mishaps connect the activities. Avoid making each game feel like an unrelated menu destination.
- Offer a private midnight choice to both players. Animate a kiss only after both opt in. Either player can decline, withdraw, or leave without a penalty. Preserve a warm shared celebration when there is no mutual kiss; do not reveal who declined or generate a compatibility score.
- Keep optional contact exchange separate from the ending and entirely voluntary. A social account is not evidence of adulthood or safe behavior.

## Experience structure

1. Arrival: establish the date, the group, the venue, and the approaching New Year. Teach movement and interaction through ordinary actions.
2. Settling in: let the pair choose something to do together. Early activities establish responsive controls and convincing physics.
3. Surprises: introduce changes that need coordination, assistance, or playful improvisation. Preserve meaningful contributions from both players.
4. Recovery and exploration: allow quieter moments, new activity choices, and small discoveries. The venue remains a coherent place throughout.
5. Midnight: bring the pair into the countdown and deliver an optional mutual romantic ending within the celebration.

This is a draft dramatic arc, not a locked sequence or minute-by-minute schedule.

## Design constraints

- Dating intent is part of the premise; do not replace it with an unrelated party game to simplify delivery.
- The world can behave absurdly, but the controls and physics response must remain understandable.
- A player should be able to recover from a mistake and help their partner. Avoid mechanics that consistently assign blame or let one skilled player do everything.
- Do not frame the date around earning affection, a compatibility grade, or an obligatory decision to keep talking.
- Keep the clock separate from any measure of attraction. Do not reward romantic consent with gameplay advantages.
- Shared physical outcomes must remain consistent online. Engine determinism alone does not provide a multiplayer networking solution.
- No external social profiles are exposed by default. In-game safety and an age/identity policy remain necessary before public stranger matching.
- Supporting characters, if computer-controlled, must be identifiable as such. The user has not selected generative AI or an AI service.

## Open decisions

1. Playtest the provisional 30-minute session, clock progression, pausing, and interruption behavior.
2. Review the venue layout, first activity set, and events connecting them in FIRST_DATE.md.
3. Dating eligibility and private mutual preferences; age assurance and identity handling; scope of profile visibility.
4. Public voice transport, reporting, moderation, retention, and launch geography. The local build now has mutually enabled voice, mute/volume controls, pause muting, and microphone cleanup; this does not establish public service readiness.

Resolve these in small groups as needed. Do not turn exploration into a long questionnaire or treat provisional recommendations as user approval.

## Evidence and references

- [EA: It Takes Two features](https://www.ea.com/games/it-takes-two/it-takes-two/features): cooperation, changing abilities, and shared action.
- [Josef Fares: gameplay and story](https://blog.playstation.com/2020/12/10/introducing-it-takes-two-the-wildest-co-op-ride-of-your-life/): mechanics designed with narrative intent.
- [Rapier rigid bodies](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/) and [joints](https://rapier.rs/docs/user_guides/javascript/joints/): candidate physics foundations, not proof of game feel.

See [FIRST_DATE.md](FIRST_DATE.md) for the proposed venue and evening, and [ROADMAP.md](ROADMAP.md) for the staged work and validation gates.
