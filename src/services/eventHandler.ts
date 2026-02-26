
import { HorizonEvent } from "./horizonListener.js";
import { ContractEventType, CreditLineCreatedPayload, DrawPayload, RepayPayload, StatusChangePayload } from "../types/events.js";
import * as creditService from "./creditService.js";
import crypto from "crypto";

// For production, use a persistent store (e.g. Redis or Postgres)
const processedEventHashes = new Set<string>();

/**
 * Generate a unique hash for an event to ensure idempotency.
 * Combines ledger, contractId, topics, and data.
 */
function getEventHash(event: HorizonEvent): string {
    const raw = `${event.ledger}:${event.contractId}:${event.topics.join(",")}:${event.data}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Process a raw Horizon event and map it to backend actions.
 */
export async function processEvent(event: HorizonEvent): Promise<void> {
    const eventHash = getEventHash(event);

    // Idempotency check
    if (processedEventHashes.has(eventHash)) {
        console.log(`[EventHandler] Skipping duplicate event: ${eventHash}`);
        return;
    }

    const topic = event.topics[0];
    if (!topic) {
        console.warn("[EventHandler] Event has no topics, ignoring.");
        return;
    }

    try {
        const data = JSON.parse(event.data);
        console.log(`[EventHandler] Processing event: ${topic} for contract ${event.contractId}`);

        switch (topic) {
            case ContractEventType.CREDIT_LINE_CREATED: {
                const payload = data as CreditLineCreatedPayload;
                creditService.createCreditLine(payload.walletAddress);
                console.log(`[EventHandler] Created credit line for ${payload.walletAddress}`);
                break;
            }
            case ContractEventType.DRAW: {
                const payload = data as DrawPayload;
                // Currently draws don't change state in creditService skeleton, 
                // but we log it as a transaction.
                console.log(`[EventHandler] Wallet ${payload.walletAddress} drew ${payload.amount}`);
                break;
            }
            case ContractEventType.REPAY: {
                const payload = data as RepayPayload;
                console.log(`[EventHandler] Wallet ${payload.walletAddress} repaid ${payload.amount}`);
                break;
            }
            case ContractEventType.STATUS_CHANGE: {
                const payload = data as StatusChangePayload;
                if (payload.newStatus === "suspended") {
                    creditService.suspendCreditLine(payload.walletAddress);
                } else if (payload.newStatus === "closed") {
                    creditService.closeCreditLine(payload.walletAddress);
                } else if (payload.newStatus === "active") {
                    // Logic to reactivate if service supported it
                    console.log(`[EventHandler] Wallet ${payload.walletAddress} status changed to active`);
                }
                break;
            }
            default:
                console.warn(`[EventHandler] Unhandled event topic: ${topic}`);
        }

        // Mark as processed
        processedEventHashes.add(eventHash);

    } catch (err) {
        console.error(`[EventHandler] Failed to process event ${topic}:`, err);
        // In a real system, we might want to retry or DLQ here.
        // For now, we let the listener's catch block handle it or just log it.
        throw err;
    }
}

/**
 * Utility for testing to clear the idempotency cache.
 */
export function _resetIdempotencyCache(): void {
    processedEventHashes.clear();
}
