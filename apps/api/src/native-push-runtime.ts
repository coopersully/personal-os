import type { Database } from "@personal-os/database";
import { sql } from "drizzle-orm";
import { enqueueNativePushEvent } from "./native-push-service.js";
import { createTextingRecoveryRuntime } from "./texting-recovery-runtime.js";

/** Bounded canonical discovery is independent of SMS consent and financial execution. */
export function createNativePushRuntime(options: {
  db: Database;
  enabled: () => boolean;
  dispatch: (continuing: () => boolean) => Promise<void>;
}) {
  let cursor: string | null = null;
  return createTextingRecoveryRuntime(async (continuing) => {
    if (!options.enabled() || !continuing()) return;
    const result = await options.db.execute<{
      userId: string;
      sourceId: string;
      kind: "attention" | "activity";
      sourceType: "maintenance_run" | "contextual_question" | "review_case" | "action_review";
      sourceRevision: string;
      createdAt: Date;
      key: string;
    }>(sql`
      WITH sources AS (
        SELECT user_id,id AS source_id,'contextual_question'::text AS source_type,'attention'::text AS kind,action_revision::text AS revision,updated_at AS changed_at FROM finance_contextual_questions WHERE state='open'
        UNION ALL SELECT user_id,id,'review_case','attention',human_action->'request'->'work'->>'actionRevision',updated_at FROM finance_review_cases WHERE status='open' AND human_action->>'state'='open'
        UNION ALL SELECT user_id,id,'action_review','attention',floor(extract(epoch FROM updated_at)*1000)::bigint::text,updated_at FROM finance_agent_action_reviews WHERE status='pending'
        UNION ALL SELECT user_id,id,'maintenance_run',CASE WHEN status IN ('completed','completed_with_questions') THEN 'activity' ELSE 'attention' END,status,updated_at FROM workspace_maintenance_runs WHERE domain='finances' AND status IN ('awaiting_approval','blocked','failed_recoverable','failed_terminal','completed','completed_with_questions')
      ), eligible AS (
        SELECT s.*,s.user_id::text||':'||s.source_id::text||':'||s.source_type||':'||s.kind AS key FROM sources s
        WHERE s.revision IS NOT NULL AND EXISTS(SELECT 1 FROM native_push_devices d JOIN sessions se ON se.id=d.session_id WHERE d.user_id=s.user_id AND d.finance_enabled AND se.expires_at>now() AND d.enrolled_at<=s.changed_at)
      ) SELECT user_id::text AS "userId",source_id::text AS "sourceId",source_type AS "sourceType",kind,revision AS "sourceRevision",changed_at AS "createdAt",key FROM eligible
      WHERE ${cursor ? sql`key>${cursor}` : sql`true`} ORDER BY key LIMIT 25
    `);
    for (const source of result.rows) {
      if (!continuing()) break;
      await options.db.transaction((tx) =>
        enqueueNativePushEvent(tx, {
          userId: source.userId,
          sourceId: source.sourceId,
          kind: source.kind,
          sourceType: source.sourceType,
          sourceRevision: source.sourceRevision,
          createdAt: new Date(source.createdAt),
        }),
      );
      cursor = source.key;
    }
    if (result.rows.length < 25) cursor = null;
    if (continuing()) await options.dispatch(continuing);
  });
}
