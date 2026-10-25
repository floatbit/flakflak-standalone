import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const apiOrigin = "http://api-flakflak.localhost",
  appOrigin = "http://app-flakflak.localhost",
  embedOrigin = "http://embed-flakflak.localhost";
const backend = process.env.E2E_BACKEND || "http://127.0.0.1:8081";
let key = "",
  siteId = "";
test.beforeAll(async ({ request }) => {
  const env = await fs.readFile(path.join(root, "api/.env"), "utf8");
  key = env.match(/^FLAKFLAK_OWNER_KEY=(.+)$/m)![1];
  const res = await request.post(backend + "/api/v1/sites", {
    headers: { Origin: appOrigin, Authorization: "Bearer " + key },
    data: { name: "Browser test workspace", origins: [appOrigin, embedOrigin] },
  });
  expect(res.ok()).toBeTruthy();
  siteId = (await res.json()).id;
});
test.beforeEach(async ({ page }) => {
  await page.route(
    /^http:\/\/(api|app|embed)-flakflak\.localhost\//,
    async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === apiOrigin) {
        const response = await route.fetch({
          url: backend + url.pathname + url.search,
          headers: { ...route.request().headers(), host: url.host },
        });
        await route.fulfill({ response });
        return;
      }
      const folder = url.origin === appOrigin ? "app/dist" : "embed/dist";
      const file = path.resolve(
        root,
        folder,
        "." + (url.pathname === "/" ? "/index.html" : url.pathname),
      );
      if (!file.startsWith(path.resolve(root, folder) + path.sep)) {
        await route.abort();
        return;
      }
      try {
        const body = await fs.readFile(file);
        const ext = path.extname(file);
        await route.fulfill({
          body,
          contentType:
            ext === ".js"
              ? "application/javascript"
              : ext === ".css"
                ? "text/css"
                : "text/html",
        });
      } catch {
        await route.fulfill({ status: 404, body: "Not found" });
      }
    },
  );
});
test("dashboard, guest comment, reply, resolution, file gallery, reload, and second origin", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(appOrigin);
  await page.getByLabel("Owner key").fill(key);
  await page.getByRole("button", { name: "Open dashboard" }).click();
  await expect(
    page.getByText("Browser test workspace", { exact: true }).first(),
  ).toBeVisible();
  await page.goto(appOrigin + "/demo.html?site=" + siteId);
  await expect(
    page.getByRole("button", { name: "FlakFlak · Feedback" }),
  ).toBeVisible();
  await page
    .locator("#intro p")
    .click({ modifiers: ["Shift"], position: { x: 60, y: 12 } });
  await page
    .getByRole("textbox", { name: "Your name", exact: true })
    .fill("Chris");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Comment", exact: true })
    .fill("Check the introductory paragraph");
  await page
    .getByRole("textbox", { name: "Comment", exact: true })
    .press("Meta+Enter");
  await expect(
    page.getByText("Check the introductory paragraph", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Reply", exact: true })
    .fill("This is a browser-tested reply");
  await page
    .getByRole("textbox", { name: "Reply", exact: true })
    .press("Control+Enter");
  await expect(
    page.getByText("This is a browser-tested reply", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Add attachments")).toBeEnabled();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6x8AAAAASUVORK5CYII=",
    "base64",
  );
  await page
    .getByLabel("Add attachments")
    .setInputFiles({ name: "capture.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("img", { name: "capture.png" })).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: "capture.png" })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.getByRole("img", { name: "capture.png" }).click();
  await expect(page.getByRole("dialog", { name: "Attachments" })).toBeVisible();
  await page
    .getByRole("dialog", { name: "Attachments" })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "Closed", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Resolution note", exact: true })
    .fill("Checked and approved");
  await page
    .getByRole("textbox", { name: "Resolution note", exact: true })
    .press("Meta+Enter");
  await expect(
    page.getByRole("button", { name: "Closed", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await page.getByRole("button", { name: "FlakFlak · Feedback" }).click();
  await expect(page.getByText("100% finished")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Show closed comments").check();
  await page.getByRole("button", { name: "Comments", exact: true }).click();
  await page
    .getByRole("button", { name: "Check the introductory paragraph" })
    .click();
  await expect(
    page.getByText("Check the introductory paragraph", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Comment", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.screenshot({
    path: "/private/tmp/flakflak-widget-desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const bounds = await page
    .getByRole("dialog", { name: "Comment", exact: true })
    .boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: "/private/tmp/flakflak-widget-mobile.png" });
  const other = await context.newPage();
  await other.route(
    /^http:\/\/(api|app|embed)-flakflak\.localhost\//,
    async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === apiOrigin) {
        const response = await route.fetch({
          url: backend + url.pathname + url.search,
          headers: { ...route.request().headers(), host: url.host },
        });
        await route.fulfill({ response });
        return;
      }
      const file = path.join(
        root,
        "embed/dist",
        url.pathname === "/" ? "demo.html" : url.pathname,
      );
      try {
        await route.fulfill({
          body: await fs.readFile(file),
          contentType: url.pathname.endsWith(".js")
            ? "application/javascript"
            : "text/html",
        });
      } catch {
        await route.fulfill({ status: 404, body: "Not found" });
      }
    },
  );
  await other.goto(embedOrigin + "/demo.html?site=" + siteId);
  await expect(
    other.getByRole("button", { name: "FlakFlak · Feedback" }),
  ).toBeVisible();
  await other.getByRole("button", { name: "FlakFlak · Feedback" }).click();
  await expect(other.getByText("1 active")).toHaveCount(0);
  await expect(other.getByText("100% finished")).toBeVisible();
  expect(errors).toEqual([]);
});
