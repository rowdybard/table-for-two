# Conversation depth: persistent implementation goal

Status: **active**. Branch: `codex/conversation-depth`.

Implement the user's approved “Make Table for Two's conversations worth sharing” plan, starting from canonical `main` (`05ff06a5e5727fc99d78fe64469460ab286a4d0a`). Preserve subsequent Claude work and the unrelated desktop checkout. The target is funny, flirty, surprising, emotionally believable conversations with distinct characters and earned callbacks. Keep the current cast, modes, restaurant, eleven scenarios, sixteen agendas, six outcomes and dinner mechanics.

## Required implementation

- [x] Reliable Solo reply streams: actual-provider deadlines, completion checks, cleanup, same-evening recovery.
- [x] Bounded Double requests and delivery acknowledgments; preserve per-listener evidence and seats.
- [x] Evaluation uses production system, transcript, turn-note and validation builders.
- [x] Sixty coherent eight-turn scripts: twelve per preset, twelve seeded Blind, twelve Double.
- [x] Six thirty-exchange continuity fixtures.
- [x] Record first utterance, completion, format failures, costs and unrated human review fields. Default dry run; explicit budget required for live execution; no AI judge.
- [x] Fifty-four preset conversation seeds: each character has six anecdotes, six opinions, three contradictions and three modest desires.
- [x] Six exchange examples per character: teasing, attraction, disagreement, vulnerability, repair and an unpromising opening.
- [x] Select at most two relevant, untold, disclosure-appropriate seeds; add no more than 600 estimated prompt tokens on comparable turns.
- [x] Balance natural speech protections with confident flirting, shared jokes, character-specific pushback and occasional stories. Vary openness in presentation; keep mechanical confidence and romance earned.
- [x] Preserve HUMAN / TOLD THEM / OPEN memory. Keep at most one grounded shared premise; corrections, disclosures and promises take priority. Retire stopped or stale bits.
- [x] Three alternatives per character for twelve frequent authored cue slots: 108 versions total. Preserve suppression and aside limits.
- [x] Existing scenario choices get branch-specific immediate context and appropriate later factual callbacks; no new branches or interruptions.
- [x] Blind: thirty-six grounded seeds, twelve vulnerability motives, twelve opening templates; deterministic seeds and no preset biography leakage.
- [x] Double cast voice, knowledge, agenda and romantic progress stay independent.
- [x] Refresh restrained reaction envelopes for distinct delivered utterances, including repeated emotion values. Important speech/listening wins over incidental gestures.
- [x] Bound voice preparation/playback, retain existing fallbacks and truthful receipts, and reject late audio.
- [x] Latest authorized scope: reduce GPU cost for potato hardware, including cheaper lighting/shadows, materials and scene detail while retaining readable faces, hands and captions. No replacement character rigs or new activities. Remote performance/readability verification remains pending.
- [x] Fix the separately reported WASD input delay and stutter while preserving authoritative movement, collisions and interaction rules. Remote movement verification remains pending.

## Constraints and verification

- Do **not** launch the game, a browser playtest, or a rendering fixture on this computer. Browser tests run in GitHub Actions. Node-only unit tests, typechecks, builds and dry runs are permitted.
- No live model auditions, paid synthesis, speculative generations, background model judges or additional production calls. Live auditions require a separately authorized explicit spending cap.
- Keep existing turn JSON and the 700-character model memory target. Interest remains presentation-only. Optional timeout metadata/start-model identity are the only transport additions.
- Preserve provider settings, privacy disclosure, host-only controls, chemistry and boundaries. No automatic paid fallback or retries.
- Browser recovery must cover headers-only/stalled bodies, failed streams, late receipts and successful next turns without reset.
- Human quality gates remain **unverified** until a real review: candidate preferred in at least 70% of non-tied comparisons, at least 90% latest-turn relevance, 80% anonymized cast identification, and both reviewers find an earned memorable beat in at least forty of sixty scripts. No fabricated human facts, unheard callbacks or transferred couple progress.
- Work through Mira's content slice and offline checks first, then extend to other cast, Blind and Double. Mock checks do not establish human preference or live dialogue quality.
- Publish the game only after integrated quality review and deployment checks. Keep the branch/PR reviewable when human-review or spending gates are pending.

## Progress log

