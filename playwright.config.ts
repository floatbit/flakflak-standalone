import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  use: {
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        launchOptions: {
          executablePath:
            process.env.CHROME_BIN ||
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        },
      },
    },
    ...(process.env.FLAKFLAK_ALL_BROWSERS === "1"
      ? [
          { name: "firefox", use: { browserName: "firefox" as const } },
          { name: "webkit", use: { browserName: "webkit" as const } },
        ]
      : []),
  ],
  reporter: "list",
});
