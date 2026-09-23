import { config } from '../config.js';
import { inference } from './inference.js';
import { stats, insertSummary } from '../db/index.js';
import { emit, EVENTS } from './events.js';

const SUMMARY_TOOL = {
  name: 'file_summary',
  description: 'Record the operations summary for the reporting period. Call this once.',
  input_schema: {
    type: 'object',
    properties: {
      headcount_ask: {
        type: 'string',
        description:
          'A specific, straight-faced headcount request for Facilities. One sentence, containing a number.',
      },
      narrative: {
        type: 'string',
        description:
          'Three to five sentences of executive summary. Utterly deadpan. Cite the actual figures given.',
      },
    },
    required: ['headcount_ask', 'narrative'],
    additionalProperties: false,
  },
};

const SYSTEM = `You write the quarterly operations summary for a corporate Complaints Department.

You will be given real ticket volumes from the intake system. Write the summary
an operations director would circulate to leadership: measured, slightly
defensive of the team, and entirely serious about what the data shows.

Never acknowledge that the underlying complaints are trivial. Never make a joke.
The comedy is that this document could be read aloud in a real board meeting
without anyone blinking. Cite the actual numbers you are given. Close the
narrative by building the case for the headcount ask.

The headcount ask must be a specific number of additional Facilities
headcount, justified by the ticket volume and SLA pressure in the data.`;

/**
 * The closing beat of the talk: total tickets, top three components by volume,
 * and a recommended headcount ask for Facilities.
 *
 * The scheduled path is a cron trigger running agents/summary-agent.yaml.
 * This in-process copy exists only so the "Generate now" button can rehearse
 * the ending without waiting for the clock. Keep its instructions in step
 * with agents/summary-prompt.txt — they are two statements of one job.
 */
export async function generateSummary() {
  const s = await stats();
  const topComponents = s.byComponent.slice(0, 3);

  const facts = [
    `Total tickets filed: ${s.tickets}`,
    `Total complaints received: ${s.complaints}`,
    '',
    'Top components by volume:',
    ...(topComponents.length
      ? topComponents.map((c, i) => `  ${i + 1}. ${c.component} — ${c.count} tickets`)
      : ['  (none yet)']),
    '',
    'Severity distribution:',
    ...(s.bySeverity.length
      ? s.bySeverity.map((r) => `  ${r.severity}: ${r.count}`)
      : ['  (none yet)']),
    '',
    'Ticket volume by owning team:',
    ...(s.byOwner.length ? s.byOwner.map((r) => `  ${r.owner}: ${r.count}`) : ['  (none yet)']),
  ].join('\n');

  const response = await inference().messages.create({
    model: config.inference.model,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Intake data for the reporting period:\n\n${facts}\n\nWrite the summary.`,
      },
    ],
    tools: [SUMMARY_TOOL],
    tool_choice: { type: 'tool', name: SUMMARY_TOOL.name },
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(
      `model declined to write the summary (${response.stop_details?.category ?? 'unspecified'})`,
    );
  }

  const call = (response.content ?? []).find(
    (b) => b.type === 'tool_use' && b.name === SUMMARY_TOOL.name,
  );
  if (!call) throw new Error(`model returned no ${SUMMARY_TOOL.name} call`);

  const parsed = call.input ?? {};

  const summary = await insertSummary({
    totalTickets: s.tickets,
    topComponents,
    headcountAsk: String(parsed.headcount_ask ?? 'No additional headcount requested at this time.').trim(),
    narrative: String(parsed.narrative ?? '').trim() || 'No narrative produced for this period.',
  });

  emit(EVENTS.SUMMARY, summary);
  return summary;
}
