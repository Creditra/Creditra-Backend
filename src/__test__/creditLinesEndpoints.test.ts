import express, { Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import creditRouter from "../routes/credit.js";
import { _resetStore, createCreditLine } from "../services/creditService.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/credit", creditRouter);
  return app;
}

const VALID_ID = "line-abc";
const MISSING_ID = "does-not-exist";
const ADMIN_KEY = "test-secret";

describe("Credit lines endpoints", () => {
  beforeEach(() => {
    _resetStore();
    process.env["ADMIN_API_KEY"] = ADMIN_KEY;
  });

  describe("GET /api/credit/lines", () => {
    it("returns 200 with an empty array when no credit lines exist", async () => {
      const res = await request(buildApp()).get("/api/credit/lines");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [] });
    });

    it("returns all credit lines for future success cases", async () => {
      const active = createCreditLine("line-active", "active");
      const suspended = createCreditLine("line-suspended", "suspended");
      const closed = createCreditLine("line-closed", "closed");

      const res = await request(buildApp()).get("/api/credit/lines");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data).toEqual([active, suspended, closed]);
    });

    it("returns JSON content-type", async () => {
      const res = await request(buildApp()).get("/api/credit/lines");
      expect(res.headers["content-type"]).toMatch(/application\/json/);
    });
  });

  describe("GET /api/credit/lines/:id", () => {
    it("returns 200 with the full credit line payload for a known id", async () => {
      const created = createCreditLine(VALID_ID);

      const res = await request(buildApp()).get(`/api/credit/lines/${VALID_ID}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: created });
    });

    it("returns 404 with a consistent not-found error when id does not exist", async () => {
      const res = await request(buildApp()).get(`/api/credit/lines/${MISSING_ID}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: `Credit line "${MISSING_ID}" not found.` });
    });

    it("returns JSON content-type on not-found responses", async () => {
      const res = await request(buildApp()).get(`/api/credit/lines/${MISSING_ID}`);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
    });
  });

  describe("POST /api/credit/lines/:id/suspend", () => {
    it("returns 200 for an active credit line", async () => {
      createCreditLine(VALID_ID, "active");
      const res = await request(buildApp())
        .post(`/api/credit/lines/${VALID_ID}/suspend`)
        .set("x-admin-api-key", ADMIN_KEY);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("suspended");
    });

    it("returns 404 for a missing credit line", async () => {
      const res = await request(buildApp())
        .post(`/api/credit/lines/${MISSING_ID}/suspend`)
        .set("x-admin-api-key", ADMIN_KEY);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain(MISSING_ID);
    });

    it("returns 409 for invalid status transitions", async () => {
      createCreditLine(VALID_ID, "suspended");
      const res = await request(buildApp())
        .post(`/api/credit/lines/${VALID_ID}/suspend`)
        .set("x-admin-api-key", ADMIN_KEY);

      expect(res.status).toBe(409);
    });
  });

  describe("POST /api/credit/lines/:id/close", () => {
    it("returns 200 for an active credit line", async () => {
      createCreditLine(VALID_ID, "active");
      const res = await request(buildApp())
        .post(`/api/credit/lines/${VALID_ID}/close`)
        .set("x-admin-api-key", ADMIN_KEY);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("closed");
    });

    it("returns 404 for a missing credit line", async () => {
      const res = await request(buildApp())
        .post(`/api/credit/lines/${MISSING_ID}/close`)
        .set("x-admin-api-key", ADMIN_KEY);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain(MISSING_ID);
    });

    it("returns 409 for invalid status transitions", async () => {
      createCreditLine(VALID_ID, "closed");
      const res = await request(buildApp())
        .post(`/api/credit/lines/${VALID_ID}/close`)
        .set("x-admin-api-key", ADMIN_KEY);

      expect(res.status).toBe(409);
    });
  });
});
