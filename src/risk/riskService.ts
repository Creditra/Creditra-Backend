import type { RiskInputs, RiskOutput } from './types.js';
import { scoreWallet, DEFAULT_WEIGHTS } from './riskModel.js';
import type { RiskWeights } from './types.js';

/**
 * Async service wrapper around the risk scoring model.
 *
 * Keeping this layer async is deliberate: when the stub is replaced by a
 * real engine (HTTP oracle, on-chain lookup, ML inference endpoint) the
 * route layer will not need to change — only this function's body updates.
 *
 * @param inputs  - Wallet signals to evaluate.
 * @param weights - Optional weight overrides; defaults to {@link DEFAULT_WEIGHTS}.
 * @returns       A promise resolving to the {@link RiskOutput} for the wallet.
 */
export async function evaluateRisk(
  inputs: RiskInputs,
  weights: RiskWeights = DEFAULT_WEIGHTS,
): Promise<RiskOutput> {
  // When connecting a real engine, replace the line below with the
  // async call (e.g. await riskEngineClient.evaluate(inputs)).
  return scoreWallet(inputs, weights);
}