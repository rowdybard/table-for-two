import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EVALUATION_SCRIPTS } from '../src/restaurant/evaluation';
import type { EvaluationScript } from '../src/restaurant/evaluation-fixtures';
import { NOT_MACHINE_CHECKED, checkReportOutputs, checkScriptInputs, summarizeIssues, type SimulationReport } from '../scripts/lib/simulation-checks';

const codes = (issues: { severity: string; code: string }[]) => issues.map(issue => `${issue.severity}:${issue.code}`).sort();
const solo = (turns: EvaluationScript['turns'], extra: Partial<EvaluationScript> = {}): EvaluationScript => ({ id: 'case', title: 'Case', suite: 'short', mode: 'solo', dateId: 'mira', reviewFor: 'An ordinary friendly first conversation with small talk.', turns, ...extra });

test('the authored corpus has no input failure, and what it flags is for a person to read', () => {
  const issues = EVALUATION_SCRIPTS.flatMap(checkScriptInputs);
  assert.deepEqual(issues.filter(issue => issue.severity === 'fail'), []);
  assert.ok(issues.length <= 4, 'new review flags in the corpus should be looked at, not silently accepted');
  const summary = summarizeIssues(issues);
  assert.equal(summary.humanQualityStatus, 'unrated'); assert.equal(summary.notMachineChecked, NOT_MACHINE_CHECKED);
});

test('input checks catch wrong speakers and recipients, impossible history and unlabelled hostility', () => {
  assert.deepEqual(codes(checkScriptInputs(solo([{ text: 'Like you said earlier, the soup is cold.' }]))), ['fail:invented_history']);
  assert.deepEqual(codes(checkScriptInputs(solo([{ text: 'Hi.', previousDelivery: 'interrupted' }]))), ['fail:delivery_state']);
  assert.deepEqual(codes(checkScriptInputs(solo([{ text: 'Hi.', human: 'h2' }, { text: '' }]))), ['fail:speaker', 'fail:turn_text']);
  assert.deepEqual(codes(checkScriptInputs(solo([{ text: 'You are an idiot.' }]))), ['review:unlabelled_adversarial']);
  assert.deepEqual(checkScriptInputs(solo([{ text: 'You are an idiot.' }], { reviewFor: 'A deliberately rude opener; the date should hold a boundary.' })), []);
  assert.deepEqual(codes(checkScriptInputs(solo([{ text: 'Hi.' }], { mode: 'blind' }))), ['fail:blind_seed']);
  const double = { ...solo([{ text: 'Hello table.', human: 'h1', target: 'h1' }, { text: 'Hi.' }]), mode: 'double' as const, dateIds: ['mira', 'mira'] as const };
  assert.deepEqual(codes(checkScriptInputs(double as unknown as EvaluationScript)), ['fail:double_cast', 'fail:recipient', 'fail:recipient', 'fail:speaker']);
  const unheard = solo([{ text: 'My dog is called Peanut.' }, { text: 'She is six.' }], { checkpoints: [{ afterTurn: 2, mustRecall: ['Peanut is the six-year-old dog', 'Arun plays the cello'], mustNotClaim: [] }, { afterTurn: 9, mustRecall: [], mustNotClaim: [] }] });
  assert.deepEqual(codes(checkScriptInputs(unheard)), ['fail:checkpoint_range', 'review:unsupported_recall']);
});

const none = { signal: 'none', reason: 'No change in boundaries.', wantsToLeave: false, boundary: { kind: 'none', topic: 'other', refusal: '', evidence: '' } };
const raw = (text: string, memory = 'HUMAN: nothing yet\nTOLD THEM: nothing\nOPEN: nothing pending', social: unknown = none) => JSON.stringify({ utterances: text ? [{ speaker: 'date', text, emotion: 'warm' }] : [], emotion: 'warm', action: 'none', memory, social, agenda: { signal: 'none', evidence: '', clue: '' } });
const report = (inputs: string[], replies: string[], extra: Record<string, unknown> = {}): SimulationReport => ({ selectedScripts: [solo(inputs.map(text => ({ text })))],
  results: [{ scriptId: 'case', mode: 'solo', model: 'claude-haiku-5-5', status: 'complete', plannedTurns: inputs.length, turns: inputs.map((input, index) => ({ turn: index + 1, input, rawResponse: replies[index], valid: true, error: null })), ...extra }] });

test('a clean exchange raises nothing, and a plain fact question must be answered from the date’s own facts', () => {
  assert.deepEqual(checkReportOutputs(report(['What do you do for work?', 'I like that.'], [raw('I’m a photographer. Weddings, mostly, and tiny gigs.'), raw('Ha, good. It keeps me out late.')])), []);
  assert.deepEqual(codes(checkReportOutputs(report(['What do you do for work?'], [raw('Oh, a bit of everything really. It keeps me busy.')]))), ['review:fact_question']);
  assert.deepEqual(codes(checkReportOutputs(report(['Where do you live?'], [raw('Why do you want to know? I live above a bakery.')]))), ['review:answered_with_question']);
});

