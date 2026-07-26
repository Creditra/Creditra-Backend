#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import yaml from 'yaml';

const root = process.cwd();
const openapiPath = path.join(root, 'src', 'openapi.yaml');
const methods = ['get', 'post', 'put', 'patch', 'delete'];
const methodSet = new Set(methods);

const mountedRouters = [
  {
    file: path.join(root, 'src', 'routes', 'health.ts'),
    router: 'healthRouter',
    basePath: '/health',
  },
  {
    file: path.join(root, 'src', 'routes', 'credit.ts'),
    router: 'creditRouter',
    basePath: '/api/credit',
  },
  {
    file: path.join(root, 'src', 'routes', 'risk.ts'),
    router: 'riskRouter',
    basePath: '/api/risk',
  },
  {
    file: path.join(root, 'src', 'routes', 'webhook.ts'),
    router: 'webhookRouter',
    basePath: '/api/webhooks',
  },
  {
    file: path.join(root, 'src', 'routes', 'reconciliation.ts'),
    router: 'reconciliationRouter',
    basePath: '/api/reconciliation',
  },
];

function normalizePath(value) {
  const cleaned = value.replace(/\/+/g, '/');
  if (cleaned.length > 1 && cleaned.endsWith('/')) {
    return cleaned.slice(0, -1);
  }
  return cleaned;
}

function expressToOpenApiPath(basePath, routePath) {
  const joined = routePath === '/'
    ? basePath
    : `${basePath}${routePath.startsWith('/') ? '' : '/'}${routePath}`;

  return normalizePath(joined).replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function routeKey(method, routePath) {
  return `${method.toUpperCase()} ${routePath}`;
}

function extractRuntimeRoutes() {
  const routes = new Map();

  for (const mounted of mountedRouters) {
    const source = fs.readFileSync(mounted.file, 'utf8');
    const matcher = new RegExp(
      `\\b${mounted.router}\\s*\\.\\s*(${methods.join('|')})\\s*\\(\\s*(['"\`])([^'"\`]+)\\2`,
      'g',
    );

    for (const match of source.matchAll(matcher)) {
      const [, method, , routePath] = match;
      const openApiPath = expressToOpenApiPath(mounted.basePath, routePath);
      const key = routeKey(method, openApiPath);
      const existing = routes.get(key);

      if (existing) {
        throw new Error(
          `Duplicate runtime route ${key} found in ${mounted.file}; already seen in ${existing.file}`,
        );
      }

      routes.set(key, {
        method,
        path: openApiPath,
        file: path.relative(root, mounted.file),
      });
    }
  }

  return routes;
}

function extractOpenApiRoutes() {
  const spec = yaml.parse(fs.readFileSync(openapiPath, 'utf8'));
  const paths = spec?.paths;

  if (!paths || typeof paths !== 'object') {
    throw new Error('src/openapi.yaml must define a top-level paths object.');
  }

  const routes = new Map();

  for (const [routePath, operations] of Object.entries(paths)) {
    if (!operations || typeof operations !== 'object') {
      continue;
    }

    for (const method of Object.keys(operations)) {
      if (!methodSet.has(method)) {
        continue;
      }

      const normalizedPath = normalizePath(routePath);
      const key = routeKey(method, normalizedPath);

      if (routes.has(key)) {
        throw new Error(`Duplicate OpenAPI route ${key} found in src/openapi.yaml.`);
      }

      routes.set(key, {
        method,
        path: normalizedPath,
        file: path.relative(root, openapiPath),
      });
    }
  }

  return routes;
}

function sortedKeys(map) {
  return Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
}

function diff(left, right) {
  return sortedKeys(left).filter((key) => !right.has(key));
}

const runtimeRoutes = extractRuntimeRoutes();
const openApiRoutes = extractOpenApiRoutes();
const missingFromOpenApi = diff(runtimeRoutes, openApiRoutes);
const staleInOpenApi = diff(openApiRoutes, runtimeRoutes);

if (missingFromOpenApi.length > 0 || staleInOpenApi.length > 0) {
  console.error('OpenAPI drift detected.');

  if (missingFromOpenApi.length > 0) {
    console.error('\nRuntime routes missing from src/openapi.yaml:');
    for (const key of missingFromOpenApi) {
      const route = runtimeRoutes.get(key);
      console.error(`  - ${key} (${route.file})`);
    }
  }

  if (staleInOpenApi.length > 0) {
    console.error('\nOpenAPI routes without a mounted Express route:');
    for (const key of staleInOpenApi) {
      console.error(`  - ${key} (src/openapi.yaml)`);
    }
  }

  console.error('\nUpdate src/openapi.yaml or the mounted route catalog in scripts/check-openapi-drift.mjs.');
  process.exit(1);
}

console.log(`OpenAPI drift check passed (${runtimeRoutes.size} mounted route operations).`);
