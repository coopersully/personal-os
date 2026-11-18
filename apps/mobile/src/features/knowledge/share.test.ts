import type { KnowledgePage } from "@personal-os/domain";
import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  platform: { OS: "ios" },
  share: vi.fn(),
  files: [] as { name: string; text?: string; exists: boolean; uri: string }[],
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "cache" },
  File: class {
    name: string;
    text?: string;
    exists = false;
    uri: string;
    constructor(_: string, name: string) {
      this.name = name;
      this.uri = `file:///cache/${name}`;
      h.files.push(this);
    }
    write(text: string) {
      this.text = text;
      this.exists = true;
    }
    delete() {
      this.exists = false;
    }
  },
}));
vi.mock("react-native", () => ({
  Platform: h.platform,
  Share: { share: h.share, sharedAction: "sharedAction", dismissedAction: "dismissedAction" },
}));

const { memoryShareAvailable, shareMemoryPage } = await import("./share");
const data: KnowledgePage = {
  schemaVersion: 1,
  items: [],
  nextCursor: null,
  epoch: 1,
  state: "available",
};

beforeEach(() => {
  h.platform.OS = "ios";
  h.files = [];
  h.share.mockReset();
});

it("shares_one_export_page_as_a_file_and_removes_it", async () => {
  expect(memoryShareAvailable()).toBe(true);
  h.share.mockResolvedValue({ action: "sharedAction" });
  await expect(shareMemoryPage(data, 2, () => true)).resolves.toBe(true);
  expect(h.share).toHaveBeenCalledWith({
    title: "nohmi memory export",
    url: "file:///cache/nohmi-memory-2-uuid.json",
  });
  expect(JSON.parse(h.files[0]?.text ?? "")).toEqual(data);
  expect(h.files[0]?.exists).toBe(false);
});

it("a_dismissed_or_abandoned_share_reports_nothing_shared", async () => {
  h.share.mockResolvedValue({ action: "dismissedAction" });
  await expect(shareMemoryPage(data, 1, () => true)).resolves.toBe(false);
  await expect(shareMemoryPage(data, 1, () => false)).resolves.toBe(false);
  let calls = 0;
  await expect(shareMemoryPage(data, 1, () => calls++ === 0)).resolves.toBe(false);
  expect(h.files.every((file) => !file.exists)).toBe(true);
});

it("sharing_is_unavailable_off_ios", () => {
  h.platform.OS = "android";
  expect(memoryShareAvailable()).toBe(false);
});
