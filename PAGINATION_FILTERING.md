# Credit Lines Pagination and Filtering

This document describes the pagination, filtering, and sorting capabilities for the `GET /api/credit/lines` endpoint.

## Endpoint
`GET /api/credit/lines`

## Query Parameters

### Pagination
- `page` (optional, default: `1`): The page number to retrieve (1-indexed).
- `pageSize` (optional, default: `10`, max: `100`): The number of items per page.

### Filtering
- `status` (optional): Filter items by their current status. Supported values: `active`, `suspended`, `closed`, `pending`, `defaulted`.
- `borrower` (optional): Filter items by the borrower's wallet address. Performs a partial, case-insensitive match.

### Sorting
- `sortBy` (optional, default: `createdAt`): The field to sort the results by. Supported values: `creditLimit`, `createdAt`, `interestRateBps`, `status`.
- `sortDirection` (optional, default: `asc`): The direction to sort. Supported values: `asc`, `desc`.

## Response Format
The endpoint returns a standardized paginated response:

```json
{
  "items": [
    {
      "id": "...",
      "walletAddress": "...",
      "creditLimit": "...",
      "availableCredit": "...",
      "interestRateBps": ...,
      "status": "...",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "total": 100,
  "page": 1,
  "pageSize": 10,
  "pagination": {
    "total": 100,
    "offset": 0,
    "limit": 10
  }
}
```

> [!NOTE]
> The `creditLines` field is also provided in the response for backwards compatibility.
