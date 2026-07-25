import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  computeEtag,
  etagMatches,
  applyConditionalGet,
  okWithEtag,
  stableSerialize,
  ETAG_CACHE_CONTROL,
} from '../etag.js';
import { HTTP_NOT_MODIFIED, HTTP_OK } from '../httpStatus.js';

function createMockResponse(): Response {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res as Response;
}

function createMockRequest(ifNoneMatch?: string): Request {
  return {
    headers: ifNoneMatch !== undefined ? { 'if-none-match': ifNoneMatch } : {},
  } as Request;
}

describe('etag helpers', () => {
  describe('stableSerialize / computeEtag', () => {
    it('produces a quoted strong ETag', () => {
      const etag = computeEtag({ a: 1 });
      expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/);
    });

    it('is stable for the same payload', () => {
      expect(computeEtag({ x: 'y', n: 2 })).toBe(computeEtag({ x: 'y', n: 2 }));
    });

    it('changes when the payload changes', () => {
      const a = computeEtag({ data: { balance: '10.00' }, error: null });
      const b = computeEtag({ data: { balance: '11.00' }, error: null });
      expect(a).not.toBe(b);
    });

    it('serializes Dates as ISO strings (matches Express JSON)', () => {
      const d = new Date('2024-01-15T10:00:00.000Z');
      expect(stableSerialize({ at: d })).toBe(
        JSON.stringify({ at: '2024-01-15T10:00:00.000Z' }),
      );
    });
  });

  describe('etagMatches', () => {
    const etag = computeEtag({ id: 'line-1' });

    it('returns false when header is missing or empty', () => {
      expect(etagMatches(undefined, etag)).toBe(false);
      expect(etagMatches('', etag)).toBe(false);
      expect(etagMatches('   ', etag)).toBe(false);
    });

    it('matches an exact strong tag', () => {
      expect(etagMatches(etag, etag)).toBe(true);
    });

    it('matches a weak-prefixed tag via weak comparison', () => {
      const raw = etag.slice(1, -1);
      expect(etagMatches(`W/"${raw}"`, etag)).toBe(true);
      expect(etagMatches(`w/"${raw}"`, etag)).toBe(true);
    });

    it('matches when the tag appears in a list', () => {
      expect(etagMatches(`"other", ${etag}`, etag)).toBe(true);
    });

    it('matches *', () => {
      expect(etagMatches('*', etag)).toBe(true);
    });

    it('rejects a different tag', () => {
      expect(etagMatches('"deadbeef"', etag)).toBe(false);
    });

    it('accepts array form of the header', () => {
      expect(etagMatches([etag], etag)).toBe(true);
    });
  });

  describe('applyConditionalGet', () => {
    it('sets ETag and Cache-Control and returns false when no match', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const etag = computeEtag({ ok: true });

      expect(applyConditionalGet(req, res, etag)).toBe(false);
      expect(res.setHeader).toHaveBeenCalledWith('ETag', etag);
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', ETAG_CACHE_CONTROL);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 304 when If-None-Match matches', () => {
      const etag = computeEtag({ ok: true });
      const req = createMockRequest(etag);
      const res = createMockResponse();

      expect(applyConditionalGet(req, res, etag)).toBe(true);
      expect(res.status).toHaveBeenCalledWith(HTTP_NOT_MODIFIED);
      expect(res.end).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('okWithEtag', () => {
    it('sends the envelope with ETag on a full response', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const data = { id: 'cl_1', creditLimit: '1000.00' };

      okWithEtag(req, res, data);

      expect(res.status).toHaveBeenCalledWith(HTTP_OK);
      expect(res.json).toHaveBeenCalledWith({ data, error: null });
      expect(res.setHeader).toHaveBeenCalledWith('ETag', expect.stringMatching(/^"/));
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', ETAG_CACHE_CONTROL);
    });

    it('returns 304 with empty body when validators match', () => {
      const data = { id: 'cl_1' };
      const firstReq = createMockRequest();
      const firstRes = createMockResponse();
      okWithEtag(firstReq, firstRes, data);

      const etag = (firstRes.setHeader as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === 'ETag',
      )?.[1] as string;

      const secondReq = createMockRequest(etag);
      const secondRes = createMockResponse();
      okWithEtag(secondReq, secondRes, data);

      expect(secondRes.status).toHaveBeenCalledWith(HTTP_NOT_MODIFIED);
      expect(secondRes.end).toHaveBeenCalled();
      expect(secondRes.json).not.toHaveBeenCalled();
    });
  });
});
