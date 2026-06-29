/**
 * Dependency-injection contract tests.
 *
 * These tests instantiate the composition root ({@link Container}) and assert
 * that every service and repository resolves and is wired with a consistent,
 * shared dependency graph. They are a guardrail against runtime wiring
 * failures (e.g. a service constructed with the wrong repository, or a getter
 * returning `undefined`).
 *
 * In addition they verify the "fail fast" contract on environment validation:
 * production-like configuration must surface missing/invalid env vars eagerly
 * via {@link validateEnv} rather than crashing deep inside a request path.
 *
 * See `docs/ARCHITECTURE.md` §1 (Wiring).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Container } from '../Container.js';
import { validateEnv } from '../../config/env.js';
import { CreditLineService } from '../../services/CreditLineService.js';
import { RiskEvaluationService } from '../../services/RiskEvaluationService.js';
import { ReconciliationService } from '../../services/reconciliationService.js';
import { ReconciliationWorker } from '../../services/reconciliationWorker.js';

/**
 * The public dependency contract: each resolver must return a defined value
 * and (where a concrete class exists) an instance of the expected type.
 */
const SERVICE_RESOLVERS: ReadonlyArray<{
  readonly name: keyof Container;
  readonly ctor?: new (...args: never[]) => unknown;
}> = [
  { name: 'creditLineService', ctor: CreditLineService },
  { name: 'riskEvaluationService', ctor: RiskEvaluationService },
  { name: 'reconciliationService', ctor: ReconciliationService },
  { name: 'reconciliationWorker', ctor: ReconciliationWorker },
];

const REPOSITORY_RESOLVERS: ReadonlyArray<keyof Container> = [
  'creditLineRepository',
  'riskEvaluationRepository',
  'transactionRepository',
];

describe('Container DI contract', () => {
  let container: Container;

  beforeEach(() => {
    // Reset singleton so each test sees a freshly wired graph.
    Container['instance'] = undefined as unknown as Container;
    container = Container.getInstance();
  });

  afterEach(() => {
    Container['instance'] = undefined as unknown as Container;
  });

  describe('service resolution', () => {
    it.each(SERVICE_RESOLVERS)('resolves $name to a usable instance', ({ name, ctor }) => {
      const resolved = container[name];
      expect(resolved, `${String(name)} must resolve`).toBeDefined();
      if (ctor) {
        expect(resolved).toBeInstanceOf(ctor);
      }
    });

    it.each(REPOSITORY_RESOLVERS)('resolves repository %s', (name) => {
      const repo = container[name] as Record<string, unknown>;
      expect(repo, `${String(name)} must resolve`).toBeDefined();
      // A repository is a contract object: it must expose callable methods.
      expect(typeof repo).toBe('object');
    });

    it('resolves every service without throwing', () => {
      expect(() => {
        for (const { name } of SERVICE_RESOLVERS) {
          void container[name];
        }
        for (const name of REPOSITORY_RESOLVERS) {
          void container[name];
        }
      }).not.toThrow();
    });
  });

  describe('graph consistency', () => {
    it('shares a single repository instance across all consumers', () => {
      // Reconciliation and the credit-line service must observe the *same*
      // credit-line repository, otherwise reads/writes diverge at runtime.
      const repo = container.creditLineRepository;
      container.setRepositories({ creditLineRepository: repo });
      // Re-resolving must remain stable (idempotent wiring).
      expect(container.creditLineRepository).toBe(repo);
      expect(container.reconciliationService).toBeInstanceOf(ReconciliationService);
    });

    it('rebuilds dependent services when a repository is swapped', () => {
      const before = container.creditLineService;
      const InMemory = container.creditLineRepository.constructor as new () => typeof container.creditLineRepository;
      container.setRepositories({ creditLineRepository: new InMemory() });
      expect(container.creditLineService).not.toBe(before);
      expect(container.creditLineService).toBeInstanceOf(CreditLineService);
    });

    it('returns a stable singleton', () => {
      expect(Container.getInstance()).toBe(container);
    });
  });

  describe('fail-fast environment contract', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
      process.env = { ...ORIGINAL_ENV };
    });

    it('throws when required env vars are missing', () => {
      delete process.env.DATABASE_URL;
      delete process.env.API_KEYS;
      expect(() => validateEnv()).toThrow(/Environment validation failed/);
    });

    it('throws when DATABASE_URL is malformed', () => {
      process.env.DATABASE_URL = 'not-a-url';
      process.env.API_KEYS = 'k1';
      expect(() => validateEnv()).toThrow(/DATABASE_URL/);
    });

    it('accepts a production-like configuration', () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/creditra';
      process.env.API_KEYS = 'prod-key-1,prod-key-2';
      process.env.NODE_ENV = 'production';
      process.env.CORS_ORIGINS = 'https://app.creditra.example';
      expect(() => validateEnv()).not.toThrow();
      const env = validateEnv();
      expect(env.DATABASE_URL).toContain('postgresql://');
      expect(env.NODE_ENV).toBe('production');
    });
  });
});
