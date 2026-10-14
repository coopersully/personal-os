import { localDateAt, localDateToIso } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
export function useTodayClock(timeZone: string) {
  const cache = useQueryClient();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let day = localDateToIso(localDateAt(new Date(), timeZone));
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      const next = new Date();
      const nextDay = localDateToIso(localDateAt(next, timeZone));
      setNow(next);
      if (nextDay !== day) {
        day = nextDay;
        void cache.invalidateQueries({ queryKey: ["daily-brief"] });
        void cache.invalidateQueries({ queryKey: ["today-commitments"] });
      }
    };
    const resume = () => {
      tick();
      void cache.invalidateQueries({ queryKey: ["daily-brief"] });
      void cache.invalidateQueries({ queryKey: ["today-commitments"] });
    };
    const interval = window.setInterval(tick, 30000);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", tick);
    tick();
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [cache, timeZone]);
  return now;
}
