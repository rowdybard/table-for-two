# Love at First Strike

A multiplayer New Year's Eve date in a bowling alley. The complete product includes exploring the venue, activities, physical surprises, supporting characters, and an optional mutual midnight ending. See [PROJECT.md](PROJECT.md), [FIRST_DATE.md](FIRST_DATE.md), and [ROADMAP.md](ROADMAP.md) for the product direction.

[ART_DIRECTION.md](ART_DIRECTION.md) records the user's Life Is Strange 2 visual reference, the code-only production constraint, and the current visual proof. Earlier concept artwork is historical documentation.

## Current build

A local desktop-browser playtest of an incomplete date inside a connected bowling lounge. The current presentation uses a new perspective Three.js renderer with code-authored geometry, generated material textures, skinned character limbs, and shared server physics. The camera follows the player; the wheel changes distance and V opens a closer view when the pair is nearby. Earlier primitive 3D, illustrated, and pixel presentations were rejected. This new proof has not met the requested visual bar; faces, clothing, acting, and scene composition need substantial work.

Pool sits at the back-center, bowling to the left, and the arcade to the right, with the shoe counter and lounge around the arrival. Shared coordinates align furniture and activity boundaries. The pair now begins together near the supporting characters, and the pool deck has been lowered to waist height. Walls and ceiling enclose the room; camera collision and separate activity views preserve playable sightlines. No imported visual assets are used.

Two people can walk the venue, bowl with server-authoritative Rapier physics, play cooperative pool, and operate a cooperative claw machine. At pool, take alternating shots toward a shared goal of clearing six balls; cushions, collisions, pockets, and cue-ball scratches are simulated. At the claw, each player steers one axis and both choose when to drop. A captured prize grows too large for the chute: steer it together to the side hatch and release it into the venue as a physical object. Text, reactions, optional synthesized sound effects, a shared clock, pause/resume, and reconnect are included. Authored computer-controlled friends greet the pair.

The midnight invitation is private and optional. Both people must explicitly choose yes for the kiss; either can change their choice before it begins. Otherwise the night reaches a shared celebration. The room remains open afterward.

Optional voice is available after both players enable it. Mute and output-volume controls are separate from game sounds. Pause mutes both directions, leaving voice releases this page's microphone tracks, and a disconnect requires fresh opt-in. This build uses direct local WebRTC connections without an internet relay; public-network voice is unfinished.

The other arcade cabinets remain scenery. The full date, richer supporting characters and events, public dating/matching, reporting and moderation, adulthood verification, and contact exchange remain unfinished. This is a local playtest, not a public dating service.

## Run locally

Use Node.js 24 and pnpm 11. The lockfile pins dependencies. No API key or external account is needed.

```sh
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173`. The development server hosts the browser app and the WebSocket room service on that address. It binds to loopback; an invitation from this build works only on the same computer. To test the second player, open the invitation in a separate browser profile or incognito window so each has independent session storage.

1. Enter a first name and leave the room code blank to create a room.
2. In the second browser, enter a different name and the first room's code.
3. Use WASD or arrows to walk: A/D across the room, W/S toward its back/front. Use the wheel to zoom and V for a closer view while your connected partner is nearby. V dismisses the greeting; walking returns to exploration. Close framing follows the pair's positions, and the camera checks walls and selected opaque furniture.
4. Approach the bowling lane and press E to enter; set aim, power, and spin, then press Space or Roll. Fresh pins becomes available once the objects settle. E or Escape leaves the activity.
5. Approach the prize machine and press E. Each player takes a control: one steers left/right with A/D, the other away/toward with W/S; the on-screen buttons also work. A ring marks the claw's projected position on the prize bed. Align it over the prize and both choose Ready to drop. If the oversized prize appears, steer left and toward the marked release bay; both choose Ready to release. Swap controls or leave whenever you like.
6. Approach the front or side of the pool table and press E. Both players take a cue. On your turn, drag back from the white ball and release to shoot, or set aim/power and use Take shot. Turns alternate after each shot. Pass cue lets the other person shoot; a scratch replaces the white ball after the others stop. A new rack becomes available after clearing the table. Leaving preserves the rack and allows an already-started shot to settle; both people must return before another shot.
7. Enter opens chat. Voice off opens the voice controls without accessing a microphone; Enable voice requests microphone permission. Both people must enable voice before audio flows. Mute mic silences your input, Leave voice stops its tracks, and Your date's volume changes playback locally. Escape closes the controls.
8. Sound off/on toggles locally synthesized effects; it never accesses a microphone. Either player can pause; both must confirm resuming. Leaving closes the date for both and releases voice capture.

The clock stays at 8 p.m. while waiting for a second player, then advances toward midnight over 30 active minutes. Reloading can reconnect to the same slot for 60 seconds; both players confirm resuming. A private midnight choice appears at the next safe activity boundary near the end of the evening. Keep playing dismisses it; select the clock to reopen it. No answer or a decline leads to the shared celebration without a kiss. Pending choices are cleared by pausing or disconnecting. In-flight shots finish before the ending; new shots wait while the midnight outcome is pending.

## Verification

```sh
pnpm check
pnpm test
pnpm build
```

Build first and keep the development server running, then `pnpm test:browser` runs paired browser regression tests using installed Google Chrome. The focused midnight tests launch their own loopback server with the production bundle. Browser tests use the browser's normal graphics path; set `LFS_SOFTWARE_GPU=1` to force SwiftShader for a separate software-rendering diagnostic. Voice tests use synthetic audio devices and never access the user's real microphone. These tests do not establish target hardware performance or human-perceived audio quality. Screenshots are written to the ignored `.qa/` directory.

`pnpm build` builds the browser bundle only. A deployed product also needs the room server; publishing `dist/` alone will not provide multiplayer.

## Architecture

- `src/render/CinematicVenueRenderer.ts`: current perspective camera, state interpolation, physical-object views, pool ray/plane input mapping, and ending presentation.
- `src/render/cinematic/`: code-authored environment, procedural materials, characters and animation. Static meshes are batched within material and animation boundaries. The older renderers are unused and excluded from the active bundle.
- `src/shared/`: network types and venue geometry shared by client and server.
- `server/`: room lifecycle, validated player intents, fixed-step Rapier physics, clock, and communication. Pool has an isolated planar Rapier simulation so walking bodies cannot disturb the table.
- `src/audio/`: optional synthesized gameplay effects, activated by the player.
- `src/voice/`: explicit voice opt-in, audio-only WebRTC transport, mute/playback controls, and capture lifecycle. `server/voice.ts` validates signaling; the room server relays it only to the consenting partner. No audio is recorded or transcribed by the app.
- `src/main.ts`: local session UI, controls, connection, and contextual activity interface. Key changes send immediately and held input refreshes on a separate timer, so command delivery does not depend on animation frames. Blur, pause, and open communication panels stop gameplay input.
- `tests/`: WebSocket integration and actual browser interaction coverage.

No production hosting has been configured. The remaining public-launch work in the roadmap is required before stranger matchmaking is exposed.

Browser voice references: [microphone permission and secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [WebRTC signaling and ICE ordering](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling), and [stopping media tracks](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/stop).
