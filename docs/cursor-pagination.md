# Cursor Pagination for Credit Lines

## Overview

This document describes the cursor-based pagination implementation for the credit lines API endpoint. Cursor pagination provides stable, efficient pagination for large datasets and is the recommended approach for production use.

## Features

- **Backward Compatible**: The API supports both offset-based (legacy) and cursor-based pagination
- **Stable Results**: Cursor pagination ensures consistent results even when data changes between requests
- **Efficient**: No need to count total items or skip records
- **Simple**: Easy to implement in client applications

## API Usage

### Endpoint

```
GET /api/credit/lines
```

### Pagination Modes

#### 1. Cursor-Based Pagination (Recommended)

Use the `cursor` parameter to enable cursor-based pagination:

```bash
# First page
GET /api/credit/lines?cursor&limit=10

# Next page (use nextCursor from previous response)
GET /api/credit/lines?cursor=<nextCursor>&limit=10
```

**Response Format:**
```json
{
  "creditLines": [...],
  "pagination": {
    "limit": 10,
    "nextCursor": "base64EncodedCursor",
    "hasMore": true
  }
}
```

**Fields:**
- `limit`: Number of items per page
- `nextCursor`: Cursor for the next page (null if no more pages)
- `hasMore`: Boolean indicating if more results are available

#### 2. Offset-Based Pagination (Legacy)

Use `offset` and `limit` parameters for traditional pagination:

```bash
GET /api/credit/lines?offset=0&limit=10
```

**Response Format:**
```json
{
  "creditLines": [...],
  "pagination": {
    "total": 100,
    "offset": 0,
    "limit": 10
  }
}
```

## Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cursor` | string | No | - | Cursor for pagination. When present, enables cursor mode |
| `offset` | integer | No | 0 | Offset for legacy pagination (ignored if cursor is present) |
| `limit` | integer | No | 100 | Number of items per page (1-100) |

## Implementation Details

### Cursor Format

Cursors are base64-encoded strings containing:
- Timestamp of the last item (createdAt)
- ID of the last item

This ensures stable ordering even when items are added or removed.

### Ordering

Results are ordered by:
1. `createdAt` timestamp (ascending)
2. `id` (ascending, for items with same timestamp)

This provides a stable, deterministic ordering for pagination.

### Error Handling

The API returns 400 Bad Request for invalid parameters:
- `limit` must be between 1 and 100
- Invalid cursors are handled gracefully by starting from the beginning

## Client Implementation Examples

### JavaScript/TypeScript

```typescript
async function fetchAllCreditLines() {
  const allItems = [];
  let cursor = undefined;
  
  do {
    const url = cursor 
      ? `/api/credit/lines?cursor=${cursor}&limit=50`
      : '/api/credit/lines?cursor&limit=50';
    
    const response = await fetch(url);
    const data = await response.json();
    
    allItems.push(...data.creditLines);
    cursor = data.pagination.nextCursor;
  } while (cursor);
  
  return allItems;
}
```

### Python

```python
def fetch_all_credit_lines():
    all_items = []
    cursor = None
    
    while True:
        url = f"/api/credit/lines?cursor={cursor}&limit=50" if cursor else "/api/credit/lines?cursor&limit=50"
        response = requests.get(url)
        data = response.json()
        
        all_items.extend(data['creditLines'])
        cursor = data['pagination']['nextCursor']
        
        if not cursor:
            break
    
    return all_items
```

## Testing

Comprehensive tests are included for:
- First page retrieval
- Next page using cursor
- Last page detection (nextCursor = null)
- Cursor exhaustion
- Invalid cursor handling
- Stable ordering across pages
- Empty result sets
- Limit validation

Run tests with:
```bash
npm test
```

## Migration Guide

### For Existing Clients

No changes required! The API remains backward compatible with offset-based pagination.

### For New Implementations

Use cursor-based pagination for better performance and stability:

**Before (offset-based):**
```javascript
const response = await fetch('/api/credit/lines?offset=20&limit=10');
```

**After (cursor-based):**
```javascript
// First page
const firstPage = await fetch('/api/credit/lines?cursor&limit=10');

// Next page
const nextPage = await fetch(
  `/api/credit/lines?cursor=${firstPage.pagination.nextCursor}&limit=10`
);
```

## Performance Considerations

- **Cursor pagination**: O(n) where n is the position of the cursor
- **Offset pagination**: O(n) where n is the offset value
- For large offsets, cursor pagination is more efficient as it doesn't require counting/skipping records
- Cursor pagination provides consistent results even when data changes between requests

## Security Notes

- Cursors are opaque tokens and should not be parsed or modified by clients
- Invalid cursors are handled gracefully without exposing internal data structures
- No PII or sensitive data is included in cursors
- Rate limiting should be applied at the API gateway level

## Future Enhancements

Potential improvements for future versions:
- Bidirectional pagination (previous page support)
- Custom ordering fields
- Filtering support with cursor pagination
- Cursor expiration/validation
