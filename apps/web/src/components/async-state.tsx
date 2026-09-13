import { errorMessage } from "../api.js";
import { useErrorNotification } from "../lib/error-notification.js";
import { WorkspaceSkeleton, type WorkspaceSkeletonKind } from "./workspace-skeleton.js";

export function PageLoading({ workspace = "generic" }: { workspace?: WorkspaceSkeletonKind }) {
  return <WorkspaceSkeleton kind={workspace} />;
}

export function InlineError({ error }: { error: unknown }) {
  useErrorNotification(error);
  return (
    <div className="inline-error" role="alert">
      <strong>Couldn’t load this material.</strong>
      <span>{errorMessage(error)}</span>
    </div>
  );
}
