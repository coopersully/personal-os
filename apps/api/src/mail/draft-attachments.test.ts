import { expect, it, vi } from "vitest";
import { resolveDraftAttachments } from "./draft-attachments.js";

const file = {
  id: "11111111-1111-4111-8111-111111111111",
  filename: "notes.txt",
  contentType: "text/plain",
  size: 4,
  data: "dGVzdA==",
};
it("persists uploaded bytes and preserves attachments for older clients", async () => {
  const download = vi.fn();
  expect(await resolveDraftAttachments([file], [], download)).toEqual([file]);
  expect(await resolveDraftAttachments(undefined, [file], download)).toEqual([file]);
  expect(await resolveDraftAttachments([], [file], download)).toEqual([]);
  expect(download).not.toHaveBeenCalled();
});
it("resolves retained IDs only within the current draft", async () => {
  const { data: _data, ...metadata } = file;
  expect(await resolveDraftAttachments([metadata], [file], vi.fn())).toEqual([file]);
  await expect(resolveDraftAttachments([metadata], [], vi.fn())).rejects.toThrow("not part");
});
it("copies original attachments through the authorized download boundary", async () => {
  const { data: _data, ...metadata } = file;
  const download = vi.fn().mockResolvedValue(file);
  const source = { messageId: "22222222-2222-4222-8222-222222222222", attachmentId: file.id };
  expect(await resolveDraftAttachments([{ ...metadata, source }], [], download)).toEqual([file]);
  expect(download).toHaveBeenCalledWith(
    source.messageId,
    source.attachmentId,
    expect.any(AbortSignal),
  );
  download.mockRejectedValue(new Error("Not found"));
  await expect(resolveDraftAttachments([{ ...metadata, source }], [], download)).rejects.toThrow(
    "Not found",
  );
});
it("rejects forged sizes, invalid bytes, duplicates and oversized totals", async () => {
  await expect(resolveDraftAttachments([{ ...file, size: 3 }], [], vi.fn())).rejects.toThrow(
    "invalid",
  );
  await expect(resolveDraftAttachments([{ ...file, data: "!!!!" }], [], vi.fn())).rejects.toThrow();
  await expect(resolveDraftAttachments([file, file], [], vi.fn())).rejects.toThrow();
  await expect(
    resolveDraftAttachments([{ ...file, size: 11 * 1024 * 1024 }], [], vi.fn()),
  ).rejects.toThrow();
});
it("does not trust source metadata or override immutable saved bytes", async () => {
  const download = vi.fn().mockResolvedValue({ ...file, size: 3 });
  const { data: _data, ...metadata } = file;
  await expect(
    resolveDraftAttachments(
      [{ ...metadata, source: { messageId: file.id, attachmentId: file.id } }],
      [],
      download,
    ),
  ).rejects.toThrow("invalid");
  expect(await resolveDraftAttachments([{ ...file, data: "ZXZpbA==" }], [file], download)).toEqual([
    file,
  ]);
});
