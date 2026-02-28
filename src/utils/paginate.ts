import { CreditLine } from '../data/creditLines.js';

export interface PaginationQuery {
  page?: string;
  pageSize?: string;
  status?: string;
  borrower?: string;
  sortBy?: string;
  sortDirection?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function paginateAndFilter<T>(
  data: T[],
  query: PaginationQuery,
  fieldMapping: Record<string, keyof T> = {} as any
): PaginatedResponse<T> {
  const parsedPage = parseInt(query.page ?? '1', 10);
  const parsedPageSize = parseInt(query.pageSize ?? '10', 10);
  const page = Math.max(1, isNaN(parsedPage) ? 1 : parsedPage);
  const pageSize = Math.min(100, Math.max(1, isNaN(parsedPageSize) ? 10 : parsedPageSize));
  
  // map the generic sortBy to actual object key, fallback to createdAt
  const sortByKey = query.sortBy ? (fieldMapping[query.sortBy] || query.sortBy as keyof T) : ('createdAt' as keyof T);
  const sortDirection = query.sortDirection === 'desc' ? 'desc' : 'asc';

  // Filtering
  let filtered = data.filter((item) => {
    // extract mapped keys for filtering
    const statusKey = fieldMapping['status'] || 'status' as keyof T;
    const borrowerKey = fieldMapping['borrower'] || 'borrower' as keyof T;

    if (query.status && item[statusKey] !== query.status) return false;
    
    const borrowerVal = item[borrowerKey];
    if (query.borrower && borrowerVal) {
        if (typeof borrowerVal === 'string' && !borrowerVal.toLowerCase().includes(query.borrower.toLowerCase())) return false;
    } else if (query.borrower && !borrowerVal) {
        return false;
    }
    return true;
  });

  // Sorting
  filtered.sort((a, b) => {
    const aVal = a[sortByKey] ?? '';
    const bVal = b[sortByKey] ?? '';
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
