import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
export function RitualSetupOffer({ userId }: { userId: string }) {
  const key = `nohmi.ritual-setup.${userId}`;
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(key) === "dismissed");
  function dismiss() {
    localStorage.setItem(key, "dismissed");
    setDismissed(true);
  }
  if (dismissed) return null;
  return (
    <Alert>
      <AlertTitle>Make room for your morning and evening</AlertTitle>
      <AlertDescription>
        <p>Set up a short ritual that waits until you’re ready.</p>
        <div className="flex gap-2">
          <Button asChild size="sm">
            <Link to="/settings?section=rituals" onClick={dismiss}>
              Set up rituals
            </Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Later
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
