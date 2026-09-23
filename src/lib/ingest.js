import { insertComplaint, markComplaint } from '../db/index.js';
import { fireWebhook } from './mars.js';
import { emit, EVENTS } from './events.js';

/**
 * Accept a complaint and hand it to Harness Runtime.
 *
 * Returns as soon as the complaint row exists. The ticket is written later,
 * by an agent in its own microVM — this process never does that work, and
 * never waits for it. The submitter gets an instant thank-you page and the
 * ticket lands on the wall a few seconds later, which is the bit the room
 * actually watches.
 */
export async function submitComplaint({ body, source = 'web' }) {
  const complaint = await insertComplaint({ body, source });
  emit(EVENTS.COMPLAINT, complaint);

  // Fire and forget. Failures are recorded on the complaint row, not thrown
  // at the person who just told us their chair squeaks.
  dispatch(complaint).catch((err) => {
    console.error(`[ingest] complaint ${complaint.id} failed:`, err.message);
  });

  return complaint;
}

async function dispatch(complaint) {
  try {
    await markComplaint(complaint.id, { status: 'processing' });
    await fireWebhook({ complaintId: complaint.id, body: complaint.body });
    // The agent sets 'ticketed' itself once the row is in, so there is
    // nothing further to do here. The watcher notices the new ticket.
  } catch (err) {
    await markComplaint(complaint.id, {
      status: 'failed',
      error: String(err.message).slice(0, 500),
    }).catch(() => {});
    throw err;
  }
}
