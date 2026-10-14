import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useQueryFeedback } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { getDesktopSettings, isDesktop, nativeAction } from "@/features/desktop/bridge";
export function TodayPetCard() {
  const [pending, setPending] = useState(false);
  const query = useQuery({
    queryKey: ["desktop-settings"],
    queryFn: getDesktopSettings,
    enabled: isDesktop(),
    refetchInterval: 30000,
  });
  useQueryFeedback({ query, title: "Couldn’t refresh pet settings." });
  if (!isDesktop() || !query.data?.settings.petEnabled) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Your desktop pet</h2>
        </CardTitle>
        <CardDescription>Your companion’s quick access</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button
          disabled={pending}
          onClick={() => {
            setPending(true);
            toast.promise(
              nativeAction("quick_access").finally(() => setPending(false)),
              {
                loading: "Opening pet quick access…",
                success: "Pet quick access requested.",
                error: "Could not open pet quick access.",
              },
            );
          }}
        >
          Open quick access
        </Button>
      </CardFooter>
    </Card>
  );
}
