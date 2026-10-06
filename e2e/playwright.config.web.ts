import { defineConfig } from '@playwright/test';
import base from './playwright.config.steel';
import { createProjects } from './setup/flows.cjs';

const chromiumProject =
  base.projects?.find((project) => project.name === 'chromium') ?? base.projects?.[0];

export default defineConfig({
  ...base,
  fullyParallel: false,
  workers: 1,
  projects: createProjects(chromiumProject),
});
