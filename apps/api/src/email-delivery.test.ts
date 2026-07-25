import { createEmailDelivery } from "./email-delivery.js";

const message = {
  html: "<p>Welcome</p>",
  subject: "Welcome to ilo",
  text: "Welcome",
  to: "friend@example.com",
};

describe("email delivery", () => {
  it("logs a safe local-development skip when Resend is not configured", async () => {
    const log = vi.fn();
    const delivery = createEmailDelivery({ from: "", log, resendApiKey: "" });

    await delivery.send(message);

    expect(log).toHaveBeenCalledWith({
      event: "email_delivery_skipped",
      recipient: message.to,
      subject: message.subject,
    });
  });

  it("sends the transactional message through Resend", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const delivery = createEmailDelivery({
      from: "ilo <hello@ilo.coopersully.me>",
      resendApiKey: "resend-test-key",
    });

    await delivery.send(message);

    expect(request).toHaveBeenCalledWith("https://api.resend.com/emails", {
      body: JSON.stringify({
        from: "ilo <hello@ilo.coopersully.me>",
        html: message.html,
        subject: message.subject,
        text: message.text,
        to: [message.to],
      }),
      headers: {
        authorization: "Bearer resend-test-key",
        "content-type": "application/json",
      },
      method: "POST",
    });
    request.mockRestore();
  });

  it("normalizes Resend failures without exposing provider details", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("provider detail", { status: 503 }));
    const delivery = createEmailDelivery({
      from: "ilo <hello@ilo.coopersully.me>",
      resendApiKey: "resend-test-key",
    });

    await expect(delivery.send(message)).rejects.toMatchObject({
      code: "service_unavailable",
      message: "Account email could not be delivered.",
    });
    request.mockRestore();
  });
});
