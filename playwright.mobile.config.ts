import { defineConfig } from '@playwright/test';
import config from './playwright.config';

/** Run separately from Chromium so the shared machine owns only one test browser. */
export default defineConfig({
  ...config,
  testMatch: '**/browser-mobile.spec.ts',
  workers: 1,
  use: { ...config.use, browserName: 'webkit', channel: undefined, launchOptions: {} },
});
