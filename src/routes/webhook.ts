/**
 * Outbound-webhook management routes mounted at `/api/webhooks`.
 *
 * These endpoints describe the **server's** outbound webhook fan-out (the
 * draw-confirmation push). The backend does not currently receive any
 * inbound webhooks.
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
import { getWebhookConfig, testWebhookConnectivity } from '../services/drawWebhookService.js';
import { getWebhookDeliveryStateStore } from '../services/webhookDeliveryState.js';
import { redactLogArgs } from '../utils/logRedact.js';
import { Container } from '../container/Container.js';
import { createApiKeyMiddleware } from '../middleware/auth.js';
import { loadApiKeys } from '../config/apiKeys.js';
import type { OutboundWebhookStatus } from '../services/outboundWebhookStore.js';

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
 * List active outbound webhook subscriptions. Admin/API-key gated because
 * subscriber URLs are operational integration metadata.
 */
webhookRouter.get('/subscriptions', requireApiKey, async (_req: Request, res: Response) => {
    const subscriptions = await container.outboundWebhookDispatcher.listSubscriptions();
    res.status(200).json({
        data: subscriptions.map((subscription) => ({
            id: subscription.id,
            url: subscription.url,
            eventTypes: subscription.eventTypes,
            active: subscription.active,
            secretRef: subscription.secretRef,
            createdAt: subscription.createdAt,
            updatedAt: subscription.updatedAt
        })),
        error: null
    });
});

/**
 * Inspect recent outbound delivery rows. Admin/API-key gated; payloads are
 * included so operators can debug event fan-out without reading server logs.
 */
webhookRouter.get('/deliveries', requireApiKey, async (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const allowedStatuses = new Set(['queued', 'delivered', 'failed', 'dead_letter']);
    const deliveries = await container.outboundWebhookDispatcher.listDeliveries({
        status: status && allowedStatuses.has(status)
            ? (status as OutboundWebhookStatus)
            : undefined,
        limit: Number.isFinite(limit) ? limit : undefined
    });
    res.status(200).json({ data: deliveries, error: null });
});

/**
 * Replay a failed/dead-letter delivery by queueing it again. The original row
 * is preserved and moved back to queued so history remains inspectable.
 */
webhookRouter.post('/deliveries/:id/replay', requireApiKey, async (req: Request, res: Response) => {
    try {
        const jobId = await container.outboundWebhookDispatcher.replayDelivery(req.params.id);
        res.status(202).json({ data: { jobId }, error: null });
    } catch (error) {
        res.status(404).json({
            data: null,
            error: error instanceof Error ? error.message : 'Delivery not found'
        });
    }
});
