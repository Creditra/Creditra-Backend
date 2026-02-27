export type CreditLineStatus = 'Active' | 'Closed' | 'Suspended';

export interface CreditLine {
     id: string;
     borrowerId: string;
     limit: number;
     utilized: number;
     status: CreditLineStatus;
}

export const creditLines: CreditLine[] = [
     {
          id: 'line-1',
          borrowerId: 'user-1',
          limit: 1000,
          utilized: 0,
          status: 'Active',
     },
];