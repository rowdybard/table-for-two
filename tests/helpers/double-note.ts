import type { ClaudeRequest } from '../../server/restaurant/providers';

/** The latest Double turn note: the paragraph at the end of the last message. */
export const doubleNote = (request: Pick<ClaudeRequest, 'messages'>) => request.messages.at(-1)!.content;

/** Who spoke, to whom, and what they said, read from the last paragraph of the Double turn note. */
export function humanTurnOf(request: Pick<ClaudeRequest, 'messages'>): { speaker: string; to: string; text: string } {
  const first = doubleNote(request).split('\n\n').at(-1)!.split('\n')[0], match = /^(.+?) said (to .+?): “(.*)”$/.exec(first);
  if (!match) throw new Error(`The note does not end with the friend's words: ${first}`);
  return { speaker: match[1], to: match[2], text: match[3] };
}

/** Everything the model was sent, flattened, for substring checks. */
export const everything = (request: Pick<ClaudeRequest, 'messages'> & { system: string }) => `${request.system}\n${request.messages.map(message => message.content).join('\n')}`;

/**
 * The structured facts the Double note states in prose, for tests that need a speaker id or an agenda
 * milestone: who spoke (as h1/h2), what they said, and which date was offered a milestone this turn.
 */
export function doubleContext(request: Pick<ClaudeRequest, 'messages'>) {
  const text = doubleNote(request), turn = humanTurnOf(request);
  const rows = [...text.matchAll(/^- (.+?) and (.+?) \((h[12]), (d[12])\): /gm)].map(match => ({ humanName: match[1], dateName: match[2], humanId: match[3] as 'h1' | 'h2', id: match[4] as 'd1' | 'd2' }));
  const speaker = rows.find(row => row.humanName === turn.speaker)?.humanId;
  if (!speaker) throw new Error(`Unknown speaker in the note: ${turn.speaker}`);
  return {
    humanTurn: { speaker, text: turn.text, to: turn.to },
    characters: rows.map(row => {
      const goal = new RegExp(`${row.dateName}’s private goal, never said aloud: ([^\\n]*)`).exec(text), milestone = goal && /You may now signal "(\w+)"/.exec(goal[1]);
      return { ...row, agenda: { evidenceReady: !!milestone, nextMilestone: (milestone ? milestone[1] : null) as 'noticed' | 'understood' | 'respected' | null } };
    }),
  };
}
