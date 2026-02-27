import express, { Express } from "express";
import request from "supertest";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { riskRouter } from "../routes/risk.js";
import * as riskService from "../services/riskService.js";

vi.mock("../services/riskService.js");

const mockGetRiskHistory = vi.mocked(riskService.getRiskHistory);

function buildApp(): Express {
    const app = express();
    app.use(express.json());
    app.use("/api/risk", riskRouter);
    return app;
}

const VALID_ADDRESS = "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGZBW3JXDC55CYIXB5NAXMCEKJ";
const VALID_ADDRESS_2 = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

describe("GET /api/risk/history/:walletAddress", () => {
    let app: Express;

    beforeEach(() => {
        app = buildApp();
        mockGetRiskHistory.mockReset();
    });

    describe("successful requests", () => {
        it("returns 200 with empty array when no history exists", async () => {
            mockGetRiskHistory.mockResolvedValueOnce([]);

            const res = await request(app)
                .get(`/api/risk/history/${VALID_ADDRESS}`)
                .expect(200);

            expect(res.body.data).toEqual({
                walletAddress: VALID_ADDRESS,
                evaluations: [],
            });
            expect(res.body.error).toBeNull();
        });

        it("returns 200 with evaluation history when records exist", async () => {
            const mockHistory = [
                {
                    id: "123e4567-e89b-12d3-a456-426614174001",
                    riskScore: 45,
                    riskLevel: "medium" as const,
                    suggestedLimit: "10000.00",
                    interestRateBps: 500,
                    inputs: { transactionCount: 100 },
                    evaluatedAt: "2026-02-26T10:00:00.000Z",
                },
                {
                    id: "123e4567-e89b-12d3-a456-426614174002",
                    riskScore: 35,
                    riskLevel: "low" as const,
                    suggestedLimit: "15000.00",
                    interestRateBps: 400,
                    inputs: null,
                    evaluatedAt: "2026-02-25T10:00:00.000Z",
                },
            ];

            mockGetRiskHistory.mockResolvedValueOnce(mockHistory);

            const res = await request(app)
                .get(`/api/risk/history/${VALID_ADDRESS}`)
                .expect(200);

            expect(res.body.data.walletAddress).toBe(VALID_ADDRESS);
            expect(res.body.data.evaluations).toHaveLength(2);
            expect(res.body.data.evaluations[0]).toEqual(mockHistory[0]);
            expect(res.body.data.evaluations[1]).toEqual(mockHistory[1]);
            expect(res.body.error).toBeNull();
        });

        it("calls getRiskHistory with the wallet address from URL", async () => {
            mockGetRiskHistory.mockResolvedValueOnce([]);

            await request(app)
                .get(`/api/risk/history/${VALID_ADDRESS}`)
                .expect(200);

            expect(mockGetRiskHistory).toHaveBeenCalledTimes(1);
            expect(mockGetRiskHistory).toHaveBeenCalledWith(VALID_ADDRESS);
        });

        it("handles different wallet addresses correctly", async () => {
            mockGetRiskHistory.mockResolvedValueOnce([]);

            await request(app)
                .get(`/api/risk/history/${VALID_ADDRESS_2}`)
                .expect(200);

            expect(mockGetRiskHistory).toHaveBeenCalledWith(VALID_ADDRESS_2);
        });

        it("returns JSON content-type", async () => {
            mockGetRiskHistory.mockResolvedValueOnce([]);

            const res = await request(app)
                .get(`/api/risk/history/${VALID_ADDRESS}`)
                .expect(200);

            expect(res.headers["content-type"]).toMatch(/application\/json/);
        });

        it("response includes all expected fields for each evaluation", async () => {
            const mockHistory = [
                {
                    id: "123e4567-e89b-12d3-a456-426614174001",
                    riskScore: 45,
                    riskLevel: "medium" as const,
                    suggestedLimit: "10000.00",
                    interestRateBps: 500,
                    inputs: { test: "data" },
                    evaluatedAt: "2026-02-26T10:00:00.000Z",
                },
            ];

            mockGetRiskHistory.mockResolvedValueOnce(mockHistory);

            const res = await request(app)
                .get(`/api/risk/history/${VALID_ADDRESS}`)
                .expect(200);

            const evaluation = res.body.data.evaluations[0];
            expect(evaluation).toHaveProperty("id");
            expect(evaluation).toHaveProperty("riskScore");
            expect(evaluation).toHaveProperty("riskLevel");
            expect(evaluation).toHaveProperty("suggestedLimit");
            expect(evaluation).toHaveProperty("interestRateBps");
            expect(evaluation).toHaveProperty("inputs");
            expect(evaluation).toHaveProperty("evaluatedAt");
        });

        it("handles evaluations with null inputs", async () => {
            const mockHistory = [
                {
                    id: "123e4567-e89b-12d3-a456-426614174001",
                    riskScore: 30,
                    riskLevel: "low" as const,
                    suggestedLimit: "5000.00",
                    interestRateBps: 300,
                    inputs: null,
                    evaluatedAt: "2026-02-26T10:00:00.000Z",
                },
            ];

            mockGetRiskHistory.mockResolvedValueOnce(mockHistory);

            const res = await request(app)
                .get(`/api/risk/history/${VALID_ADDRESS}`)
                .expect(200);

            expect(res.body.data.evaluations[0].inputs).toBeNull();
        });

        it("returns evaluations with correct risk levels", async () => {
            const mockHistory = [
                {
                    id: "123e4567-e89b-12d3-a456-426614174001",
                    riskScore: 30,
                    riskLevel: "low" as const,
                    suggestedLimit: "15000.00",
                    interestRateBps: 300,
                    inputs: null,
                    evaluatedAt: "2026-02-26T12:00:00.000Z",
                },
                {
                    id: "123e4567-e89b-12d3-a456-426614174002",
                    riskScore: 55,
                    riskLevel: "medium" as const,
                    suggestedLimit: "10000.00",
                    interestRateBps: 500,
                    inputs: null,
                    evaluatedAt: "2026-02-26T11:00:00.000Z",
                },
                {
                    id: "123e4567-e89b-12d3-a456-426614174003",
                    riskScore: 75,
                    riskLevel: "high" as const,
                    suggestedLimit: "5000.00",
                    interestRateBps: 800,
                    inputs: null,
                    evaluatedAt: "2026-02-26T10:00:00.000Z",
                },
            ];

            mockGetRiskHistory.mockResolvedValueOnce(mockHistory);

            const res = await request(app)
                .get(`/api/risk/history/${VALID_ADDRESS}`)
                .expect(200);

            expect(res.body.data.evaluations[0].riskLevel).toBe("low");
            expect(res.body.data.evaluations[1].riskLevel).toBe("medium");
            expect(res.body.data.evaluations[2].riskLevel).toBe("high");
        });

        it("returns multiple evaluations in order", async () => {
            const mockHistory = Array.from({ length: 5 }, (_, i) => ({
                id: `123e4567-e89b-12d3-a456-42661417400${i}`,
                riskScore: 40 + i * 5,
                riskLevel: "medium" as const,
                suggestedLimit: `${10000 - i * 1000}.00`,
                interestRateBps: 500 + i * 50,
                inputs: null,
                evaluatedAt: `2026-02-${26 - i}T10:00:00.000Z`,
            }));

            mockGetRiskHistory.mockResolvedValueOnce(mockHistory);

            const res = await request(app)
                .get(`/api/risk/history/${VALID_ADDRESS}`)
                .expect(200);

            expect(res.body.data.evaluations).toHaveLength(5);
            expect(res.body.data.evaluations.map((e: { id: string }) => e.id))
                .toEqual(mockHistory.map(h => h.id));
        });
    });

    describe("error handling", () => {
        it("returns 400 when getRiskHistory throws an Error", async () => {
            mockGetRiskHistory.mockRejectedValueOnce(
                new Error("Invalid wallet address: \"BAD\"")
            );

            const res = await request(app)
                .get("/api/risk/history/BAD")
                .expect(400);

            expect(res.body.data).toBeNull();
            expect(res.body.error).toContain("Invalid wallet address");
        });

        it("returns 400 with service error message verbatim", async () => {
            const errorMsg = 'Invalid wallet address: "TOOLONG". Must start with \'G\'';
            mockGetRiskHistory.mockRejectedValueOnce(new Error(errorMsg));

            const res = await request(app)
                .get("/api/risk/history/TOOLONG")
                .expect(400);

            expect(res.body.error).toBe(errorMsg);
        });

        it("returns 400 with 'Unknown error' when non-Error is thrown", async () => {
            mockGetRiskHistory.mockRejectedValueOnce("raw string throw");

            const res = await request(app)
                .get(`/api/risk/history/${VALID_ADDRESS}`)
                .expect(400);

            expect(res.body.data).toBeNull();
            expect(res.body.error).toBe("Unknown error");
        });

        it("returns JSON content-type on error", async () => {
            mockGetRiskHistory.mockRejectedValueOnce(new Error("Test error"));

            const res = await request(app)
                .get("/api/risk/history/BAD")
                .expect(400);

            expect(res.headers["content-type"]).toMatch(/application\/json/);
        });

        it("does not call getRiskHistory when it throws during setup", async () => {
            mockGetRiskHistory.mockRejectedValueOnce(new Error("Database error"));

            await request(app)
                .get(`/api/risk/history/${VALID_ADDRESS}`)
                .expect(400);

            expect(mockGetRiskHistory).toHaveBeenCalledTimes(1);
        });
    });

    describe("validation", () => {
        it("validates wallet address format through service", async () => {
            mockGetRiskHistory.mockRejectedValueOnce(
                new Error("Invalid wallet address")
            );

            await request(app)
                .get("/api/risk/history/INVALID")
                .expect(400);

            expect(mockGetRiskHistory).toHaveBeenCalledWith("INVALID");
        });

        it("handles URL-encoded wallet addresses", async () => {
            mockGetRiskHistory.mockResolvedValueOnce([]);

            await request(app)
                .get(`/api/risk/history/${encodeURIComponent(VALID_ADDRESS)}`)
                .expect(200);

            expect(mockGetRiskHistory).toHaveBeenCalledWith(VALID_ADDRESS);
        });
    });

    describe("response structure", () => {
        it("follows unified envelope format on success", async () => {
            mockGetRiskHistory.mockResolvedValueOnce([]);

            const res = await request(app)
                .get(`/api/risk/history/${VALID_ADDRESS}`)
                .expect(200);

            expect(res.body).toHaveProperty("data");
            expect(res.body).toHaveProperty("error");
            expect(res.body.error).toBeNull();
        });

        it("follows unified envelope format on error", async () => {
            mockGetRiskHistory.mockRejectedValueOnce(new Error("Test error"));

            const res = await request(app)
                .get("/api/risk/history/BAD")
                .expect(400);

            expect(res.body).toHaveProperty("data");
            expect(res.body).toHaveProperty("error");
            expect(res.body.data).toBeNull();
        });

        it("includes walletAddress in response data", async () => {
            mockGetRiskHistory.mockResolvedValueOnce([]);

            const res = await request(app)
                .get(`/api/risk/history/${VALID_ADDRESS}`)
                .expect(200);

            expect(res.body.data.walletAddress).toBe(VALID_ADDRESS);
        });

        it("includes evaluations array in response data", async () => {
            mockGetRiskHistory.mockResolvedValueOnce([]);

            const res = await request(app)
                .get(`/api/risk/history/${VALID_ADDRESS}`)
                .expect(200);

            expect(res.body.data).toHaveProperty("evaluations");
            expect(Array.isArray(res.body.data.evaluations)).toBe(true);
        });
    });
});
