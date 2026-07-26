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
 * - GET  `/deliveries`  — cursor-paginated delivery records (incl. dead letters).
 *
 * Outbound payload contract (subscriber side) is documented in
 * `docs/API.md` §Webhooks: HMAC-SHA256 over the raw body, signed with
 * `WEBHOOK_SECRET`, delivered as `X-Webhook-Signature: sha256=…`.
 */
import { Router, type Request, type Response } from 'express';
import { getWebhookConfig, testWebhookConnectivity } from '../services/drawWebhookService.js';
import { getWebhookDeliveryStateStore } from '../services/webhookDeliveryState.js';
import { redactLogArgs } from '../utils/logRedact.js';
import {
  paginateArray,
  parseCursorQuery,
  toPaginationMeta,
} from '../utils/cursorPagination.js';

export const webhookRouter = Router();

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
 * Cursor-paginated delivery records (standard pagination model).
 *
 * Query:
 * - `cursor` — opaque cursor from a previous page (omit / empty for first page)
 * - `limit`  — page size (1–100, default 25)
 * - `status` — optional filter: `delivered` | `failed` | `dead_letter`
 *
 * Sort: `updatedAt DESC`, composite id (`drawId::url`) ASC as tie-break.
 */
webhookRouter.get('/deliveries', (req: Request, res: Response) => {
    try {
        const { cursor, limit } = parseCursorQuery(req.query as Record<string, unknown>);
        const statusFilter =
            typeof req.query.status === 'string' && req.query.status.length > 0
                ? req.query.status
                : undefined;

        if (
            statusFilter !== undefined &&
            statusFilter !== 'delivered' &&
            statusFilter !== 'failed' &&
            statusFilter !== 'dead_letter'
        ) {
            return res.status(400).json({
                data: null,
                error: "Invalid 'status'. Must be one of: delivered, failed, dead_letter.",
            });
        }

        const store = getWebhookDeliveryStateStore();
        let records = store.list();
        if (statusFilter) {
            records = records.filter((r) => r.status === statusFilter);
        }

        const page = paginateArray(records, {
            cursor,
            limit,
            order: 'desc',
            getKey: (r) => ({
                t: Date.parse(r.updatedAt),
                i: `${r.drawId}::${r.url}`,
            }),
        });

        return res.status(200).json({
            data: {
                items: page.items,
                pagination: toPaginationMeta(page),
            },
            error: null,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Bad request';
        return res.status(400).json({ data: null, error: message });
    }
});
