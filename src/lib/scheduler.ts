import db from '../db';
import { sendOccasionReminder } from './email';

const REMIND_AT_DAYS = [14, 7, 3, 1];

function daysUntil(dateStr: string): number {
  const months: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const [mon, day] = dateStr.split(' ');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const month = months[mon] ?? 0;
  const d = parseInt(day, 10);
  let target = new Date(now.getFullYear(), month, d);
  if (target < now) target.setFullYear(now.getFullYear() + 1);
  return Math.round((target.getTime() - now.getTime()) / 86400000);
}

export async function runOccasionReminders() {
  const occasions = await db.occasion.findMany({
    include: {
      circle: {
        include: {
          members: { include: { user: true } },
        },
      },
    },
  });

  for (const occ of occasions) {
    const days = daysUntil(occ.date);
    if (!REMIND_AT_DAYS.includes(days)) continue;

    const recipients = occ.circle.members
      .filter(m => m.user.notifBirthdays)
      .map(m => m.user.email)
      .filter(Boolean);

    if (recipients.length === 0) continue;

    await sendOccasionReminder(recipients, occ.title, occ.date, days).catch(() => {});
    console.log(`Occasion reminder sent: "${occ.title}" in ${days} days → ${recipients.length} recipient(s)`);
  }
}

export function startScheduler() {
  // Schedule to run at the next midnight, then every 24h
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 5, 0);
  const msUntilMidnight = nextMidnight.getTime() - now.getTime();

  setTimeout(() => {
    runOccasionReminders().catch(console.error);
    setInterval(() => runOccasionReminders().catch(console.error), 24 * 60 * 60 * 1000);
  }, msUntilMidnight);

  console.log(`Occasion reminder scheduler started — next run in ${Math.round(msUntilMidnight / 60000)} min`);
}
