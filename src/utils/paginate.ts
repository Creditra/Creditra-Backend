import { CreditLine } from '../data/creditLines.js';

export interface PaginationQuery {
  page?: string;
  pageSize?: string;
  status?: string;
  borrower?: string;
  sortBy?: string;
  sortDirection?: string;
}

export interface PaginatedResponse {
  items: CreditLine[];
  total: number;
  page: number;
  pageSize: number;
}

export function paginateAndFilter(
  data: CreditLine[],
  query: PaginationQuery
): PaginatedResponse {
  const parsedPage = parseInt(query.page ?? '1', 10);
  const parsedPageSize = parseInt(query.pageSize ?? '10', 10);
  const page = Math.max(1, isNaN(parsedPage) ? 1 : parsedPage);
  const pageSize = Math.min(100, Math.max(1, isNaN(parsedPageSize) ? 10 : parsedPageSize));
  const sortBy = query.sortBy ?? 'createdAt';
  const sortDirection = query.sortDirection === 'desc' ? 'desc' : 'asc';

  // Filtering
  let filtered = data.filter((item) => {
    if (query.status && item.status !== query.status) return false;
    if (query.borrower && !item.borrower.toLowerCase().includes(query.borrower.toLowerCase())) return false;
    return true;
  });

  // Sorting
  filtered.sort((a, b) => {
    const aVal = a[sortBy as keyof CreditLine] ?? '';
    const bVal = b[sortBy as keyof CreditLine] ?? '';
    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  // Pagination
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  return { items, total, page, pageSize };
}
