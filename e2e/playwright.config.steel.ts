import path from 'node:path';
import { defineConfig } from '@playwright/test';
import base from './playwright.config.mock';

const hook = path.resolve(__dirname, 'setup/fake-steel-catalog.cjs');
const servers = Array.isArray(base.webServer) ? base.webServer : [base.webServer];

export default defineConfig({
  ...base,
  testMatch: ['mock/steel-catalog-review.spec.ts'],
  webServer: servers.filter((server) => server !== undefined).map((server) => ({
    ...server,
    env: {
      ...server.env,
      STEEL_POSTGRES_URL: 'postgresql://fixture:fixture@127.0.0.1:9/catalog',
      NODE_OPTIONS: `${server.env?.NODE_OPTIONS ?? ''} --require=${hook}`.trim(),
    },
  })),
});
