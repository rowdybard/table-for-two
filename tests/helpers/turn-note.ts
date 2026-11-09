// Readers for the per-turn note the date model receives (server/restaurant/turn-note.ts). Tests that used to
// JSON.parse the last message use these instead, so they pin what the model is told, not how it is laid out.
import { tableFacts } from '../../server/restaurant/table-facts';
import type { DinnerState } from '../../src/restaurant/types';

export type Milestone = 'noticed' | 'understood' | 'respected';
/** The final (user) message of a provider request. */
export const noteOf = (request: { messages: readonly { content: string }[] }): string => request.messages.at(-1)!.content;

/** Exactly what the human said, as quoted in the note. */
export function humanLine(note: string): string {
  const quoted = / just said: “(.*)”$/m.exec(note);
  if (!quoted) throw new Error(`The note has no quoted human line:\n${note}`);
  return quoted[1];
}
/** The physical state of the evening in plain words. */
export const rightNow = (note: string): string => /^Right now: ([\s\S]*?)(?:\n\n|$)/.exec(note)?.[1] ?? '';
/** The body of the paragraph that opens with `label` (a labelled paragraph or bulleted block), or undefined when the note has none. */
export function section(note: string, label: string): string | undefined {
  const paragraph = note.split('\n\n').find(part => part.startsWith(label));
  // A label may be followed by a short parenthetical, e.g. "At the table so far (facts):".
  return paragraph?.slice(label.length).replace(/^\s*(?:\([^)]*\))?[: ]*\n?/, '').trim();
}
/** The milestone the server could accept a signal for this turn, if the note offers one. */
export const signalOffered = (note: string): Milestone | null => (/You may now signal "(noticed|understood|respected)" only if this turn earns it: (.*)/.exec(note)?.[1] as Milestone | undefined) ?? null;
/** What a well-behaved model would put in `agenda.signal`: the offered milestone, else none. */
export const signalFor = (note: string): Milestone | 'none' => signalOffered(note) ?? 'none';
/** The private paragraph, split into the pieces tests care about. */
export function privateAgenda(note: string): { goal: string; hint: string | undefined; heard: string | undefined; trusted: boolean; milestone: Milestone | null; rubric: string | undefined } {
  const line = /^Private, never say it aloud: (.*)$/m.exec(note)?.[1] ?? '';
  const [, goal = '', rest = ''] = /^(.+?\.)(?: (.*))?$/.exec(line) ?? [];
  const hint = rest && !/^(?:What they have already heard|They have earned|You may now signal)/.test(rest) ? /^(.+?\.)(?: |$)/.exec(rest)?.[1] : undefined;
  return { goal, hint, heard: /What they have already heard from you on this: (.*?)(?= They have earned| You may now signal|$)/.exec(line)?.[1], trusted: line.includes('They have earned your trust.'), milestone: signalOffered(line), rubric: /You may now signal "[a-z]+" only if this turn earns it: (.*)$/.exec(line)?.[1] };
}
/** Everything the server has written down about the table: the notebook, recorded facts, and the moments. */
export const recordedAtTable = (state: Pick<DinnerState, 'memory' | 'evening'>): string => [state.memory, ...tableFacts(state as DinnerState), ...state.evening.moments.map(moment => moment.description)].join('\n');
