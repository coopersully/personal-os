import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { MouseEvent } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { api } from "../../api.js";
import { isDesktop } from "./bridge.js";
import { DesktopUpdates } from "./updates.js";

function openRelease(event: MouseEvent<HTMLAnchorElement>) {
  if (!isDesktop()) return;
  event.preventDefault();
  void openUrl(event.currentTarget.href).catch(() =>
    toast.error("Could not open the download in your browser"),
  );
}
export function DesktopDownloads({ standalone = false }: { standalone?: boolean }) {
  const query = useQuery({
    queryKey: ["desktop-release"],
    queryFn: api.getDesktopRelease,
    staleTime: 300_000,
    retry: false,
  });
  const release = query.data?.release;
  const content = (
    <Card>
      <CardHeader>
        <CardTitle>nohmi for Mac</CardTitle>
        <CardDescription>
          {release
            ? `Version ${release.version} · macOS 14 or later`
            : "Your rituals, widgets and workspaces on your desktop"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {query.isPending ? <p role="status">Finding the latest release</p> : null}
        {query.isError || query.data?.status === "unavailable" ? (
          <p role="alert">
            Downloads are temporarily unavailable{" "}
            <Button variant="ghost" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </p>
        ) : null}
        {query.data?.status === "not_published" ? (
          <p role="status">The first signed desktop release is being prepared</p>
        ) : null}
        {query.data?.status === "disabled" ? (
          <p role="status">Ask your server operator for a matching desktop installer</p>
        ) : null}
        {release ? (
          <>
            <p>
              Install once. nohmi checks for updates when it opens and connects to your hosted nohmi
              account.
            </p>
            <ItemGroup>
              {release.installers.map((installer) => (
                <Item key={installer.architecture} variant="muted">
                  <ItemContent>
                    <ItemTitle>
                      {installer.architecture === "aarch64" ? "Apple Silicon" : "Intel"}
                    </ItemTitle>
                    <ItemDescription>
                      {installer.architecture === "aarch64"
                        ? "Mac with an M-series chip"
                        : "Mac with an Intel processor"}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button asChild>
                      <a
                        href={installer.url}
                        onClick={openRelease}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Download for{" "}
                        {installer.architecture === "aarch64" ? "Apple Silicon" : "Intel"}
                      </a>
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
            <p className="text-sm text-muted-foreground">
              Open the downloaded disk image and drag nohmi into Applications
            </p>
            <details>
              <summary>
                Release notes · {new Date(release.publishedAt).toLocaleDateString()}
              </summary>
              <p className="whitespace-pre-wrap break-words">
                {release.notes || "No release notes were provided"}
              </p>
            </details>
          </>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {release ? (
          <Button asChild variant="ghost">
            <a href={release.releaseUrl} onClick={openRelease} target="_blank" rel="noreferrer">
              View release on GitHub
            </a>
          </Button>
        ) : null}
        {standalone ? (
          <Button variant="ghost" asChild>
            <Link to="/today">Open nohmi</Link>
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
  return standalone ? (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      {isDesktop() ? <DesktopUpdates /> : null}
      {content}
    </main>
  ) : (
    content
  );
}
