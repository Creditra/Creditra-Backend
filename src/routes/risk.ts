import { Router, type Request, type Response } from 'express';
import { evaluateRisk, RiskInputs } from "../risk/index.js";
import { evaluateWallet } from "../services/riskService.js";

const router = Router();

/**
 * POST /api/risk/evaluate
 *
 * Evaluates the credit risk for a given wallet address.
 *
 * Request body (all fields required):
 * ```json
 * {
 *   "walletAddress":          "0xabc...123",
 *   "transactionCount":       250,
 *   "walletAgeDays":          365,
 *   "defiActivityVolumeUsd":  12000,
 *   "currentBalanceUsd":      8000,
 *   "hasHighRiskInteraction": false
 * }
 * ```
 *
 * Responses:
 * - 200 RiskOutput — successful evaluation
 * - 400 { error, fields? } — missing or invalid fields
 * - 500 { error } — unexpected server error
 */
riskRouter.post('/evaluate', async (req: Request, res: Response) => {
  const body = req.body ?? {};

  // ── Field presence validation ─────────────────────────────────────────────
  const requiredFields: (keyof RiskInputs)[] = [
    'walletAddress',
    'transactionCount',
    'walletAgeDays',
    'defiActivityVolumeUsd',
    'currentBalanceUsd',
    'hasHighRiskInteraction',
  ];

  const missingFields = requiredFields.filter((f) => body[f] === undefined || body[f] === null);
  if (missingFields.length > 0) {
    return res.status(400).json({
      error: 'Missing required fields',
      fields: missingFields,
    });
  }

  // ── Type validation ───────────────────────────────────────────────────────
  const numericFields: (keyof RiskInputs)[] = [
    'transactionCount',
    'walletAgeDays',
    'defiActivityVolumeUsd',
    'currentBalanceUsd',
  ];

  const invalidNumeric = numericFields.filter(
    (f) => typeof body[f] !== 'number' || !isFinite(body[f]) || body[f] < 0,
  );
  if (invalidNumeric.length > 0) {
    return res.status(400).json({
      error: 'Fields must be non-negative finite numbers',
      fields: invalidNumeric,
    });
  }

  if (typeof body.walletAddress !== 'string' || body.walletAddress.trim() === '') {
    return res.status(400).json({ error: 'walletAddress must be a non-empty string' });
  }

  if (typeof body.hasHighRiskInteraction !== 'boolean') {
    return res.status(400).json({
      error: 'hasHighRiskInteraction must be a boolean',
    });
  }

  // ── Scoring ───────────────────────────────────────────────────────────────
  const inputs: RiskInputs = {
    walletAddress: body.walletAddress.trim(),
    transactionCount: body.transactionCount,
    walletAgeDays: body.walletAgeDays,
    defiActivityVolumeUsd: body.defiActivityVolumeUsd,
    currentBalanceUsd: body.currentBalanceUsd,
    hasHighRiskInteraction: body.hasHighRiskInteraction,
  };

  try {
    const result = await evaluateRisk(inputs);
    return res.json(result);
  } catch (err) {
    console.error('[risk/evaluate] scoring error', err);
    return res.status(500).json({ error: 'Internal risk evaluation error' });
  }
});
