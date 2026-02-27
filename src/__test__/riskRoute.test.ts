import express, { Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/riskService.js", () => ({
  evaluateWallet: vi.fn(),
  InvalidWalletAddressError: class InvalidWalletAddressError extends Error {
    constructor() {
      super("Invalid wallet address format.");
      this.name = "InvalidWalletAddressError";
    }
  },
}));

import riskRouter from "../routes/risk.js";
import {
  evaluateWallet,
  InvalidWalletAddressError,
} from "../services/riskService.js";

const mockEvaluateWallet = vi.mocked(evaluateWallet);

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/risk", riskRouter);
  return app;
}

const VALID_ADDRESS = "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGZBW3JXDC55CYIXB5NAXMCEKJA";
const MOCK_RESULT = {
  walletAddress: VALID_ADDRESS,
  score: null,
  riskLevel: null,
  message: "Risk evaluation placeholder - engine not yet integrated.",
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

  it("returns 400 when walletAddress is blank", async () => {
    const res = await request(app)
      .post("/api/risk/evaluate")
      .send({ walletAddress: "   " });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "walletAddress is required" });
  });

  it("returns 400 for invalid format and does not call evaluateWallet", async () => {
    const invalidAddress = "BAD";
    const res = await request(app)
      .post("/api/risk/evaluate")
      .send({ walletAddress: invalidAddress });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid wallet address format." });
    expect(res.body.error).not.toContain(invalidAddress);
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

  it("normalizes walletAddress and calls evaluateWallet with trimmed value", async () => {
    mockEvaluateWallet.mockResolvedValueOnce(MOCK_RESULT);

    await request(app)
      .post("/api/risk/evaluate")
      .send({ walletAddress: ` ${VALID_ADDRESS} ` });

    expect(mockEvaluateWallet).toHaveBeenCalledTimes(1);
    expect(mockEvaluateWallet).toHaveBeenCalledWith(VALID_ADDRESS);
  });

  it("returns 400 when service throws InvalidWalletAddressError", async () => {
    mockEvaluateWallet.mockRejectedValueOnce(new InvalidWalletAddressError());

    const res = await request(app)
      .post("/api/risk/evaluate")
      .send({ walletAddress: VALID_ADDRESS });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid wallet address format." });
  });

  it("returns 500 with a generic message when service throws unexpected errors", async () => {
    mockEvaluateWallet.mockRejectedValueOnce(new Error("DB unavailable"));

    const res = await request(app)
      .post("/api/risk/evaluate")
      .send({ walletAddress: VALID_ADDRESS });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Unable to evaluate wallet at this time." });
  });

  it("returns JSON content-type on 400 error", async () => {
    const res = await request(app).post("/api/risk/evaluate").send({});
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});
