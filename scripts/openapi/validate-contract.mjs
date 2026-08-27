import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'yaml';

const root = resolve(new URL('../..', import.meta.url).pathname);
const spec = yaml.parse(readFileSync(resolve(root, 'docs/openapi.yaml'), 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(`OpenAPI contract validation failed: ${message}`);
}

const creditList = spec.paths['/api/credit/lines']?.get;
assert(creditList, 'credit-line list operation is missing');
assert(creditList.parameters.some(parameter => parameter.name === 'limit'), 'credit list must expose limit');
assert(creditList.parameters.some(parameter => parameter.name === 'cursor'), 'credit list must expose cursor');
assert(creditList.responses['400'], 'credit list must describe validation errors');

const transactionList = spec.paths['/api/credit/lines/{id}/transactions']?.get;
assert(transactionList, 'transaction history operation is missing');
assert(transactionList.parameters.some(parameter => parameter.name === 'cursor'), 'transaction history must expose cursor');
assert(transactionList.responses['400'], 'transaction history must describe validation errors');

const schemas = spec.components?.schemas ?? {};
assert(schemas.ErrorResponse, 'ErrorResponse schema is required');
assert(schemas.CreditLine, 'CreditLine schema is required');
assert(schemas.Transaction, 'Transaction schema is required');
assert(schemas.TransactionHistoryResponse, 'TransactionHistoryResponse schema is required');

console.log('OpenAPI representative contract checks passed');
