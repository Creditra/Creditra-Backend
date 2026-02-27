/**
 * API Key Configuration
 *
 * Valid API keys are loaded from the `API_KEYS` environment variable as a
 * comma-separated list.  They are stored in a Set for O(1) lookup and are
 * never exposed in logs or error responses.
 *
 * Example:
 *   API_KEYS=key-abc123,key-def456
 *
 * Rotation procedure:
 *  1. Add the new key to the `API_KEYS` value (keeping the old key).
 *  2. Deploy / restart the service.
 *  3. Update all clients to use the new key.
 *  4. Remove the old key from `API_KEYS` and redeploy.
 */

/**
 * Returns the set of valid API keys parsed from the `API_KEYS` env var.
 * Throws during startup if the variable is missing or empty so that
 * misconfiguration is caught immediately.
 */
export function loadApiKeys(): Set<string> {
  const raw = process.env.API_KEYS ?? '';
  const keys = raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

  if (keys.length === 0) {
    throw new Error(
      'API_KEYS environment variable is not set or contains no valid entries. ' +
        'Set it to a comma-separated list of secret keys before starting the service.',
    );
  }

  return new Set(keys);
}
