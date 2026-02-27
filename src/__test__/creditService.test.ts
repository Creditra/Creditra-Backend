
import { beforeEach } from "vitest";
import {
  createCreditLine,
  getCreditLine,
  listCreditLines,
  suspendCreditLine,
  closeCreditLine,
  repayCreditLine,
  InvalidTransitionError,
  CreditLineNotFoundError,
  InvalidRepaymentError,
  _resetStore,
  _store,
} from "../services/creditService.js";


    
beforeEach(() => {
  _resetStore();
});


describe("createCreditLine()", () => {
  it("creates a credit line with 'active' status by default", () => {
    const line = createCreditLine("line-1");
    expect(line.status).toBe("active");
  });

  it("creates a credit line with default credit limit and currency", () => {
    const line = createCreditLine("line-1");
    expect(line.creditLimit).toBe(1000);
    expect(line.currency).toBe("USDC");
    expect(line.utilizedAmount).toBe(0);
  });

  it("allows custom credit limit and currency", () => {
    const line = createCreditLine("line-1", "active", 5000, "USD");
    expect(line.creditLimit).toBe(5000);
    expect(line.currency).toBe("USD");
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

describe("repayCreditLine()", () => {
  describe("valid repayments", () => {
    it("processes full repayment correctly", () => {
      const line = createCreditLine("line-1", "active", 1000);
      // Simulate some utilization
      line.utilizedAmount = 500;

      const result = repayCreditLine("line-1", { amount: 500 });

      expect(result.repaymentAmount).toBe(500);
      expect(result.newUtilizedAmount).toBe(0);
      expect(result.creditLine.utilizedAmount).toBe(0);
      expect(result.creditLine.events).toHaveLength(2);
      expect(result.creditLine.events[1]!.action).toBe("repayment");
      expect(result.creditLine.events[1]!.amount).toBe(500);
    });

    it("processes partial repayment correctly", () => {
      const line = createCreditLine("line-1", "active", 1000);
      line.utilizedAmount = 500;

      const result = repayCreditLine("line-1", { amount: 200 });

      expect(result.repaymentAmount).toBe(200);
      expect(result.newUtilizedAmount).toBe(300);
      expect(result.creditLine.utilizedAmount).toBe(300);
    });

    it("includes transaction reference when provided", () => {
      const line = createCreditLine("line-1", "active", 1000);
      line.utilizedAmount = 500;

      const result = repayCreditLine("line-1", {
        amount: 200,
        transactionReference: "tx-abc123"
      });

      expect(result.creditLine.events[1]!.transactionReference).toBe("tx-abc123");
    });

    it("updates the updatedAt timestamp", () => {
      const line = createCreditLine("line-1", "active", 1000);
      line.utilizedAmount = 500;
      const before = line.updatedAt;

      const result = repayCreditLine("line-1", { amount: 200 });

      expect(new Date(result.creditLine.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(before).getTime()
      );
    });

    it("persists changes in the store", () => {
      const line = createCreditLine("line-1", "active", 1000);
      line.utilizedAmount = 500;

      repayCreditLine("line-1", { amount: 200 });

      const stored = getCreditLine("line-1");
      expect(stored?.utilizedAmount).toBe(300);
      expect(stored?.events).toHaveLength(2);
    });
  });

  describe("invalid repayments", () => {
    it("throws InvalidRepaymentError for zero amount", () => {
      const line = createCreditLine("line-1", "active", 1000);
      line.utilizedAmount = 500;

      expect(() => repayCreditLine("line-1", { amount: 0 })).toThrow(InvalidRepaymentError);
      expect(() => repayCreditLine("line-1", { amount: 0 })).toThrow(/must be positive/);
    });

    it("throws InvalidRepaymentError for negative amount", () => {
      const line = createCreditLine("line-1", "active", 1000);
      line.utilizedAmount = 500;

      expect(() => repayCreditLine("line-1", { amount: -100 })).toThrow(InvalidRepaymentError);
    });

    it("throws InvalidRepaymentError when repayment exceeds utilized amount", () => {
      const line = createCreditLine("line-1", "active", 1000);
      line.utilizedAmount = 300;

      expect(() => repayCreditLine("line-1", { amount: 400 })).toThrow(InvalidRepaymentError);
      expect(() => repayCreditLine("line-1", { amount: 400 })).toThrow(/cannot exceed utilized amount/);
    });

    it("allows repayment equal to utilized amount", () => {
      const line = createCreditLine("line-1", "active", 1000);
      line.utilizedAmount = 300;

      expect(() => repayCreditLine("line-1", { amount: 300 })).not.toThrow();
    });

    it("throws InvalidTransitionError for suspended credit line", () => {
      const line = createCreditLine("line-1", "suspended", 1000);
      line.utilizedAmount = 500;

      expect(() => repayCreditLine("line-1", { amount: 200 })).toThrow(InvalidTransitionError);
      expect(() => repayCreditLine("line-1", { amount: 200 })).toThrow(/repay.*suspended/);
    });

    it("throws InvalidTransitionError for closed credit line", () => {
      const line = createCreditLine("line-1", "closed", 1000);
      line.utilizedAmount = 500;

      expect(() => repayCreditLine("line-1", { amount: 200 })).toThrow(InvalidTransitionError);
    });

    it("throws CreditLineNotFoundError for unknown id", () => {
      expect(() => repayCreditLine("ghost", { amount: 100 })).toThrow(CreditLineNotFoundError);
      expect(() => repayCreditLine("ghost", { amount: 100 })).toThrow(/ghost/);
    });
  });

  describe("edge cases", () => {
    it("handles repayment when utilized amount is zero", () => {
      const line = createCreditLine("line-1", "active", 1000);
      // utilizedAmount is 0 by default

      expect(() => repayCreditLine("line-1", { amount: 1 })).toThrow(InvalidRepaymentError);
      expect(() => repayCreditLine("line-1", { amount: 1 })).toThrow(/cannot exceed utilized amount/);
    });

    it("handles multiple sequential repayments", () => {
      const line = createCreditLine("line-1", "active", 1000);
      line.utilizedAmount = 500;

      repayCreditLine("line-1", { amount: 200 });
      repayCreditLine("line-1", { amount: 150 });

      const stored = getCreditLine("line-1");
      expect(stored?.utilizedAmount).toBe(150);
      expect(stored?.events).toHaveLength(3); // created + 2 repayments
    });
  });
});
