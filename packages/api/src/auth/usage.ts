import { sql, type Kysely } from 'kysely';
import type { Database } from '@msapi/db';

interface Counter {
  secondWindow: number;
  secondCount: number;
  day: string;
  count: number;
  flushed: number;
}

export class UsageMeter {
  private readonly counters = new Map<string, Counter>();
  private readonly db: Kysely<Database>;
  private readonly now: () => number;
  private readonly timer: NodeJS.Timeout;

  constructor(db: Kysely<Database>, now: () => number = () => Date.now()) {
    this.db = db;
    this.now = now;
    this.timer = setInterval(() => { void this.flush(); }, 10_000);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  async charge(keyId: number, scope: string, perDay: number, perSecond: number): Promise<'ok' | 'daily' | 'second'> {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const id = `${keyId}:${scope}`;
    let counter = this.counters.get(id);
    if (!counter || counter.day !== day) {
      const stored = scope === 'key' ? await this.stored(keyId, day) : 0;
      counter = { secondWindow: 0, secondCount: 0, day, count: stored, flushed: stored };
      this.counters.set(id, counter);
    }
    const second = Math.floor(this.now() / 1000);
    if (counter.secondWindow !== second) {
      counter.secondWindow = second;
      counter.secondCount = 0;
    }
    if (counter.secondCount >= perSecond) return 'second';
    if (counter.count >= perDay) return 'daily';
    counter.secondCount += 1;
    counter.count += 1;
    return 'ok';
  }

  async flush(): Promise<void> {
    for (const [id, counter] of this.counters) {
      const delta = counter.count - counter.flushed;
      if (delta <= 0) continue;
      const keyId = Number(id.slice(0, id.indexOf(':')));
      try {
        await this.db.insertInto('usage_daily').values({ api_key_id: keyId, day: counter.day, requests: delta })
          .onConflict(oc => oc.columns(['api_key_id', 'day']).doUpdateSet({
            requests: sql`usage_daily.requests + ${delta}`,
            updated_at: sql`now()`,
          }))
          .execute();
        await this.db.updateTable('api_key').set({ last_used_at: new Date(this.now()) }).where('id', '=', keyId).execute();
        counter.flushed = counter.count;
      } catch {
        // The next flush retries the same delta.
      }
    }
  }

  private async stored(keyId: number, day: string): Promise<number> {
    const row = await this.db.selectFrom('usage_daily').select('requests')
      .where('api_key_id', '=', keyId)
      .where('day', '=', sql<Date>`${day}::date`)
      .executeTakeFirst();
    return row?.requests ?? 0;
  }
}
