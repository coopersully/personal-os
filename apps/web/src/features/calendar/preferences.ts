import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";

/** Only approved Calendar guidance supplies a default event destination. */
export function useDefaultCalendarId() {
  const profile = useQuery({
    queryKey: ["domain-profile", "calendar"],
    queryFn: () => api.getDomainProfile("calendar"),
  });
  return profile.data?.status === "active" &&
    typeof profile.data.preferences.defaultCalendarId === "string"
    ? profile.data.preferences.defaultCalendarId
    : undefined;
}
