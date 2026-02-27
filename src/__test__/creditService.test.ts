
import { beforeEach } from "node:test";
import {
  createCreditLine,
  getCreditLine,
  listCreditLines,
  suspendCreditLine,
  closeCreditLine,
  getTransactions,
  InvalidTransitionError,
  CreditLineNotFoundError,
  _resetStore,
  _store,
  _transactionStore,
} from "../../services/creditService.js";


    
beforeEach(() => {
  _resetStore();
});


describe("createCreditLine()", () => {
  it("creates a credit line with 'active' status by default", () => {
    const line = createCreditLine("line-1");
    expect(line.status).toBe("active");
  });

  it("stores the credit line so getCreditLine can find it", () => {
    createCreditLine("line-1");
    expect(getCreditLine("line-1")).toBeDefined();
  });

  it("returns the correct id", () => {
    const line = createCreditLine("abc-123");
    expect(line.id).toBe("abc-123");
  });

  it("sets createdAt and updatedAt to valid ISO timestamps", () => {
    const line = createCreditLine("line-1");
    expect(new Date(line.createdAt).getTime()).not.toBeNaN();
    expect(new Date(line.updatedAt).getTime()).not.toBeNaN();
  });

  it("initialises events with a single 'created' entry", () => {
    const line = createCreditLine("line-1");
    expect(line.events).toHaveLength(1);
    expect(line.events[0]!.action).toBe("created");
  });

  it("allows an explicit 'suspended' initial status", () => {
    const line = createCreditLine("line-s", "suspended");
    expect(line.status).toBe("suspended");
  });

  it("allows an explicit 'closed' initial status", () => {
    const line = createCreditLine("line-c", "closed");
    expect(line.status).toBe("closed");
  });

  it("stores multiple distinct credit lines", () => {
    createCreditLine("a");
    createCreditLine("b");
    expect(_store.size).toBe(2);
  });
});


describe("getCreditLine()", () => {
  it("returns the credit line for a known id", () => {
    createCreditLine("line-1");
    expect(getCreditLine("line-1")).toBeDefined();
  });

  it("returns undefined for an unknown id", () => {
    expect(getCreditLine("ghost")).toBeUndefined();
  });

  it("returns the correct credit line when multiple exist", () => {
    createCreditLine("a");
    createCreditLine("b");
    expect(getCreditLine("b")?.id).toBe("b");
  });
});

describe("listCreditLines()", () => {
  it("returns an empty array when the store is empty", () => {
    expect(listCreditLines()).toEqual([]);
  });

  it("returns all credit lines", () => {
    createCreditLine("a");
    createCreditLine("b");
    expect(listCreditLines()).toHaveLength(2);
  });

  it("each returned entry has the expected shape", () => {
    createCreditLine("x");
    const lines = listCreditLines();
    expect(lines[0]).toMatchObject({
      id: "x",
      status: "active",
    });
  });
});

