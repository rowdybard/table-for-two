import type { DinnerState, SceneUtterance } from '../../src/restaurant/types';

type DeferredCue = { key: string; utterances: SceneUtterance[] };
const deferredDateCues = new WeakMap<DinnerState, DeferredCue[]>();
function writeCue(view: DinnerState, key: string, utterances: SceneUtterance[]) {
  if (!utterances.length) return;
  const reaction = utterances.find(line => line.speaker === 'date');
  if (view.phase !== 'ended' && view.evening.stance !== 'leaving') view.emotion = reaction?.emotion ?? (key.includes('allergic-reaction') ? 'surprised' : view.emotion);
  view.evening.cues.push({ id: `scenario-${key}`, key: `scenario-${key}`, utterances });
  view.evening.cues = view.evening.cues.slice(-70);
}
export function appendScenarioCue(view: DinnerState, key: string, utterances: SceneUtterance[]) {
  const away = ['privacy-break', 'cleanup-break'].includes(view.evening.scenarioCare?.presence ?? 'at-table');
  if (!away) { writeCue(view, key, utterances); return; }
  const date = utterances.filter(line => line.speaker === 'date');
  if (date.length) {
    const queue = deferredDateCues.get(view) ?? [];
    if (!queue.some(cue => cue.key === key)) queue.push({ key, utterances: date.map(line => ({ ...line })) });
    deferredDateCues.set(view, queue);
  }
  const staff = utterances.filter(line => line.speaker !== 'date');
  writeCue(view, date.length && staff.length ? `${key}-staff` : key, staff);
}
export function flushScenarioDateCues(view: DinnerState) {
  if (view.phase === 'ended' || view.evening.stance === 'leaving') { deferredDateCues.delete(view); return; }
  if (view.phase !== 'playing' || view.evening.scenarioCare?.presence !== 'at-table') return;
  const queue = deferredDateCues.get(view); if (!queue) return;
  deferredDateCues.delete(view);
  for (const cue of queue) writeCue(view, cue.key, cue.utterances);
}
