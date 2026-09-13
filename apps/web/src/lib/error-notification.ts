import { useEffect } from "react";
import { toast } from "sonner";
import { errorMessage } from "../api.js";

export function notifyError(error: unknown) {
  const message = errorMessage(error);
  toast.error(message, { id: `application-error:${message}` });
}

export function useErrorNotification(error: unknown) {
  const message = error ? errorMessage(error) : null;
  useEffect(() => {
    if (message) toast.error(message, { id: `application-error:${message}` });
  }, [message]);
}
