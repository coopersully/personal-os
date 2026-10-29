import {
  type Database,
  financeConversationMessages,
  financeConversationReadCursors,
} from "@personal-os/database";
import {
  type FinanceConversationUnread,
  financeConversationUnreadSchema,
  idSchema,
} from "@personal-os/domain";
import { sql } from "drizzle-orm";

export function createFinanceConversationUnreadService({ db }: { db: Database }) {
  return {
    async readUnread(ownerId: string): Promise<FinanceConversationUnread> {
      const owner = idSchema.parse(ownerId);
      // One statement gives count, cursor and latest agent sequence one MVCC snapshot.
      const result = await db.execute(sql`
        select count(*) filter (where m.sequence > c.read_sequence)::text as "unreadCount",
               c.read_sequence::text as "readThroughSequence",
               coalesce(max(m.sequence), 0::bigint)::text as "latestAgentSequence"
        from (select coalesce((select ${financeConversationReadCursors.readThroughSequence}
               from ${financeConversationReadCursors}
               where ${financeConversationReadCursors.userId} = ${owner}), 0::bigint) as read_sequence) c
        left join ${financeConversationMessages} m on m.user_id = ${owner} and m.author_kind = 'agent'
        group by c.read_sequence
      `);
      return financeConversationUnreadSchema.parse(result.rows[0]);
    },
  };
}
