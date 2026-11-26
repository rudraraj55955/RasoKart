import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deliveryEventsPath,
  displayableTimelineEvent,
  getDeliveryTimelineState,
  type DeliveryTimelineEvent,
} from "./email-delivery-timeline";

const event: DeliveryTimelineEvent = {
  id: 91,
  provider: "MSG91",
  providerMessageId: "provider-message-91",
  providerEventId: "provider-event-91",
  status: "bounced",
  failureSummary: "Mailbox unavailable",
  receivedAt: "2026-09-16T10:01:00.000Z",
};

describe("password-reset callback timeline regression contract", () => {
  it("builds a distinct callback endpoint for every delivery row", () => {
    assert.equal(deliveryEventsPath(41), "/api/admin/email-delivery/41/events");
    assert.equal(deliveryEventsPath(42), "/api/admin/email-delivery/42/events");
    assert.notEqual(deliveryEventsPath(41), deliveryEventsPath(42));
  });

  it("covers loading, populated, empty, and retryable error states", () => {
    assert.deepEqual(getDeliveryTimelineState(true, null, []), { kind: "loading" });
    assert.deepEqual(getDeliveryTimelineState(false, null, [event]), {
      kind: "populated",
      events: [event],
    });
    assert.deepEqual(getDeliveryTimelineState(false, null, []), { kind: "empty" });
    assert.deepEqual(getDeliveryTimelineState(false, "Temporary provider error", []), {
      kind: "error",
      message: "Temporary provider error",
      retryable: true,
    });
  });

  it("allows only sanitized provider callback details into the rendered event model", () => {
    const sourceWithSecrets = {
      ...event,
      recipient: "recipient@example.test",
      resetToken: "reset-token-secret",
      message: "Your reset code is 123456",
      payload: { html: "<strong>secret reset message</strong>" },
    };
    const display = displayableTimelineEvent(sourceWithSecrets);

    assert.deepEqual(Object.keys(display).sort(), [
      "failureSummary",
      "provider",
      "providerEventId",
      "providerMessageId",
      "receivedAt",
      "status",
    ]);
    const rendered = JSON.stringify(display);
    assert.equal(rendered.includes("recipient@example.test"), false);
    assert.equal(rendered.includes("reset-token-secret"), false);
    assert.equal(rendered.includes("123456"), false);
    assert.equal(rendered.includes("secret reset message"), false);
  });
});