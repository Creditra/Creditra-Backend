/**
 * Outbound webhook fan-out for confirmed draw events.
 *
 * Drives the protocol's "the chain saw your draw" notification path.
 * Subscriber URLs come from `WEBHOOK_URLS` (comma-separated) and the HMAC
 * secret from `WEBHOOK_SECRET`. Delivery settings include retry/backoff
 * controls exposed through the webhook config.
 *
 * Signature contract sent to subscribers:
 * - `X-Webhook-Signature: sha256=<hex HMAC over raw body>`
 * - `X-Webhook-Timestamp: <payload ISO timestamp>`
 * - `User-Agent: Creditra-Webhook/1.0`
 *
 * Subscribers must (a) re-compute the HMAC and compare in constant time,
 * (b) reject timestamps outside their tolerance window, and
 * (c) deduplicate by `data.drawId`. See `docs/webhook-subscribers.md`.
 */
import { createHmac } from "node:crypto";
import type { HorizonEvent } from "./horizonListener.js";
import { getWebhookDeliveryStateStore } from "./webhookDeliveryState.js";
import { redactLogArgs } from "../utils/logRedact.js";
import { createServiceLogger } from "../utils/serviceLogger.js";
import { duplicateResource } from "../errors/ConflictError.js";

const log = createServiceLogger("DrawWebhookService");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookPayload {
    /** Event type - always 'draw_confirmed' for this service */
    event: "draw_confirmed";
    /** Timestamp when the webhook was generated */
    timestamp: string;
    /** The original Horizon event that triggered this webhook */
    data: {
        ledger: number;
        contractId: string;
        drawAmount: string;
        drawId: string;
        borrowerWallet: string;
        creditLineId: string;
        horizonTimestamp: string;
    };
}

export interface WebhookConfig {
    /** Webhook endpoint URLs (comma-separated) */
    urls: string[];
    /** HMAC secret for signing payloads */
    secret: string;
    /** Maximum retry attempts */
    maxRetries: number;
    /** Initial backoff delay in milliseconds */
    initialBackoffMs: number;
    /** Backoff multiplier */
    backoffMultiplier: number;
    /** Request timeout in milliseconds */
    timeoutMs: number;
}

export interface WebhookDeliveryResult {
    url: string;
    success: boolean;
    attempt: number;
    error?: string;
    responseStatus?: number;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let activeConfig: WebhookConfig | null = null;

/**
 * Runtime webhook subscriptions (in addition to env `WEBHOOK_URLS`).
 * Keyed by normalised URL so duplicate registration is O(1).
 * Secrets are never stored here — signing still uses config.secret.
 */
const runtimeSubscriptions = new Map<string, { url: string; createdAt: string }>();

/** Normalise a subscription URL for equality (trim trailing slash, lowercase host). */
export function normaliseWebhookUrl(url: string): string {
    const trimmed = url.trim();
    try {
        const parsed = new URL(trimmed);
        parsed.hash = '';
        // Drop default ports; keep path without trailing slash (except root).
        let path = parsed.pathname;
        if (path.length > 1 && path.endsWith('/')) {
            path = path.slice(0, -1);
        }
        return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
    } catch {
        return trimmed;
    }
}

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

export function resolveWebhookConfig(): WebhookConfig {
    const urlsRaw = process.env["WEBHOOK_URLS"] ?? "";
    const urls = urlsRaw
        ? urlsRaw.split(",").map((url) => url.trim()).filter(Boolean)
        : [];

    const secret = process.env["WEBHOOK_SECRET"] ?? "";
    
    if (urls.length > 0 && !secret) {
        throw new Error("WEBHOOK_SECRET is required when WEBHOOK_URLS is configured");
    }

    const maxRetries = parseInt(
        process.env["WEBHOOK_MAX_RETRIES"] ?? "3",
        10
    );

    const initialBackoffMs = parseInt(
        process.env["WEBHOOK_INITIAL_BACKOFF_MS"] ?? "1000",
        10
    );

    const backoffMultiplier = parseFloat(
        process.env["WEBHOOK_BACKOFF_MULTIPLIER"] ?? "2.0"
    );

    const timeoutMs = parseInt(
        process.env["WEBHOOK_TIMEOUT_MS"] ?? "10000",
        10
    );

    return { urls, secret, maxRetries, initialBackoffMs, backoffMultiplier, timeoutMs };
}

// ---------------------------------------------------------------------------
// HMAC Signature utilities
// ---------------------------------------------------------------------------

function generateSignature(payload: string, secret: string): string {
    return createHmac("sha256", secret)
        .update(payload, "utf8")
        .digest("hex");
}

// ---------------------------------------------------------------------------
// HTTP delivery utilities
// ---------------------------------------------------------------------------

async function deliverWebhook(
    url: string,
    payload: WebhookPayload,
    signature: string,
    timeoutMs: number
): Promise<{ success: boolean; status?: number; error?: string }> {
    const payloadString = JSON.stringify(payload);

    try {
        const response = await fetchWithTimeout(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Webhook-Signature": `sha256=${signature}`,
                "X-Webhook-Timestamp": payload.timestamp,
                "User-Agent": "Creditra-Webhook/1.0"
            },
            body: payloadString,
            timeouts: {
                connectTimeoutMs: timeoutMs,
                readTimeoutMs: 0,
            },
            retry: false,
        });

