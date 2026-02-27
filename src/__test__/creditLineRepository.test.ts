import { beforeEach, describe, expect, it } from "vitest";
import { creditLineRepository } from "../repositories/creditLineRepository.js";
import { _resetStore, createCreditLine } from "../services/creditService.js";

describe("creditLineRepository.getById()", () => {
  beforeEach(() => {
    _resetStore();
  });

  it("returns a full credit line for a known id", () => {
    const created = createCreditLine("line-1");
    expect(creditLineRepository.getById("line-1")).toEqual(created);
  });

  it("returns undefined for an unknown id", () => {
    expect(creditLineRepository.getById("missing")).toBeUndefined();
  });
});
