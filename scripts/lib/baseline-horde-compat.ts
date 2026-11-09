import { hordeAdapter } from '../../server/restaurant/horde';

const bridgeEndpoint = 'https://oai.aihorde.net/v1/chat/completions';

/** Bench-only bridge compatibility; all prompts and native transport remain frozen. */
export function createBaselineHordeAdapter(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch) {
  if (env.AI_HORDE_TRANSPORT === 'native') return hordeAdapter(env, fetcher);
  const bridgeFetch: typeof fetch = (input, init) => {
    if (input !== bridgeEndpoint || init?.method !== 'POST' || typeof init.body !== 'string') throw new Error('Unexpected baseline bridge request.');
    const body = JSON.parse(init.body) as { horde?: { context_fit?: string } };
    if (body.horde?.context_fit !== 'reject') throw new Error('Unexpected baseline bridge context setting.');
    body.horde.context_fit = 'grow';
    return fetcher(input, { ...init, body: JSON.stringify(body) });
  };
  return hordeAdapter(env, bridgeFetch);
}
