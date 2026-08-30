import { readBoundedRequestBody } from "./request-body.js";

describe("bounded request bodies", () => {
  it("accepts an empty body even when content length is not numeric", async () => {
    const request = new Request("https://api.example.com/webhook", {
      headers: { "content-length": "unknown" },
    });
    await expect(readBoundedRequestBody(request, 16)).resolves.toBe("");
  });
});
