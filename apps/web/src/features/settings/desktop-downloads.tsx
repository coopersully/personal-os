import { DownloadIcon, MonitorIcon } from "@/components/icons";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "../../components/ui/item.js";

export type DesktopDownloads = {
  macos: string | null;
  windows: string | null;
};

type DesktopPlatform = keyof DesktopDownloads | null;

type DesktopDownloadEnvironment = {
  VITE_DESKTOP_DOWNLOAD_MACOS_URL?: string;
  VITE_DESKTOP_DOWNLOAD_WINDOWS_URL?: string;
};

function downloadUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function configuredDesktopDownloads(
  environment: DesktopDownloadEnvironment = import.meta.env as DesktopDownloadEnvironment,
): DesktopDownloads {
  return {
    macos: downloadUrl(environment.VITE_DESKTOP_DOWNLOAD_MACOS_URL),
    windows: downloadUrl(environment.VITE_DESKTOP_DOWNLOAD_WINDOWS_URL),
  };
}

export function hasDesktopDownloads(downloads = configuredDesktopDownloads()) {
  return Boolean(downloads.macos || downloads.windows);
}

export function detectedDesktopPlatform(userAgent: string): DesktopPlatform {
  if (/Windows/i.test(userAgent)) return "windows";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "macos";
  return null;
}

function platformName(platform: Exclude<DesktopPlatform, null>) {
  return platform === "macos" ? "macOS" : "Windows";
}

function platformDescription(platform: Exclude<DesktopPlatform, null>) {
  return platform === "macos" ? "For Macs with Apple silicon." : "For 64-bit Windows PCs.";
}

export function DesktopDownloadsSettings({
  downloads = configuredDesktopDownloads(),
  userAgent = navigator.userAgent,
}: {
  downloads?: DesktopDownloads;
  userAgent?: string;
}) {
  const detected = detectedDesktopPlatform(userAgent);
  const recommended = detected && downloads[detected] ? detected : null;
  const alternatives = (Object.keys(downloads) as Array<Exclude<DesktopPlatform, null>>).filter(
    (platform) => downloads[platform] && platform !== recommended,
  );

  if (!hasDesktopDownloads(downloads)) return null;

  return (
    <Card className="settings-section" size="sm">
      <CardHeader>
        <CardTitle>
          <h2>Desktop app</h2>
        </CardTitle>
        <CardDescription>
          Use ilo in a dedicated desktop window. The installer connects to this deployment.
        </CardDescription>
      </CardHeader>
      <CardContent className="settings-section__body">
        <ItemGroup>
          {recommended ? (
            <DownloadItem
              platform={recommended}
              recommended
              url={downloads[recommended] as string}
            />
          ) : null}
          {alternatives.map((platform) => (
            <DownloadItem key={platform} platform={platform} url={downloads[platform] as string} />
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  );
}

function DownloadItem({
  platform,
  recommended = false,
  url,
}: {
  platform: Exclude<DesktopPlatform, null>;
  recommended?: boolean;
  url: string;
}) {
  const name = platformName(platform);
  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <MonitorIcon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{recommended ? `Recommended for ${name}` : `ilo for ${name}`}</ItemTitle>
        <ItemDescription>{platformDescription(platform)}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button asChild size="sm">
          <a href={url}>
            Download
            <DownloadIcon data-icon="inline-end" />
          </a>
        </Button>
      </ItemActions>
    </Item>
  );
}
