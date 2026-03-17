import { config } from '../config/index.js';

/**
 * Checks if a feature flag is enabled.
 * Reads from the central config which is populated by environment variables.
 * 
 * @param flagName - The name of the feature flag (e.g., 'risk_v2')
 * @returns boolean - True if the feature is enabled
 */
export function isFeatureEnabled(flagName: string): boolean {
    return !!config.featureFlags[flagName];
}
