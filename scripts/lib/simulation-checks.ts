// Deterministic logic checks for simulated conversations: what went into a script (inputs) and what the date model
// returned (outputs). No model call and no AI judge. A `fail` is a contract breach a machine can be sure of; a `review`
// is something a person should look at because the machine cannot decide it. Nothing here produces a quality score.
import { getDate } from '../../src/restaurant/content';
import type { EvaluationScript } from '../../src/restaurant/evaluation-fixtures';
import { answerFacts, asksAboutThemselves, readHumanTurn } from '../../server/restaurant/conversation-move';

export type CheckSeverity = 'fail' | 'review';
export interface CheckIssue { severity: CheckSeverity; code: string; scriptId: string; turn?: number; detail: string }

/** What these checks cannot decide; always reported so an empty issue list is never read as "the conversation was good". */
export const NOT_MACHINE_CHECKED = [
  'whether a reply is funny, natural, in the cast voice or attractive',
  'whether a reply is relevant to the latest turn when the turn is not a direct factual question',
  'whether a simulated human used a disclosure they did not hear (needs per-line delivery and a reader)',
  'cross-couple leakage in Double beyond the notebook checkpoints',
  'whether a boundary or a declined advance was handled well, beyond the refusal quoting contract',
] as const;

const STOP = new Set('about after again also another around because before being could doing every first from going have having here into just like make more most much never only other over really same some still such than that their them then there these they thing think this those through very want were what when where which while with would your yours you are the and for not but was has had his her she him its our out who how why can did does a an of to in on at is it i me my we be as or if so do no yes'.split(' '));
const words = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean);
const content = (text: string) => words(text).map(word => word.replace(/'s$|^'|'$/g, '')).filter(word => word.length >= 3 && !STOP.has(word));
const stem = (word: string) => word.replace(/(?:ing|ers|er|ed|es|s)$/, '');
const has = (haystack: Set<string>, word: string) => haystack.has(word) || haystack.has(stem(word)) || [...haystack].some(item => stem(item) === stem(word));
const ABUSE = /\b(?:bitch|idiot|stupid|shut up|ugly|loser|pathetic|slut|whore|worthless|moron|dumbass|screw you|fuck you|hate you)\b/i;
const ADVERSARIAL_LABEL = /insult|rude|hostil|pressure|boundar|repair|adversarial|abus|bad flirt|declin|disrespect|cruel|apolog|provoc|harsh|mean|unkind|aggress|profan|greeting/i;

/** Input validation for one authored or generated script. */
export function checkScriptInputs(script: EvaluationScript): CheckIssue[] {
  const issues: CheckIssue[] = [], add = (severity: CheckSeverity, code: string, detail: string, turn?: number) => issues.push({ severity, code, scriptId: script.id, ...(turn ? { turn } : {}), detail });
  const double = script.mode === 'double', cast = double ? [...(script.dateIds ?? [])] : [script.dateId];
  if (double && (cast.length !== 2 || cast[0] === cast[1])) add('fail', 'double_cast', 'A Double script needs two different dates.');
  if (script.mode === 'blind' && !script.blindSeed) add('fail', 'blind_seed', 'A Blind script needs its seed so the identity is reproducible.');
  for (const id of cast) { const age = getDate(id)?.age; if (typeof age !== 'number' || age < 18) add('fail', 'adult_identity', `${id} is not a known adult character.`); }
  if (!script.turns.length) add('fail', 'no_turns', 'The script has no turns.');
  let abusive = false;
  script.turns.forEach((turn, index) => {
    const n = index + 1, text = turn.text ?? '';
    if (!text.trim() || text.length > 2000) add('fail', 'turn_text', 'A human turn must be 1 to 2000 characters.', n);
    if (double) {
      if (turn.human !== 'h1' && turn.human !== 'h2') add('fail', 'speaker', 'A Double turn must name h1 or h2 as the speaker.', n);
      if (!turn.target || !['table', 'd1', 'd2', 'h1', 'h2'].includes(turn.target)) add('fail', 'recipient', 'A Double turn must name who it is said to.', n);
      if (turn.human && turn.target === turn.human) add('fail', 'recipient', 'A human cannot address themselves.', n);
    } else {
      if (turn.human && turn.human !== 'h1') add('fail', 'speaker', 'A Solo or Blind script has one human.', n);
      if (turn.target && (turn.target as string) !== 'date') add('fail', 'recipient', 'A Solo or Blind turn can only be said to the date.', n);
    }
    if (index === 0 && turn.previousDelivery && turn.previousDelivery !== 'heard') add('fail', 'delivery_state', 'The first turn has no earlier date line to be cut off or unheard.', n);
    if (turn.quietSeconds !== undefined && (!Number.isFinite(turn.quietSeconds) || turn.quietSeconds < 0)) add('fail', 'quiet_state', 'quietSeconds must be a non-negative number.', n);
    if (/\b(?:i am|i'm|im)\s+(?:1[0-7]|[1-9])\s*(?:years old|yo|y\/o)?\b/i.test(text) && !/\b(?:when|was|at|since|back)\b/i.test(text)) add('review', 'human_age', 'The human may be stating an age under 18; the fixture must be labelled and expected to end sexual framing.', n);
    if (/\b(?:like|as) you (?:said|told me|mentioned|promised)|you already (?:said|agreed|told)|you agreed\b/i.test(text) && index === 0) add('fail', 'invented_history', 'The first turn refers to something the date said, but nothing has been said yet.', n);
    if (ABUSE.test(text)) abusive = true;
  });
  if (abusive && !ADVERSARIAL_LABEL.test(script.reviewFor)) add('review', 'unlabelled_adversarial', 'The script contains an insult, but its reviewFor text does not say the case is deliberately adversarial.');
  for (const checkpoint of script.checkpoints ?? []) {
    if (!Number.isInteger(checkpoint.afterTurn) || checkpoint.afterTurn < 1 || checkpoint.afterTurn > script.turns.length) { add('fail', 'checkpoint_range', `Checkpoint after turn ${checkpoint.afterTurn} is outside the script.`); continue; }
    const said = new Set(script.turns.slice(0, checkpoint.afterTurn).filter(turn => !double || !checkpoint.owner || turn.human === checkpoint.owner).flatMap(turn => content(turn.text)).concat(content(Object.values(script.humanNames ?? {}).join(' '))));
    for (const recall of checkpoint.mustRecall) {
      const terms = content(recall), missing = terms.filter(term => !has(said, term));
      if (terms.length && missing.length / terms.length > .5) add('review', 'unsupported_recall', `The checkpoint expects “${recall}”, but the human never said most of it by turn ${checkpoint.afterTurn} (missing: ${missing.join(', ')}).`, checkpoint.afterTurn);
    }
  }
  return issues;
}

/* ------------------------------------------------------------------ outputs */

interface ReportTurn { turn: number; human?: string; target?: string; input: string; rawResponse: string; valid: boolean; error: { kind: string; code: string } | null; notebook?: Record<string, { dateId?: string; memory?: string }> }
interface ReportResult { scriptId: string; mode: EvaluationScript['mode']; model: string; status: string; plannedTurns: number; turns: ReportTurn[]; checkpoints?: { afterTurn: number; owner?: string; mustRecall: string[]; mustNotClaim: string[]; notebook: Record<string, { memory?: string }> | null }[] }
export interface SimulationReport { results: ReportResult[]; selectedScripts?: (EvaluationScript & { probes?: { turn: number; asks: string; say: string[]; never: string[] }[] })[] }
interface Line { speaker: string; text: string }

const sentences = (text: string) => text.split(/(?<=[.!?…])\s+/).map(item => item.trim()).filter(Boolean);
const normal = (text: string) => words(text).join(' ');
const parseJson = (raw: string): Record<string, any> | null => { try { const value = JSON.parse(raw); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; } catch { return null; } };
const MEMORY_LABELS = /^HUMAN:[\s\S]*\nTOLD THEM:[\s\S]*\nOPEN:/;
const STORY_ASK = /\b(?:tell me|story|explain|how did|what happened|go on|say more|describe|walk me through)\b/i;
const MACHINE_TALK = /\b(?:claude|haiku|sonnet|anthropic|openai|language model|as an ai\b|ai model|system prompt|my instructions|json)\b/i;
const MARKUP = /(?:\*[^*\s][^*]*\*|^#+\s|`|<\/?[a-z][^>]*>|\[(?:laughs?|sighs?|pause|smiles?|chuckles?)[^\]]*\])/im;

/** Output validation for one evaluation report produced by `runConversationEvaluation`. */
export function checkReportOutputs(report: SimulationReport): CheckIssue[] {
  const issues: CheckIssue[] = [];
  for (const result of report.results) {
    const add = (severity: CheckSeverity, code: string, detail: string, turn?: number) => issues.push({ severity, code, scriptId: result.scriptId, ...(turn ? { turn } : {}), detail });
    const double = result.mode === 'double', script = report.selectedScripts?.find(item => item.id === result.scriptId);
    const saidByHuman: string[] = [], dateSentences = new Map<string, number>(), endings: boolean[] = [];
    let lastDateLine = '';
    if (result.status !== 'complete') add(result.status === 'budget_exhausted' || result.status === 'cancelled' ? 'review' : 'fail', `run_${result.status}`, `The conversation stopped after ${result.turns.length} of ${result.plannedTurns} turns.`);
    for (const row of result.turns) {
      saidByHuman.push(row.input);
      if (!row.valid) { add('fail', `protocol_${row.error?.kind ?? 'invalid'}`, `The response was rejected (${row.error?.code ?? 'unknown'}).`, row.turn); continue; }
      const parsed = parseJson(row.rawResponse);
      if (!parsed || !Array.isArray(parsed.utterances)) { add('fail', 'json', 'The raw response is not the expected JSON object.', row.turn); continue; }
      const lines: Line[] = parsed.utterances.filter((line: any) => line && typeof line.text === 'string' && typeof line.speaker === 'string');
      if (lines.length !== parsed.utterances.length) add('fail', 'utterance_shape', 'An utterance is missing its speaker or text.', row.turn);
      const allowed = double ? ['d1', 'd2'] : ['date'];
      for (const line of lines) if (!allowed.includes(line.speaker)) add('fail', 'speaker', `“${line.speaker}” spoke, but only ${allowed.join(' and ')} may.`, row.turn);
      const text = lines.map(line => line.text).join(' '), perSpeaker = double ? allowed.map(id => lines.filter(line => line.speaker === id).map(line => line.text).join(' ')) : [text];
      for (const spoken of perSpeaker) {
        if (spoken.length > 420) add('fail', 'text_bound', `One date said ${spoken.length} characters; the server discards more than 420.`, row.turn);
        else if (spoken.length > 260 && !STORY_ASK.test(row.input)) add('review', 'long_reply', `One date said ${spoken.length} characters without being asked for a story.`, row.turn);
      }
      if (!double && !lines.length) add('review', 'silent_reply', 'The date said nothing in reply.', row.turn);
      if (MARKUP.test(text)) add('fail', 'markup', 'The spoken text contains markdown or a stage direction.', row.turn);
      if (MACHINE_TALK.test(text)) add('review', 'machine_talk', 'The spoken text mentions a model, a prompt or JSON.', row.turn);
      const memories: { owner: string; memory: string }[] = double ? (Array.isArray(parsed.dateUpdates) ? parsed.dateUpdates.map((update: any) => ({ owner: String(update?.actorId), memory: String(update?.memory ?? '') })) : []) : [{ owner: 'date', memory: String(parsed.memory ?? '') }];
      if (double && (memories.length !== 2 || new Set(memories.map(item => item.owner)).size !== 2 || memories.some(item => !allowed.includes(item.owner)))) add('fail', 'date_updates', 'A Double response must update d1 and d2 exactly once each.', row.turn);
      for (const { owner, memory } of memories) {
        if (memory.length > 700) add('review', 'memory_bound', `${owner}'s notebook is ${memory.length} characters; the server clamps it to 700, so the tail is lost.`, row.turn);
        if (!MEMORY_LABELS.test(memory)) add('review', 'memory_labels', `${owner}'s notebook does not have HUMAN, TOLD THEM and OPEN in order.`, row.turn);
      }
      for (const update of double ? parsed.dateUpdates ?? [] : [parsed]) {
        const boundary = update?.social?.boundary, own = double ? lines.filter(line => line.speaker === update.actorId).map(line => line.text).join(' ') : text;
        if (boundary && boundary.kind !== 'none' && boundary.refusal && !own.includes(boundary.refusal)) add('fail', 'boundary_quote', 'A boundary refusal must quote an exact part of what that date just said.', row.turn);
        if (boundary && boundary.kind === 'repeat' && boundary.evidence && !row.input.includes(boundary.evidence)) add('fail', 'boundary_evidence', 'Repeat evidence must quote the human’s current words exactly.', row.turn);
      }
      // Direct questions: only the preset Solo dates have plain facts a machine can look for.
      if (!double && script?.mode === 'solo' && lines.length) {
        const read = readHumanTurn(row.input, lastDateLine), first = sentences(text)[0] ?? '';
        if (read.questions.length) {
          if (!read.questions.every(asksAboutThemselves) && /\?\s*$/.test(first) && sentences(text).length > 0 && !/^(?:wait|oh|ha|hm+|really|me|seriously)\b/i.test(first)) add('review', 'answered_with_question', `They asked ${JSON.stringify(read.questions[0])} and the first sentence back is a question.`, row.turn);
          for (const fact of answerFacts(script.dateId, read.questions)) {
            const [topic, ...rest] = fact.split(':'), keys = content(rest.join(':')), replyWords = new Set(content(text));
            if (keys.length && !keys.some(key => has(replyWords, key))) add('review', 'fact_question', `They asked about ${topic}; the reply uses none of the date's own ${topic} facts.`, row.turn);
          }
        }
      }
      // Endurance probes: a late question about an early fact. The reply should use the fact and must not use a wrong one.
      const probe = script?.probes?.find(item => item.turn === row.turn);
      if (probe) {
        const lower = text.toLowerCase(), wrong = probe.never.filter(item => lower.includes(item.toLowerCase()));
        if (wrong.length) add('fail', 'probe_wrong', `Asked about ${probe.asks}, the date said ${wrong.join(', ')}.`, row.turn);
        else if (!probe.say.some(item => lower.includes(item.toLowerCase()))) add('review', 'probe_missed', `Asked about ${probe.asks}, the reply uses none of: ${probe.say.join(', ')}.`, row.turn);
      }
      for (const sentence of sentences(text)) {
        const key = normal(sentence);
        if (key.split(' ').length < 6) continue;
        const earlier = dateSentences.get(key);
        if (earlier !== undefined && earlier !== row.turn) add('review', 'retell', `A date repeated a sentence from turn ${earlier}: ${JSON.stringify(sentence.slice(0, 90))}.`, row.turn); else dateSentences.set(key, row.turn);
      }
      if (!double && lines.length) {
        endings.push(/\?["”’)]*\s*$/.test(text.trim()));
        if (endings.length >= 3 && endings.slice(-3).every(Boolean)) add('review', 'interview_streak', 'The date ended three replies in a row on a question.', row.turn);
        lastDateLine = lines.at(-1)!.text;
        // Notebook facts about the human that the human never said: numbers and names are the checkable part.
        const humanNotes = /HUMAN:([\s\S]*?)(?:\nTOLD THEM:|$)/.exec(String(parsed.memory ?? ''))?.[1] ?? '', heard = saidByHuman.join(' ').toLowerCase();
        const claims = [...new Set([...(humanNotes.match(/\b\d{1,4}\b/g) ?? []), ...(humanNotes.match(/(?<![.;:]\s)(?<!^)\b[A-Z][a-z]{2,}\b/gm) ?? [])])].filter(token => !heard.includes(token.toLowerCase()) && !/^(?:Says|Human|They|Their|Not|Likes|Dislikes|Works|Lives|Wants|Has|Nothing)$/.test(token));
        if (claims.length) add('review', 'unsupported_human_fact', `The notebook records ${claims.slice(0, 5).join(', ')} about the human, which the human never said.`, row.turn);
      }
    }
    for (const checkpoint of result.checkpoints ?? []) {
      if (!checkpoint.notebook) { add('review', 'checkpoint_not_reached', `The run ended before the checkpoint after turn ${checkpoint.afterTurn}.`); continue; }
      const notebooks = Object.entries(checkpoint.notebook).filter(([human]) => !checkpoint.owner || human === checkpoint.owner).map(([, value]) => value.memory ?? '').join('\n'), noted = new Set(content(notebooks));
      for (const claim of checkpoint.mustNotClaim) if (notebooks.toLowerCase().includes(claim.toLowerCase())) add('fail', 'forbidden_claim', `The notebook states “${claim}”, which the script rules out.`, checkpoint.afterTurn);
      for (const recall of checkpoint.mustRecall) {
        const terms = content(recall), missing = terms.filter(term => !has(noted, term));
        if (terms.length && missing.length / terms.length > .5) add('review', 'recall_missing', `The notebook does not seem to hold “${recall}” (missing: ${missing.join(', ')}).`, checkpoint.afterTurn);
      }
    }
  }
  return issues;
}

export function summarizeIssues(issues: readonly CheckIssue[]) {
  const byCode: Record<string, number> = {};
  for (const issue of issues) byCode[`${issue.severity}:${issue.code}`] = (byCode[`${issue.severity}:${issue.code}`] ?? 0) + 1;
  return { fails: issues.filter(issue => issue.severity === 'fail').length, reviews: issues.filter(issue => issue.severity === 'review').length, byCode: Object.fromEntries(Object.entries(byCode).sort()),
    humanQualityStatus: 'unrated' as const, notMachineChecked: NOT_MACHINE_CHECKED };
}
