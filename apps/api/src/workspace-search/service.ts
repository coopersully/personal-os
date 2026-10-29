import type { Database } from "@personal-os/database";
import type {
  AgentAccessWorkItem,
  SearchableWorkspace,
  WorkspaceSearchPage,
  WorkspaceSearchQuery,
  WorkspaceSearchResult,
} from "@personal-os/domain";
import { sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import { workspaceSearchSources } from "./sources.js";

/** Scope in SQL before matching. Queries stay on the server; only bounded previews leave it. */
export function createWorkspaceSearchService(db: Database) {
  return {
    async search(
      userId: string,
      workspace: SearchableWorkspace,
      query: WorkspaceSearchQuery,
      reviews: AgentAccessWorkItem[] = [],
    ): Promise<WorkspaceSearchPage> {
      const projections = workspaceSearchSources[workspace].map(
        (source) => sql`
        SELECT t.id::text AS id, ${source.kindSql ? sql.raw(source.kindSql) : sql`${source.kind}::text`} AS kind,
          ${sql.raw(source.title)} AS title, left(${sql.raw(source.preview)}, 240) AS preview,
          ${sql.raw(source.text)} AS document, ${sql.raw(source.href)} AS href,
          ${sql.raw(source.state)} AS state
        FROM ${sql.raw(source.from)} WHERE t.user_id = ${userId}::uuid AND (${sql.raw(source.where)})
      `,
      );
      if (reviews.length) {
        const projected = reviews.map((item) => ({
          id: item.id,
          kind: "Review",
          title: item.title,
          preview: Array.from(
            item.preview?.map((part) => `${part.label}: ${part.value}`).join(" · ") || item.summary,
          )
            .slice(0, 240)
            .join(""),
          document: `${item.title} ${item.summary} ${item.preview?.map((part) => part.value).join(" ") ?? ""}`,
          href: `/${workspace}?review=${encodeURIComponent(item.id)}`,
          state: null,
        }));
        projections.push(
          sql`SELECT * FROM jsonb_to_recordset(${JSON.stringify(projected)}::jsonb) AS r(id text, kind text, title text, preview text, document text, href text, state text)`,
        );
      }
      const literal = query.q.replace(/[\\%_]/g, "\\$&");
      const terms = [...new Set(query.q.toLocaleLowerCase("en-US").split(/\s+/).filter(Boolean))];
      if (terms.length > 12) throw new AppError("invalid_request", "Use at most 12 search terms.");
      const matches = terms.map(
        (term) => sql`document ILIKE ${`%${term.replace(/[\\%_]/g, "\\$&")}%`}`,
      );
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
        return tx.execute<WorkspaceSearchResult>(sql`
        WITH candidates AS (${sql.join(projections, sql` UNION ALL `)})
        SELECT id, kind, title, preview, href, state FROM candidates
        WHERE (${sql.join(matches, sql` AND `)})
          AND (${query.kind} = 'all' OR (${query.kind} = 'reviews' AND kind = 'Review') OR (${query.kind} = 'content' AND kind <> 'Review'))
          AND (${query.includeArchived} OR state IS NULL OR state IN ('Pending', 'Hidden calendar'))
        ORDER BY CASE WHEN lower(title) = lower(${query.q}) THEN 0 WHEN title ILIKE ${`${literal}%`} THEN 1 ELSE 2 END,
          ts_rank_cd(to_tsvector('simple', document), plainto_tsquery('simple', ${query.q})) DESC,
          lower(title), kind, id
        LIMIT ${query.limit + 1} OFFSET ${query.offset}
      `);
      });
      return {
        items: result.rows.slice(0, query.limit),
        nextOffset: result.rows.length > query.limit ? query.offset + query.limit : null,
        coverage: "synced",
      };
    },
  };
}
