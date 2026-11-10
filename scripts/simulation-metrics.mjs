// Deterministic style counts for saved simulation reports: how often replies open on a filler word, echo the human's
// phrase back, end on a question, and how long replies and notebooks run. Counts only; it rates nothing and calls nothing.
// Usage: node scripts/simulation-metrics.mjs <report.json> [more.json ...]
import { readFileSync } from 'node:fs';

const FILLER = /^(?:ha+|oh+|okay|ok|honestly|mm+|fair(?: enough)?|right|well|yeah|look|wait|ooh|deal|noted|got it|sure)\b/i;
const words = text => text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
const sentences = text => text.split(/(?<=[.!?…])\s+/).filter(Boolean);
/** The reply's first sentence repeats three or more consecutive words of the human's turn. */
function echoes(human, reply) {
  const h = words(human), first = words(sentences(reply)[0] ?? '');
  for (let i = 0; i + 3 <= first.length; i++) { const gram = first.slice(i, i + 3).join(' '); for (let j = 0; j + 3 <= h.length; j++) if (h.slice(j, j + 3).join(' ') === gram) return true; }
  return false;
}
const totals = { replies: 0, filler: 0, honestly: 0, echo: 0, question: 0, sentences: 0, words: 0, memory: 0, memoryMax: 0, openers: {} };
for (const file of process.argv.slice(2)) {
  for (const result of JSON.parse(readFileSync(file, 'utf8')).results) for (const turn of result.turns) {
    let parsed; try { parsed = JSON.parse(turn.rawResponse); } catch { continue; }
    const lines = (parsed.utterances ?? []).filter(line => line && typeof line.text === 'string');
    if (!lines.length) continue;
    const reply = lines.map(line => line.text).join(' '), opener = FILLER.exec(reply.trim())?.[0].toLowerCase().replace(/^ha+$/, 'ha').replace(/^oh+$/, 'oh').replace(/^mm+$/, 'mm');
    totals.replies++; totals.sentences += sentences(reply).length; totals.words += words(reply).length;
    if (opener) { totals.filler++; totals.openers[opener] = (totals.openers[opener] ?? 0) + 1; }
    if (/\bhonestly\b/i.test(reply)) totals.honestly++;
    if (echoes(turn.input, reply)) totals.echo++;
    if (/\?["”’)]*\s*$/.test(reply.trim())) totals.question++;
    const memories = typeof parsed.memory === 'string' ? [parsed.memory] : (parsed.dateUpdates ?? []).map(update => update.memory ?? '');
    for (const memory of memories) { totals.memory += memory.length / memories.length; totals.memoryMax = Math.max(totals.memoryMax, memory.length); }
  }
}
const pct = n => `${Math.round(1000 * n / Math.max(1, totals.replies)) / 10}%`;
console.log(JSON.stringify({ replies: totals.replies, opensOnFiller: pct(totals.filler), saysHonestly: pct(totals.honestly), echoesHumanPhrase: pct(totals.echo), endsOnQuestion: pct(totals.question),
  sentencesPerReply: +(totals.sentences / Math.max(1, totals.replies)).toFixed(2), wordsPerReply: +(totals.words / Math.max(1, totals.replies)).toFixed(1),
  notebookChars: Math.round(totals.memory / Math.max(1, totals.replies)), notebookMax: totals.memoryMax, openers: Object.fromEntries(Object.entries(totals.openers).sort((a, b) => b[1] - a[1])) }, null, 1));
