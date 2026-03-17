import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isFeatureEnabled } from './featureFlags.js';
import { config } from '../config/index.js';

vi.mock('../config/index.js', () => ({
    config: {
        featureFlags: {
            test_feature: true,
            disabled_feature: false
        }
    }
}));

describe('isFeatureEnabled', () => {
    it('should return true when a feature is enabled', () => {
        expect(isFeatureEnabled('test_feature')).toBe(true);
    });

    it('should return false when a feature is disabled', () => {
        expect(isFeatureEnabled('disabled_feature')).toBe(false);
    });

    it('should return false when a feature does not exist', () => {
        expect(isFeatureEnabled('non_existent')).toBe(false);
    });
});
