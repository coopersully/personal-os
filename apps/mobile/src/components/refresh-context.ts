import type { QueryClient } from "@tanstack/react-query";
import { createContext } from "react";
export const RefreshClient = createContext<QueryClient | null>(null);
export const RefreshScope = createContext<readonly string[]>([]);
