import { hordeAdapter } from '../../server/restaurant/horde';
import { TURN_SCHEMA, type ClaudeAdapter } from '../../server/restaurant/providers';

const bridgeEndpoint = 'https://oai.aihorde.net/v1/chat/completions';

/** Bench-only bridge compatibility; all prompts and native transport remain frozen. */
export function createBaselineHordeAdapter(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): ClaudeAdapter {
  if (env.AI_HORDE_TRANSPORT === 'native') return hordeAdapter(env, fetcher);
  return { async *stream(request, signal) {
    const bridgeFetch: typeof fetch = (input, init) => {
      if (input !== bridgeEndpoint || init?.method !== 'POST' || typeof init.body !== 'string') throw new Error('Unexpected baseline bridge request.');
      const body = JSON.parse(init.body) as { horde?: { context_fit?: string }; response_format?: { type?: string } };
      if (body.horde?.context_fit !== 'reject' || body.response_format?.type !== 'json_object') throw new Error('Unexpected baseline bridge settings.');
      body.horde.context_fit = 'grow';
      body.response_format = { type: 'json_schema', json_schema: { name: 'date_turn', schema: request.outputSchema ?? TURN_SCHEMA, strict: true } } as typeof body.response_format;
      return fetcher(input, { ...init, body: JSON.stringify(body) });
    };
    yield* hordeAdapter(env, bridgeFetch).stream(request, signal);
  } };
}