        if (response.ok) {
            return { success: true, status: response.status };
        } else {
            return { 
                success: false, 
                status: response.status, 
                error: `HTTP ${response.status}: ${response.statusText}` 
            };
        }
    } catch (error) {
        if (error instanceof Error) {
            throw error;
        }
        
        throw new Error("Unknown error occurred");
    }
}

// ---------------------------------------------------------------------------
// Retry logic with exponential backoff
// ---------------------------------------------------------------------------

async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number,
    initialBackoffMs: number,
    backoffMultiplier: number
): Promise<{ result: T; attempts: number }> {
    let lastError: Error;
    let delay = initialBackoffMs;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
            const result = await fn();
            return { result, attempts: attempt };
        } catch (error) {
            lastError = error as Error;
            
            if (attempt <= maxRetries) {
                log.warn({ attempt, retryInMs: delay, error: lastError }, "webhook:delivery:retry");
                await new Promise(resolve => setTimeout(resolve, delay));
                delay = Math.floor(delay * backoffMultiplier);
            }
        }
    }

    throw lastError!;
}

// ---------------------------------------------------------------------------
// Event processing
// ---------------------------------------------------------------------------

function parseDrawConfirmedEvent(event: HorizonEvent): WebhookPayload | null {
    // Check if this is a draw confirmation event
    if (!event.topics.includes("draw_confirmed")) {
        return null;
    }

    try {
        const eventData = JSON.parse(event.data);
        
        return {
            event: "draw_confirmed",
            timestamp: new Date().toISOString(),
            data: {
                ledger: event.ledger,
                contractId: event.contractId,
                drawAmount: eventData.drawAmount || "0",
                drawId: eventData.drawId || "",
                borrowerWallet: eventData.borrowerWallet || "",
                creditLineId: eventData.creditLineId || "",
                horizonTimestamp: event.timestamp
            }
        };
    } catch (error) {
        log.error({ error }, "webhook:event-parse:failed");
        return null;
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getWebhookConfig(): WebhookConfig | null {
    if (!activeConfig) return null;
    // Merge env URLs with runtime subscriptions for a complete view.
    const runtimeUrls = Array.from(runtimeSubscriptions.values()).map((s) => s.url);
    const merged = Array.from(new Set([...activeConfig.urls, ...runtimeUrls]));
    return { ...activeConfig, urls: merged };
}

export function initializeWebhooks(): void {
    try {
        activeConfig = resolveWebhookConfig();
        log.info({ urls: activeConfig.urls.length, maxRetries: activeConfig.maxRetries, timeoutMs: activeConfig.timeoutMs }, "webhook:initialized");
    } catch (error) {
        log.error({ error }, "webhook:initialize:failed");
        activeConfig = null;
    }
}

/**
 * Register a runtime webhook subscription URL.
 *
 * @throws {ConflictError} when the URL is already registered (env or runtime).
 * Message and details never include the full URL when it may carry secrets
 * (query tokens); only a non-sensitive field name is exposed.
 */
export function registerWebhookSubscription(url: string): { url: string; createdAt: string } {
    if (!url || typeof url !== 'string' || !url.trim()) {
        throw new Error('Webhook URL is required');
    }
    const trimmed = url.trim();
    try {
        // Validate absolute http(s) URL without storing credentials in details.
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('Webhook URL must use http or https');
        }
    } catch (err) {
        if (err instanceof Error && err.message.startsWith('Webhook URL')) throw err;
        throw new Error('Webhook URL is invalid');
    }

    const key = normaliseWebhookUrl(trimmed);
    const envUrls = activeConfig?.urls ?? [];
    const envKeys = new Set(envUrls.map(normaliseWebhookUrl));

    if (envKeys.has(key) || runtimeSubscriptions.has(key)) {
        throw duplicateResource(
            'webhook_subscription',
            'A webhook subscription for this endpoint already exists.',
            { field: 'url', reason: 'duplicate_url' },
        );
    }

    const createdAt = new Date().toISOString();
    const record = { url: trimmed, createdAt };
    runtimeSubscriptions.set(key, record);
    // Delivery reads getWebhookConfig() which merges env + runtime URLs.
    return record;
}

/** List runtime subscriptions only (env URLs are visible via /config). */
export function listRuntimeWebhookSubscriptions(): Array<{ url: string; createdAt: string }> {
    return Array.from(runtimeSubscriptions.values());
}

/** Test helper: clear runtime subscriptions. */
export function _resetRuntimeWebhookSubscriptions(): void {
    runtimeSubscriptions.clear();
}

export async function sendDrawConfirmationWebhook(
    event: HorizonEvent
): Promise<WebhookDeliveryResult[]> {
    if (!activeConfig || activeConfig.urls.length === 0) {
        log.info("webhook:delivery:disabled");
        return [];
    }

    const payload = parseDrawConfirmedEvent(event);
    if (!payload) {
        log.info({ ledger: event.ledger, contractId: event.contractId }, "webhook:delivery:skipped-non-draw-event");
        return [];
    }

    const payloadString = JSON.stringify(payload);
    const signature = generateSignature(payloadString, activeConfig.secret);

    log.info({ drawId: payload.data.drawId, deliveryCount: activeConfig.urls.length }, "webhook:delivery:start");

    const store = getWebhookDeliveryStateStore();

    const deliveryPromises = activeConfig.urls.map(async (url) => {
        // Exactly-once: a re-emitted Horizon event for an already-delivered
        // (drawId, url) must not re-POST to a URL that previously succeeded.
        if (store.isDelivered(payload.data.drawId, url)) {
            console.log(
                `[DrawWebhook] Skipping already-delivered draw ${payload.data.drawId} for a subscriber`
            );
            return { url, success: true, attempt: 0 };
        }

        try {
            const { result, attempts } = await retryWithBackoff(
                () => deliverWebhook(url, payload, signature, activeConfig!.timeoutMs),
                activeConfig!.maxRetries,
                activeConfig!.initialBackoffMs,
                activeConfig!.backoffMultiplier
            );

            store.record({
                drawId: payload.data.drawId,
                url,
                status: result.success ? "delivered" : "failed",
                attempts,
                lastError: result.error,
                deliveredAt: result.success ? new Date().toISOString() : undefined
            });

            return {
                url,
                success: result.success,
                attempt: attempts,
                responseStatus: result.status,
                error: result.error
            };
        } catch (error) {
            const attempts = activeConfig!.maxRetries + 1;
            const lastError = error instanceof Error ? error.message : "Unknown error";

            // Exhausted all retries — dead-letter instead of silently dropping.
            store.record({
                drawId: payload.data.drawId,
                url,
                status: "dead_letter",
                attempts,
                lastError
            });
            log.warn("webhook:delivery:dead-letter", {
                drawId: payload.data.drawId,
                url,
                attempts,
                lastError,
            });

            return { url, success: false, attempt: attempts, error: lastError };
        }
    });

    const results = await Promise.all(deliveryPromises);
    
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    
    log.info({ successful: successCount, failed: failureCount }, "webhook:delivery:complete");

    return results;
}

// ---------------------------------------------------------------------------
// Health check utilities
// ---------------------------------------------------------------------------

export async function testWebhookConnectivity(): Promise<{
    url: string;
    reachable: boolean;
    error?: string;
}[]> {
    if (!activeConfig || activeConfig.urls.length === 0) {
        return [];
    }

    const testPayload: WebhookPayload = {
        event: "draw_confirmed",
        timestamp: new Date().toISOString(),
        data: {
            ledger: 0,
            contractId: "test",
            drawAmount: "0",
            drawId: "test",
            borrowerWallet: "test",
            creditLineId: "test",
            horizonTimestamp: new Date().toISOString()
        }
    };

    const payloadString = JSON.stringify(testPayload);
    const signature = generateSignature(payloadString, activeConfig.secret);

    const testPromises = activeConfig.urls.map(async (url) => {
        try {
            const result = await deliverWebhook(url, testPayload, signature, 5000);
            return {
                url,
                reachable: result.success,
                error: result.error
            };
        } catch (error) {
            return {
                url,
                reachable: false,
                error: error instanceof Error ? error.message : "Unknown error"
            };
        }
    });

    return Promise.all(testPromises);
}
