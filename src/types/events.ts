
export enum ContractEventType {
    CREDIT_LINE_CREATED = "credit_line_created",
    DRAW = "draw",
    REPAY = "repay",
    STATUS_CHANGE = "status_change",
}

export interface CreditLineCreatedPayload {
    walletAddress: string;
}

export interface DrawPayload {
    walletAddress: string;
    amount: string;
}

export interface RepayPayload {
    walletAddress: string;
    amount: string;
}

export interface StatusChangePayload {
    walletAddress: string;
    newStatus: "active" | "suspended" | "closed";
}

export type EventPayload =
    | CreditLineCreatedPayload
    | DrawPayload
    | RepayPayload
    | StatusChangePayload;
