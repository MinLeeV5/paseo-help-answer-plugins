import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export default defineConfig({
  testDir: ".", testMatch: "desktop.spec.ts", fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:4178", viewport: { width: 1280, height: 820 },
    launchOptions: existsSync(chrome) ? { executablePath: chrome } : {} },
  webServer: { command: "node tests/serve.mjs", url: "http://127.0.0.1:4178", reuseExistingServer: !process.env.CI, cwd: process.cwd() },
});