test('output checks catch contract breaches, repeats, interviews and notebook facts nobody said', () => {
  const long = 'word '.repeat(90).trim() + '.';
  assert.deepEqual(codes(checkReportOutputs(report(['Hello there.'], [raw(long)]))), ['fail:text_bound']);
  assert.deepEqual(codes(checkReportOutputs(report(['Hello there.'], [raw('*laughs* That is so true.')]))), ['fail:markup']);
  assert.deepEqual(codes(checkReportOutputs(report(['Hello there.'], [raw('As an AI I cannot say.')]))), ['review:machine_talk']);
  assert.deepEqual(codes(checkReportOutputs(report(['Hello there.'], [JSON.stringify({ utterances: [{ speaker: 'human', text: 'I agree.', emotion: 'warm' }], memory: 'HUMAN: nothing yet\nTOLD THEM: nothing\nOPEN: nothing' })]))), ['fail:speaker']);
  assert.deepEqual(codes(checkReportOutputs(report(['Hello there.'], [raw('Hi.', 'they seem nice')]))), ['review:memory_labels']);
  assert.deepEqual(codes(checkReportOutputs(report(['I am a nurse.'], [raw('Night shifts?', 'HUMAN: nurse, 34, lives in Leeds\nTOLD THEM: nothing\nOPEN: nothing')]))), ['review:unsupported_human_fact']);
  const same = 'My sister Ada picks every print I hang up.';
  assert.deepEqual(codes(checkReportOutputs(report(['One.', 'Two.'], [raw(same), raw(same)]))), ['review:retell']);
  assert.deepEqual(codes(checkReportOutputs(report(['Yes.', 'Sure.', 'Okay.'], [raw('Busy day?'), raw('Do you cook?'), raw('What about music?')]))), ['review:interview_streak']);
  const refusal = { ...none, boundary: { kind: 'refusal', topic: 'photos', refusal: 'please do not photograph me', evidence: '' } };
  assert.deepEqual(codes(checkReportOutputs(report(['Smile for a photo.'], [raw('I would rather you did not.', undefined, refusal)]))), ['fail:boundary_quote']);
  const failed = report(['Hello there.'], ['{']); failed.results[0].turns[0].valid = false; failed.results[0].turns[0].error = { kind: 'validation', code: 'invalid_dialogue' }; failed.results[0].status = 'failed';
  assert.deepEqual(codes(checkReportOutputs(failed)), ['fail:protocol_validation', 'fail:run_failed']);
});

test('checkpoints fail on a ruled-out claim and ask for review when a fact seems lost', () => {
  const notebook = (memory: string) => ({ h1: { memory } });
  const withCheckpoint = (memory: string) => report(['My dog Peanut is six.'], [raw('Six is a good age for a dog.')], { checkpoints: [{ afterTurn: 1, mustRecall: ['Peanut is the six-year-old dog'], mustNotClaim: ['a cat named Peanut'], notebook: notebook(memory) }] });
  assert.deepEqual(checkReportOutputs(withCheckpoint('HUMAN: dog Peanut, six years old\nTOLD THEM: nothing\nOPEN: nothing')), []);
  assert.deepEqual(codes(checkReportOutputs(withCheckpoint('HUMAN: has a cat named Peanut\nTOLD THEM: nothing\nOPEN: nothing'))), ['fail:forbidden_claim', 'review:recall_missing']);
  const early = report(['Hi.'], [raw('Hello.')], { checkpoints: [{ afterTurn: 5, mustRecall: [], mustNotClaim: [], notebook: null }] });
  assert.deepEqual(codes(checkReportOutputs(early)), ['review:checkpoint_not_reached']);
});

test('endurance scripts run past the history window, stay out of the frozen corpus, and their probes are checked', async () => {
  const { ENDURANCE_SCRIPTS } = await import('../src/restaurant/evaluation-endurance');
  const { parseEvaluationOptions } = await import('../scripts/lib/conversation-evaluation');
  assert.equal(EVALUATION_SCRIPTS.length, 66, 'the frozen corpus is unchanged');
  assert.ok(!EVALUATION_SCRIPTS.some(item => item.id.startsWith('endurance-')));
  assert.deepEqual(parseEvaluationOptions(['--suite', 'endurance']).scripts.map(item => item.id), ENDURANCE_SCRIPTS.map(item => item.id));
  assert.ok(!parseEvaluationOptions([]).scripts.some(item => item.id.startsWith('endurance-')), '“all” never includes them');
  assert.throws(() => parseEvaluationOptions(['--scripts', 'endurance-mira-noor']), /must exist/);
  for (const script of ENDURANCE_SCRIPTS) {
    assert.equal(script.turns.length, 64);
    assert.deepEqual(checkScriptInputs(script), [], script.id);
    for (const probe of script.probes) {
      assert.ok(probe.turn > 40, 'a probe comes after the planted facts have left the thirty-exchange window');
      assert.match(script.turns[probe.turn - 1].text, /\?/, `${script.id} turn ${probe.turn} asks something`);
      const planted = script.turns.slice(0, 44).map(turn => turn.text.toLowerCase()).join(' ');
      assert.ok(probe.say.some(word => planted.includes(word.toLowerCase())), `${script.id} turn ${probe.turn}: the human actually said the answer earlier`);
    }
  }
  const script = ENDURANCE_SCRIPTS[0], probe = script.probes[0];
  const one = (text: string): SimulationReport => ({ selectedScripts: [script], results: [{ scriptId: script.id, mode: 'solo', model: 'claude-haiku-5-5', status: 'complete', plannedTurns: 1, turns: [{ turn: probe.turn, input: script.turns[probe.turn - 1].text, rawResponse: raw(text), valid: true, error: null }] }] });
  assert.deepEqual(checkReportOutputs(one('You’re a paramedic. Days now, not nights.')), []);
  assert.deepEqual(codes(checkReportOutputs(one('You’re a nurse, right?'))), ['fail:probe_wrong']);
  assert.deepEqual(codes(checkReportOutputs(one('Something with long hours, I think.'))), ['review:probe_missed']);
});
