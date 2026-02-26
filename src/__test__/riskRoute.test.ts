import express, { type Express } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/riskService.js", () => ({
  evaluateWallet: vi.fn(),
}));

import { riskRouter } from "../routes/risk.js";
import { evaluateWallet } from "../services/riskService.js";
import { requestJson } from "./testHttp.js";

const mockEvaluateWallet = vi.mocked(evaluateWallet);

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/risk", riskRouter);
  return app;
}

const VALID_ADDRESS =
  "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGZBW3JXDC55CYIXB5NAXMCEKJA";

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
    const res = await requestJson(app, {
      method: "POST",
      path: "/api/risk/evaluate",
      body: {},
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ data: null, error: "walletAddress is required" });
  });

  it("returns 200 with the service result on a valid address", async () => {
    mockEvaluateWallet.mockResolvedValueOnce(MOCK_RESULT as any);
    const res = await requestJson(app, {
      method: "POST",
      path: "/api/risk/evaluate",
      body: { walletAddress: VALID_ADDRESS },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: MOCK_RESULT, error: null });
  });
});
