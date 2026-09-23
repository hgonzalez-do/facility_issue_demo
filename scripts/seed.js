#!/usr/bin/env node
/**
 * Fills the dashboard with plausible traffic so you can rehearse, take
 * screenshots, or check the layout without standing in front of 200 people.
 *
 *   node scripts/seed.js            # 12 canned complaints, real classification
 *   node scripts/seed.js --fake     # no API calls; deterministic fake tickets
 *   node scripts/seed.js -n 40      # more, cycling through the canned list
 */
import { initDb, closeDb, insertComplaint, insertTicket, markComplaint } from '../src/db/index.js';
import { classify } from '../src/lib/classify.js';
import { toRow, COMPONENTS, OWNERS, SEVERITIES, SLA_HOURS } from '../src/lib/ticket-schema.js';

const GRIEVANCES = [
  'The coffee here is cold.',
  'My coworker chews loudly.',
  'The third-floor printer makes a noise like it is in pain.',
  'Someone keeps stealing my yoghurt.',
  'The meeting room clock is four minutes fast.',
  'The soap in the bathroom smells like a hospital.',
  'The lift plays jazz.',
  'My chair squeaks only when I lean back to think.',
  'The air conditioning is set for people who run cold.',
  'There are never any forks.',
  'The Wi-Fi drops every time I stand up.',
  'Someone booked the quiet room for a conference call.',
  'The plants in reception are plastic and nobody will admit it.',
  'My monitor is one inch too low.',
  'The kitchen bin lid slams.',
  'People say "circle back" unironically.',
  'The hand dryer is louder than the fire alarm.',
  'The fridge smells and no one will investigate.',
  'My desk wobbles but only on Tuesdays.',
  'The stairwell door needs a shove that I do not have in me.',
];

const args = process.argv.slice(2);
const fake = args.includes('--fake');
const nFlag = args.indexOf('-n');
const count = nFlag >= 0 ? Number.parseInt(args[nFlag + 1], 10) || 12 : 12;

function pick(arr, seed) {
  return arr[seed % arr.length];
}

function fakeTicket(body, i) {
  const sev = pick(SEVERITIES, i + 1);
  const slaBySev = { P1: 4, P2: 24, P3: 72, P4: 168 };
  return {
    title: body.replace(/\.$/, '').replace(/^(The|My|Someone|There|People)\b/i, 'Reported').slice(0, 90),
    component: pick(COMPONENTS, i * 3 + 1),
    severity: sev,
    affected_users: [4, 11, 27, 63, 118, 250][i % 6],
    suggested_owner: pick(OWNERS, i * 2),
    sla_hours: String(slaBySev[sev] ?? pick(SLA_HOURS, i)),
    root_cause_hypothesis: 'Tolerance drift in an unowned process boundary.',
  };
}

await initDb();

console.log(`Seeding ${count} complaint${count === 1 ? '' : 's'}${fake ? ' (fake tickets, no API calls)' : ''}…\n`);

let ok = 0;
let failed = 0;

for (let i = 0; i < count; i++) {
  const body = GRIEVANCES[i % GRIEVANCES.length];
  const complaint = await insertComplaint({ body, source: 'seed' });

  try {
    const parsed = fake ? fakeTicket(body, i) : await classify(body);
    const ticket = await insertTicket(toRow(parsed, { complaintId: complaint.id }));
    await markComplaint(complaint.id, { status: 'ticketed' });
    ok += 1;
    console.log(`  ${String(ticket.severity).padEnd(2)} ${ticket.component.padEnd(28)} ${ticket.title}`);
  } catch (err) {
    failed += 1;
    await markComplaint(complaint.id, { status: 'failed', error: err.message });
    console.error(`  !! ${body} — ${err.message}`);
  }
}

console.log(`\nDone. ${ok} filed, ${failed} failed.`);
await closeDb();
