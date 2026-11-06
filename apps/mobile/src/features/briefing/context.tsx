import { createContext, type PropsWithChildren, useContext, useState } from "react";
import type { Scenario } from "./sample";

const Context = createContext<{ scenario: Scenario; setScenario: (value: Scenario) => void }>({
  scenario: "attention",
  setScenario: () => {},
});
export function PreviewProvider({ children }: PropsWithChildren) {
  const [scenario, setScenario] = useState<Scenario>("attention");
  return <Context.Provider value={{ scenario, setScenario }}>{children}</Context.Provider>;
}
export function usePreview() {
  return useContext(Context);
}
