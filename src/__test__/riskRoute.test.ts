
import express, { Express } from "express";
import request from "supertest";
import { jest } from "@jest/globals";

jest.mock("../../services/riskService.js", () => ({
    evaluateWallet: jest.fn(),
}));

import riskRouter from "../../routes/risk.js";
import { evaluateWallet } from "../../services/riskService.js";

const mockEvaluateWallet = evaluateWallet as jest.MockedFunction<
    typeof evaluateWallet
>;

function buildApp(): Express {
    const app = express();
    app.use(express.json());
    app.use("/api/risk", riskRouter);
    return app;
}


const VALID_ADDRESS = "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGZBW3JXDC55CYIXB5NAXMCEKJ";

const MOCK_RESULT = {
    walletAddress: VALID_ADDRESS,
    score: null,
    riskLevel: null,
    message: "Risk evaluation placeholder — engine not yet integrated.",
    evaluatedAt: "2026-02-26T00:00:00.000Z",
};


describe("POST /api/risk/evaluate", () => {
    let app: Express;

    beforeEach(() => {
        app = buildApp();
        mockEvaluateWallet.mockReset();
    });


    it("returns 400 when body is empty", async () => {
        const res = await request(app)
        .post("/api/risk/evaluate")
        .set("Content-Type", "application/json")
        .send({});

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: "walletAddress is required" });
    });

    it("returns 400 when walletAddress is missing from body", async () => {
        const res = await request(app)
        .post("/api/risk/evaluate")
        .send({ unrelated: "field" });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain("walletAddress is required");
    });

    it("does NOT call evaluateWallet when walletAddress is absent", async () => {
        await request(app).post("/api/risk/evaluate").send({});
        expect(mockEvaluateWallet).not.toHaveBeenCalled();
    });


    it("returns 200 with the service result on a valid address", async () => {
        mockEvaluateWallet.mockResolvedValueOnce(MOCK_RESULT);

        const res = await request(app)
        .post("/api/risk/evaluate")
        .send({ walletAddress: VALID_ADDRESS });

        expect(res.status).toBe(200);
        expect(res.body).toEqual(MOCK_RESULT);
    });

    it("calls evaluateWallet with the exact walletAddress from the body", async () => {
        mockEvaluateWallet.mockResolvedValueOnce(MOCK_RESULT);

        await request(app)
        .post("/api/risk/evaluate")
        .send({ walletAddress: VALID_ADDRESS });

        expect(mockEvaluateWallet).toHaveBeenCalledTimes(1);
        expect(mockEvaluateWallet).toHaveBeenCalledWith(VALID_ADDRESS);
    });

    it("response body contains all expected fields", async () => {
        mockEvaluateWallet.mockResolvedValueOnce(MOCK_RESULT);

        const res = await request(app)
        .post("/api/risk/evaluate")
        .send({ walletAddress: VALID_ADDRESS });

        expect(res.body).toHaveProperty("walletAddress");
        expect(res.body).toHaveProperty("score");
        expect(res.body).toHaveProperty("riskLevel");
        expect(res.body).toHaveProperty("message");
        expect(res.body).toHaveProperty("evaluatedAt");
    });


    it("returns 400 when evaluateWallet throws an Error", async () => {
        mockEvaluateWallet.mockRejectedValueOnce(
        new Error("Invalid wallet address: \"BAD\""),
        );

        const res = await request(app)
        .post("/api/risk/evaluate")
        .send({ walletAddress: "BAD" });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain("Invalid wallet address");
    });

    it("returns 400 with the service error message verbatim", async () => {
        const errorMsg = 'Invalid wallet address: "TOOLONG". Must start with \'G\'';
        mockEvaluateWallet.mockRejectedValueOnce(new Error(errorMsg));

        const res = await request(app)
        .post("/api/risk/evaluate")
        .send({ walletAddress: "TOOLONG" });

        expect(res.body.error).toBe(errorMsg);
    });

    it("returns 400 with 'Unknown error' when a non-Error is thrown", async () => {
        mockEvaluateWallet.mockRejectedValueOnce("raw string throw");

        const res = await request(app)
        .post("/api/risk/evaluate")
        .send({ walletAddress: VALID_ADDRESS });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Unknown error");
    });


    it("returns JSON content-type on success", async () => {
        mockEvaluateWallet.mockResolvedValueOnce(MOCK_RESULT);

        const res = await request(app)
        .post("/api/risk/evaluate")
        .send({ walletAddress: VALID_ADDRESS });

        expect(res.headers["content-type"]).toMatch(/application\/json/);
    });

    it("returns JSON content-type on 400 error", async () => {
        const res = await request(app)
        .post("/api/risk/evaluate")
        .send({});

        expect(res.headers["content-type"]).toMatch(/application\/json/);
    });
});