- Canonical source cloned into an isolated checkout; original desktop tree left untouched.
- Confirmed initial base is `05ff06a`; dependencies installed from the frozen lockfile.
- Parallel owners: runtime/integration (root), dialogue/content, evaluation/CI, presentation/audio.
- Implemented all source items above. The Mira slice passed offline selection checks before expanding the other cast; this was not a live preference audition.
- Content checks verify 54 preset seeds, 18 exchanges, 108 cue versions, 36 Blind seeds, twelve Blind motives/openings, and all 58 scenario histories in three voices.
- Evaluation checks execute all 660 scripted turns using injected providers, with no HTTP/renderer startup. Human ratings remain null.
- Typecheck and production client build pass. The first complete Node run passed 568/569; its remaining greeting-dependent fixture was corrected and its focused rerun passes. Final frozen CI is authoritative for the integrated tree.
- Review caught and fixed hidden-caption completion, authorization-error caption fallthrough, and terminal `done` waiting for HTTP EOF.
- Prepared an isolated baseline bench at `08fceff2408c7597601c993e7b7d7a73e93e1610`, preserving evaluated source `05ff06a5...`. Frozen-source parity and all 660 injected turns pass; no live baseline capture exists.
- Added offline counterbalanced human-review packets and a gate calculator. Nine checks pass; human judgments remain null, and missing capture/review coverage blocks a pass.
- First remote browser run exposed two recovery mock fixtures matching old failed transcript text and existing software-browser test assumptions. Source/unit/package checks passed; browser verification and artifact review remain pending the corrected integrated run.
- The integrated Node suite subsequently passed all 608 checks. The five recovery/caption browser cases and four speech cases pass; remaining existing browser-flow failures are being corrected from remote traces, without launching locally.
- Complete baseline/candidate prompt comparison covers 2,640 matched requests across all scripts, natural/comfortable stances and Haiku/Horde. Maximum increase is 419 estimated tokens; no request exceeds the 600-token allowance. Reproducible evidence is saved under the isolated checkout's ignored `.qa/` directory.
- Final authored farewells now recall only this couple's actual shared acts with completed own-listener delivery evidence. Outcome selection, earned confidence, reserved wording and medical handoffs remain unchanged; Blind uses seeded voice rather than preset biography.
- User expanded the scope to stronger GPU reductions and a non-framerate WASD latency fix. Two GPT-6.1 Terra agents at ultra now handle movement and low-tier assets/materials alongside the lighting owner; Fast mode is enabled in Codex configuration. Their changes remain under integration and remote verification.
- Low-tier shader lights are reduced from twelve to four, software canvas budget from 1,000,000 to 320,000 pixels, and low-tier PMREM/shadow/reflection/glow work and roughly 279,000 detailed plant triangles are avoided. Draw-only pacing preserves independent input updates; high-tier antialiasing and lighting remain.
- Walking now uses bounded visual prediction, immediate ordered direction/stop sends, and a queued focus-loss stop that does not depend on a later render frame. Authoritative positions and collisions remain server-owned. Focused integrated rendering, movement, caption and ending checks pass; actual remote performance is not yet claimed.
- Integrated canonical `main` through `2b1ee14894abb48d8196fd41297aa597c0929efb`, retaining Claude's newer seated dialogue and real-voice recovery. The combined path keeps bounded streaming/audio waits, consumes failed replies' terminal state, cancels incomplete playback, and never retries an Edge stream timeout. Guarded merge checks pass; the frozen conversation benchmark remains pinned to its documented original baseline.
- Remote run `42690435478` passed all 647 Node checks, deployment packaging/smoke, six recovery cases, four speech cases and Blind. Broader browser traces exposed an actual menu pause/resume/order race and a Double Send button that failed to refresh after processing ended; both are fixed with deterministic held-request regressions. Narrow software-browser startup budgets now cover measured 5.3–8.2 second stalls, and dessert bill fixtures verify the dessert actually selected when the accelerated offer expires. A complete revised CI pass is still required.
- Reviewed remote low-tier arrival, seated Jules, small desktop and shared Double dessert captures. Eyes, mouth, hands and captions remain readable. SwiftShader captures remain slow (for example 3.6 draw/update FPS at 320,000 pixels, 147 calls and 172,000 triangles seated); these shared-runner samples do not establish smooth low-end hardware performance. No game or renderer was launched locally.
- Low-tier selection now also recognizes named Intel HD/UHD and Radeon Vega 3/6/7/8/10/11 adapters, so a laptop with more than 4 GB system RAM can still receive cheaper lighting and materials. Explicit quality overrides win; unknown and discrete adapters retain the existing default. Ten policy tests pass without creating a WebGL context.
- The GPU-policy build passed all 648 Node checks and deployment packaging/smoke remotely. Corrected a keyboard-test off-by-one using the captured focus position, and reused the existing title readiness gate for history after Play again. The ten isolated browser groups can run concurrently on standard hosted runners; all remain mandatory for the final technical gate.
- Run `42694248963` passed 27 of 31 browser cases, including all four Solo evening cases, six recovery cases, four speech cases, Blind, shared Double turns and reconnect. Remaining fixtures now respect actual interruption priority, rejoin scene readiness and transient dessert serving windows. The final check wait is derived from the authored course durations and test story rate.
- A walking trace exposed a real frame-dependent stop: the last forward update at `20:38:26.018` was followed by a zero update at `20:38:26.450`. Keyboard events now dispatch through the ordered sender directly; pending direction/stop changes drain without another frame, and Escape, prompt chips, menus and pointer-unlock clear paths send stops too. Fourteen focused movement checks and independent source review pass; a browser regression holds animation frames and checks accepted keyboard start/stop requests. The interaction hint moved upward by three percentage points to clear the hands in reviewed seated views.
- Run `42698091063` passed all 652 Node checks and 30/31 browser cases, including accepted movement start/stop while frames are held, complete Double and Solo evenings, friend voice, wingman play and all recovery. Its remaining failure exposed a real focus race: a delayed menu refresh reset a control already selected through the keyboard. The controller now preserves valid focus after menu-entry work; a held-frame keyboard regression covers that transition. The final integrated run remains required.
- Run `42699808836` verified the complete restaurant suite and both input regressions, with 652 Node checks and 30/31 browser cases passing. The remaining Double fixture exhausted a two-second button-stability check while its dessert offer was still open. Its existing bounded retry now actually retries that observed enabled offer; it still requires a real authored decision, two spoons and the exact served items on the check. No gameplay timers or click actionability checks were bypassed.
- Run `42701211829` passed the dessert path and again reached 652 Node checks plus 30/31 browser cases. Reconnect stopped before restoration assertions because its generic 15-second full-page load wait expired: the document returned in 7 ms, but app assets began loading 16.37 seconds after navigation. That reload now gates on navigation commit, then the existing 30-second scene readiness, then the unchanged HUD, token, identity and seat checks. No success was inferred from the incomplete restore trace.
- Applied the same commit/scene-readiness gate to every explicit Solo/Blind/Double restore, after another reload hit the same generic-load limit. A separate Double trace measured four seconds between rendered frames: the visible, enabled return-order button never reached the pointer click's two-frame stability gate. Scripted Double prompt choices now use the exact numbered keyboard shortcut displayed by the game, preserving actual input handling and result assertions; roster, microphone, menu, check and other pointer paths remain covered. No force clicks, DOM dispatches or gameplay timer changes were added.
- Follow-up traces confirmed that even navigation commit can be reported after 15 seconds despite a prompt HTTP response, so only that helper's commit deadline is now 30 seconds, matching its existing scene-readiness allowance. All numbered scenario and evening-action helpers now share the same displayed-keyboard activation; their beat, decision, incident and resulting-state checks remain intact. These changes cover the measured timing classes rather than bypassing gameplay or globally loosening assertions.
- Run `42706477202` passed 652 Node checks and 30/31 browser cases; the complete Double evening reached both endings and failed only while awaiting its asynchronous Play again title. The new helper arms same-URL navigation before the actual click, then waits for scene readiness. Inspection also found an unbounded room-leave request: it now has the existing clamped request deadline, preserves departure credentials, and cannot clear a newer membership. Eleven focused client tests pass, including stalled transports and late old exits.
- The user explicitly approved one **$0, text-only AI Horde pilot**: Mira's eight-turn `mira-fry-treaty` script on frozen baseline and candidate, **sixteen generation requests total**, no voice and no paid fallback. This approval does not authorize a larger capture batch or manufacture human review scores. The matched pilot is pending capture; the full corpus and two-reviewer gates remain unverified.
- The initial approved attempts used **two requests, $0, and generated no valid replies**. Horde rejected its default 2,048-token context while estimating the candidate at 6,326 prompt tokens plus 512 output tokens. The bridge now uses `grow`, retaining every message instead of truncating. Forty-seven guarded candidate checks pass. Baseline bench `27a2f8c2cea7edd0cc81030aebcbf7b4ea04eb76` applies the identical field adjustment only at the capture boundary, with original adapter/shim hashes verified; all 45 guarded baseline checks pass and its frozen production source/extraction hash remain unchanged. The remaining approved allowance is fourteen requests; a fresh complete eight-plus-eight pair needs an explicit two-request extension, still at $0. No extension is assumed.

## Remaining release gates

- [ ] Remote provider-disabled CI passes the complete integrated suite, package checks and browser recovery flows.
- [ ] CI screenshot artifacts reviewed for actual framing, captions and performance handoff.
- [x] Compatible baseline benchmark is prepared and verified offline.
- [ ] A separate explicit live spending cap is authorized and matched baseline/candidate captures are completed; run neither implicitly.
- [ ] Two human reviewers complete the documented preference, relevance, cast-identification and memorable-beat gates.
- [ ] Publish only after the quality and deployment gates; preserve current live provider configuration and secrets.

No game/browser was launched on the user's computer during implementation, no live evaluation was run, and the live game has not been replaced by this candidate.

Update this checklist with concrete tests and unresolved gates; never mark qualitative review passed from mock output.
