import { ApiClientError } from "@personal-os/api-client";
import { refreshDueAlerts } from "../notifications/events";
import { allPages } from "./logic";

export { actOnItem, allPages, type ItemAction, isOpen, itemKey, uniqueItems } from "./logic";

import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner-native";
import { useAuth } from "../auth/context";

const Search = createContext({ search: "", setSearch: (_value: string) => {} });
export function MobileDataProvider({ children }: PropsWithChildren) {
  const [search, setSearch] = useState("");
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: (error) => toast.error(errorMessage(error)) }),
        defaultOptions: {
          queries: { retry: false, staleTime: 30_000, gcTime: 300_000 },
          mutations: { retry: false },
        },
      }),
  );
  useEffect(() => () => client.clear(), [client]);
  return (
    <QueryClientProvider client={client}>
      <Search.Provider value={{ search, setSearch }}>{children}</Search.Provider>
    </QueryClientProvider>
  );
}
export const useTaskSearch = () => useContext(Search);
export function useTaskApi() {
  return useAuth().session.api();
}
export function errorMessage(error: unknown) {
  if (error instanceof ApiClientError && error.status === 409)
    return "This changed elsewhere. Refresh the record before trying again; your draft is still here.";
  if (error instanceof ApiClientError && error.status < 500) return error.message;
  return "Couldn’t confirm the result. Check your connection and refresh before retrying.";
}
export function useTaskResources() {
  const api = useTaskApi();
  const lists = useQuery({
    queryKey: ["tasks", "lists"],
    queryFn: () => allPages((cursor) => api.listTaskLists({ limit: 100, cursor })),
  });
  const projects = useQuery({
    queryKey: ["tasks", "projects"],
    queryFn: () => allPages((cursor) => api.listTaskProjects({ limit: 100, cursor })),
  });
  const settings = useQuery({
    queryKey: ["tasks", "settings"],
    queryFn: () => api.getWorkspaceSettings("tasks"),
  });
  return { lists, projects, settings };
}
export function useTaskAction() {
  const client = useQueryClient();
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  async function run<T>(
    label: string,
    action: () => Promise<T>,
    onSuccess?: (value: T) => void,
    onError?: (error: unknown) => void,
    feedback?: (value: T) => { message: string; error?: boolean },
  ) {
    if (lock.current) return false;
    lock.current = true;
    setPending(true);
    const id = toast.loading(label);
    try {
      const value = await action();
      refreshDueAlerts();
      const result = feedback?.(value);
      if (result?.error) toast.error(result.message, { id });
      else toast.success(result?.message ?? "Saved", { id });
      onSuccess?.(value);
      await client.invalidateQueries({ queryKey: ["tasks"] });
      return true;
    } catch (error) {
      toast.error(errorMessage(error), { id });
      onError?.(error);
      return false;
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return { pending, run };
}
