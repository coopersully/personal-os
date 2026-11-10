import type { createApiClient } from "@personal-os/api-client";
import type { UpdateUserInput } from "@personal-os/domain";
import { type QueryKey, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner-native";
import { holdReadFeedback } from "../../components/read-feedback-scope";
import { useAuth } from "../auth/context";
import { errorMessage } from "../tasks/data";
export type SettingsApi = ReturnType<typeof createApiClient>;

/** Each captured API checks the live human session before and after transport. */
export function useSettingsResource<T>(
  key: string,
  load: (api: SettingsApi) => Promise<T>,
  enabled = true,
  scopedReadFeedback = false,
) {
  const { state, session } = useAuth();
  const owner = state.user?.id;
  const epoch = session.epoch();
  return useQuery({
    queryKey: ["settings", owner, epoch, key],
    meta: { scopedReadFeedback },
    queryFn: () => {
      if (!owner || epoch !== session.epoch()) throw new Error("Your session changed.");
      return load(session.api());
    },
    enabled: !!owner && enabled,
    retry: false,
  });
}
export function useSettingsAction() {
  const { state, session } = useAuth();
  const scope = { owner: state.user?.id, epoch: session.epoch() };
  const current = useRef(scope);
  current.current = scope;
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const run = async <T>(
    action: (api: SettingsApi) => Promise<T>,
    success?: string | ((value: T) => string),
    loadingLabel = "Working…",
  ): Promise<{ ok: true; value: T } | { ok: false }> => {
    if (
      busy.current ||
      !scope.owner ||
      scope.owner !== current.current.owner ||
      scope.epoch !== session.epoch()
    )
      return { ok: false };
    busy.current = true;
    setPending(true);
    const captured = scope;
    const id = success ? toast.loading(loadingLabel) : undefined;
    try {
      const result = await action(session.api());
      if (captured.owner !== current.current.owner || captured.epoch !== session.epoch()) {
        if (id) toast.dismiss(id);
        return { ok: false };
      }
      if (success) toast.success(typeof success === "function" ? success(result) : success, { id });
      return { ok: true, value: result };
    } catch (error) {
      if (captured.owner === current.current.owner && captured.epoch === session.epoch())
        toast.error(errorMessage(error), { id });
      else if (id) toast.dismiss(id);
      return { ok: false };
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return { pending, run };
}
/** Own exact mounted reads through settlement. Native pull refresh uses spinner/errors only. */
export function useSettingsRefresh(
  queryKeys: readonly QueryKey[],
  refetches: readonly (() => Promise<unknown>)[],
  confirmedMessage: string,
  mode: "spinner" | "action" = "spinner",
) {
  const client = useQueryClient();
  const action = useSettingsAction();
  const refresh = () =>
    action.run(
      async () => {
        const queries = queryKeys.flatMap((queryKey) =>
          client.getQueryCache().findAll({ queryKey, exact: true }),
        );
        const release = holdReadFeedback(queries);
        try {
          const results = await Promise.allSettled(
            refetches.map((refetch) => Promise.resolve().then(refetch)),
          );
          for (const result of results) {
            if (result.status === "rejected") throw result.reason;
            if (
              result.value &&
              typeof result.value === "object" &&
              "error" in result.value &&
              result.value.error
            )
              throw result.value.error;
          }
        } finally {
          release();
        }
      },
      mode === "action" ? confirmedMessage : undefined,
      "Refreshing…",
    );
  return { refresh, pending: action.pending };
}
const userQueues = new WeakMap<object, Promise<unknown>>();
export function useUserSettings() {
  const { state, session } = useAuth();
  const query = useQueryClient();
  const action = useSettingsAction();
  const save = (input: UpdateUserInput, success?: string) =>
    action.run(async (api) => {
      const epoch = session.epoch();
      const previous = userQueues.get(session) ?? Promise.resolve();
      const operation = previous
        .catch(() => {})
        .then(async () => {
          const user = await api.updateUser(input);
          if (!session.acceptUserUpdate(user, epoch)) throw new Error("Your session changed.");
          await query.invalidateQueries({ queryKey: ["settings", user.id] });
          return user;
        });
      userQueues.set(session, operation);
      return operation;
    }, success);
  return { user: state.user, save, pending: action.pending };
}
