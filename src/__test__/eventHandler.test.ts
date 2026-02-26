
import { describe, it, expect, vi, beforeEach } from "vitest";
import { processEvent, _resetIdempotencyCache } from "../services/eventHandler.js";
import * as creditService from "../services/creditService.js";
import { HorizonEvent } from "../services/horizonListener.js";

// Mock creditService
vi.mock("../services/creditService.js", () => ({
    createCreditLine: vi.fn(),
    suspendCreditLine: vi.fn(),
    closeCreditLine: vi.fn(),
}));

describe("eventHandler", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        _resetIdempotencyCache();
    });

    const mockEvent = (topic: string, data: any): HorizonEvent => ({
        ledger: 123,
        timestamp: "2024-01-01T00:00:00Z",
        contractId: "CONTRACT_XYZ",
        topics: [topic],
        data: JSON.stringify(data),
    });

    it("processes credit_line_created event", async () => {
        const event = mockEvent("credit_line_created", { walletAddress: "GABC" });
        await processEvent(event);
        expect(creditService.createCreditLine).toHaveBeenCalledWith("GABC");
    });

    it("processes status_change (suspended) event", async () => {
        const event = mockEvent("status_change", { walletAddress: "GABC", newStatus: "suspended" });
        await processEvent(event);
        expect(creditService.suspendCreditLine).toHaveBeenCalledWith("GABC");
    });

    it("processes status_change (closed) event", async () => {
        const event = mockEvent("status_change", { walletAddress: "GABC", newStatus: "closed" });
        await processEvent(event);
        expect(creditService.closeCreditLine).toHaveBeenCalledWith("GABC");
    });

    it("processes status_change (active) event", async () => {
        const event = mockEvent("status_change", { walletAddress: "GABC", newStatus: "active" });
        await processEvent(event);
        // Just logs, no service call expected yet
        expect(creditService.suspendCreditLine).not.toHaveBeenCalled();
    });

    it("processes status_change (unknown) event", async () => {
        const event = mockEvent("status_change", { walletAddress: "GABC", newStatus: "unknown" });
        await processEvent(event);
        // Should just be a no-op/log
        expect(creditService.suspendCreditLine).not.toHaveBeenCalled();
    });

    it("handles draw and repay events (logging only for now)", async () => {
        const drawEvent = mockEvent("draw", { walletAddress: "GABC", amount: "100" });
        const repayEvent = mockEvent("repay", { walletAddress: "GABC", amount: "50" });

        await processEvent(drawEvent);
        await processEvent(repayEvent);

        // No service calls expected yet for these
        expect(creditService.createCreditLine).not.toHaveBeenCalled();
    });

    it("enforces idempotency", async () => {
        const event = mockEvent("credit_line_created", { walletAddress: "GABC" });

        await processEvent(event);
        await processEvent(event); // Second time

        expect(creditService.createCreditLine).toHaveBeenCalledTimes(1);
    });

    it("skips event with no topics", async () => {
        const event = mockEvent("any", { data: "test" });
        event.topics = [];

        await processEvent(event);
        expect(creditService.createCreditLine).not.toHaveBeenCalled();
    });

    it("handles malformed JSON data gracefully", async () => {
        const event = mockEvent("credit_line_created", {});
        event.data = "{ invalid json }";

        await expect(processEvent(event)).rejects.toThrow();
    });

    it("logs warning for unhandled topics", async () => {
        const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => { });
        const event = mockEvent("unknown_topic", { data: "test" });

        await processEvent(event);

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Unhandled event topic"));
        consoleSpy.mockRestore();
    });
});
