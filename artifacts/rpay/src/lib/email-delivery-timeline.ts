export type DeliveryTimelineStatus = "accepted" | "delivered" | "bounced" | "failed";

export interface DeliveryTimelineEvent {
  id: number;
  provider: string;
  providerMessageId: string | null;
  providerEventId: string | null;
  status: DeliveryTimelineStatus;
  failureSummary: string | null;
  receivedAt: string;
}

export type DeliveryTimelineState =
  | { kind: "loading" }
  | { kind: "error"; message: string; retryable: true }
  | { kind: "empty" }
  | { kind: "populated"; events: DeliveryTimelineEvent[] };

export function deliveryEventsPath(deliveryId: number): string {
  return `/api/admin/email-delivery/${deliveryId}/events`;
}

export function getDeliveryTimelineState(
  loading: boolean,
  error: string | null,
  events: DeliveryTimelineEvent[],
): DeliveryTimelineState {
  if (loading) return { kind: "loading" };
  if (error) return { kind: "error", message: error, retryable: true };
  if (events.length === 0) return { kind: "empty" };
  return { kind: "populated", events };
}

export function displayableTimelineEvent(event: DeliveryTimelineEvent) {
  return {
    provider: event.provider,
    providerMessageId: event.providerMessageId,
    providerEventId: event.providerEventId,
    status: event.status,
    failureSummary: event.failureSummary,
    receivedAt: event.receivedAt,
  };
}