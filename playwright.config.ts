import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  use: {
    browserName: "chromium",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath:
        process.env.CHROME_BIN ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
    viewport: { width: 1280, height: 900 },
  },
  reporter: "list",
});