describe("suspendCreditLine()", () => {
  describe("valid transition: active → suspended", () => {
    it("changes status to 'suspended'", () => {
      createCreditLine("line-1");
      const updated = suspendCreditLine("line-1");
      expect(updated.status).toBe("suspended");
    });

    it("appends a 'suspended' event to the event log", () => {
      createCreditLine("line-1");
      const updated = suspendCreditLine("line-1");
      expect(updated.events).toHaveLength(2);
      expect(updated.events[1]!.action).toBe("suspended");
    });

    it("updates the updatedAt timestamp", () => {
      const line = createCreditLine("line-1");
      const before = line.updatedAt;
      const updated = suspendCreditLine("line-1");
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(before).getTime(),
      );
    });

    it("persists the change in the store", () => {
      createCreditLine("line-1");
      suspendCreditLine("line-1");
      expect(getCreditLine("line-1")?.status).toBe("suspended");
    });
  });

  describe("invalid transitions", () => {
    it("throws InvalidTransitionError when line is already suspended", () => {
      createCreditLine("line-1", "suspended");
      expect(() => suspendCreditLine("line-1")).toThrow(InvalidTransitionError);
    });

    it("error message mentions 'suspend' and 'suspended'", () => {
      createCreditLine("line-1", "suspended");
      expect(() => suspendCreditLine("line-1")).toThrow(/suspend.*suspended|suspended.*suspend/i);
    });

    it("throws InvalidTransitionError when line is closed", () => {
      createCreditLine("line-1", "closed");
      expect(() => suspendCreditLine("line-1")).toThrow(InvalidTransitionError);
    });

    it("error name is 'InvalidTransitionError'", () => {
      createCreditLine("line-1", "closed");
      try {
        suspendCreditLine("line-1");
      } catch (err) {
        expect((err as Error).name).toBe("InvalidTransitionError");
      }
    });

    it("exposes currentStatus and requestedAction on the error", () => {
      createCreditLine("line-1", "suspended");
      try {
        suspendCreditLine("line-1");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidTransitionError);
        const e = err as InvalidTransitionError;
        expect(e.currentStatus).toBe("suspended");
        expect(e.requestedAction).toBe("suspend");
      }
    });
  });

  describe("not-found error", () => {
    it("throws CreditLineNotFoundError for unknown id", () => {
      expect(() => suspendCreditLine("ghost")).toThrow(CreditLineNotFoundError);
    });

    it("error message includes the id", () => {
      expect(() => suspendCreditLine("ghost")).toThrow(/ghost/);
    });

    it("error name is 'CreditLineNotFoundError'", () => {
      try {
        suspendCreditLine("ghost");
      } catch (err) {
        expect((err as Error).name).toBe("CreditLineNotFoundError");
      }
    });
  });
});


describe("closeCreditLine()", () => {
    describe("valid transition: active → closed", () => {
        it("changes status to 'closed'", () => {
        createCreditLine("line-1");
        const updated = closeCreditLine("line-1");
        expect(updated.status).toBe("closed");
        });

        it("appends a 'closed' event", () => {
        createCreditLine("line-1");
        const updated = closeCreditLine("line-1");
        expect(updated.events.at(-1)!.action).toBe("closed");
        });
    });

    describe("valid transition: suspended → closed", () => {
        it("changes status from suspended to closed", () => {
        createCreditLine("line-1", "suspended");
        const updated = closeCreditLine("line-1");
        expect(updated.status).toBe("closed");
        });

        it("appends a 'closed' event after existing events", () => {
        createCreditLine("line-1", "suspended");
        const updated = closeCreditLine("line-1");
        expect(updated.events.at(-1)!.action).toBe("closed");
        });
    });

    describe("invalid transition: closed → closed", () => {
        it("throws InvalidTransitionError when line is already closed", () => {
        createCreditLine("line-1", "closed");
        expect(() => closeCreditLine("line-1")).toThrow(InvalidTransitionError);
        });

        it("error message mentions 'close' and 'closed'", () => {
        createCreditLine("line-1", "closed");
        expect(() => closeCreditLine("line-1")).toThrow(/close.*closed|closed.*close/i);
        });

        it("exposes currentStatus 'closed' and requestedAction 'close'", () => {
        createCreditLine("line-1", "closed");
        try {
            closeCreditLine("line-1");
        } catch (err) {
            const e = err as InvalidTransitionError;
            expect(e.currentStatus).toBe("closed");
            expect(e.requestedAction).toBe("close");
        }
        });
    });

    describe("not-found error", () => {
        it("throws CreditLineNotFoundError for unknown id", () => {
        expect(() => closeCreditLine("ghost")).toThrow(CreditLineNotFoundError);
        });

        it("error message includes the id", () => {
        expect(() => closeCreditLine("ghost")).toThrow(/ghost/);
        });
    });

    describe("full lifecycle", () => {
        it("supports active → suspend → close transition sequence", () => {
        createCreditLine("line-1");
        suspendCreditLine("line-1");
        const closed = closeCreditLine("line-1");
        expect(closed.status).toBe("closed");
        expect(closed.events).toHaveLength(3);
        expect(closed.events.map((e) => e.action)).toEqual([
            "created",
            "suspended",
            "closed",
        ]);
        });
  });
});


