import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'yaml';

const root = resolve(new URL('../..', import.meta.url).pathname);
const files = ['docs/openapi.yaml', 'src/openapi.yaml', 'openapi.yaml'];

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(
        ([key, nested]) => [key, sortKeys(nested)],
      ),
    );
  }
  return value;
}

function readSpec(file) {
  const path = resolve(root, file);
  try {
    return sortKeys(yaml.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    throw new Error(`Unable to parse ${file}: ${error instanceof Error ? error.message : error}`);
  }
}

const [canonical, ...generated] = files.map(readSpec);
for (const [index, artifact] of generated.entries()) {
  if (JSON.stringify(artifact) !== JSON.stringify(canonical)) {
    throw new Error(`OpenAPI drift detected: ${files[index + 1]} differs from docs/openapi.yaml. Run npm run generate:openapi.`);
  }
}

const requiredPaths = [
  '/api/credit/lines',
  '/api/credit/lines/{id}',
  '/api/credit/lines/{id}/transactions',
  '/api/risk/evaluate',
  '/health',
];
for (const path of requiredPaths) {
  if (!canonical.paths?.[path]) throw new Error(`OpenAPI is missing required path ${path}`);
}

console.log(`OpenAPI drift check passed for ${files.length} synchronized artifacts`);
