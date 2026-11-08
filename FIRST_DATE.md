# A first date at Love at First Strike

> Historical bowling prototype. The current approved first date is the single-player AI restaurant experience described in README.md and PROJECT.md. The New Year's Eve and two-human rules below apply only to the preserved bowling archive.

Design direction and current local playtest, November 2, 2026. Confirmed product constraints live in PROJECT.md. The complete first night remains unfinished; the proposals below distinguish future possibilities from the playable local build.

## The place

One continuous, walkable bowling alley on New Year's Eve. Two real players arrive with a small group of supporting characters. The characters welcome them and occupy the space; the two real people remain the date.

The user selected Life Is Strange 2 as the visual reference after rejecting the previous presentations. The next visual proof will use painterly perspective 3D, close human-scale framing, original adult characters, and a lived-in interior. Every visual remains authored in code. The current mechanical layout places bowling at the back-left, pool at the back-center, and the arcade at the back-right. The shoe counter and lounge frame the arrival on either side. The central concourse leads to the pool approach, with routes connecting the activities. Layout may change with the new staging, but rendered and physical boundaries must stay consistent. See ART_DIRECTION.md for the reference and production gate.

| Area | Its role in the date | Initial interactions |
| --- | --- | --- |
| Entrance and shoe desk | A natural arrival and short introduction | Walk, greet, choose a ball or prop, learn interact |
| Bowling | Familiar physical play and moments to celebrate or recover | Aim, power, spin, ball and pin collisions |
| Arcade | Fast cooperation and playful experimentation | A two-player claw machine: one controls horizontal movement, the other depth, both agree to drop; swap roles freely |
| Pool | Another place to spend time, with a different rhythm | Aim and strike, readable ball collisions, optional team trick-shot layouts |
| Lounge | Breathing room and an informal gathering place | Sit, talk, react, interact with a few simple props |
| Concourse and clock | Connect the venue and gather for the countdown | Meet characters, watch events, move freely between areas |

The current local playtest has bowling, cooperative pool, and a cooperative physical claw machine, plus the walkable concourse and lounge. Pool alternates shots toward a shared six-ball clear, using physical collisions, cushions, and pockets. At the claw, both players steer different axes and agree on the drop; after catching a prize they must guide its oversized form to the side hatch and jointly release it into the venue. The other arcade cabinets remain scenery. The public product and complete first night remain unfinished.

## How the evening moves

Proposed target: 30 minutes of active play, covering 8 p.m. to midnight. These time windows set tone and event eligibility, not compulsory appointments. Players choose their route and can linger, change activity, or take a break together.

| Real time | Story time | Intended experience |
| --- | --- | --- |
| 0–4 min | 8:00–8:32 p.m. | Arrive, meet the group, learn movement and interaction through ordinary actions |
| 4–11 min | 8:32–9:28 p.m. | Choose a first activity; understand the controls and each other's approach |
| 11–21 min | 9:28–10:48 p.m. | Experience an unexpected variation, recover together, and explore another activity |
| 21–27 min | 10:48–11:36 p.m. | Give the pair more choice and a calmer interval; characters prepare for midnight |
| 27–30 min | 11:36 p.m.–midnight | Finish or leave the current activity, gather, and take part in the countdown |

A first surprise may happen well before the middle of the night once both players have demonstrated the relevant controls. Do not wait for a fixed timestamp if they are already comfortable, and do not force a complicated twist on someone still learning. Schedule only one major disruption at a time.

Suggested activity transformations for testing:

- Bowling learns from the adjacent arcade: familiar bumpers become large pinball flippers. Implemented locally: after each person completes an ordinary roll and both join the lane, setting fresh pins starts two cooperative rounds. One person rolls; the other holds A/D or the two on-screen flipper controls. The flippers are real moving colliders. Settled pins count once toward a shared score out of 20, and the second round swaps roles. Both must be present for a new arcade shot. They can return to ordinary bowling when the lane rests; doing so suppresses automatic reentry until they explicitly choose the flippers again.
- The cooperative claw machine successfully captures a prize, but it is much too large for the chute. A short extension uses the same direction and drop controls to swing it toward an alternate release. Avoid inventing a new control scheme at the surprise.
- A venue event connects the spaces: the staff test the midnight party mode early, changing the lighting and activating a burst of playful physical effects throughout the concourse. The final interactive version should be chosen after movement and activity physics are playtested; lighting alone is not a cooperative challenge.

The lane and claw transformations are implemented locally; the venue-wide event remains a candidate. This is not a promise that every date follows identical events. Develop enough variation to keep later visits interesting after the central experience works.

## Controls and communication

Desktop playtest: WASD or arrow keys for movement along the venue axes, E to enter or leave an activity, Space to shoot or roll at pool/bowling, and Escape to release an activity or open pause. Pool also supports dragging back from the white ball and releasing. The exploration camera has a fixed orientation and wheel zoom. The claw's angled close view shows independent left/right and depth travel; the assigned operators use A/D and W/S respectively, or the on-screen controls. Supply visible controls when the context changes and remapping before the stranger pilot. Controller and touch layouts come after keyboard/mouse play is stable.

