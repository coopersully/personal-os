import { conversationPreviewMode } from "./conversation-preview";

it("allows only explicitly requested loopback design previews", () => {
  expect(conversationPreviewMode(new URL("http://127.0.0.1/messages?preview=messages"))).toBe(
    "messages",
  );
  expect(
    conversationPreviewMode(new URL("http://localhost/tasks/messages?preview=messages-locked")),
  ).toBe("messages-locked");
  expect(
    conversationPreviewMode(new URL("https://nohmi.example/messages?preview=messages")),
  ).toBeNull();
  expect(conversationPreviewMode(new URL("http://localhost/messages"))).toBeNull();
});
