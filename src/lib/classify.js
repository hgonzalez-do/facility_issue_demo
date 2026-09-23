import { config } from '../config.js';
import { inference } from './inference.js';
import { TICKET_TOOL, SYSTEM_PROMPT, userPrompt, coerceTicket } from './ticket-schema.js';

/**
 * Turn one grievance into one ticket.
 *
 * Uses a forced tool call rather than a structured-output format: DigitalOcean's
 * Anthropic-compatible endpoint silently ignores `output_config.format` and
 * returns prose, while `tools` + `tool_choice` is honoured in full, enums
 * included. Verified against inference.do-ai.run.
 *
 * Used directly by INGEST_MODE=local. In mars mode the equivalent work happens
 * inside a Harness Runtime sandbox, driven by the same system prompt
 * (see agents/complaint-agent.yaml).
 */
export async function classify(body) {
  const response = await inference().messages.create({
    model: config.inference.model,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt(body) }],
    tools: [TICKET_TOOL],
    tool_choice: { type: 'tool', name: TICKET_TOOL.name },
  });

  if (response.stop_reason === 'refusal') {
    const why = response.stop_details?.category ?? 'unspecified';
    throw new Error(`model declined to classify this complaint (${why})`);
  }

  const call = (response.content ?? []).find(
    (b) => b.type === 'tool_use' && b.name === TICKET_TOOL.name,
  );

  if (!call) {
    const kinds = (response.content ?? []).map((b) => b.type).join(', ') || 'nothing';
    throw new Error(`model returned ${kinds} instead of a ${TICKET_TOOL.name} call`);
  }

  // Snap to the vocabulary anyway. Enums are honoured today; this costs nothing
  // and means a provider quirk degrades to a slightly-wrong ticket, not a lost one.
  return coerceTicket(call.input);
}
