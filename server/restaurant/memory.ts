import { isTopicStopRequest } from '../../src/restaurant/conversation-content';

/**
 * The date's private notebook. The model rewrites it every turn from the notes it was shown, in
 * three labelled parts: HUMAN (what they told it), TOLD THEM (what it already shared about
 * itself) and OPEN (an unanswered question or promise). The server never rejects a turn for an
 * overlong notebook: the line was already streamed and spoken, so dropping the whole turn would
 * lose the reply's emotion, social and agenda updates for a bookkeeping field. It trims instead.
 */
/** What the model is told to stay under and the server retains. */
export const MEMORY_TARGET = 700;
/** What the server keeps; a longer notebook is trimmed to this, never refused. */
export const MEMORY_HARD = MEMORY_TARGET;
/** Only a runaway string is a protocol error. */
export const MEMORY_REJECT = 4000;
// These budgets include labels; two separating newlines bring the total to 700.
const SECTION_CAPS: Record<string, number> = { human: 400, 'told them': 158, open: 140 };

/** Remove only the optional premise. A stop must never erase a name, disclosure, question or promise. */
export function retireSharedPremise(memory: string, latestHumanText: string): string {
  if (!isTopicStopRequest(latestHumanText)) return memory;
  return memory.replace(/(\bOPEN:\s*)([\s\S]*?)(?=\b(?:HUMAN|TOLD THEM|OPEN):|$)/gi, (_match, label: string, body: string) => {
    const kept = body.split(/;\s*|\n/).filter(part => !/^shared premise\s*:/i.test(part.trim())).map(part => part.trim()).filter(Boolean);
    return label + (kept.join('; ') || 'nothing pending') + (/\n\s*$/.test(body) ? '\n' : '');
  });
}

/** Keep one optional premise behind the obligations in OPEN, even when the model lists it first. */
function prioritizeOpen(text: string): string {
  let retainedPremise = false;
  return text.replace(/(\bOPEN:\s*)([\s\S]*?)(?=\b(?:HUMAN|TOLD THEM|OPEN):|$)/gi, (_match, label: string, body: string) => {
    const clauses = body.split(/;\s*|\n/).map(part => part.trim()).filter(Boolean);
    const ordinary = clauses.filter(part => !/^shared premise\s*:/i.test(part));
    const promises = ordinary.filter(part => /\bpromis(?:e[ds]?|ing)\b/i.test(part));
    const other = ordinary.filter(part => !/\bpromis(?:e[ds]?|ing)\b/i.test(part));
    const premise = retainedPremise ? undefined : clauses.find(part => /^shared premise\s*:/i.test(part));
    retainedPremise ||= !!premise;
    // The marker makes the optional bit distinguishable without a fourth notebook section.
    return label + [...promises, ...other, ...(premise ? [cut(premise, 100)] : [])].join('; ') + (/\n\s*$/.test(body) ? '\n' : '');
  });
}

/** Cut at the last clause boundary inside the budget, else at a word boundary. */
const cut = (text: string, max: number) => {
  if (text.length <= max) return text;
  const head = text.slice(0, max), stop = Math.max(head.lastIndexOf('; '), head.lastIndexOf('. '), head.lastIndexOf(', '));
  return (stop > max * 0.6 ? head.slice(0, stop) : head.replace(/\s+\S*$/, '')).trim();
};

/** Duplicate labeled sections use the newest account, before applying stop and priority rules. */
function canonicalSections(text: string): string {
  const parts = text.split(/(?=\b(?:HUMAN|TOLD THEM|OPEN):)/).map(part => part.trim()).filter(Boolean);
  if (parts.length < 2 || !parts.every(part => /^(?:HUMAN|TOLD THEM|OPEN):/.test(part))) return text;
  const sections = new Map(parts.map(part => [part.slice(0, part.indexOf(':')).toLowerCase(), part]));
  return ['human', 'told them', 'open'].filter(label => sections.has(label)).map(label => sections.get(label)!).join('\n');
}

/**
 * Model notebook in, stored notebook out. A blank answer keeps the previous notebook, and an
 * overlong one is trimmed section by section so the human's own facts are the last thing lost.
 */
export function clampMemory(next: string, previous = '', latestHumanText = ''): string {
  const normalized = next.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean).join('\n');
  const text = prioritizeOpen(retireSharedPremise(canonicalSections(normalized || previous), latestHumanText));
  if (!text) return previous;
  if (text.length <= MEMORY_HARD) return text;
  const parts = text.split(/(?=\b(?:HUMAN|TOLD THEM|OPEN):)/).map(part => part.trim()).filter(Boolean);
  if (parts.length > 1 && parts.every(part => /^(?:HUMAN|TOLD THEM|OPEN):/.test(part))) {
    // Retain the newest occurrence of a duplicated section, then reserve room for
    // each label before joining; a final slice could otherwise remove OPEN.
    const sections = new Map(parts.map(part => [part.slice(0, part.indexOf(':')).toLowerCase(), part]));
    return ['human', 'told them', 'open'].filter(label => sections.has(label)).map(label => cut(sections.get(label)!, SECTION_CAPS[label])).join('\n');
  }
  return cut(text, MEMORY_HARD);
}
