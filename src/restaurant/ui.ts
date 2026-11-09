import { installUiTheme } from './theme';
import { DATES, MENU } from './content';

installUiTheme();

export const markup = `
<main id="restaurant-app">
  <div id="restaurant-scene" aria-label="First-person restaurant"></div>
  <div class="scene-vignette" aria-hidden="true"></div>
  <p id="scene-loading" class="scene-loading" role="status" hidden>Loading restaurant…</p>
  <section id="arrival-screen" data-screen="title" data-game-menu aria-labelledby="arrival-title">
    <div class="title-state">
      <h1 id="arrival-title" aria-label="Table for Two"><span>Table</span><i>for</i><span>Two</span></h1>
      <div class="title-commands" data-game-nav><button id="title-start" class="start-command" data-game-item>Play</button><button id="settings-open" data-game-item>Settings</button><button id="past-evenings" data-game-item hidden>Memories</button></div>
      <p class="title-key-hint"><kbd>Enter</kbd> Select <span><kbd>↑ ↓</kbd> Choose</span></p>
    </div>
    <div id="mode-menu" class="mode-state" data-game-nav>
      <h2>Choose your night</h2>
      <div class="mode-commands"><button id="mode-solo" data-game-item>Solo date</button><button id="mode-double" data-game-item>Double date</button><button id="mode-blind" data-game-item>Blind date</button><button id="mode-back" data-game-item>Back</button></div>
    </div>
    <div class="roster-state date-selection">
      <h2>Choose your date</h2>
      <div class="date-cards" data-game-nav>${DATES.map((date, index) => `<button class="date-card ${index === 0 ? 'selected' : ''}" data-game-item data-date="${date.id}" aria-pressed="${index === 0}"><span class="date-card-name">${date.name}</span><small class="date-age">${date.age} · ${date.pronouns}</small><span class="date-description">${date.description}</span></button>`).join('')}</div>
      <div class="roster-commands"><button id="start-date" data-game-item><kbd>Enter</kbd> Confirm</button><button id="select-back" data-game-item><kbd>Esc</kbd> Back</button></div>
    </div>
    <div class="selection-stage-label" aria-hidden="true"><strong>Mira</strong></div>
    <span id="evening-label" class="sr-only">Choose a date</span>
    <p id="start-error" class="error-text" role="alert" hidden></p>
  </section>
  <section id="dinner-hud" hidden>
    <div class="evening-status"><span class="live-dot"></span><span id="date-status">An evening with Mira</span><span class="status-divider">/</span><span id="dinner-stage">Arrival</span></div>
    <div id="prompt-line" class="prompt-line" hidden><p id="prompt-copy"></p><div id="prompt-chips" role="group" aria-label="Choices at the table"></div></div>
    <div id="crosshair" aria-hidden="true"></div>
    <button data-game-item id="interaction" class="interaction" hidden><kbd>E</kbd><span id="interaction-label">Take a seat</span></button>
    <div id="caption" class="caption" hidden aria-live="polite"><span id="caption-speaker"></span><p id="caption-text"></p></div>
    <div class="bottom-tray">
      <button data-game-item id="mic-toggle" class="tray-button" aria-pressed="false" aria-label="Toggle microphone" title="Toggle microphone (M)"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4m-4 0h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path class="mic-slash" d="M4 20 20 4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg><span id="mic-label" class="sr-only">Mic off</span></button>
      <button data-game-item id="friend-audio-unlock" hidden>Enable friend audio</button>
      <button data-game-item id="type-toggle" class="tray-button" aria-expanded="false" aria-controls="conversation-form"><kbd>T</kbd> Talk</button>
      <button data-game-item id="journal-toggle" class="tray-button" aria-label="Open conversation" aria-expanded="false"><kbd>J</kbd> Journal</button>
      <button data-game-item id="pause-open" class="tray-button" aria-label="Pause dinner"><kbd>Esc</kbd> Pause</button>
    </div>
    <form id="conversation-form" hidden><label class="sr-only" for="conversation-target">Address your message to</label><select id="conversation-target" hidden><option value="table">Everyone</option></select><label class="sr-only" for="conversation-input">Say something at the table</label><input id="conversation-input" autocomplete="off" maxlength="2000" placeholder="Say something…"/><button data-game-item id="send-turn" aria-label="Send message"><kbd>Enter</kbd> Send</button></form>
    <div class="controls-line"><span id="speech-status"></span><span id="turn-status" role="status"></span></div>
    <button data-game-item id="capture-pointer" class="capture-pointer">Click to look <span><kbd>WASD</kbd> Move · <kbd>E</kbd> Interact</span></button>
    <aside id="journal" class="journal" data-game-menu hidden aria-label="Conversation"><div class="panel-title"><h2>Journal</h2><button data-game-item id="journal-close" aria-label="Close conversation">×</button></div><div class="journal-tabs"><button data-game-item id="journal-chat" class="selected">Conversation</button><button data-game-item id="journal-moments">Little moments</button></div><div id="conversation-log" role="log"></div><div id="moments-log" hidden><section id="agenda-clues" class="agenda-clues" hidden aria-labelledby="agenda-clues-heading"><h3 id="agenda-clues-heading"></h3><div id="agenda-clues-lines"></div></section><div id="moments-list"></div></div></aside>
  </section>
  <div id="menu-dialog" class="modal-backdrop" data-game-menu hidden><section class="paper-dialog" role="dialog" aria-modal="true" aria-labelledby="menu-title"><div class="menu-masthead"><span>Table for Two</span></div><h2 id="menu-title">Dinner menu</h2><div class="menu-options">${MENU.map(dish => `<button data-game-item data-order="${dish}"><strong>${dish}</strong></button>`).join('')}</div><button data-game-item id="menu-close" class="text-button">Put menu down</button></section></div>
  <div id="bill-dialog" class="modal-backdrop" data-game-menu hidden><section class="paper-dialog bill-dialog" role="dialog" aria-modal="true" aria-labelledby="bill-title"><h2 id="bill-title">Guest check</h2><div class="restaurant-receipt"><strong>TABLE <i>for</i> TWO</strong><p id="bill-items"></p></div><button data-game-item data-settlement="split" class="secondary-button">Split it evenly</button><button data-game-item data-settlement="treat" class="secondary-button">Offer to treat</button><button data-game-item data-settlement="separate" class="secondary-button">Pay for what we each ordered</button><button data-game-item id="bill-close" class="text-button">Back to the table</button></section></div>
  <div id="history-dialog" class="modal-backdrop" data-game-menu hidden><section class="paper-dialog history-dialog" role="dialog" aria-modal="true" aria-labelledby="history-title"><h2 id="history-title">Past evenings</h2><div id="past-evenings-list"></div><button data-game-item id="history-close" class="secondary-button">Back</button></section></div>
  <div id="pause-dialog" class="modal-backdrop" data-game-menu hidden><section class="paper-dialog" role="dialog" aria-modal="true" aria-labelledby="pause-title"><h2 id="pause-title">Paused</h2><div class="command-list" data-game-nav><button data-game-item id="resume-date">Resume</button><button data-game-item id="pause-talk">Talk</button><button data-game-item id="pause-journal">Journal</button><button data-game-item id="pause-settings">Settings</button><button data-game-item id="finish-date">End date</button></div><p class="key-hint"><kbd>WASD</kbd> Move <kbd>E</kbd> Interact<br><kbd>T</kbd> Talk <kbd>J</kbd> Journal <kbd>1–4</kbd> Choose <kbd>M</kbd> Mic</p></section></div>
  <div id="settings-dialog" class="modal-backdrop" data-game-menu hidden><section class="paper-dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div class="panel-title"><button data-game-item id="settings-close" aria-label="Close settings">×</button></div><h2 id="settings-title">Settings</h2><label class="setting-row"><span>Spoken dialogue</span><input type="checkbox" id="speech-enabled" checked/></label><label class="setting-row"><span>Captions</span><input type="checkbox" id="captions-enabled" checked/></label><label class="setting-row"><span>Voice volume</span><input type="range" min="0" max="1" step=".05" value=".8" id="voice-volume"/></label><details id="developer-settings"><summary>Developer settings</summary><label class="field-label" for="session-limit">Maximum spend per dinner (USD)</label><input id="session-limit" type="number" min=".05" max="20" step=".05" value="2"/><button data-game-item id="settings-save" class="secondary-button">Save dinner limit</button><p id="settings-saved" role="status"></p><div id="provider-status" class="provider-status"></div><dl class="usage-grid"><dt>AI requests</dt><dd id="usage-requests">0</dd><dt>Input / output tokens</dt><dd id="usage-tokens">0 / 0</dd><dt>Cached input tokens</dt><dd id="usage-cache-tokens">0</dd><dt>Fresh speech characters</dt><dd id="usage-characters">0</dd><dt>Reused audio clips</dt><dd id="usage-hits">0</dd><dt>AI / speech</dt><dd id="usage-components">$0.000 / $0.000</dd><dt>Estimated total</dt><dd id="usage-total">$0.000</dd><dt>First audio / response</dt><dd id="usage-latency">—</dd></dl><p class="fine-print">Prices are estimates from provider usage. Spending limits apply to a new dinner. Keys stay on the server.</p></details></section></div>
  <div id="ending-screen" class="modal-backdrop" data-game-menu hidden><section class="paper-dialog ending-dialog" role="dialog" aria-modal="true" aria-labelledby="ending-title"><span class="eyebrow">Date complete</span><h2 id="ending-title">Date complete.</h2><p id="ending-copy">Thanks for taking a chance.</p><blockquote id="ending-date-line"></blockquote><section id="ending-agenda" class="agenda-reflection" hidden aria-labelledby="ending-agenda-heading"><h3 id="ending-agenda-heading"></h3><p id="ending-agenda-goal"></p><p id="ending-agenda-score" class="agenda-understanding"></p><p id="ending-agenda-reflection"></p></section><details class="ending-memories"><summary>Memories from tonight</summary><div id="ending-moments"></div><div id="ending-agenda-evidence" class="agenda-evidence" hidden></div></details><div class="ending-commands"><button data-game-item id="save-postcard">Save photocard</button><p id="ending-cost" class="fine-print"></p><button data-game-item id="back-to-table" hidden>Back to the table</button><button data-game-item id="new-date">Play again</button></div></section></div>
  <div id="toast" class="restaurant-toast" hidden role="status"></div>
</main>`;

