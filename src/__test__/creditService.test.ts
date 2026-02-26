
import { beforeEach } from "node:test";
import {
  createCreditLine,
  getCreditLine,
  listCreditLines,
  suspendCreditLine,
  closeCreditLine,
  InvalidTransitionError,
  CreditLineNotFoundError,
  _resetStore,
  _store,
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