import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RiskEvaluationRepository, CreateRiskEvaluationParams } from './riskEvaluationRepository.js';
import { DbClient } from './client.js';

describe('RiskEvaluationRepository', () => {
  let mockDb: DbClient;
  let repository: RiskEvaluationRepository;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
      end: vi.fn(),
    } as unknown as DbClient;
    repository = new RiskEvaluationRepository(mockDb);
  });

  describe('create', () => {
    const validParams: CreateRiskEvaluationParams = {
      walletAddress: 'GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGZBW3JXDC55CYIXB5NAXMCEKJ',
      riskScore: 45,
      suggestedLimit: '10000.00',
      interestRateBps: 500,
      inputs: { transactionCount: 100, avgBalance: 5000 },
    };

    it('creates a borrower and risk evaluation record', async () => {
      const borrowerId = '123e4567-e89b-12d3-a456-426614174000';
      const evaluationId = '223e4567-e89b-12d3-a456-426614174001';
      const evaluatedAt = new Date('2026-02-26T10:00:00Z');

      mockDb.query
        .mockResolvedValueOnce({
          rows: [{ id: borrowerId, wallet_address: validParams.walletAddress }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: evaluationId,
            borrower_id: borrowerId,
            risk_score: validParams.riskScore,
            suggested_limit: validParams.suggestedLimit,
            interest_rate_bps: validParams.interestRateBps,
            inputs: validParams.inputs,
            evaluated_at: evaluatedAt,
          }],
        });

      const result = await repository.create(validParams);

      expect(result).toEqual({
        id: evaluationId,
        borrowerId,
        walletAddress: validParams.walletAddress,
        riskScore: validParams.riskScore,
        suggestedLimit: validParams.suggestedLimit,
        interestRateBps: validParams.interestRateBps,
        inputs: validParams.inputs,
        evaluatedAt: evaluatedAt.toISOString(),
      });

      expect(mockDb.query).toHaveBeenCalledTimes(2);
      expect(mockDb.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('INSERT INTO borrowers'),
        [validParams.walletAddress]
      );
      expect(mockDb.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO risk_evaluations'),
        [
          borrowerId,
          validParams.riskScore,
          validParams.suggestedLimit,
          validParams.interestRateBps,
          JSON.stringify(validParams.inputs),
        ]
      );
    });

    it('handles existing borrower with ON CONFLICT', async () => {
      const borrowerId = '123e4567-e89b-12d3-a456-426614174000';
      const evaluationId = '223e4567-e89b-12d3-a456-426614174001';

      mockDb.query
        .mockResolvedValueOnce({
          rows: [{ id: borrowerId, wallet_address: validParams.walletAddress }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: evaluationId,
            borrower_id: borrowerId,
            risk_score: validParams.riskScore,
            suggested_limit: validParams.suggestedLimit,
            interest_rate_bps: validParams.interestRateBps,
            inputs: validParams.inputs,
            evaluated_at: new Date(),
          }],
        });

      await repository.create(validParams);

      expect(mockDb.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('ON CONFLICT'),
        [validParams.walletAddress]
      );
    });

    it('creates evaluation without inputs when not provided', async () => {
      const paramsWithoutInputs = {
        walletAddress: validParams.walletAddress,
        riskScore: 30,
        suggestedLimit: '5000.00',
        interestRateBps: 300,
      };

      const borrowerId = '123e4567-e89b-12d3-a456-426614174000';
      const evaluationId = '223e4567-e89b-12d3-a456-426614174001';

      mockDb.query
        .mockResolvedValueOnce({
          rows: [{ id: borrowerId, wallet_address: paramsWithoutInputs.walletAddress }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: evaluationId,
            borrower_id: borrowerId,
            risk_score: paramsWithoutInputs.riskScore,
            suggested_limit: paramsWithoutInputs.suggestedLimit,
            interest_rate_bps: paramsWithoutInputs.interestRateBps,
            inputs: null,
            evaluated_at: new Date(),
          }],
        });

      const result = await repository.create(paramsWithoutInputs);

      expect(result.inputs).toBeNull();
      expect(mockDb.query).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.arrayContaining([null])
      );
    });

    it('returns ISO 8601 formatted evaluatedAt timestamp', async () => {
      const borrowerId = '123e4567-e89b-12d3-a456-426614174000';
      const evaluationId = '223e4567-e89b-12d3-a456-426614174001';
      const evaluatedAt = new Date('2026-02-26T15:30:45.123Z');

      mockDb.query
        .mockResolvedValueOnce({
          rows: [{ id: borrowerId, wallet_address: validParams.walletAddress }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: evaluationId,
            borrower_id: borrowerId,
            risk_score: validParams.riskScore,
            suggested_limit: validParams.suggestedLimit,
            interest_rate_bps: validParams.interestRateBps,
            inputs: validParams.inputs,
            evaluated_at: evaluatedAt,
          }],
        });

      const result = await repository.create(validParams);

      expect(result.evaluatedAt).toBe('2026-02-26T15:30:45.123Z');
    });
  });

  describe('findByWalletAddress', () => {
    const walletAddress = 'GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGZBW3JXDC55CYIXB5NAXMCEKJ';

    it('returns empty array when no evaluations exist', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      const result = await repository.findByWalletAddress(walletAddress);

      expect(result).toEqual([]);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        [walletAddress]
      );
    });

    it('returns evaluations ordered by evaluatedAt DESC', async () => {
      const borrowerId = '123e4567-e89b-12d3-a456-426614174000';
      const eval1 = {
        id: '223e4567-e89b-12d3-a456-426614174001',
        borrower_id: borrowerId,
        wallet_address: walletAddress,
        risk_score: 45,
        suggested_limit: '10000.00',
        interest_rate_bps: 500,
        inputs: { test: 'data1' },
        evaluated_at: new Date('2026-02-26T10:00:00Z'),
      };
      const eval2 = {
        id: '223e4567-e89b-12d3-a456-426614174002',
        borrower_id: borrowerId,
        wallet_address: walletAddress,
        risk_score: 50,
        suggested_limit: '8000.00',
        interest_rate_bps: 600,
        inputs: { test: 'data2' },
        evaluated_at: new Date('2026-02-25T10:00:00Z'),
      };

      mockDb.query.mockResolvedValueOnce({ rows: [eval1, eval2] });

      const result = await repository.findByWalletAddress(walletAddress);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(eval1.id);
      expect(result[0].riskScore).toBe(45);
      expect(result[1].id).toBe(eval2.id);
      expect(result[1].riskScore).toBe(50);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY re.evaluated_at DESC'),
        [walletAddress]
      );
    });

    it('correctly maps all fields from database rows', async () => {
      const borrowerId = '123e4567-e89b-12d3-a456-426614174000';
      const evaluationId = '223e4567-e89b-12d3-a456-426614174001';
      const inputs = { transactionCount: 100, avgBalance: 5000 };
      const evaluatedAt = new Date('2026-02-26T10:00:00Z');

      mockDb.query.mockResolvedValueOnce({
        rows: [{
          id: evaluationId,
          borrower_id: borrowerId,
          wallet_address: walletAddress,
          risk_score: 45,
          suggested_limit: '10000.00',
          interest_rate_bps: 500,
          inputs,
          evaluated_at: evaluatedAt,
        }],
      });

      const result = await repository.findByWalletAddress(walletAddress);

      expect(result[0]).toEqual({
        id: evaluationId,
        borrowerId,
        walletAddress,
        riskScore: 45,
        suggestedLimit: '10000.00',
        interestRateBps: 500,
        inputs,
        evaluatedAt: evaluatedAt.toISOString(),
      });
    });

    it('handles null inputs correctly', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [{
          id: '223e4567-e89b-12d3-a456-426614174001',
          borrower_id: '123e4567-e89b-12d3-a456-426614174000',
          wallet_address: walletAddress,
          risk_score: 30,
          suggested_limit: '5000.00',
          interest_rate_bps: 300,
          inputs: null,
          evaluated_at: new Date(),
        }],
      });

      const result = await repository.findByWalletAddress(walletAddress);

      expect(result[0].inputs).toBeNull();
    });

    it('joins with borrowers table correctly', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      await repository.findByWalletAddress(walletAddress);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('JOIN borrowers b ON re.borrower_id = b.id'),
        [walletAddress]
      );
    });

    it('filters by wallet address in WHERE clause', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      await repository.findByWalletAddress(walletAddress);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE b.wallet_address = $1'),
        [walletAddress]
      );
    });

    it('returns multiple evaluations for same wallet', async () => {
      const borrowerId = '123e4567-e89b-12d3-a456-426614174000';
      const evaluations = [
        {
          id: '223e4567-e89b-12d3-a456-426614174001',
          borrower_id: borrowerId,
          wallet_address: walletAddress,
          risk_score: 45,
          suggested_limit: '10000.00',
          interest_rate_bps: 500,
          inputs: null,
          evaluated_at: new Date('2026-02-26T10:00:00Z'),
        },
        {
          id: '223e4567-e89b-12d3-a456-426614174002',
          borrower_id: borrowerId,
          wallet_address: walletAddress,
          risk_score: 50,
          suggested_limit: '8000.00',
          interest_rate_bps: 600,
          inputs: null,
          evaluated_at: new Date('2026-02-25T10:00:00Z'),
        },
        {
          id: '223e4567-e89b-12d3-a456-426614174003',
          borrower_id: borrowerId,
          wallet_address: walletAddress,
          risk_score: 40,
          suggested_limit: '12000.00',
          interest_rate_bps: 450,
          inputs: null,
          evaluated_at: new Date('2026-02-24T10:00:00Z'),
        },
      ];

      mockDb.query.mockResolvedValueOnce({ rows: evaluations });

      const result = await repository.findByWalletAddress(walletAddress);

      expect(result).toHaveLength(3);
      expect(result.map(r => r.id)).toEqual(evaluations.map(e => e.id));
    });
  });
});
