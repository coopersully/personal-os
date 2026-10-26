import { useSearchParams } from "react-router-dom";
import { CalendarIcon } from "@/components/icons";
import { MobileWorkspaceDock } from "@/components/mobile-workspace-dock";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useWorkspacePreferences } from "../workspace-settings/preferences";
import { calendarViewFromSearch } from "./page";

export function CalendarMobileNavigation() {
  const [params] = useSearchParams();
  const preferences = useWorkspacePreferences("calendar");
  const compact = useMediaQuery("(max-width: 560px)");
  const stored = preferences.data?.preferences.calendarView;
  const view = calendarViewFromSearch(
    params.get("view"),
    stored && stored !== "auto" ? stored : compact ? "day" : "week",
  );
  const active = new URLSearchParams(params);
  active.set("view", view);
  return (
    <MobileWorkspaceDock
      title="Calendar"
      activeSearch={active.toString()}
      pages={["day", "week", "month"].map((value) => {
        const next = new URLSearchParams(params);
        next.set("view", value);
        return { icon: CalendarIcon, label: value, path: `/calendar?${next}` };
      })}
    />
  );
}
