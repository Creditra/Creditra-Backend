import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Container } from '../Container.js';
import { InMemoryCreditLineRepository } from '../../repositories/memory/InMemoryCreditLineRepository.js';
import { PostgresCreditLineRepository } from '../../repositories/postgres/PostgresCreditLineRepository.js';

// Mock the database client
vi.mock('../../db/client.js', () => ({
  getConnection: vi.fn(() => ({
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('Container - PostgreSQL Integration', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Reset the singleton instance
    (Container as unknown as { instance: Container | undefined }).instance = undefined;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should use in-memory repositories when DATABASE_URL is not set', () => {
    delete process.env.DATABASE_URL;
    
    const container = Container.getInstance();
    const repository = container.creditLineRepository;
    
    expect(repository).toBeInstanceOf(InMemoryCreditLineRepository);
  });

  it('should use in-memory repositories in test environment even with DATABASE_URL', () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.NODE_ENV = 'test';
    
    const container = Container.getInstance();
    const repository = container.creditLineRepository;
    
    expect(repository).toBeInstanceOf(InMemoryCreditLineRepository);
  });

  it('should use PostgreSQL repositories when DATABASE_URL is set and not in test environment', () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.NODE_ENV = 'development';
    
    const container = Container.getInstance();
    const repository = container.creditLineRepository;
    
    expect(repository).toBeInstanceOf(PostgresCreditLineRepository);
  });

  it('should use PostgreSQL repositories in production environment', () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.NODE_ENV = 'production';
    
    const container = Container.getInstance();
    const repository = container.creditLineRepository;
    
    expect(repository).toBeInstanceOf(PostgresCreditLineRepository);
  });

  it('should properly shutdown database connections', async () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.NODE_ENV = 'development';
    
    const container = Container.getInstance();
    
    // Mock console.log to avoid test output noise
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    await container.shutdown();
    
    expect(consoleSpy).toHaveBeenCalledWith('[Container] Database connection closed.');
    expect(consoleSpy).toHaveBeenCalledWith('[Container] All services shut down.');
    
    consoleSpy.mockRestore();
  });

  it('should handle database connection close errors gracefully', async () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.NODE_ENV = 'development';
    
    // Mock getConnection to return a client that throws on end()
    const { getConnection } = await import('../../db/client.js');
    vi.mocked(getConnection).mockReturnValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      end: vi.fn().mockRejectedValue(new Error('Connection close failed')),
    });
    
    const container = Container.getInstance();
    
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    await container.shutdown();
    
    expect(consoleSpy).toHaveBeenCalledWith(
      '[Container] Error closing database connection:',
      expect.any(Error)
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('[Container] All services shut down.');
    
    consoleSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });
});