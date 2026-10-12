export type DesktopRelease = {
  version: string;
  publishedAt: string;
  notes: string;
  releaseUrl: string;
  installers: { architecture: "aarch64" | "x86_64"; url: string }[];
};
export type DesktopReleaseStatus = {
  status: "available" | "not_published" | "unavailable" | "disabled";
  release: DesktopRelease | null;
};
