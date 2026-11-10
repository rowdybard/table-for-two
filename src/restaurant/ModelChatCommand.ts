import { DOLPHIN_LLM_MODEL, DOLPHIN_MODEL, HORDE_MODEL, type ClaudeModel } from './types';

export const DEFAULT_CONVERSATION_MODEL: ClaudeModel = 'claude-haiku-5-5';
export type ModelChatCommand = { type: 'status' } | { type: 'reset' } | { type: 'set'; model: ClaudeModel } | { type: 'invalid' };

/** Typed controls are consumed locally before conversation, captions or shared chat. */
export function parseModelChatCommand(text: string): ModelChatCommand | null {
  const [name, ...args] = text.trim().split(/\s+/);
  if (name.toLowerCase() !== '/model') return null;
  if (args.length === 0) return { type: 'status' };
  if (args.length !== 1) return { type: 'invalid' };
  const choice = args[0].toLowerCase();
  if (choice === 'reset') return { type: 'reset' };
  const model = choice === 'haiku' ? 'claude-haiku-5-5' : choice === 'sonnet' ? 'claude-sonnet-5-5' : choice === 'dolphin' ? DOLPHIN_LLM_MODEL : undefined;
  return model ? { type: 'set', model } : { type: 'invalid' };
}

/** Ignore choices from the removed picker; only a deliberate typed override survives reload. */
export function savedConversationModel(saved: { model?: unknown; modelSource?: unknown }): ClaudeModel {
  return saved.modelSource === 'chat-command' && (saved.model === 'claude-haiku-5-5' || saved.model === 'claude-sonnet-5-5' || saved.model === DOLPHIN_LLM_MODEL)
    ? saved.model : DEFAULT_CONVERSATION_MODEL;
}

export function conversationModelName(model: ClaudeModel): string {
  return model === HORDE_MODEL ? 'AI Horde' : model === DOLPHIN_MODEL ? 'Dolphin Venice' : model === DOLPHIN_LLM_MODEL ? 'Dolphin' : model === 'claude-sonnet-5-5' ? 'Sonnet' : 'Haiku';
}
