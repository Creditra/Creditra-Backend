import { beforeEach, describe, expect, it } from "vitest";
import {
  CreditLineNotFoundError,
  InvalidTransitionError,
  _resetStore,
  _store,
  closeCreditLine,
  createCreditLine,
  getCreditLine,
  listCreditLines,
  suspendCreditLine,
} from "../services/creditService.js";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

beforeEach(() => {
  _resetStore();
});

describe("tenant isolation", () => {
  it("does not list credit lines across tenants", () => {
    createCreditLine(TENANT_A, "a1");
    createCreditLine(TENANT_B, "b1");

    expect(listCreditLines(TENANT_A).map((l) => l.id)).toEqual(["a1"]);
    expect(listCreditLines(TENANT_B).map((l) => l.id)).toEqual(["b1"]);
  });

  it("does not fetch by id across tenants", () => {
    createCreditLine(TENANT_A, "shared");
    expect(getCreditLine(TENANT_B, "shared")).toBeUndefined();
  });
});

describe("state transitions", () => {
  it("suspends an active line", () => {
    createCreditLine(TENANT_A, "line-1");
    const updated = suspendCreditLine(TENANT_A, "line-1");
    expect(updated.status).toBe("suspended");
  });

  it("closes a suspended line", () => {
    createCreditLine(TENANT_A, "line-1");
    suspendCreditLine(TENANT_A, "line-1");
    const updated = closeCreditLine(TENANT_A, "line-1");
    expect(updated.status).toBe("closed");
  });

  it("throws CreditLineNotFoundError when tenant does not have the id", () => {
    createCreditLine(TENANT_A, "line-1");
    expect(() => suspendCreditLine(TENANT_B, "line-1")).toThrow(
      CreditLineNotFoundError,
    );
  });

  it("throws InvalidTransitionError for invalid transitions", () => {
    createCreditLine(TENANT_A, "line-1", "suspended");
    expect(() => suspendCreditLine(TENANT_A, "line-1")).toThrow(
      InvalidTransitionError,
    );
  });
});

describe("_store structure", () => {
  it("keeps a separate Map per tenant", () => {
    createCreditLine(TENANT_A, "a1");
    createCreditLine(TENANT_B, "b1");
    expect(_store.get(TENANT_A)?.has("a1")).toBe(true);
    expect(_store.get(TENANT_B)?.has("b1")).toBe(true);
  });
});

