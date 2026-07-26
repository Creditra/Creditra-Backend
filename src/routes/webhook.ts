/**
 * Outbound-webhook management routes mounted at `/api/webhooks`.
 *
 * These endpoints describe the **server's** outbound webhook fan-out (the
 * draw-confirmation push). Inbound partner webhooks live on a separate router
 * (`/api/inbound-webhooks`) with HMAC + nonce replay protection — see
 * `docs/webhooks.md`.
 *
 * Surface:
 * - GET  `/config`      — sanitized config (URLs + retry knobs; secret
 *   never returned).
 * - POST `/test`        — sends a connectivity probe to every configured
 *   URL and returns a `{ reachable, unreachable, results[] }` summary.
 * - GET  `/health`      — `active` / `disabled` state, used by dashboards.
 *
 * Outbound payload contract (subscriber side) is documented in
 * `docs/API.md` §Webhooks: HMAC-SHA256 over the raw body, signed with
 * `WEBHOOK_SECRET`, delivered as `X-Webhook-Signature: sha256=…`.
 */
import { Router, type Request, type Response } from 'express';
import {
    getWebhookConfig,
    testWebhookConnectivity,
    registerWebhookSubscription,
    listRuntimeWebhookSubscriptions,
} from '../services/drawWebhookService.js';
import { getWebhookDeliveryStateStore } from '../services/webhookDeliveryState.js';
import { redactLogArgs } from '../utils/logRedact.js';
import { ConflictError, isConflictError, sendConflict } from '../errors/index.js';
import { ok, fail } from '../utils/response.js';

export const webhookRouter = Router();
const container = Container.getInstance();
const requireApiKey = createApiKeyMiddleware(() => loadApiKeys());

/**
 * Get current webhook configuration
 */
webhookRouter.get('/config', (_req: Request, res: Response) => {
    const config = getWebhookConfig();
    
    if (!config) {
        return res.status(200).json({
            urls: [],
            configured: false,
            message: 'Webhooks not configured'
        });
    }

    // Return config without sensitive data
    const safeConfig = {
        urls: config.urls,
        maxRetries: config.maxRetries,
        initialBackoffMs: config.initialBackoffMs,
        backoffMultiplier: config.backoffMultiplier,
        timeoutMs: config.timeoutMs,
        configured: config.urls.length > 0
    };

    return res.status(200).json(safeConfig);
});

/**
 * Test webhook connectivity
 */
webhookRouter.post('/test', async (_req: Request, res: Response) => {
    try {
        const results = await testWebhookConnectivity();
        
        const summary = {
            total: results.length,
            reachable: results.filter(r => r.reachable).length,
            unreachable: results.filter(r => !r.reachable).length,
            results
        };

        res.status(200).json(summary);
    } catch (error) {
        console.error(...redactLogArgs(['[WebhookRoutes] Connectivity test failed:', error]));
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to test webhook connectivity'
        });
    }
});

/**
 * Health check for webhook service
 */
webhookRouter.get('/health', (_req: Request, res: Response) => {
    const config = getWebhookConfig();
    
    if (!config || config.urls.length === 0) {
        return res.status(200).json({
            status: 'disabled',
            message: 'Webhook service is disabled (no URLs configured)'
        });
    }

    const counts = getWebhookDeliveryStateStore().counts();

    return res.status(200).json({
        status: 'active',
        urls: config.urls.length,
        maxRetries: config.maxRetries,
        timeoutMs: config.timeoutMs,
        delivery: {
            total: counts.total,
            delivered: counts.delivered,
            failed: counts.failed,
            deadLetter: counts.deadLetter
        }
    });
});

/**
 * Register a runtime webhook subscription.
 * Duplicate URLs return 409 problem+json (`duplicate_resource`).
 */
webhookRouter.post('/subscriptions', (req: Request, res: Response) => {
    try {
        const url = typeof req.body?.url === 'string' ? req.body.url : '';
        const subscription = registerWebhookSubscription(url);
        return ok(res, subscription, 201);
    } catch (error) {
        if (error instanceof ConflictError || isConflictError(error)) {
            return sendConflict(res, error as ConflictError);
        }
        return fail(res, error instanceof Error ? error.message : 'Invalid subscription', 400);
    }
});

/**
 * List runtime webhook subscriptions (env-configured URLs are on GET /config).
 */
webhookRouter.get('/subscriptions', (_req: Request, res: Response) => {
    return ok(res, { subscriptions: listRuntimeWebhookSubscriptions() });
});
