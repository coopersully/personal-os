import type { KnowledgePage } from "@personal-os/domain";
import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  platform: { OS: "ios" },
  share: vi.fn(),
  files: [] as { name: string; text?: string; exists: boolean; uri: string }[],
  /** Each write settles when the test says so, as Expo's asynchronous File.write does. */
  write: undefined as Promise<void> | undefined,
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
    async write(text: string) {
      this.exists = true;
      await h.write;
      this.text = text;
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
  h.write = undefined;
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

it("shares_only_after_the_file_is_written", async () => {
  let written!: () => void;
  h.write = new Promise((done) => (written = done));
  h.share.mockResolvedValue({ action: "sharedAction" });
  const shared = shareMemoryPage(data, 1, () => true);
  await Promise.resolve();
  expect(h.share).not.toHaveBeenCalled();
  written();
  await expect(shared).resolves.toBe(true);
  expect(JSON.parse(h.files[0]?.text ?? "")).toEqual(data);
});

it("a_failed_write_rejects_without_opening_the_share_sheet", async () => {
  h.write = Promise.reject(new Error("disk full"));
  h.write.catch(() => {});
  await expect(shareMemoryPage(data, 1, () => true)).rejects.toThrow("disk full");
  expect(h.share).not.toHaveBeenCalled();
  expect(h.files[0]?.exists).toBe(false);
});
