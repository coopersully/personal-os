import { ApiClientError } from "@personal-os/api-client";
import { RefreshClient } from "../../components/refresh-context";
import { refreshDueAlerts } from "../notifications/events";
import { allPages } from "./logic";

export {
  actOnItem,
  actWithUndo,
  allPages,
  type ItemAction,
  isOpen,
  itemKey,
  uniqueItems,
} from "./logic";

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
        queryCache: new QueryCache({
          onError: (error, query) => {
            if (!query.meta?.scopedReadFeedback) toast.error(errorMessage(error));
          },
        }),
        defaultOptions: {
          queries: { retry: false, staleTime: 30_000, gcTime: 300_000 },
          mutations: { retry: false },
        },
      }),
  );
  useEffect(() => () => client.clear(), [client]);
  return (
    <QueryClientProvider client={client}>
      <RefreshClient.Provider value={client}>
        <Search.Provider value={{ search, setSearch }}>{children}</Search.Provider>
      </RefreshClient.Provider>
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
  const refresh = async () => {
    // Native editor sheets remain mounted while dismissing. Mark their snapshots stale,
    // but do not refetch a just-trashed record until the editor is opened again.
    await client.invalidateQueries({ queryKey: ["tasks"], refetchType: "none" });
    await client.refetchQueries({
      queryKey: ["tasks"],
      type: "active",
      predicate: ({ queryKey }) => queryKey[1] !== "detail" && queryKey[1] !== "container",
    });
  };
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  async function run<T>(
    label: string,
    action: () => Promise<T>,
    onSuccess?: (value: T) => void,
    onError?: (error: unknown) => void,
    feedback?: (value: T) => { message: string; error?: boolean },
    undo?: (value: T) => Promise<unknown>,
  ) {
    if (lock.current) return false;
    lock.current = true;
    setPending(true);
    const id = toast.loading(label);
    try {
      const value = await action();
      refreshDueAlerts();
      const result = feedback?.(value);
      let used = false;
      const undoAction = undo
        ? {
            label: "Undo",
            onClick: () => {
              if (used) return;
              used = true;
              const undoId = toast.loading("Undoing…");
              void undo(value)
                .then(() => toast.success("Action undone", { id: undoId }))
                .catch((error: unknown) => toast.error(errorMessage(error), { id: undoId }))
                .finally(() => {
                  refreshDueAlerts();
                  void refresh();
                });
            },
          }
        : undefined;
      const options = { id, action: undoAction, duration: undoAction ? 10000 : undefined };
      if (result?.error) toast.error(result.message, options);
      else toast.success(result?.message ?? "Saved", options);
      onSuccess?.(value);
      await refresh();
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
