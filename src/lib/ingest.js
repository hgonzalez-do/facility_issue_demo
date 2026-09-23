import { config } from '../config.js';
import { insertComplaint, insertTicket, markComplaint } from '../db/index.js';
import { classify } from './classify.js';
import { fireWebhook } from './mars.js';
import { toRow } from './ticket-schema.js';
import { emit, EVENTS } from './events.js';

/**
 * Accept a complaint and start it on its way to becoming a ticket.
 *
 * Returns as soon as the complaint row exists. Ticket creation is deliberately
 * asynchronous in both modes — the submitter gets an instant thank-you page and
 * the ticket lands on the dashboard a few seconds later, which is the bit the
 * room actually watches.
 */
export async function submitComplaint({ body, source = 'web' }) {
  const complaint = await insertComplaint({ body, source });
  emit(EVENTS.COMPLAINT, complaint);

  // Fire and forget. Failures are recorded on the complaint row, not thrown at
  // the person who just told us their chair squeaks.
  process(complaint).catch((err) => {
    console.error(`[ingest] complaint ${complaint.id} failed:`, err.message);
  });

  return complaint;
}

async function process(complaint) {
  try {
    await markComplaint(complaint.id, { status: 'processing' });

    if (config.ingest.mode === 'mars') {
      // Hand it to Harness Runtime. A fresh microVM does the transform and
      // writes the ticket row itself, through Action Gateway. We are done here;
      // the watcher will see the row appear.
      await fireWebhook({ complaintId: complaint.id, body: complaint.body });
      return;
    }

    // local mode: do the agent's job in-process, writing to the same cluster.
    const parsed = await classify(complaint.body);
    const ticket = await insertTicket(toRow(parsed, { complaintId: complaint.id }));
    await markComplaint(complaint.id, { status: 'ticketed' });
    emit(EVENTS.TICKET, { ...ticket, complaint_body: complaint.body });
  } catch (err) {
    await markComplaint(complaint.id, {
      status: 'failed',
      error: String(err.message).slice(0, 500),
    }).catch(() => {});
    throw err;
  }
}
