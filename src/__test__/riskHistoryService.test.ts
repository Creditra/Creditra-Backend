import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getRiskHistory, isValidWalletAddress } from "../services/riskService.js";
import * as clientModule from "../db/client.js";
import { DbClient } from "../db/client.js";
import type { Mock } from "vitest";

const VALID_ADDRESS = "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGZBW3JXDC55CYIXB5NAXMCEKJ";
const VALID_ADDRESS_2 = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

describe("getRiskHistory()", () => {
    let mockDb: DbClient;
    let getConnectionSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockDb = {
            query: vi.fn(),
            connect: vi.fn(),
            end: vi.fn(),
        } as unknown as DbClient;

        getConnectionSpy = vi.spyOn(clientModule, "getConnection")
            .mockReturnValue(mockDb);
    });

    afterEach(() => {
        getConnectionSpy.mockRestore();
    });

    describe("with valid wallet address", () => {
        it("returns empty array when no evaluations exist", async () => {
            mockDb.query.mockResolvedValueOnce({ rows: [] });

            const result = await getRiskHistory(VALID_ADDRESS);

            expect(result).toEqual([]);
            expect(mockDb.connect).toHaveBeenCalledTimes(1);
            expect(mockDb.end).toHaveBeenCalledTimes(1);
        });

        it("returns evaluation history with correct structure", async () => {
            const mockRows = [
                {
                    id: "123e4567-e89b-12d3-a456-426614174001",
                    borrower_id: "223e4567-e89b-12d3-a456-426614174000",
                    wallet_address: VALID_ADDRESS,
                    risk_score: 45,
                    suggested_limit: "10000.00",
                    interest_rate_bps: 500,
                    inputs: { transactionCount: 100 },
                    evaluated_at: new Date("2026-02-26T10:00:00Z"),
                },
            ];

            mockDb.query.mockResolvedValueOnce({ rows: mockRows });

            const result = await getRiskHistory(VALID_ADDRESS);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                id: mockRows[0].id,
                riskScore: 45,
                riskLevel: "medium",
                suggestedLimit: "10000.00",
                interestRateBps: 500,
                inputs: { transactionCount: 100 },
                evaluatedAt: "2026-02-26T10:00:00.000Z",
            });
        });

        it("maps risk scores to correct risk levels", async () => {
            const mockRows = [
                {
                    id: "123e4567-e89b-12d3-a456-426614174001",
                    borrower_id: "223e4567-e89b-12d3-a456-426614174000",
                    wallet_address: VALID_ADDRESS,
                    risk_score: 30,
                    suggested_limit: "15000.00",
                    interest_rate_bps: 300,
                    inputs: null,
                    evaluated_at: new Date("2026-02-26T12:00:00Z"),
                },
                {
                    id: "123e4567-e89b-12d3-a456-426614174002",
                    borrower_id: "223e4567-e89b-12d3-a456-426614174000",
                    wallet_address: VALID_ADDRESS,
                    risk_score: 55,
                    suggested_limit: "10000.00",
                    interest_rate_bps: 500,
                    inputs: null,
                    evaluated_at: new Date("2026-02-26T11:00:00Z"),
                },
                {
                    id: "123e4567-e89b-12d3-a456-426614174003",
                    borrower_id: "223e4567-e89b-12d3-a456-426614174000",
                    wallet_address: VALID_ADDRESS,
                    risk_score: 75,
                    suggested_limit: "5000.00",
                    interest_rate_bps: 800,
                    inputs: null,
                    evaluated_at: new Date("2026-02-26T10:00:00Z"),
                },
            ];

            mockDb.query.mockResolvedValueOnce({ rows: mockRows });

            const result = await getRiskHistory(VALID_ADDRESS);

            expect(result[0].riskLevel).toBe("low");
            expect(result[1].riskLevel).toBe("medium");
            expect(result[2].riskLevel).toBe("high");
        });

        it("handles null inputs correctly", async () => {
            const mockRows = [
                {
                    id: "123e4567-e89b-12d3-a456-426614174001",
                    borrower_id: "223e4567-e89b-12d3-a456-426614174000",
                    wallet_address: VALID_ADDRESS,
                    risk_score: 40,
                    suggested_limit: "10000.00",
                    interest_rate_bps: 450,
                    inputs: null,
                    evaluated_at: new Date("2026-02-26T10:00:00Z"),
                },
            ];

            mockDb.query.mockResolvedValueOnce({ rows: mockRows });

            const result = await getRiskHistory(VALID_ADDRESS);

            expect(result[0].inputs).toBeNull();
        });

        it("handles complex inputs object", async () => {
            const complexInputs = {
                transactionCount: 100,
                avgBalance: 5000,
                creditHistory: {
                    latePayments: 0,
                    totalLoans: 5,
                },
                metadata: ["tag1", "tag2"],
            };

            const mockRows = [
                {
                    id: "123e4567-e89b-12d3-a456-426614174001",
                    borrower_id: "223e4567-e89b-12d3-a456-426614174000",
                    wallet_address: VALID_ADDRESS,
                    risk_score: 40,
                    suggested_limit: "10000.00",
                    interest_rate_bps: 450,
                    inputs: complexInputs,
                    evaluated_at: new Date("2026-02-26T10:00:00Z"),
                },
            ];

            mockDb.query.mockResolvedValueOnce({ rows: mockRows });

            const result = await getRiskHistory(VALID_ADDRESS);

            expect(result[0].inputs).toEqual(complexInputs);
        });

        it("returns multiple evaluations", async () => {
            const mockRows = Array.from({ length: 5 }, (_, i) => ({
                id: `123e4567-e89b-12d3-a456-42661417400${i}`,
                borrower_id: "223e4567-e89b-12d3-a456-426614174000",
                wallet_address: VALID_ADDRESS,
                risk_score: 40 + i * 5,
                suggested_limit: `${10000 - i * 1000}.00`,
                interest_rate_bps: 500 + i * 50,
                inputs: null,
                evaluated_at: new Date(`2026-02-${26 - i}T10:00:00Z`),
            }));

            mockDb.query.mockResolvedValueOnce({ rows: mockRows });

            const result = await getRiskHistory(VALID_ADDRESS);

            expect(result).toHaveLength(5);
            expect(result.map(r => r.id)).toEqual(mockRows.map(r => r.id));
        });

        it("converts Date objects to ISO strings", async () => {
            const evaluatedAt = new Date("2026-02-26T15:30:45.123Z");
            const mockRows = [
                {
                    id: "123e4567-e89b-12d3-a456-426614174001",
                    borrower_id: "223e4567-e89b-12d3-a456-426614174000",
                    wallet_address: VALID_ADDRESS,
                    risk_score: 40,
                    suggested_limit: "10000.00",
                    interest_rate_bps: 450,
                    inputs: null,
                    evaluated_at: evaluatedAt,
                },
            ];

            mockDb.query.mockResolvedValueOnce({ rows: mockRows });

            const result = await getRiskHistory(VALID_ADDRESS);

            expect(result[0].evaluatedAt).toBe("2026-02-26T15:30:45.123Z");
        });

        it("calls repository with correct wallet address", async () => {
            mockDb.query.mockResolvedValueOnce({ rows: [] });

            await getRiskHistory(VALID_ADDRESS);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining("WHERE b.wallet_address = $1"),
                [VALID_ADDRESS]
            );
        });

        it("works with different valid wallet addresses", async () => {
            mockDb.query.mockResolvedValueOnce({ rows: [] });

            await getRiskHistory(VALID_ADDRESS_2);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.any(String),
                [VALID_ADDRESS_2]
            );
        });
    });

    describe("with invalid wallet address", () => {
        it("throws error for empty string", async () => {
            await expect(getRiskHistory("")).rejects.toThrow(Error);
            expect(mockDb.query).not.toHaveBeenCalled();
        });

        it("throws error containing the invalid address", async () => {
            await expect(getRiskHistory("INVALID")).rejects.toThrow("INVALID");
            expect(mockDb.query).not.toHaveBeenCalled();
        });

        it("throws error for address not starting with G", async () => {
            const bad = "S" + VALID_ADDRESS.slice(1);
            await expect(getRiskHistory(bad)).rejects.toThrow(Error);
            expect(mockDb.query).not.toHaveBeenCalled();
        });

        it("throws error for too short address", async () => {
            await expect(getRiskHistory("GSHORT")).rejects.toThrow(Error);
            expect(mockDb.query).not.toHaveBeenCalled();
        });

        it("throws error for too long address", async () => {
            await expect(getRiskHistory(VALID_ADDRESS + "X")).rejects.toThrow(Error);
            expect(mockDb.query).not.toHaveBeenCalled();
        });

        it("error message hints at correct format", async () => {
            await expect(getRiskHistory("BAD")).rejects.toThrow(/56/);
        });

        it("validates before connecting to database", async () => {
            await expect(getRiskHistory("INVALID")).rejects.toThrow();
            expect(mockDb.connect).not.toHaveBeenCalled();
        });
    });

    describe("database connection management", () => {
        it("connects to database before querying", async () => {
            (mockDb.query as Mock).mockResolvedValueOnce({ rows: [] });

            await getRiskHistory(VALID_ADDRESS);

            const connectCalls = (mockDb.connect as Mock).mock.calls;
            const queryCalls = (mockDb.query as Mock).mock.calls;
            
            expect(connectCalls.length).toBeGreaterThan(0);
            expect(queryCalls.length).toBeGreaterThan(0);
        });

        it("closes database connection after successful query", async () => {
            mockDb.query.mockResolvedValueOnce({ rows: [] });

            await getRiskHistory(VALID_ADDRESS);

            expect(mockDb.end).toHaveBeenCalledTimes(1);
        });

        it("closes database connection even when query fails", async () => {
            mockDb.query.mockRejectedValueOnce(new Error("Database error"));

            await expect(getRiskHistory(VALID_ADDRESS)).rejects.toThrow("Database error");

            expect(mockDb.end).toHaveBeenCalledTimes(1);
        });

        it("gets connection from client module", async () => {
            mockDb.query.mockResolvedValueOnce({ rows: [] });

            await getRiskHistory(VALID_ADDRESS);

            expect(getConnectionSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe("risk level calculation", () => {
        it("returns 'low' for score 0", async () => {
            const mockRows = [
                {
                    id: "123e4567-e89b-12d3-a456-426614174001",
                    borrower_id: "223e4567-e89b-12d3-a456-426614174000",
                    wallet_address: VALID_ADDRESS,
                    risk_score: 0,
                    suggested_limit: "20000.00",
                    interest_rate_bps: 200,
                    inputs: null,
                    evaluated_at: new Date(),
                },
            ];

            mockDb.query.mockResolvedValueOnce({ rows: mockRows });

            const result = await getRiskHistory(VALID_ADDRESS);

            expect(result[0].riskLevel).toBe("low");
        });

        it("returns 'low' for score 39", async () => {
            const mockRows = [
                {
                    id: "123e4567-e89b-12d3-a456-426614174001",
                    borrower_id: "223e4567-e89b-12d3-a456-426614174000",
                    wallet_address: VALID_ADDRESS,
                    risk_score: 39,
                    suggested_limit: "15000.00",
                    interest_rate_bps: 350,
                    inputs: null,
                    evaluated_at: new Date(),
                },
            ];

            mockDb.query.mockResolvedValueOnce({ rows: mockRows });

            const result = await getRiskHistory(VALID_ADDRESS);

            expect(result[0].riskLevel).toBe("low");
        });

        it("returns 'medium' for score 40", async () => {
            const mockRows = [
                {
                    id: "123e4567-e89b-12d3-a456-426614174001",
                    borrower_id: "223e4567-e89b-12d3-a456-426614174000",
                    wallet_address: VALID_ADDRESS,
                    risk_score: 40,
                    suggested_limit: "10000.00",
                    interest_rate_bps: 450,
                    inputs: null,
                    evaluated_at: new Date(),
                },
            ];

            mockDb.query.mockResolvedValueOnce({ rows: mockRows });

            const result = await getRiskHistory(VALID_ADDRESS);

            expect(result[0].riskLevel).toBe("medium");
        });

        it("returns 'medium' for score 69", async () => {
            const mockRows = [
                {
                    id: "123e4567-e89b-12d3-a456-426614174001",
                    borrower_id: "223e4567-e89b-12d3-a456-426614174000",
                    wallet_address: VALID_ADDRESS,
                    risk_score: 69,
                    suggested_limit: "7000.00",
                    interest_rate_bps: 650,
                    inputs: null,
                    evaluated_at: new Date(),
                },
            ];

            mockDb.query.mockResolvedValueOnce({ rows: mockRows });

            const result = await getRiskHistory(VALID_ADDRESS);

            expect(result[0].riskLevel).toBe("medium");
        });

        it("returns 'high' for score 70", async () => {
            const mockRows = [
                {
                    id: "123e4567-e89b-12d3-a456-426614174001",
                    borrower_id: "223e4567-e89b-12d3-a456-426614174000",
                    wallet_address: VALID_ADDRESS,
                    risk_score: 70,
                    suggested_limit: "5000.00",
                    interest_rate_bps: 750,
                    inputs: null,
                    evaluated_at: new Date(),
                },
            ];

            mockDb.query.mockResolvedValueOnce({ rows: mockRows });

            const result = await getRiskHistory(VALID_ADDRESS);

            expect(result[0].riskLevel).toBe("high");
        });

        it("returns 'high' for score 100", async () => {
            const mockRows = [
                {
                    id: "123e4567-e89b-12d3-a456-426614174001",
                    borrower_id: "223e4567-e89b-12d3-a456-426614174000",
                    wallet_address: VALID_ADDRESS,
                    risk_score: 100,
                    suggested_limit: "1000.00",
                    interest_rate_bps: 1000,
                    inputs: null,
                    evaluated_at: new Date(),
                },
            ];

            mockDb.query.mockResolvedValueOnce({ rows: mockRows });

            const result = await getRiskHistory(VALID_ADDRESS);

            expect(result[0].riskLevel).toBe("high");
        });
    });
});
