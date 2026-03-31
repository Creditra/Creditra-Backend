import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchWithTimeout,
  fetchJsonWithTimeout,
  HttpTimeoutError,
  HttpRequestError,
  getDefaultTimeouts,
} from '../fetchWithTimeout.js';

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('getDefaultTimeouts', () => {
    it('should return default timeouts from environment', () => {
      const timeouts = getDefaultTimeouts();
      expect(timeouts.connectTimeoutMs).toBe(5000);
      expect(timeouts.readTimeoutMs).toBe(10000);
    });

    it('should parse custom timeouts from environment', () => {
      process.env['HTTP_CONNECT_TIMEOUT_MS'] = '3000';
      process.env['HTTP_READ_TIMEOUT_MS'] = '8000';

      const timeouts = getDefaultTimeouts();
      expect(timeouts.connectTimeoutMs).toBe(3000);
      expect(timeouts.readTimeoutMs).toBe(8000);

      delete process.env['HTTP_CONNECT_TIMEOUT_MS'];
      delete process.env['HTTP_READ_TIMEOUT_MS'];
    });
  });

  describe('fetchWithTimeout', () => {
    it('should successfully fetch when response is fast', async () => {
      const mockResponse = new Response('{"data":"test"}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const response = await fetchWithTimeout('https://example.com/api');

      expect(response.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/api',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('should throw HttpTimeoutError when request times out', async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => {
            const error = new Error('AbortError');
            error.name = 'AbortError';
            reject(error);
          }, 100);
        });
      });

      const promise = fetchWithTimeout('https://example.com/slow', {
        timeouts: { connectTimeoutMs: 50, readTimeoutMs: 50 },
      });

      vi.advanceTimersByTime(100);

      await expect(promise).rejects.toThrow(HttpTimeoutError);
      await expect(promise).rejects.toThrow(/HTTP read timeout after 100ms/);
    });

    it('should throw HttpRequestError for network failures', async () => {
      const networkError = new Error('Network failure');
      global.fetch = vi.fn().mockRejectedValue(networkError);

      await expect(
        fetchWithTimeout('https://example.com/fail')
      ).rejects.toThrow(HttpRequestError);
    });

    it('should use custom timeout overrides', async () => {
      const mockResponse = new Response('OK');
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      await fetchWithTimeout('https://example.com/api', {
        timeouts: { connectTimeoutMs: 1000, readTimeoutMs: 2000 },
      });

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should merge user-provided abort signal', async () => {
      const mockResponse = new Response('OK');
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const userController = new AbortController();
      await fetchWithTimeout('https://example.com/api', {
        signal: userController.signal,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/api',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });
  });

  describe('fetchJsonWithTimeout', () => {
    it('should fetch and parse JSON successfully', async () => {
      const mockData = { id: '123', name: 'test' };
      const mockResponse = new Response(JSON.stringify(mockData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await fetchJsonWithTimeout('https://example.com/api');

      expect(result).toEqual(mockData);
    });

    it('should throw HttpRequestError for non-OK status', async () => {
      const mockResponse = new Response('Not Found', {
        status: 404,
        statusText: 'Not Found',
      });

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      await expect(
        fetchJsonWithTimeout('https://example.com/notfound')
      ).rejects.toThrow(HttpRequestError);
      await expect(
        fetchJsonWithTimeout('https://example.com/notfound')
      ).rejects.toThrow(/HTTP 404 Not Found/);
    });

    it('should throw HttpRequestError for invalid JSON', async () => {
      const mockResponse = new Response('not valid json', {
        status: 200,
      });

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      await expect(
        fetchJsonWithTimeout('https://example.com/invalid')
      ).rejects.toThrow(HttpRequestError);
      await expect(
        fetchJsonWithTimeout('https://example.com/invalid')
      ).rejects.toThrow(/Failed to parse JSON response/);
    });

    it('should handle typed responses', async () => {
      interface TestResponse {
        id: string;
        value: number;
      }

      const mockData: TestResponse = { id: 'abc', value: 42 };
      const mockResponse = new Response(JSON.stringify(mockData), {
        status: 200,
      });

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await fetchJsonWithTimeout<TestResponse>(
        'https://example.com/typed'
      );

      expect(result.id).toBe('abc');
      expect(result.value).toBe(42);
    });
  });

  describe('HttpTimeoutError', () => {
    it('should create error with correct properties', () => {
      const error = new HttpTimeoutError('connect', 'https://example.com', 5000);

      expect(error.name).toBe('HttpTimeoutError');
      expect(error.type).toBe('connect');
      expect(error.url).toBe('https://example.com');
      expect(error.timeoutMs).toBe(5000);
      expect(error.message).toContain('HTTP connect timeout after 5000ms');
    });
  });

  describe('HttpRequestError', () => {
    it('should create error with correct properties', () => {
      const cause = new Error('Network error');
      const error = new HttpRequestError('Request failed', 'https://example.com', cause);

      expect(error.name).toBe('HttpRequestError');
      expect(error.url).toBe('https://example.com');
      expect(error.cause).toBe(cause);
      expect(error.message).toBe('Request failed');
    });

    it('should work without cause', () => {
      const error = new HttpRequestError('Request failed', 'https://example.com');

      expect(error.name).toBe('HttpRequestError');
      expect(error.url).toBe('https://example.com');
      expect(error.cause).toBeUndefined();
    });
  });
});
