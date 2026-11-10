// Providers that only offer JSON mode (direct Dolphin, Dolphin Venice) are not held to the schema by their API, so they
// occasionally misspell one bookkeeping key ("refusion") or use a signal outside the list ("warmth"). The spoken line in
// such a reply is fine, and rejecting the whole turn costs the player their reply. This settles ONLY the private
// bookkeeping (`social`, `agenda`) before the normal validator runs: a small slip is corrected, and anything that still
// does not validate becomes the neutral "nothing happened" value. Spoken lines, emotions, actions and memory are never
// touched here and are still validated strictly. Schema-enforced providers (Anthropic) skip this entirely. No model call.
import { DOLPHIN_LLM_MODEL, DOLPHIN_MODEL } from '../../src/restaurant/types';
import { validAgendaAssessment } from './agendas';
import { validBoundaryAssessment } from './boundaries';
import { SOCIAL_SIGNALS } from './providers';

const SCHEMA_FREE_MODELS: readonly string[] = [DOLPHIN_LLM_MODEL, DOLPHIN_MODEL];
const BOUNDARY_KEYS = ['kind', 'topic', 'refusal', 'evidence'], SOCIAL_KEYS = ['signal', 'reason', 'wantsToLeave', 'boundary'];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const neutralBoundary = () => ({ kind: 'none', topic: 'other', refusal: '', evidence: '' });
const neutralSocial = () => ({ signal: 'none', reason: 'No change in boundaries.', wantsToLeave: false, boundary: neutralBoundary() });
const neutralAgenda = () => ({ signal: 'none', evidence: '', clue: '' });

/** One misspelled key standing in for the one missing key is renamed; anything else is left for the validator. */
function renameSingleTypo(item: Record<string, unknown>, expected: readonly string[]) {
  const unknown = Object.keys(item).filter(key => !expected.includes(key)), missing = expected.filter(key => !(key in item));
  if (unknown.length === 1 && missing.length === 1) { item[missing[0]] = item[unknown[0]]; delete item[unknown[0]]; }
}
const validSocial = (social: unknown) => record(social) && Object.keys(social).every(key => SOCIAL_KEYS.includes(key)) && (SOCIAL_SIGNALS as readonly string[]).includes(social.signal as string)
  && typeof social.reason === 'string' && social.reason.length <= 180 && typeof social.wantsToLeave === 'boolean' && (social.boundary === undefined || validBoundaryAssessment(social.boundary));

function settle(holder: Record<string, unknown>, repairs: string[]) {
  if (holder.social !== undefined && !validSocial(holder.social)) {
    const social = holder.social;
    if (record(social)) {
      renameSingleTypo(social, SOCIAL_KEYS);
      if (record(social.boundary)) renameSingleTypo(social.boundary, BOUNDARY_KEYS);
      if (typeof social.signal === 'string' && !(SOCIAL_SIGNALS as readonly string[]).includes(social.signal)) social.signal = 'none';
      if (typeof social.reason === 'string' && social.reason.length > 180) social.reason = social.reason.slice(0, 180);
    }
    if (validSocial(social)) repairs.push('social_corrected'); else { holder.social = neutralSocial(); repairs.push('social_neutralised'); }
  }
  if (holder.agenda !== undefined && !validAgendaAssessment(holder.agenda)) {
    if (record(holder.agenda)) renameSingleTypo(holder.agenda, ['signal', 'evidence', 'clue']);
    if (validAgendaAssessment(holder.agenda)) repairs.push('agenda_corrected'); else { holder.agenda = neutralAgenda(); repairs.push('agenda_neutralised'); }
  }
}

/**
 * Settles the bookkeeping of a parsed Solo turn or Double table turn in place, for schema-free providers only.
 * Returns what it changed (empty for every other model and for a reply that was already valid).
 */
export function settleLooseAssessments(value: unknown, model: string): string[] {
  const repairs: string[] = [];
  if (!SCHEMA_FREE_MODELS.includes(model) || !record(value)) return repairs;
  if (Array.isArray(value.dateUpdates)) { for (const update of value.dateUpdates) if (record(update)) settle(update, repairs); }
  else settle(value, repairs);
  return repairs;
}
