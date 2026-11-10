import type { ClaudeModel } from '../../src/restaurant/types';

/** Capture-only identity and published rate; the frozen production model registry is unchanged. */
export const DOLPHIN_LLM_MODEL = 'dolphinllm/uncensored' as ClaudeModel;
export const DOLPHIN_LLM_RATE = { input: .15, output: .50, cacheRead: .15, cacheWrite: 0 } as const;
