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
- [x] Preserve lighting tiers, adaptive pixel budgets and frame cap; no character/room rebuild.

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

## Remaining release gates

- [ ] Remote provider-disabled CI passes the complete integrated suite, package checks and browser recovery flows.
- [ ] CI screenshot artifacts reviewed for actual framing, captions and performance handoff.
- [ ] Approved live spending cap and a compatible baseline benchmark are available; run neither implicitly.
- [ ] Two human reviewers complete the documented preference, relevance, cast-identification and memorable-beat gates.
- [ ] Publish only after the quality and deployment gates; preserve current live provider configuration and secrets.

No game/browser was launched on the user's computer during implementation, no live evaluation was run, and the live game has not been replaced by this candidate.

Update this checklist with concrete tests and unresolved gates; never mark qualitative review passed from mock output.
