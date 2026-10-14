import { useQuery } from "@tanstack/react-query";
import { type CSSProperties, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ActionButton } from "@/components/action-button";
import { DownloadIcon } from "@/components/icons";
import { getDesktopSettings, isDesktop } from "./bridge";
import { restartForUpdate } from "./update-bridge";
import { useDesktopUpdateStatus } from "./updates";

/** A still of the bundled native creature, using its silhouette and selected color. */
function PetPortrait({ color }: { color: string }) {
  return (
    <span
      className="pet-portrait"
      aria-hidden="true"
      style={{ "--pet-color": color } as CSSProperties}
    >
      <span className="pet-portrait__body" />
      <span className="pet-portrait__ear pet-portrait__ear--left" />
      <span className="pet-portrait__ear pet-portrait__ear--right" />
      <span className="pet-portrait__eye pet-portrait__eye--left" />
      <span className="pet-portrait__eye pet-portrait__eye--right" />
    </span>
  );
}
export function DesktopRailUtilities() {
  const desktop = isDesktop();
  const status = useDesktopUpdateStatus();
  const settings = useQuery({
    queryKey: ["desktop-status"],
    queryFn: getDesktopSettings,
    enabled: desktop,
    refetchInterval: 30000,
  });
  const [installing, setInstalling] = useState(false);
  if (!desktop) return null;
  const update = status.data;
  const available =
    update?.availableVersion && ["downloading", "ready", "installing"].includes(update.phase);
  return (
    <>
      {available ? (
        <ActionButton
          className="workspace-rail__utility workspace-rail__update"
          variant="ghost"
          size="icon-sm"
          aria-label={`Install nohmi ${update.availableVersion}`}
          tooltip={
            update.phase === "ready"
              ? "Install update and restart"
              : update.phase === "downloading"
                ? "Downloading update"
                : "Installing update"
          }
          disabled={update.phase !== "ready" || installing}
          onClick={() => {
            setInstalling(true);
            const id = toast.loading("Installing update and restarting…");
            void restartForUpdate()
              .then(() => {
                toast.success("Update installation requested.", { id });
              })
              .catch(() => {
                toast.error("Couldn’t install the update. Open desktop settings to retry.", { id });
              })
              .finally(() => setInstalling(false));
          }}
        >
          <DownloadIcon aria-hidden="true" />
        </ActionButton>
      ) : null}
      {settings.data?.settings.petEnabled ? (
        <ActionButton
          asChild
          variant="ghost"
          size="icon-sm"
          className="workspace-rail__utility"
          tooltip="Pet settings"
        >
          <Link to="/settings?section=pet" aria-label="Pet settings">
            <PetPortrait color={settings.data.settings.petColor} />
          </Link>
        </ActionButton>
      ) : null}
    </>
  );
}
