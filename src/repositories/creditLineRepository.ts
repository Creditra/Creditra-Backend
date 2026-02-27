import { CreditLine, _store } from "../services/creditService.js";

export interface CreditLineRepository {
  getAll(): CreditLine[];
  getById(id: string): CreditLine | undefined;
}

export const creditLineRepository: CreditLineRepository = {
  getAll(): CreditLine[] {
    return Array.from(_store.values());
  },
  getById(id: string): CreditLine | undefined {
    return _store.get(id);
  },
};
