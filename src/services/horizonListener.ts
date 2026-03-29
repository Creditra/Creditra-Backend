
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HorizonEvent {
    /** Ledger sequence number in which the event was recorded. */
    ledger: number;
    /** ISO-8601 timestamp of the ledger close. */
    timestamp: string;
    /** The Soroban contract ID that emitted this event. */
    contractId: string;
    /** Decoded event topic array (stringified for the skeleton). */
    topics: string[];
    /** Decoded event data payload (stringified for the skeleton). */
    data: string;
}


export type EventHandler = (event: HorizonEvent) => void | Promise<void>;

export interface HorizonListenerConfig {
    horizonUrl: string;
    contractIds: string[];
    pollIntervalMs: number;
    startLedger: string;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** Whether the listener loop is currently running. */
let running = false;

/** NodeJS timer handle for the polling interval. */
let intervalHandle: ReturnType<typeof setInterval> | null = null;

/** Registered event handlers. */
const eventHandlers: EventHandler[] = [];

/** Active configuration (set on start). */
let activeConfig: HorizonListenerConfig | null = null;

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

export function resolveConfig(): HorizonListenerConfig {
    const horizonUrl =
        process.env["HORIZON_URL"] ?? "https://horizon-testnet.stellar.org";

    const contractIdsRaw = process.env["CONTRACT_IDS"] ?? "";
    const contractIds = contractIdsRaw
        ? contractIdsRaw.split(",").map((id) => id.trim()).filter(Boolean)
        : [];

    const pollIntervalMs = parseInt(
        process.env["POLL_INTERVAL_MS"] ?? "5000",
        10,
    );

    const startLedger = process.env["HORIZON_START_LEDGER"] ?? "latest";

    return { horizonUrl, contractIds, pollIntervalMs, startLedger };
}

// ---------------------------------------------------------------------------
// Event dispatch
// ---------------------------------------------------------------------------

export function onEvent(handler: EventHandler): void {
    eventHandlers.push(handler);
}

export function clearEventHandlers(): void {
    eventHandlers.length = 0;
}


async function dispatchEvent(event: HorizonEvent): Promise<void> {
    for (const handler of eventHandlers) {
        try {
        await handler(event);
        } catch (err) {
        console.error(
            "[HorizonListener] Event handler threw an error:",
            err,
        );
        }
    }
}

// ---------------------------------------------------------------------------
// Simulated polling (skeleton — replace with real HTTP call in production)
// ---------------------------------------------------------------------------


export async function pollOnce(config: HorizonListenerConfig): Promise<void> {
    console.log(
        `[HorizonListener] Polling ${config.horizonUrl} ` +
        `(contracts: ${config.contractIds.length > 0 ? config.contractIds.join(", ") : "none"}, ` +
        `startLedger: ${config.startLedger})`,
    );

    if (config.contractIds.length > 0) {
        const simulatedEvent: HorizonEvent = {
        ledger: 1000,
        timestamp: new Date().toISOString(),
        contractId: config.contractIds[0]!,
        topics: ["credit_line_created"],
        data: JSON.stringify({ walletAddress: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" }),
        };

        console.log(
        "[HorizonListener] Simulated event received:",
        JSON.stringify(simulatedEvent),
        );

        await dispatchEvent(simulatedEvent);
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isRunning(): boolean {
    return running;
}

export function getConfig(): HorizonListenerConfig | null {
    return activeConfig;
}

export async function start(): Promise<void> {
    if (running) {
        console.warn("[HorizonListener] Already running — ignoring start() call.");
        return;
    }

    const config = resolveConfig();
    activeConfig = config;
    running = true;

    console.log("[HorizonListener] Starting with config:", {
        horizonUrl: config.horizonUrl,
        contractIds: config.contractIds,
        pollIntervalMs: config.pollIntervalMs,
        startLedger: config.startLedger,
    });

    await pollOnce(config);

    intervalHandle = setInterval(() => {
        void pollOnce(config);
    }, config.pollIntervalMs);

    console.log(
        `[HorizonListener] Started. Polling every ${config.pollIntervalMs}ms.`,
    );
}

export function stop(): void {
    if (!running) {
        console.warn("[HorizonListener] Not running — ignoring stop() call.");
        return;
    }

    if (intervalHandle !== null) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }

    running = false;
    activeConfig = null;

    console.log("[HorizonListener] Stopped.");
}