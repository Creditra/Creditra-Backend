import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('../..', import.meta.url).pathname);
const canonical = resolve(root, 'docs/openapi.yaml');

// docs/openapi.yaml is the reviewed source document. Runtime and root copies
// are generated artifacts and must never be edited independently.
for (const target of ['src/openapi.yaml', 'openapi.yaml']) {
  copyFileSync(canonical, resolve(root, target));
}
console.log('Generated src/openapi.yaml and openapi.yaml from docs/openapi.yaml');
