import { Spinner } from "@personal-os/ui";
import { errorMessage } from "../api.js";

export function PageLoading() {
  return (
    <div className="page-loading">
      <Spinner />
    </div>
  );
}

export function InlineError({ error }: { error: unknown }) {
  return (
    <div className="inline-error" role="alert">
      <strong>Couldn’t load this material.</strong>
      <span>{errorMessage(error)}</span>
    </div>
  );
}
