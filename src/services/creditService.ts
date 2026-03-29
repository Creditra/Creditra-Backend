import type { CreateCreditLineBody, DrawBody, RepayBody } from '../schemas/index.js';

export interface CreditLine {
  id: string;
  walletAddress: string;
  requestedLimit: string;
  status: 'pending' | 'active' | 'closed';
}

export interface DrawResult {
  id: string;
  walletAddress: string;
  amount: string;
  txHash: string | null;
  status: 'submitted' | 'pending';
}

export interface RepayResult {
  id: string;
  walletAddress: string;
  amount: string;
  txHash: string | null;
  status: 'submitted' | 'pending';
}

export interface SorobanClient {
  submitDraw(walletAddress: string, id: string, amount: string): Promise<string | null>;
  submitRepay(walletAddress: string, id: string, amount: string): Promise<string | null>;
}

export const noopSorobanClient: SorobanClient = {
  submitDraw: async () => null,
  submitRepay: async () => null,
};

export async function createCreditLine(body: CreateCreditLineBody): Promise<CreditLine> {
  return {
    id: 'placeholder-id',
    walletAddress: body.walletAddress,
    requestedLimit: body.requestedLimit,
    status: 'pending',
  };
}

export async function drawFromCreditLine(
  id: string,
  body: DrawBody,
  soroban: SorobanClient = noopSorobanClient,
): Promise<DrawResult> {
  const txHash = await soroban.submitDraw(body.walletAddress, id, body.amount);
  return {
    id,
    walletAddress: body.walletAddress,
    amount: body.amount,
    txHash,
    status: txHash !== null ? 'submitted' : 'pending',
  };
}

export async function repayCredit(
  id: string,
  body: RepayBody,
  soroban: SorobanClient = noopSorobanClient,
): Promise<RepayResult> {
  const txHash = await soroban.submitRepay(body.walletAddress, id, body.amount);
  return {
    id,
    walletAddress: body.walletAddress,
    amount: body.amount,
    txHash,
    status: txHash !== null ? 'submitted' : 'pending',
  };
}
