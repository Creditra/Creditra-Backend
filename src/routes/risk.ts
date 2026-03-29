import { Router } from 'express';
import { fail } from '../helpers/fail.js';

export const riskRouter = Router();

// ---------------------------------------------------------------------------
// In-memory store (placeholder until a real DB is wired up)
// ---------------------------------------------------------------------------
export interface RiskEvaluation {
  id: string;
  walletAddress: string;
  riskScore: number;
  creditLimit: string;
  interestRateBps: number;
}

// Exported so tests can seed data without importing a real DB
export const evaluationStore = new Map<string, RiskEvaluation>();

// Simple UUID-v4 pattern used for ID validation
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// POST /api/risk/evaluate
// ---------------------------------------------------------------------------
riskRouter.post('/evaluate', (req, res) => {
  const walletAddress: unknown = req.body?.walletAddress;

  if (!walletAddress) {
    // Use fail() for consistency — no raw error JSON
    return fail(res, 400, 'INVALID_INPUT', 'walletAddress required');
  }

  const evaluation: RiskEvaluation = {
    id: crypto.randomUUID(),
    walletAddress: walletAddress as string,
    riskScore: 0,
    creditLimit: '0',
    interestRateBps: 0,
  };

  evaluationStore.set(evaluation.id, evaluation);

  return res.json({
    ...evaluation,
    message: 'Risk engine not yet connected; placeholder response.',
  });
});

// ---------------------------------------------------------------------------
// GET /api/risk/evaluations/:id
// ---------------------------------------------------------------------------
riskRouter.get('/evaluations/:id', (req, res) => {
  const { id } = req.params;

  // Validate ID format before hitting the data source
  if (!UUID_RE.test(id)) {
    return fail(res, 400, 'INVALID_INPUT', 'Invalid evaluation id format');
  }

  try {
    const evaluation = evaluationStore.get(id);

    if (!evaluation) {
      // 404 — resource does not exist; use fail() only, no stack trace
      return fail(res, 404, 'NOT_FOUND', 'Risk evaluation not found');
    }

    return res.json({ evaluation });
  } catch (err) {
    // Log internally — never expose internals to the caller
    console.error('[GET /evaluations/:id] Unexpected error:', err);
    return fail(res, 500, 'INTERNAL_ERROR', 'Something went wrong');
  }
});
