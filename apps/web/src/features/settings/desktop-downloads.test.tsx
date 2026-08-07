// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  configuredDesktopDownloads,
  DesktopDownloadsSettings,
  detectedDesktopPlatform,
} from "./desktop-downloads.js";

describe("desktop download settings", () => {
  it("selects the matching installer from the browser platform", () => {
    expect(detectedDesktopPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(detectedDesktopPlatform("Mozilla/5.0 (Macintosh; Apple Silicon Mac OS X 15_0)")).toBe(
      "macos",
    );
    expect(detectedDesktopPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBeNull();
  });

  it("renders only configured HTTPS installers and recommends the matching one", () => {
    render(
      <DesktopDownloadsSettings
        downloads={{
          macos: "https://downloads.example.com/ilo-macos.dmg",
          windows: "https://downloads.example.com/ilo-windows.exe",
        }}
        userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      />,
    );

    expect(screen.getByText("Recommended for Windows")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Download" })[0]).toHaveAttribute(
      "href",
      "https://downloads.example.com/ilo-windows.exe",
    );
    expect(screen.getByText("ilo for macOS")).toBeInTheDocument();
  });

  it("does not expose malformed or insecure configured links", () => {
    expect(
      configuredDesktopDownloads({
        VITE_DESKTOP_DOWNLOAD_MACOS_URL: "javascript:alert(1)",
        VITE_DESKTOP_DOWNLOAD_WINDOWS_URL: "http://downloads.example.com/ilo.exe",
      }),
    ).toEqual({ macos: null, windows: null });
  });
});
