import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronRightIcon } from "@/components/icons";
import { SettingsRecord, SettingsRecordAction } from "@/components/settings-record";
import { Badge } from "@/components/ui/badge";
import { ItemGroup } from "@/components/ui/item";
import { api } from "../../api.js";

/** One entry to the cross-workspace decision queue, owned by Today. */
export function ReviewsEntry() {
  const query = useQuery({
    queryKey: ["agent-access-work-items", "all", "all", null],
    queryFn: () => api.listAgentAccessWorkItems({ limit: 10 }),
  });
  const count = query.data?.summary.total;
  return (
    <ItemGroup>
      <SettingsRecord
        title="Reviews"
        description={
          query.isError || query.data?.unavailableDomains.length
            ? "Some workspaces could not be checked. Open Reviews to retry."
            : query.isPending
              ? "Checking for decisions that need you…"
              : count === 0
                ? "No pending reviews or attention items."
                : "Decisions and requests that need your judgment."
        }
        metadata={
          typeof count === "number" ? (
            <Badge variant="secondary">{count.toLocaleString()} pending</Badge>
          ) : null
        }
        actions={
          <SettingsRecordAction asChild label="Open Reviews">
            <Link to="/reviews">
              <ChevronRightIcon />
            </Link>
          </SettingsRecordAction>
        }
      />
    </ItemGroup>
  );
}
