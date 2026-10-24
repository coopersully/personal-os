import { useLocation, useNavigate } from "react-router-dom";
import { XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { authenticationDestination } from "./auth-navigation";

const destinationNames: Record<string, string> = {
  finances: "Finances",
  plan: "Budget",
  cashflow: "Cash flow",
  setup: "Setup",
};

/** Keep the return destination visible and let the user opt out before signing in. */
export function LoginDestination() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  if (!params.has("next")) return null;
  const destination = authenticationDestination(location.search);
  // Invalid targets already fall back to Today; never advertise an unsafe destination.
  if (destination === "/today" && params.get("next") !== "/today") return null;
  const label = new URL(destination, "https://nohmi.invalid").pathname
    .split("/")
    .filter(Boolean)
    .map(
      (segment) =>
        destinationNames[segment] ??
        segment.replace(/-/g, " ").replace(/^./, (letter) => letter.toUpperCase()),
    )
    .join(" / ");
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md bg-muted py-1 pl-3 pr-1 text-sm text-muted-foreground">
      <span className="min-w-0 flex-1">
        After login: <span className="font-medium text-foreground">{label}</span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Clear destination after login"
        onClick={() => {
          params.delete("next");
          navigate(
            { pathname: location.pathname, search: params.toString(), hash: location.hash },
            { replace: true },
          );
        }}
      >
        <XIcon aria-hidden="true" />
      </Button>
    </div>
  );
}
