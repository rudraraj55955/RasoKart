/**
 * Connector Engine — Core Dispatch Layer
 *
 * ConnectorEngine wraps the adapter registry and provides:
 *   - Adapter lookup with fail-closed fallback for unregistered providers
 *   - Session token lifecycle (encrypt/decrypt/validate)
 *   - Unified error handling that never fabricates CONNECTED status
 *   - Logging for every session state transition
 *
 * The engine is instantiated as a singleton (export const engine).
 * All portalSessions routes call methods on this singleton.
 *
 * SECURITY INVARIANTS:
 *   - encryptedSessionToken is NEVER logged at any level
 *   - Status CONNECTED is set only when the adapter explicitly returns it
 *   - Any exception from an adapter method returns status FAILED, never CONNECTED
 *   - The engine itself has no write access to the DB; callers write DB rows
 */

import { getAdapter, isPortalProvider } from "./adapters/registry";
import {
  encryptSessionPayload,
  decryptSessionToken,
  makeSessionPayload,
  type SessionPayload,
} from "./sessionCrypto";
import type {
  PortalSessionStatus,
  InitiateParams,
  InitiateResult,
  SubmitStepParams,
  SubmitStepResult,
  ValidateResult,
  DiscoveryResult,
  FetchTransactionsParams,
  FetchTransactionsResult,
  HealthCheckResult,
} from "./types";
import { logger } from "../../lib/logger";

// Re-export types for route convenience
export type {
  PortalSessionStatus,
  InitiateParams,
  InitiateResult,
  SubmitStepParams,
  SubmitStepResult,
  ValidateResult,
  DiscoveryResult,
  FetchTransactionsParams,
  FetchTransactionsResult,
  HealthCheckResult,
};

export { isPortalProvider, getAdapter };

export class ConnectorEngine {
  /**
   * Initiate a new portal session.
   * Returns the adapter's result directly. If no adapter is registered,
   * returns BLOCKED with a clear message.
   */
  async initiateSession(
    slug: string,
    connectionId: number,
    params: InitiateParams,
  ): Promise<InitiateResult> {
    const adapter = getAdapter(slug);
    if (!adapter) {
      return {
        status: "BLOCKED",
        failReason: "NO_ADAPTER_REGISTERED",
        failDetail: `No connector adapter is registered for provider "${slug}". ` +
          `This provider requires a custom adapter implementation before portal ` +
          `sessions can be initiated.`,
      };
    }

    try {
      logger.info({ slug, connectionId, loginMethod: params.loginMethod },
        "connector_engine_initiate_session");
      const result = await adapter.initiateSession(params);

      // Build and encrypt a session token if the adapter produced adapter data
      // (i.e. the provider returned a partial session state to continue from)
      if (result.status !== "PARTNER_API_REQUIRED" && result.status !== "BLOCKED" &&
          result.status !== "FAILED" && !result.encryptedSessionToken) {
        // Adapter returned an in-progress status without a token — wrap a placeholder
        const payload = makeSessionPayload(slug, connectionId, {
          step: result.nextStep ?? "PENDING",
        });
        const enc = encryptSessionPayload(payload);
        if (enc.ok) result.encryptedSessionToken = enc.token;
      }

      logger.info({ slug, connectionId, status: result.status },
        "connector_engine_session_initiated");
      return result;
    } catch (err: any) {
      logger.error({ slug, connectionId, err: err?.message }, "connector_engine_initiate_error");
      return {
        status: "FAILED",
        failReason: "ADAPTER_ERROR",
        failDetail: "The adapter encountered an unexpected error. " +
          "No session was created. Check server logs for details.",
      };
    }
  }

  /**
   * Submit OTP / password / CAPTCHA for a pending session.
   */
  async submitStep(
    slug: string,
    connectionId: number,
    encryptedToken: string,
    params: Omit<SubmitStepParams, "encryptedSessionToken">,
  ): Promise<SubmitStepResult> {
    const adapter = getAdapter(slug);
    if (!adapter) {
      return {
        status: "BLOCKED",
        failReason: "NO_ADAPTER_REGISTERED",
      };
    }

    try {
      const result = await adapter.submitStep({
        encryptedSessionToken: encryptedToken,
        ...params,
      });
      logger.info({ slug, connectionId, status: result.status },
        "connector_engine_step_submitted");
      return result;
    } catch (err: any) {
      logger.error({ slug, connectionId, err: err?.message }, "connector_engine_step_error");
      return {
        status: "FAILED",
        failReason: "ADAPTER_ERROR",
        failDetail: "Step submission failed. Please retry the connection.",
      };
    }
  }

