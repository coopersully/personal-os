import { createContext } from "react";

/** Scoped to Settings; workspace forms and standalone flows retain their own layout. */
export const SettingsControlsContext = createContext(false);