Activity controls should express player intent through tuned physics. Players can predict what will happen when they aim, push, spin, or release something. Surprises change the situation, not the reliability of the controls. Assistive aim and forgiving timing are preferable to making game skill a requirement for a good date.

The local build requires explicit enablement from both people and browser microphone permission before voice flows. It includes mute, output volume, text, and reactions. Pause mutes voice; leaving releases capture, and disconnect requires fresh opt-in. Voice currently uses local peer connections without an internet relay. The representative night must be completable with voice off. Character dialogue is clearly distinguished from the two real players, is captioned, and does not impersonate a real participant. Start with authored character behavior rather than introducing an AI service dependency.

## Clock and interruptions

Proposed rules:

- One server-owned story clock advances at eight story minutes per active real minute. Both players see the same time, including after reconnecting.
- Preserve the large physical clock as a landmark and show a small HUD clock whenever the world clock is outside the current framing. A player never needs to leave an activity to check the time.
- Offer the private midnight choice from 11:55 p.m. at the next safe activity boundary. Players can dismiss it, continue playing, and reopen it from the clock without changing their saved answer. Do not unexpectedly cut off a shot or move a character into a kiss animation.
- At midnight, finish an already released bowling/pool shot or automatic claw drop/lift before resolving the celebration. Temporarily prevent new shots while the ending is unresolved. A pool shot continues settling if someone leaves the table, but pauses when the room pauses. The story clock stops at midnight; any remaining no-response grace counts only while activities are safe to interrupt.
- Either player can pause immediately. Both confirm resuming. A pause clears both unactivated midnight choices and restarts their response grace, so a previously saved yes cannot activate immediately after resuming. Keep a clear leave option throughout, and do not penalize either player for using it.
- On disconnection, pause shared play for up to 60 seconds. Restore the same room state on reconnect and request both players' readiness before resuming. On timeout, offer the remaining player a clean exit; do not substitute an undisclosed bot for their date.
- Leaving the date cancels pending romantic or contact-sharing actions. Resume and reconnection cannot bypass a block.

The proposed pause/reconnect behavior needs testing against conversational flow and server resource limits. The real duration may exceed 30 minutes when players pause.

## Midnight

The countdown belongs to the whole venue. Friends celebrate around the pair. A private invitation lets each player choose whether their avatar participates in a kiss with this date. Do not send either person's individual choice to the other client. Execute the shared animation only after both have explicitly opted in and neither has withdrawn, left, or blocked the other.

Both players retain the ability to cancel through the moment the action begins. No response counts as no consent. Without mutual consent, show an equally complete celebration. Do not identify who declined or attach a gameplay prize, penalty, score, or compatibility claim to the outcome. A mutual kiss necessarily reveals that both opted in; the UI should make that consequence clear.

The local build keeps the room open after midnight so players can finish the celebration and leave. Optional contact exchange can be available without becoming a mandatory result screen. The future-message idea from the original screenshot remains a later possibility rather than a dependency for this night.

## Technical approach and first validation

The current visual proof uses perspective Three.js over authoritative Rapier 3D physics to pursue the supplied Life Is Strange 2 reference. The new camera, code-authored room and characters, and activity views are integrated; visual fidelity remains unproven. Presentation preserves physical positions and orientations rather than replacing collisions with scripted outcomes. Keep simulation, activity rules, visual presentation, input, and communication separate. Maintain shared room, activity, clock, and consent state on an authoritative server. Clients send permitted actions rather than declaring outcomes or their own verification status.

Browser-native delivery is selected. Godot was considered: it can also export to the browser, but introduces its own web rendering, audio, and threading constraints. The native-web recommendation favors direct integration with the dating service and browser communication tools; it does not assert that Godot cannot achieve the game or that Three.js automatically provides better physics. Reference: [Godot web export documentation](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html).

Proposed test targets, to be calibrated on recorded reference desktop hardware:

- Fixed physics simulation at 60 Hz, with 95th-percentile rendered frame time no greater than 16.7 ms during a representative five-minute session at 1080p.
- Usable paired control at 150 ms round-trip network latency with 1% simulated packet loss. Check visible corrections and perceived responsiveness as well as state consistency.
- Stable repeated collisions and joint interactions without tunneling, explosive motion, or duplicate ownership. Define tolerances against actual object dimensions and the activity's needs.
- Reconnect restores the same room, activity, clock, and consent boundaries. A retired room cannot be rejoined to reach a departed or blocked player.
- Test at least two different activity mechanics. Bowling alone does not validate pool, a claw machine, venue exploration, or the date as a whole.

## Next review

Review the actual paired arrival, routes, movement feel, and transitions between the three playable activities. The current layout separates the pool and lane approaches; furniture should hide only the body parts physically behind it, with player names remaining readable. The art direction, complete evening, character performances, surprise pacing, and provisional duration still need validation. Keep public matchmaking and external contact exchange behind the separately documented launch-readiness work in ROADMAP.md.
