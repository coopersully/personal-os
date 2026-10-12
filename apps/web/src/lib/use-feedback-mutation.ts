import {
  type MutateOptions,
  type MutationFunctionContext,
  type QueryClient,
  type UseMutationOptions,
  useMutation,
} from "@tanstack/react-query";
import { useContext, useId, useMemo, useRef } from "react";
import { toast } from "sonner";
import { classifyMutationError, type FeedbackOptions } from "./feedback.js";

import { SettingsFeedbackContext } from "./settings-feedback.js";

type Attempt<T> = { toastId: string; callerContext: T | undefined; preparationFailed: boolean };

export function useFeedbackMutation<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TOnMutateResult = unknown,
>(
  {
    feedback: options,
    ...mutationOptions
  }: UseMutationOptions<TData, TError, TVariables, TOnMutateResult> & { feedback: FeedbackOptions },
  queryClient?: QueryClient,
) {
  const settingsFeedback = useContext(SettingsFeedbackContext);
  const operationId = useId();
  const sequence = useRef(0);
  const latest = useRef<Attempt<TOnMutateResult> | null>(null);
  // React Query does not retain an onMutate result when that callback rejects.
  // Its execution context still identifies the attempt in onError/onSettled.
  const preparing = useRef(new WeakMap<MutationFunctionContext, Attempt<TOnMutateResult>>());
  const mutation = useMutation<TData, TError, TVariables, Attempt<TOnMutateResult>>(
    {
      ...mutationOptions,
      // Uncertain writes must never be retried automatically.
      ...(options.safeToRetry ? {} : { retry: false }),
      onMutate: async (variables, context) => {
        if (latest.current) toast.dismiss(latest.current.toastId);
        const attempt: Attempt<TOnMutateResult> = {
          toastId: `${operationId}-${++sequence.current}`,
          callerContext: undefined,
          preparationFailed: false,
        };
        latest.current = attempt;
        if (options.pending) toast.loading(options.pending, { id: attempt.toastId });
        preparing.current.set(context, attempt);
        try {
          attempt.callerContext = await mutationOptions.onMutate?.(variables, context);
          return attempt;
        } catch (error) {
          attempt.preparationFailed = true;
          // Preserve the original rejection and prevent mutationFn from running.
          throw error;
        }
      },
      onError: (error, variables, result, context) => {
        const attempt = result ?? preparing.current.get(context);
        const failure = classifyMutationError(error, {
          ...options,
          ...(attempt?.preparationFailed ? { safeToRetry: true } : {}),
        });
        if (
          attempt === latest.current &&
          (settingsFeedback || options.pending || !failure.persistent)
        )
          toast.error(failure.message, {
            id: attempt?.toastId,
            duration: Number.POSITIVE_INFINITY,
          });
        return mutationOptions.onError?.(error, variables, attempt?.callerContext, context);
      },
      onSuccess: async (data, variables, attempt, context) => {
        try {
          // TanStack permits omitting onMutate even when a context generic is supplied.
          await mutationOptions.onSuccess?.(
            data,
            variables,
            attempt?.callerContext as TOnMutateResult,
            context,
          );
          if (attempt !== latest.current) return;
          if (options.success)
            toast.success(options.success, {
              id: attempt?.toastId,
              ...(options.successDescription ? { description: options.successDescription } : {}),
            });
          else toast.dismiss(attempt?.toastId);
        } catch {
          if (attempt !== latest.current) return;
          toast.error(
            "The change was saved, but the view couldn’t refresh. Refresh the page to see the latest state.",
            { id: attempt?.toastId, duration: Number.POSITIVE_INFINITY },
          );
        }
      },
      onSettled: async (data, error, variables, result, context) => {
        const attempt = result ?? preparing.current.get(context);
        try {
          await mutationOptions.onSettled?.(
            data,
            error,
            variables,
            attempt?.callerContext,
            context,
          );
        } finally {
          preparing.current.delete(context);
        }
      },
    },
    queryClient,
  );
  const preparationFailed = latest.current?.preparationFailed ?? false;
  const feedback = useMemo(
    () =>
      mutation.isError
        ? classifyMutationError(mutation.error, {
            action: options.action,
            form: Boolean(options.form),
            safeToRetry: preparationFailed || Boolean(options.safeToRetry),
          })
        : null,
    [
      mutation.isError,
      mutation.error,
      options.action,
      options.form,
      options.safeToRetry,
      preparationFailed,
    ],
  );
  function callbacks(
    caller?: MutateOptions<TData, TError, TVariables, TOnMutateResult>,
  ): MutateOptions<TData, TError, TVariables, Attempt<TOnMutateResult>> | undefined {
    if (!caller) return undefined;
    return {
      onSuccess: (data, variables, attempt, context) =>
        caller.onSuccess?.(data, variables, attempt?.callerContext, context),
      onError: (error, variables, attempt, context) =>
        caller.onError?.(error, variables, attempt?.callerContext, context),
      onSettled: (data, error, variables, attempt, context) =>
        caller.onSettled?.(data, error, variables, attempt?.callerContext, context),
    };
  }
  return {
    ...mutation,
    context: mutation.context?.callerContext,
    mutate: (
      variables: TVariables,
      caller?: MutateOptions<TData, TError, TVariables, TOnMutateResult>,
    ) => mutation.mutate(variables, callbacks(caller)),
    mutateAsync: (
      variables: TVariables,
      caller?: MutateOptions<TData, TError, TVariables, TOnMutateResult>,
    ) => mutation.mutateAsync(variables, callbacks(caller)),
    feedback,
  };
}