  /**
   * Validate an existing session token.
   */
  async validateSession(
    slug: string,
    connectionId: number,
    encryptedToken: string,
  ): Promise<ValidateResult> {
    const adapter = getAdapter(slug);
    if (!adapter) {
      return { valid: false, reason: "NO_ADAPTER_REGISTERED" };
    }

    // First check token decryptability
    const dec = decryptSessionToken(encryptedToken);
    if (!dec.ok) {
      return { valid: false, reason: dec.reason };
    }

    try {
      const result = await adapter.validateSession(encryptedToken);
      logger.info({ slug, connectionId, valid: result.valid }, "connector_engine_session_validated");
      return result;
    } catch (err: any) {
      logger.error({ slug, connectionId, err: err?.message }, "connector_engine_validate_error");
      return { valid: false, reason: "ADAPTER_ERROR" };
    }
  }

  /**
   * Discover merchants, stores, devices, and QR codes.
   */
  async discoverEntities(
    slug: string,
    connectionId: number,
    encryptedToken: string,
  ): Promise<DiscoveryResult> {
    const adapter = getAdapter(slug);
    if (!adapter) {
      return { entities: [] };
    }
    try {
      const result = await adapter.discoverEntities(encryptedToken);
      logger.info({ slug, connectionId, entityCount: result.entities.length },
        "connector_engine_discovery_complete");
      return result;
    } catch (err: any) {
      logger.error({ slug, connectionId, err: err?.message }, "connector_engine_discovery_error");
      return { entities: [] };
    }
  }

  /**
   * Fetch and normalise transactions.
   */
  async fetchTransactions(
    slug: string,
    connectionId: number,
    encryptedToken: string,
    params: Omit<FetchTransactionsParams, "encryptedSessionToken">,
  ): Promise<FetchTransactionsResult> {
    const adapter = getAdapter(slug);
    if (!adapter) {
      return { transactions: [], hasMore: false };
    }
    try {
      const result = await adapter.fetchTransactions({
        encryptedSessionToken: encryptedToken,
        ...params,
      });
      logger.info({
        slug, connectionId,
        count: result.transactions.length,
        hasMore: result.hasMore,
      }, "connector_engine_transactions_fetched");
      return result;
    } catch (err: any) {
      logger.error({ slug, connectionId, err: err?.message }, "connector_engine_fetch_error");
      return { transactions: [], hasMore: false };
    }
  }

  /**
   * Health check — does not require a valid session token.
   */
  async healthCheck(
    slug: string,
    connectionId: number,
    encryptedToken?: string,
  ): Promise<HealthCheckResult> {
    const adapter = getAdapter(slug);
    if (!adapter) {
      return {
        healthy: false,
        status: "BLOCKED",
        reason: "NO_ADAPTER_REGISTERED",
        detail: `No connector adapter registered for "${slug}".`,
      };
    }
    try {
      return await adapter.healthCheck(encryptedToken);
    } catch (err: any) {
      logger.error({ slug, connectionId, err: err?.message }, "connector_engine_health_error");
      return { healthy: false, status: "FAILED", reason: "ADAPTER_ERROR" };
    }
  }

  /**
   * Logout and invalidate session.
   */
  async logout(
    slug: string,
    connectionId: number,
    encryptedToken: string,
  ): Promise<void> {
    const adapter = getAdapter(slug);
    if (!adapter) return;
    try {
      await adapter.logout(encryptedToken);
      logger.info({ slug, connectionId }, "connector_engine_logout_complete");
    } catch (err: any) {
      // logout must not throw — log and continue
      logger.warn({ slug, connectionId, err: err?.message }, "connector_engine_logout_error_swallowed");
    }
  }

  /**
   * Decrypt a session token and return the payload (for internal use only).
   * NEVER call this in a route response path.
   */
  decryptToken(token: string): SessionPayload | null {
    const result = decryptSessionToken(token);
    return result.ok ? result.payload : null;
  }

  /**
   * Encrypt a session payload into a storable token.
   */
  encryptPayload(payload: SessionPayload): string | null {
    const result = encryptSessionPayload(payload);
    return result.ok ? result.token : null;
  }
}

/** Singleton engine instance used by all portalSessions routes. */
export const engine = new ConnectorEngine();
