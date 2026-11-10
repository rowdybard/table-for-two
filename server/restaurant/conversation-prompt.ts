import { getDate } from '../../src/restaurant/content';
import { CHARACTER_STORIES } from '../../src/restaurant/story';
import { createBlindDate } from '../../src/restaurant/blind-date';
import type { ClaudeModel, DinnerState } from '../../src/restaurant/types';
import { ACTIONS, EMOTIONS, SOCIAL_SIGNALS } from './providers';
import { DATE_DIALOGUE_INSTRUCTIONS, SPOKEN_REGISTER, VOICE_REMINDER, outputContract } from './dialogue-policy';
import { SKEPTICISM_INSTRUCTIONS } from './skepticism';
import { AGENDA_INSTRUCTIONS } from './agendas';
import { BOUNDARY_INSTRUCTIONS } from './boundaries';
import { roleplayInstructions } from './roleplay';

/** Shared by the live runtime and offline evaluations. No provider or scene is started. */
export function soloSystem(input: Pick<DinnerState, 'dateId' | 'blindDate'> & { model: ClaudeModel }): string {
  const date = getDate(input.dateId);
  if (!date) throw new Error('Unknown date in conversation prompt.');
  const blind = input.blindDate ? createBlindDate(input.blindDate.seed) : undefined;
  const { voiceHabits, dinnerArc: _arc, preferences: _preferences, preferredMain: _main, preferredDessert: _dessert, occupation: _job, ...life } = blind?.biography ?? CHARACTER_STORIES[date.id];
  const persona = `You are ${date.name}, an adult (${date.age}) fictional AI date in a first-person restaurant game. Pronouns: ${date.pronouns}. Have your own opinions and react the way you really would. Never speak for the human.\nPersonality: ${blind?.personality ?? date.personality}\nLikes and dislikes: ${blind?.preferences ?? date.preferences}\nBoundaries: ${(blind?.boundaries ?? date.boundaries).replace(/\.$/, '')}.\nYour life (draw on it only where the talk goes there and reveal it slowly; its disclosure rules apply): ${JSON.stringify(life)}${blind ? '\nThis is a blind date with a newly seeded personality. The reused appearance and name do not supply a preset biography. Follow only the life above; discover chemistry through the conversation.' : ''}`;
  return [persona, DATE_DIALOGUE_INSTRUCTIONS, BOUNDARY_INSTRUCTIONS, roleplayInstructions(input.model), outputContract({ emotions: EMOTIONS, actions: ACTIONS, signals: SOCIAL_SIGNALS }), SPOKEN_REGISTER, `YOUR VOICE: ${voiceHabits}`, VOICE_REMINDER].join('\n');
}
