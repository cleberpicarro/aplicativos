import type { Db } from '../lib/db.js';

export async function logEvent(db: Db, cardId: string, actorId: string | null, type: string, before?: unknown, after?: unknown) {
  await db.query(
    `INSERT INTO card_events (card_id, actor_id, type, before, after) VALUES ($1, $2, $3, $4, $5)`,
    [cardId, actorId, type, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after)],
  );
}
