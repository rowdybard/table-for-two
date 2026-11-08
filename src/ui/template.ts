export const gameMarkup = `
<main id="venue" aria-label="Inside the bowling lounge"></main>
<div class="film-vignette" aria-hidden="true"></div>
<header class="game-header">
  <div class="brand"><span class="brand-pin" aria-hidden="true"><svg viewBox="0 0 20 30"><path fill="currentColor" d="M10 1C5 1 5 7 7 10L7 14C7 18 3 21 3 26Q3 29 6 29H14Q17 29 17 26C17 21 13 18 13 14V10C15 7 15 1 10 1Z"/><path stroke="#a45143" stroke-width="2" d="M7 10H13M7 13H13"/></svg></span><div>Love at<br><b>First Strike</b></div></div>
  <div class="story-clock"><span>NEW YEAR’S EVE</span><button id="clock" type="button" aria-controls="midnight-choice" disabled>8:00 <small>PM</small></button><span id="midnight-hint" hidden>Your midnight choice · open</span><span id="night-status">New Year’s Eve</span></div>
  <div id="session-actions" hidden><button id="invite" class="quiet-button">Invite your date</button><button id="pause" class="quiet-button">Menu <kbd>ESC</kbd></button></div>
</header>
<section id="arrival" class="arrival-screen"><div class="arrival-copy">
  <span class="eyebrow">DECEMBER 31 · OPEN UNTIL LATE</span><h1>Meet me<br>at the alley.</h1><p class="arrival-intro">A co-op date. A very unpredictable night.</p>
  <form id="join-form"><label for="name">Your name</label><input id="name" maxlength="24" autocomplete="off" placeholder="First name" required value="Alex"><label for="room">Room code <span>optional</span></label><input id="room" maxlength="6" autocomplete="off" placeholder="Leave blank to start a room" pattern="[A-Za-z0-9]{6}"><button id="join" type="submit" class="primary-button">Enter the alley <span aria-hidden="true">→</span></button></form>
  <small class="build-note">Two players · Private room · Desktop playtest</small>
</div></section>
<div id="connection" class="connection" role="status" aria-live="polite">Opening the doors…</div>
<div id="welcome" class="dialogue" hidden><span class="eyebrow">MIRA · CHARACTER FRIEND</span><p>Welcome in. Pick a lane, play pool, or try the prize machine together.</p><button id="dismiss-welcome" aria-label="Dismiss greeting">×</button></div>
<div id="controls" class="controls" hidden><span><kbd>W A S D</kbd> Walk</span><span><kbd>E</kbd> Interact</span><span><kbd>V</kbd> Close view</span><span><kbd>SCROLL</kbd> Zoom</span><span id="room-code"></span></div>
<button id="interact" class="interaction-prompt" hidden><kbd>E</kbd><span id="interaction-label">Play</span></button>
<div id="station-note" class="station-note" hidden></div>
<div id="social" class="social" hidden><button id="chat-toggle" class="quiet-button" aria-expanded="false">Talk <kbd>ENTER</kbd></button><button id="voice-toggle" class="quiet-button" aria-expanded="false" aria-controls="voice-panel">Voice off</button><button id="sound-toggle" class="quiet-button" aria-pressed="false" aria-label="Enable game sounds">Sound off</button><button id="leave" class="quiet-button">Leave</button></div>
<section id="chat" class="chat-panel" aria-label="Conversation" hidden><div class="panel-heading">Just the two of you<button id="chat-close" class="close-button" aria-label="Close conversation">×</button></div><div id="chat-log" role="log" aria-live="polite"></div><form id="chat-form"><input id="chat-input" maxlength="300" aria-label="Message your date" placeholder="Say something…" autocomplete="off"><button class="primary-button" type="submit">Send</button></form><div class="chat-reactions" aria-label="Reactions"><button class="quiet-button reaction" data-reaction="heart" aria-label="Send a heart">♡</button><button class="quiet-button reaction" data-reaction="laugh">Ha!</button><button class="quiet-button reaction" data-reaction="nice">Nice!</button></div></section>
<section id="voice-panel" class="voice-panel" aria-label="Voice chat" hidden>
  <div class="panel-heading"><div><span class="eyebrow">VOICE CHAT</span><h2>Talk together</h2></div><button id="voice-close" class="close-button" aria-label="Close voice panel">×</button></div>
  <p id="voice-status" class="voice-status" role="status">Voice is off.</p>
  <p class="voice-note">Both players must enable voice. Pausing the game mutes voice; leaving voice stops your microphone.</p>
  <div class="voice-actions"><button id="voice-enable" class="primary-button">Enable voice</button><button id="voice-mute" class="quiet-button" hidden>Mute mic</button><button id="voice-disable" class="quiet-button" hidden>Leave voice</button><button id="voice-play" class="quiet-button" hidden>Play voice</button></div>
  <label class="voice-volume" for="voice-volume">Your date’s volume<input id="voice-volume" type="range" min="0" max="1" step=".05" value=".8"></label>
</section>
<audio id="voice-output" autoplay hidden></audio>
<section id="bowling" class="activity-panel" aria-label="Bowling controls" hidden>
  <div class="panel-heading"><div><span class="eyebrow">THE LANES</span><h2 id="lane-title">Line up your shot.</h2></div><button id="bowling-exit" class="close-button" aria-label="Leave bowling">×</button></div>
  <p id="lane-role" class="lane-role"></p><p id="lane-status" class="lane-status" role="status"></p>
  <div class="score-line"><span>Pins down</span><strong id="pins">0 / 10</strong></div>
  <div id="lane-score" class="lane-score" hidden></div>
  <div id="lane-roller-controls"><label for="aim">Aim <output id="aim-value">Straight</output></label><input id="aim" type="range" min="-1" max="1" step=".025" value="0">
  <div class="shot-settings"><label for="power">Power<input id="power" type="range" min=".15" max="1" step=".05" value=".7"></label><label for="spin">Spin<input id="spin" type="range" min="-1" max="1" step=".05" value="0"></label></div><button id="bowl" class="primary-button">Roll <kbd>SPACE</kbd></button></div>
  <div id="lane-flippers" hidden><div class="flipper-controls"><button id="flipper-left" class="direction-button" aria-label="Hold left flipper" aria-pressed="false">Left <kbd>A</kbd></button><button id="flipper-right" class="direction-button" aria-label="Hold right flipper" aria-pressed="false">Right <kbd>D</kbd></button></div><p class="activity-note">Hold to open. Release to swing back.</p></div>
  <div class="lane-actions"><button id="reset-lane" class="quiet-button">Fresh pins</button><button id="lane-mode-classic" class="quiet-button" hidden>Back to bowling</button><button id="lane-mode-arcade" class="quiet-button" hidden>Try the flippers</button></div>
</section>
<section id="pool" class="activity-panel" aria-label="Pool controls" hidden>
  <div class="panel-heading"><div><span class="eyebrow">THE POOL TABLE</span><h2>Clear the table.</h2></div><button id="pool-exit" class="close-button" aria-label="Leave pool">×</button></div>
  <p id="pool-status" class="pool-status" role="status">Take a cue and wait for your date.</p>
  <div class="score-line"><span>Balls pocketed</span><strong id="pool-progress">0 / 6</strong></div>
  <button id="pool-join" class="primary-button">Take a cue</button>
  <div id="pool-controls" hidden>
    <label for="pool-aim">Aim</label><input id="pool-aim" type="range" min="-180" max="180" step=".1" value="0">
    <label for="pool-power">Power</label><input id="pool-power" type="range" min=".1" max="1" step=".05" value=".55">
    <div class="pool-actions"><button id="pool-shoot" class="primary-button">Take shot <kbd>SPACE</kbd></button><button id="pool-pass" class="quiet-button">Pass cue</button></div>
  </div>
  <button id="pool-rerack" class="quiet-button" hidden>New rack</button>
  <p id="pool-hint" class="activity-note">Drag back from the white ball to aim and release, or use the controls. Take turns to pocket all six balls.</p>
</section>
<section id="claw" class="activity-panel" aria-label="Cooperative prize machine" hidden>
  <div class="panel-heading"><div><span class="eyebrow">PRIZE MACHINE</span><h2>One claw. Two controls.</h2></div><button id="claw-exit" class="close-button" aria-label="Leave prize machine">×</button></div><p id="claw-status"></p><button id="claw-join" class="primary-button">Take a control</button><div id="claw-controls" hidden><p id="claw-role" class="role-label"></p><div class="claw-directions"><button id="claw-left" class="direction-button" aria-label="Move claw negative direction">←</button><button id="claw-right" class="direction-button" aria-label="Move claw positive direction">→</button></div><button id="claw-ready" class="primary-button">Ready to drop</button><button id="claw-swap" class="quiet-button">Swap controls</button><p id="claw-hint" class="activity-note">Hold a direction. You both steer, then both choose when to drop.</p></div>
</section>
<section id="midnight-choice" class="midnight-choice" aria-label="Your private midnight choice" hidden><span class="eyebrow">MIDNIGHT IS ALMOST HERE</span><h2>A kiss at midnight?</h2><p>Only if you both want your characters to kiss. Your answer is private; a kiss shows that you both said yes.</p><div class="choice-actions"><button id="kiss-yes" class="primary-button">I’d like that</button><button id="kiss-no" class="quiet-button">Just celebrate</button></div><p id="choice-status" class="activity-note">You can change your choice until the celebration begins.</p><button id="midnight-dismiss" class="quiet-button">Keep playing</button><p class="activity-note">Select the clock to reopen your choice.</p></section>
<div id="celebration" class="celebration" hidden><span class="eyebrow">MIDNIGHT</span><h2>Happy New Year.</h2><p id="celebration-text">The night is yours.</p><button id="stay" class="quiet-button">Stay a little longer</button></div>
<div id="pause-screen" class="pause-screen" hidden><section class="pause-card"><span class="eyebrow">THE NIGHT CAN WAIT</span><h2 id="pause-title">A little intermission.</h2><p id="pause-description"></p><button id="resume" class="primary-button">I’m ready</button><button id="pause-leave" class="quiet-button">Leave the date</button></section></div>
<div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
`;