describe("getTransactions()", () => {
  describe("not-found error", () => {
    it("throws CreditLineNotFoundError for an unknown id", () => {
      expect(() => getTransactions("ghost")).toThrow(CreditLineNotFoundError);
    });

    it("error message includes the id", () => {
      expect(() => getTransactions("ghost")).toThrow(/ghost/);
    });

    it("error name is 'CreditLineNotFoundError'", () => {
      try {
        getTransactions("ghost");
      } catch (err) {
        expect((err as Error).name).toBe("CreditLineNotFoundError");
      }
    });
  });

  describe("status changes are recorded automatically", () => {
    it("records a status_change transaction when a line is created", () => {
      createCreditLine("line-1");
      const result = getTransactions("line-1");
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.type).toBe("status_change");
      expect(result.transactions[0]!.metadata).toMatchObject({ action: "created" });
    });

    it("records a status_change transaction when a line is suspended", () => {
      createCreditLine("line-1");
      suspendCreditLine("line-1");
      const result = getTransactions("line-1");
      expect(result.transactions).toHaveLength(2);
      expect(result.transactions[1]!.metadata).toMatchObject({ action: "suspended" });
    });

    it("records a status_change transaction when a line is closed", () => {
      createCreditLine("line-1");
      closeCreditLine("line-1");
      const result = getTransactions("line-1");
      expect(result.transactions.at(-1)!.type).toBe("status_change");
      expect(result.transactions.at(-1)!.metadata).toMatchObject({ action: "closed" });
    });

    it("each transaction has the expected shape", () => {
      createCreditLine("line-1");
      const result = getTransactions("line-1");
      expect(result.transactions[0]).toMatchObject({
        id: expect.any(String),
        creditLineId: "line-1",
        type: "status_change",
        amount: null,
        currency: null,
        timestamp: expect.any(String),
        metadata: expect.any(Object),
      });
    });

    it("transaction id is a unique string", () => {
      createCreditLine("line-1");
      suspendCreditLine("line-1");
      const result = getTransactions("line-1");
      const ids = result.transactions.map((tx) => tx.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("transaction creditLineId matches the credit line id", () => {
      createCreditLine("line-1");
      const result = getTransactions("line-1");
      expect(result.transactions[0]!.creditLineId).toBe("line-1");
    });

    it("_resetStore clears the transaction store", () => {
      createCreditLine("line-1");
      _resetStore();
      expect(_transactionStore.size).toBe(0);
    });
  });

  describe("empty history with type filter", () => {
    it("returns empty transactions array when filtered type has no matches", () => {
      createCreditLine("line-1");
      const result = getTransactions("line-1", { type: "draw" });
      expect(result.transactions).toHaveLength(0);
    });

    it("returns total 0 for an empty filtered result", () => {
      createCreditLine("line-1");
      const result = getTransactions("line-1", { type: "draw" });
      expect(result.total).toBe(0);
    });

    it("returns totalPages 1 even when total is 0", () => {
      createCreditLine("line-1");
      const result = getTransactions("line-1", { type: "repayment" });
      expect(result.totalPages).toBe(1);
    });

    it("returns correct page and limit in empty result", () => {
      createCreditLine("line-1");
      const result = getTransactions("line-1", { type: "draw" }, { page: 1, limit: 10 });
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });
  });

  describe("filters", () => {
    it("filters by type: returns only matching transactions", () => {
      createCreditLine("line-1");
      suspendCreditLine("line-1");
      const result = getTransactions("line-1", { type: "status_change" });
      expect(result.transactions.every((tx) => tx.type === "status_change")).toBe(true);
    });

    it("filters by type: total reflects filtered count", () => {
      createCreditLine("line-1");
      suspendCreditLine("line-1");
      const result = getTransactions("line-1", { type: "status_change" });
      expect(result.total).toBe(2);
    });

    it("filters by 'from': excludes transactions before the date", () => {
      createCreditLine("line-1");
      const future = new Date(Date.now() + 60_000).toISOString();
      const result = getTransactions("line-1", { from: future });
      expect(result.transactions).toHaveLength(0);
    });

    it("filters by 'from': includes transactions on or after the date", () => {
      createCreditLine("line-1");
      const past = new Date(Date.now() - 60_000).toISOString();
      const result = getTransactions("line-1", { from: past });
      expect(result.transactions).toHaveLength(1);
    });

    it("filters by 'to': excludes transactions after the date", () => {
      createCreditLine("line-1");
      const past = new Date(Date.now() - 60_000).toISOString();
      const result = getTransactions("line-1", { to: past });
      expect(result.transactions).toHaveLength(0);
    });

    it("filters by 'to': includes transactions on or before the date", () => {
      createCreditLine("line-1");
      const future = new Date(Date.now() + 60_000).toISOString();
      const result = getTransactions("line-1", { to: future });
      expect(result.transactions).toHaveLength(1);
    });

    it("filters by combined from and to: returns transactions within the window", () => {
      createCreditLine("line-1");
      suspendCreditLine("line-1");
      const past = new Date(Date.now() - 60_000).toISOString();
      const future = new Date(Date.now() + 60_000).toISOString();
      const result = getTransactions("line-1", { from: past, to: future });
      expect(result.transactions).toHaveLength(2);
    });

    it("combined from/to range can produce an empty result", () => {
      createCreditLine("line-1");
      const past1 = new Date(Date.now() - 120_000).toISOString();
      const past2 = new Date(Date.now() - 60_000).toISOString();
      const result = getTransactions("line-1", { from: past1, to: past2 });
      expect(result.transactions).toHaveLength(0);
    });
  });

  describe("pagination", () => {
    it("defaults to page 1 with limit 20", () => {
      createCreditLine("line-1");
      const result = getTransactions("line-1");
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it("respects a custom limit", () => {
      createCreditLine("line-1");
      suspendCreditLine("line-1");
      closeCreditLine("line-1");
      const result = getTransactions("line-1", {}, { page: 1, limit: 2 });
      expect(result.transactions).toHaveLength(2);
    });

    it("returns the correct page of results", () => {
      createCreditLine("line-1");
      suspendCreditLine("line-1");
      closeCreditLine("line-1");
      const page2 = getTransactions("line-1", {}, { page: 2, limit: 2 });
      expect(page2.transactions).toHaveLength(1);
      expect(page2.transactions[0]!.metadata).toMatchObject({ action: "closed" });
    });

    it("returns an empty transactions array on a page beyond total", () => {
      createCreditLine("line-1");
      const result = getTransactions("line-1", {}, { page: 99, limit: 20 });
      expect(result.transactions).toHaveLength(0);
    });

    it("calculates totalPages correctly", () => {
      createCreditLine("line-1");
      suspendCreditLine("line-1");
      closeCreditLine("line-1");
      const result = getTransactions("line-1", {}, { page: 1, limit: 2 });
      expect(result.total).toBe(3);
      expect(result.totalPages).toBe(2);
    });

    it("totalPages is at least 1 when there are no transactions", () => {
      createCreditLine("line-1");
      const result = getTransactions("line-1", { type: "draw" });
      expect(result.totalPages).toBe(1);
    });

    it("returns all transactions on a single page when limit exceeds total", () => {
      createCreditLine("line-1");
      suspendCreditLine("line-1");
      const result = getTransactions("line-1", {}, { page: 1, limit: 100 });
      expect(result.transactions).toHaveLength(2);
      expect(result.totalPages).toBe(1);
    });
  });

  describe("isolation between credit lines", () => {
    it("does not mix transactions across different credit lines", () => {
      createCreditLine("line-a");
      createCreditLine("line-b");
      suspendCreditLine("line-b");
      const resultA = getTransactions("line-a");
      expect(resultA.total).toBe(1);
      expect(resultA.transactions.every((tx) => tx.creditLineId === "line-a")).toBe(true);
    });
  });
});