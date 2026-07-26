import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createIdempotencyMiddleware } from "../idempotency.js";
import { InMemoryIdempotencyStore } from "../../services/idempotencyStore.js";

function createTestApp() {
  const app = express();
  const store = new InMemoryIdempotencyStore();
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  app.use(express.json());
  app.use(createIdempotencyMiddleware(store));
  app.post("/mutations", async (req, res) => {
    calls += 1;
    if (req.body?.wait) {
      await gate;
    }
    res.status(201).json({ calls, body: req.body });
  });

  return {
    app,
    getCalls: () => calls,
    release: () => release?.(),
  };
}

describe("createIdempotencyMiddleware", () => {
  it("passes through POST requests without an Idempotency-Key", async () => {
    const { app, getCalls } = createTestApp();

    const first = await request(app).post("/mutations").send({ amount: "10" });
    const second = await request(app).post("/mutations").send({ amount: "10" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.calls).toBe(1);
    expect(second.body.calls).toBe(2);
    expect(getCalls()).toBe(2);
  });

  it("replays the original response for the same route, principal, key, and body", async () => {
    const { app, getCalls } = createTestApp();

    const first = await request(app)
      .post("/mutations")
      .set("Idempotency-Key", "client-key-1")
      .send({ walletAddress: "GABC", amount: "10" });
    const replay = await request(app)
      .post("/mutations")
      .set("Idempotency-Key", "client-key-1")
      .send({ walletAddress: "GABC", amount: "10" });

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.headers["idempotency-status"]).toBe("replayed");
    expect(replay.body).toEqual(first.body);
    expect(getCalls()).toBe(1);
  });

  it("rejects reuse of the same key for a different request body", async () => {
    const { app, getCalls } = createTestApp();

    const first = await request(app)
      .post("/mutations")
      .set("Idempotency-Key", "client-key-2")
      .send({ walletAddress: "GABC", amount: "10" });
    const conflict = await request(app)
      .post("/mutations")
      .set("Idempotency-Key", "client-key-2")
      .send({ walletAddress: "GABC", amount: "11" });

    expect(first.status).toBe(201);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toMatch(/different request/);
    expect(getCalls()).toBe(1);
  });

  it("waits for an in-flight identical request and does not run the handler twice", async () => {
    const { app, getCalls, release } = createTestApp();

    const first = request(app)
      .post("/mutations")
      .set("Idempotency-Key", "client-key-3")
      .send({ walletAddress: "GABC", amount: "10", wait: true });
    const second = request(app)
      .post("/mutations")
      .set("Idempotency-Key", "client-key-3")
      .send({ walletAddress: "GABC", amount: "10", wait: true });

    await new Promise((resolve) => setTimeout(resolve, 10));
    release();

    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(secondResponse.headers["idempotency-status"]).toBe("replayed");
    expect(secondResponse.body).toEqual(firstResponse.body);
    expect(getCalls()).toBe(1);
  });
});
