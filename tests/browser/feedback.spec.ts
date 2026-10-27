import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
async function openSidebar(page: Page) {
  const launcher = page.getByRole("button", { name: "FlakFlak · Feedback" });
  await expect(launcher).toHaveAttribute("aria-expanded", /true|false/);
  if ((await launcher.getAttribute("aria-expanded")) !== "true")
    await launcher.click();
}
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
test.beforeEach(async ({ page, request, context, browserName }) => {
  if (browserName === "chromium")
    for (const origin of [appOrigin, embedOrigin])
      await context.grantPermissions(["local-network-access"], { origin });
  if (process.env.FLAKFLAK_DEBUG_NETWORK === "1") {
    page.on("requestfailed", (request) =>
      console.log("NETWORK", request.url(), request.failure()?.errorText),
    );
    page.on("console", (message) => {
      if (message.type() === "error") console.log("BROWSER", message.text());
    });
  }
  const setup = await request.post(backend + "/api/v1/sites", {
    headers: { Origin: appOrigin, Authorization: "Bearer " + key },
    data: { name: "Browser test workspace", origins: [appOrigin, embedOrigin] },
  });
  expect(setup.ok()).toBeTruthy();
  siteId = (await setup.json()).id;
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
        let body = await fs.readFile(file);
        // Native browser requests preserve multipart bytes in WebKit; interception does not.
        if (url.origin === embedOrigin && url.pathname === "/widget.js")
          body = Buffer.concat([
            Buffer.from(
              "document.currentScript.dataset.apiUrl=" +
                JSON.stringify(backend + "/api/v1") +
                ";",
            ),
            body,
          ]);
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
    .fill("This is a browser-tested reply http://reddit.com?f=222&a=2");
  await page
    .getByRole("textbox", { name: "Reply", exact: true })
    .press("Control+Enter");
  await expect(
    page.getByText(
      "This is a browser-tested reply http://reddit.com?f=222&a=2",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "http://reddit.com?f=222&a=2",
      exact: true,
    }),
  ).toHaveAttribute("href", "http://reddit.com/?f=222&a=2");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Add attachments")).toBeEnabled();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6x8AAAAASUVORK5CYII=",
    "base64",
  );
  await page.getByLabel("Add attachments").setInputFiles([
    { name: "capture.png", mimeType: "image/png", buffer: png },
    { name: "capture-2.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(page.getByRole("img", { name: "capture.png" })).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: "capture.png" })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(
    page.getByRole("img", { name: "capture-2.png", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Add attachments")).toBeEnabled();
  await page.locator(".attachments-section .files img").first().click();
  await expect(page.getByRole("dialog", { name: "Attachments" })).toBeVisible();
  const viewer = page.getByRole("dialog", { name: "Attachments" });
  expect(await viewer.boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: page.viewportSize()!.width,
    height: page.viewportSize()!.height,
  });
  await expect(viewer).toHaveCSS("border-radius", "0px");
  await expect(viewer).toHaveCSS("border-top-width", "0px");
  await expect(viewer.getByText("1 / 2", { exact: true })).toBeVisible();
  await page
    .locator("[data-flakflak-root]")
    .evaluate((node) => node.setAttribute("data-theme", "macos9"));
  await expect(viewer.getByText("1 / 2", { exact: true })).toHaveCSS(
    "color",
    "rgb(255, 255, 255)",
  );
  await page
    .locator("[data-flakflak-root]")
    .evaluate((node) => node.setAttribute("data-theme", "graphite"));

  await viewer.getByRole("button", { name: "← Previous", exact: true }).click();
  await expect(viewer.getByText("2 / 2", { exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Next →", exact: true }).click();
  await expect(viewer.getByText("1 / 2", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Comment", exact: true }),
  ).toBeVisible();
  await page.getByRole("img", { name: "capture.png", exact: true }).click();

  await page
    .getByRole("dialog", { name: "Attachments" })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "Content", exact: true }).click();
  await page.getByRole("button", { name: "Open", exact: true }).click();
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
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Delete comment", exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: /Show earlier replies/ }).click();
  await expect(page.locator(".history-status")).toHaveCount(4);
  for (const theme of [
    "windowsxp",
    "macos9",
    "linen",
    "macintosh",
    "windows311",
    "gameboy",
  ]) {
    await page
      .locator("[data-flakflak-root]")
      .evaluate((node, value) => node.setAttribute("data-theme", value), theme);
    const statusColors = await page
      .locator(".history-status")
      .evaluateAll((nodes) =>
        Object.fromEntries(
          nodes.map((node) => [
            node.getAttribute("data-status"),
            getComputedStyle(node).color,
          ]),
        ),
      );
    expect(Object.keys(statusColors)).toHaveLength(4);
    expect(new Set(Object.values(statusColors)).size).toBe(4);
    await expect(
      page.locator('.status-grid button[aria-pressed="true"]'),
    ).toHaveCSS("color", "rgb(255, 255, 255)");
  }
  await page.reload();
  await openSidebar(page);
  await expect(page.getByText("100% finished")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Show closed comments").check();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
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
          body:
            url.pathname === "/widget.js"
              ? Buffer.concat([
                  Buffer.from(
                    "document.currentScript.dataset.apiUrl=" +
                      JSON.stringify(backend + "/api/v1") +
                      ";",
                  ),
                  await fs.readFile(file),
                ])
              : await fs.readFile(file),
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
  await openSidebar(other);
  await expect(other.getByText("1 active")).toHaveCount(0);
  await expect(other.getByText("100% finished")).toBeVisible();
  expect(errors).toEqual([]);
});

test("settings persist, stay isolated from the host page, and fit review navigation beside either sidebar", async ({
  page,
  request,
}) => {
  const origin = { Origin: appOrigin };
  const guestResponse = await request.post(
    backend + "/api/v1/sites/" + siteId + "/guests",
    { headers: origin, data: { name: "Settings tester" } },
  );
  expect(guestResponse.status()).toBe(201);
  const person = await guestResponse.json();
  for (const [index, status] of ["open", "content"].entries()) {
    const result = await request.post(
      backend + "/api/v1/sites/" + siteId + "/comments",
      {
        headers: { ...origin, Authorization: "Bearer " + person.token },
        data: {
          url: appOrigin + "/demo.html?site=" + siteId,
          title: "Settings demo",
          body: "Settings navigation " + index,
          status,
          client_id: crypto.randomUUID(),
          anchor: {
            selector: "#intro p",
            text: "Mark this text, leave a reply, or attach a screenshot.",
            x: 0.5,
            y: 0.5,
            documentX: 600,
            documentY: 550,
            viewportWidth: 1280,
          },
        },
      },
    );
    expect(
      result.status(),
      (await result.json()).message || "Comment fixture should be created",
    ).toBe(201);
  }
  await page.goto(appOrigin + "/demo.html?site=" + siteId);
  const originalFont = await page
    .locator("#intro p")
    .evaluate((node) => getComputedStyle(node).fontFamily);
  const launcher = page.getByRole("button", { name: "FlakFlak · Feedback" });
  await launcher.click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Comments", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Graphite", exact: true }).click();
  await page.getByRole("button", { name: "Right", exact: true }).click();
  await page.getByRole("button", { name: "Large", exact: true }).click();
  await page.getByLabel("Pause dot animations").check();
  await page.getByLabel("Hide dots", { exact: true }).check();
  const host = page.locator("[data-flakflak-root]");
  await expect(host).toHaveAttribute("data-theme", "graphite");
  await expect(host).toHaveAttribute("data-side", "right");
  await expect(host).toHaveAttribute("data-size", "large");
  const widgetFont = await host.evaluate(
    (node) => getComputedStyle(node).fontFamily,
  );
  const intrusive = await page.addStyleTag({
    content:
      "* { font-family: serif !important; font-weight: 900 !important; }",
  });
  expect(await host.evaluate((node) => getComputedStyle(node).fontFamily)).toBe(
    widgetFont,
  );
  expect(await host.evaluate((node) => getComputedStyle(node).fontWeight)).toBe(
    "400",
  );
  await intrusive.evaluate((node) => node.remove());
  expect(
    await page
      .locator("#intro p")
      .evaluate((node) => getComputedStyle(node).fontFamily),
  ).toBe(originalFont);
  await expect(
    page.getByRole("button", { name: /Open comment #/ }),
  ).toHaveCount(0);
  await page.reload();
  await openSidebar(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Graphite", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Pause dot animations")).toBeChecked();
  await expect(page.getByLabel("Hide dots", { exact: true })).toBeChecked();
  await page.screenshot({ path: "/private/tmp/flakflak-settings-desktop.png" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await host.evaluate((node) => node.setAttribute("data-theme", "macos9"));
  const groupAction = page.getByRole("button", {
    name: "Collapse all",
    exact: true,
  });
  await expect(groupAction).toHaveCSS("box-shadow", "none");
  await expect(groupAction).toHaveCSS("border-radius", "4px");
  await page.getByRole("button", { name: "Collapse all", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Expand all", exact: true }),
  ).toBeVisible();
  await page.reload();
  await openSidebar(page);
  await expect(
    page.getByRole("button", { name: "Expand all", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Expand all", exact: true }).click();
  await page.getByRole("button", { name: /Settings navigation 0/ }).click();
  const nav = page.getByRole("navigation", { name: "Review navigation" });
  await expect(nav.getByText("1 of 2")).toBeVisible();
  await nav.getByRole("button", { name: "Next →", exact: true }).click();
  await expect(nav.getByText("2 of 2")).toBeVisible();
  const panel = await page
      .getByRole("dialog", { name: "Comment", exact: true })
      .boundingBox(),
    sidebar = await page
      .getByRole("complementary", { name: "FlakFlak sidebar" })
      .boundingBox();
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(sidebar!.x - 12);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Left", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const leftPanel = await page
      .getByRole("dialog", { name: "Comment", exact: true })
      .boundingBox(),
    leftSidebar = await page
      .getByRole("complementary", { name: "FlakFlak sidebar" })
      .boundingBox();
  expect(leftPanel!.x).toBeGreaterThanOrEqual(
    leftSidebar!.x + leftSidebar!.width + 12,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("dialog", { name: "Comment", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.screenshot({ path: "/private/tmp/flakflak-settings-mobile.png" });
});

test("ownership, reattachment cancel/confirm, dragging, reply pages and failed-upload retries", async ({
  page,
  request,
  browserName,
}) => {
  const url = appOrigin + "/demo.html?site=" + siteId;
  await page.goto(url);
  await expect(
    page.getByRole("button", { name: "FlakFlak · Feedback" }),
  ).toBeVisible();
  await page
    .locator("#intro p")
    .click({ modifiers: ["Shift"], position: { x: 100, y: 10 } });
  await page
    .getByRole("textbox", { name: "Your name", exact: true })
    .fill("Port tester");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Comment", exact: true })
    .fill("Interaction parity thread");
  await page
    .getByRole("textbox", { name: "Comment", exact: true })
    .press("Meta+Enter");
  const dialog = page.getByRole("dialog", { name: "Comment", exact: true });
  await expect(
    dialog.getByRole("button", { name: "Reply", exact: true }),
  ).toBeEnabled();
  const id = Number(
    (await dialog.locator(".titlebar strong").innerText()).match(/#(\d+)/)![1],
  );
  const identity = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem("flakflak:guest:" + id)!),
    siteId,
  );
  const headers = {
    Origin: appOrigin,
    Authorization: "Bearer " + identity.token,
  };
  const path = "/api/v1/sites/" + siteId + "/comments/" + id;
  const detail = async () =>
    (await request.get(backend + path, { headers })).json();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          sessionStorage.setItem("test-copied-link", text);
        },
      },
    }),
  );
  await dialog.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Copied!", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("test-copied-link")),
  ).toContain("#flakflak-comment-" + id);
  await expect(
    dialog.getByRole("button", { name: "Copy link", exact: true }),
  ).toBeVisible();

  await expect(
    dialog.getByRole("button", { name: "Details", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await dialog
    .getByRole("button", { name: "Edit comment", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Edit comment", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "Edit comment", exact: true }),
  ).toHaveValue("Interaction parity thread");
  await dialog
    .getByRole("button", { name: "Cancel edit", exact: true })
    .click();
  await expect(
    dialog.getByText("Interaction parity thread", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Edit comment", exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: "Edit comment", exact: true })
    .fill("Edited interaction thread");
  await dialog
    .getByRole("textbox", { name: "Edit comment", exact: true })
    .press("Meta+Enter");
  await expect(
    dialog.getByText("Edited interaction thread", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Reply", exact: true }),
  ).toBeEnabled();
  let loseFirstResponse = true;
  await page.route("**/comments/*/attachments*", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    if (browserName === "webkit") {
      if (loseFirstResponse) {
        loseFirstResponse = false;
        await route.abort("failed");
        return;
      }
      await route.continue();
      return;
    }
    const original = new URL(route.request().url());
    const response = await route.fetch({
      url: backend + original.pathname + original.search,
      headers: { ...route.request().headers(), host: original.host },
    });
    if (loseFirstResponse) {
      loseFirstResponse = false;
      await route.abort("failed");
      return;
    }
    await route.fulfill({ response });
  });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6x8AAAAASUVORK5CYII=",
    "base64",
  );
  await dialog
    .getByLabel("Add attachments")
    .setInputFiles({ name: "retry.png", mimeType: "image/png", buffer: png });
  await expect(
    dialog.getByRole("button", { name: "Retry upload", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Retry upload", exact: true })
    .click();
  await expect(dialog.getByRole("img", { name: "retry.png" })).toBeVisible();
  expect((await detail()).attachments).toHaveLength(1);
  if (await page.getByRole("button", { name: "Dismiss", exact: true }).count())
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  const originalAnchor = (await detail()).comment.anchor;
  await openSidebar(page);
  await dialog.getByRole("button", { name: "Details", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Reposition Dot", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "FlakFlak sidebar" }),
  ).toBeHidden();
  await page.locator("#two p").click();
  await expect(
    page.getByRole("button", { name: "Confirm placement", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect((await detail()).comment.anchor).toEqual(originalAnchor);
  await dialog.getByRole("button", { name: "Details", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Reposition Dot", exact: true })
    .click();
  await page.locator("#two p").click();
  await page
    .getByRole("button", { name: "Confirm placement", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () => (await detail()).comment.anchor.selector)
    .toBe("#two > p");
  await expect(
    dialog.getByRole("button", { name: "Reply", exact: true }),
  ).toBeEnabled();
  const dot = page.getByRole("button", {
    name: new RegExp("Open comment #" + id + " · open"),
  });
  const point = await dot.boundingBox(),
    target = await page.locator("#one p").boundingBox();
  await page.keyboard.down("Alt");
  await expect(dot).toHaveCSS("cursor", "grab");
  await page.mouse.move(
    point!.x + point!.width / 2,
    point!.y + point!.height / 2,
  );
  await page.mouse.down();
  await expect(page.locator("#intro p")).toHaveCSS("cursor", "grabbing");
  await page.mouse.move(target!.x + 50, target!.y + 10, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect
    .poll(async () => (await detail()).comment.anchor.selector)
    .toBe("#one > p");
  for (let i = 1; i <= 5; i++) {
    const response = await request.post(backend + path + "/replies", {
      headers,
      data: { body: "Pagination reply " + i, client_id: crypto.randomUUID() },
    });
    expect(response.ok()).toBeTruthy();
  }
  await dialog.getByRole("button", { name: "Details", exact: true }).click();
  await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(dialog.getByText("5 replies", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("Pagination reply 1", { exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Show earlier replies (3)", exact: true })
    .click();
  await expect(
    dialog.getByText("Pagination reply 1", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Hide earlier replies", exact: true })
    .click();
  await expect(dialog.locator(".reply")).toHaveCount(2);
  await dialog
    .getByRole("button", { name: "Show earlier replies (3)", exact: true })
    .click();
  await expect(dialog.locator(".reply")).toHaveCount(5);
  await dialog
    .locator(".reply")
    .filter({ has: page.getByText("Pagination reply 1", { exact: true }) })
    .hover();
  page.once("dialog", (d) => d.accept());
  await dialog
    .locator(".reply")
    .filter({ has: page.getByText("Pagination reply 1", { exact: true }) })
    .getByRole("button", { name: "Delete reply", exact: true })
    .click();
  await expect.poll(async () => (await detail()).reply_count).toBe(4);
  await expect(
    dialog.getByRole("button", { name: "Remove file", exact: true }),
  ).toBeEnabled();
  await dialog.locator(".files .file").first().hover();
  await dialog
    .getByRole("button", { name: "Remove file", exact: true })
    .click();
  await expect.poll(async () => (await detail()).attachments.length).toBe(0);
  await expect(
    dialog.getByRole("button", { name: "Reply", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Details", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Delete comment", exact: true }),
  ).toHaveCount(0);
  expect((await request.delete(backend + path, { headers })).ok()).toBe(true);
  expect((await request.get(backend + path, { headers })).status()).toBe(404);
});

test("unread activity is preserved until a thread is opened, survives reload, and excludes own replies", async ({
  page,
  request,
}) => {
  const origin = { Origin: appOrigin },
    prefix = "/api/v1/sites/" + siteId;
  const createGuest = async (name: string) =>
    (
      await request.post(backend + prefix + "/guests", {
        headers: origin,
        data: { name },
      })
    ).json();
  const author = await createGuest("Author"),
    reader = await createGuest("Reader");
  const auth = { ...origin, Authorization: "Bearer " + author.token },
    reading = { ...origin, Authorization: "Bearer " + reader.token };
  const created = await request.post(backend + prefix + "/comments", {
    headers: auth,
    data: {
      url: appOrigin + "/demo.html?site=" + siteId,
      title: "Unread demo",
      body: "Unread test thread",
      status: "open",
      client_id: crypto.randomUUID(),
      anchor: {
        selector: "#intro p",
        text: "Mark this text, leave a reply, or attach a screenshot.",
        x: 0.5,
        y: 0.5,
        documentX: 600,
        documentY: 550,
        viewportWidth: 1280,
      },
    },
  });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).id;
  await page.addInitScript(
    ({ site, person }) =>
      localStorage.setItem("flakflak:guest:" + site, JSON.stringify(person)),
    { site: siteId, person: reader },
  );
  await page.goto(appOrigin + "/demo.html?site=" + siteId);
  await openSidebar(page);
  await expect(
    page.getByRole("button", { name: "Unread · 1", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Collapse all", exact: true }).click();
  await expect(page.locator("flakflak-widget details[open]")).toHaveCount(0);
  await page.getByRole("button", { name: "Unread · 1", exact: true }).click();
  await expect(page.locator("flakflak-widget details[open]")).toHaveCount(1);
  await page.getByRole("button", { name: "Unread · 1", exact: true }).click();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.getByRole("button", { name: "Unread only", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Author added #/ }),
  ).toBeVisible();
  expect(
    (
      await (
        await request.get(
          backend +
            prefix +
            "/comments?url=" +
            encodeURIComponent(appOrigin + "/demo.html?site=" + siteId),
          { headers: reading },
        )
      ).json()
    ).comments[0].unread,
  ).toBe(true);
  await page.getByRole("button", { name: /Author added #/ }).click();
  await expect(
    page.getByText("No unread activity.", { exact: true }),
  ).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "Comment", exact: true });
  await dialog
    .getByRole("textbox", { name: "Reply", exact: true })
    .fill("My own reply");
  await dialog
    .getByRole("textbox", { name: "Reply", exact: true })
    .press("Control+Enter");
  await expect(dialog.getByText("My own reply", { exact: true })).toBeVisible();
  await page.reload();
  await openSidebar(page);
  await expect(
    page.getByRole("button", { name: "Unread · 0", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mark all as read", exact: true }),
  ).toHaveCount(0);
  await request.post(backend + prefix + "/comments/" + id + "/replies", {
    headers: auth,
    data: {
      body: "A new reply from somebody else",
      client_id: crypto.randomUUID(),
    },
  });
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.getByRole("button", { name: "Comments", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unread · 1", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Mark all as read", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Unread · 0", exact: true }),
  ).toBeVisible();
});

test.afterEach(async ({ context }) => {
  for (const page of context.pages())
    await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("new-dot dragging and keyboard movement preserve page-specific recoverable drafts", async ({
  page,
}) => {
  const url = appOrigin + "/demo.html?site=" + siteId;
  await page.goto(url);
  await expect(
    page.getByRole("button", { name: "FlakFlak · Feedback" }),
  ).toBeVisible();
  await page
    .locator("#intro p")
    .click({ modifiers: ["Shift"], position: { x: 90, y: 10 } });
  await page
    .getByRole("textbox", { name: "Your name", exact: true })
    .fill("Draft tester");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Comment", exact: true })
    .fill("A draft that must survive moving its dot");
  await page.getByLabel("Attach files", { exact: true }).setInputFiles({
    name: "draft-capture.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6x8AAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(
    page.getByRole("img", { name: "draft-capture.png" }),
  ).toBeVisible();
  const dot = page.getByRole("button", {
      name: "Move new comment dot",
      exact: true,
    }),
    from = await dot.boundingBox(),
    to = await page.locator("#one p").boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + 50, to!.y + 10, { steps: 6 });
  await page.mouse.up();
  await expect(
    page.getByRole("textbox", { name: "Comment", exact: true }),
  ).toHaveValue("A draft that must survive moving its dot");
  await dot.focus();
  await dot.press("ArrowRight");
  const moved = await dot.boundingBox();
  await page
    .getByRole("dialog", { name: "Comment", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.reload();
  await openSidebar(page);
  await page
    .getByRole("button", { name: "Resume new comment draft", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Comment", exact: true }),
  ).toHaveValue("A draft that must survive moving its dot");
  await expect(
    page.getByRole("img", { name: "draft-capture.png" }),
  ).toBeVisible();
  const restored = await dot.boundingBox();
  expect(Math.abs(restored!.x - moved!.x)).toBeLessThan(2);
  expect(Math.abs(restored!.y - moved!.y)).toBeLessThan(2);
  await page
    .getByRole("dialog", { name: "Comment", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.goto(url + "&variant=second");
  await openSidebar(page);
  await expect(
    page.getByRole("button", { name: "Resume new comment draft", exact: true }),
  ).toHaveCount(0);
  await page.goto(url);
  await openSidebar(page);
  await page
    .getByRole("button", { name: "Resume new comment draft", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Comment", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("img", { name: "draft-capture.png" }),
  ).toHaveCount(0);
});

test.describe("WordPress reference appearance", () => {
  test.use({ deviceScaleFactor: 2 });
  test("Graphite sidebar, thread, composer and semantic dot colors match the reference components", async ({
    page,
    request,
    browserName,
  }) => {
    const origin = { Origin: appOrigin },
      prefix = "/api/v1/sites/" + siteId;
    const person = await (
      await request.post(backend + prefix + "/guests", {
        headers: origin,
        data: { name: "Harry" },
      })
    ).json();
    const headers = { ...origin, Authorization: "Bearer " + person.token };
    let openId = 0;
    for (let i = 0; i < 4; i++) {
      const response = await request.post(backend + prefix + "/comments", {
        headers,
        data: {
          url: appOrigin + "/demo.html?site=" + siteId,
          title: "Home Page",
          body: i ? "Completed feedback" : "test",
          status: "open",
          client_id: crypto.randomUUID(),
          anchor: {
            selector: "#intro > p",
            text: "Mark this text, leave a reply, or attach a screenshot.",
            x: 0.5,
            y: 0.5,
            documentX: 600,
            documentY: 550,
            viewportWidth: 1280,
          },
        },
      });
      expect(response.ok()).toBeTruthy();
      const c = await response.json();
      if (i)
        await request.patch(
          backend + prefix + "/comments/" + c.id + "/status",
          { headers, data: { status: "closed", version: 1 } },
        );
      else openId = c.id;
    }
    await page.addInitScript(
      ({ site, person }) => {
        localStorage.setItem("flakflak:guest:" + site, JSON.stringify(person));
        localStorage.setItem(
          "flakflak:preferences:" + site,
          JSON.stringify({
            theme: "graphite",
            side: "left",
            size: "standard",
            hideDots: false,
            pauseAnimations: true,
          }),
        );
      },
      { site: siteId, person },
    );
    await page.goto(appOrigin + "/demo.html?site=" + siteId);
    await page.evaluate(() => (document.title = "Home Page"));
    const dot = page.getByRole("button", {
      name: "Open comment #" + openId + " · open",
      exact: true,
    });
    await expect(dot).toBeVisible();
    expect(
      await dot.evaluate((node) => getComputedStyle(node).backgroundColor),
    ).toBe("rgb(255, 87, 51)");
    await openSidebar(page);
    await expect(
      page.getByRole("button", { name: "Unread · 0", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("75% finished", { exact: true })).toBeVisible();
    await expect(
      page.getByText("3 closed · 1 remaining", { exact: true }),
    ).toBeVisible();
    const sidebar = page.getByRole("complementary", {
      name: "FlakFlak sidebar",
    });
    const floating = (await sidebar.boundingBox())!;
    expect(floating.width).toBe(320);
    expect(floating.x).toBe(12);
    expect(floating.y).toBe(12);
    expect(floating.height).toBe(page.viewportSize()!.height - 24);
    await sidebar.screenshot({
      path: "/private/tmp/flakflak-sidebar-" + browserName + ".png",
    });
    await sidebar.locator(".comment-row").click();
    const panel = page.getByRole("dialog", { name: "Comment", exact: true });
    await expect(
      panel.getByRole("button", { name: "Reply", exact: true }),
    ).toBeEnabled();
    expect((await panel.boundingBox())!.width).toBe(350);
    await expect(
      panel.getByRole("button", { name: "Details", exact: true }),
    ).toBeVisible();
    await expect(panel.locator(".native-file")).toBeHidden();
    await panel.screenshot({
      path: "/private/tmp/flakflak-thread-" + browserName + ".png",
    });
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .locator("#intro p")
      .click({ modifiers: ["Shift"], position: { x: 500, y: 10 } });
    await page
      .getByRole("textbox", { name: "Comment", exact: true })
      .fill("test");
    expect((await panel.boundingBox())!.width).toBe(320);
    await expect(
      panel.getByRole("button", { name: "Open", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      panel.getByRole("button", { name: "Content", exact: true }),
    ).toBeVisible();
    await expect(panel.getByRole("combobox")).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "Add files", exact: true }),
    ).toBeVisible();
    await panel.screenshot({
      path: "/private/tmp/flakflak-composer-" + browserName + ".png",
    });
  });
});

test("sidebar open and closed state survives reload and navigation", async ({
  page,
}) => {
  const url = appOrigin + "/demo.html?site=" + siteId;
  await page.goto(url);
  const launcher = page.getByRole("button", { name: "FlakFlak · Feedback" });
  await expect(launcher).toHaveAttribute("aria-expanded", "false");
  await launcher.click();
  await expect(launcher).toHaveAttribute("aria-expanded", "true");
  await page.reload();
  await expect(launcher).toHaveAttribute("aria-expanded", "true");
  await page.goto(url + "&variant=another");
  await expect(launcher).toHaveAttribute("aria-expanded", "true");
  await launcher.click();
  await page.reload();
  await expect(launcher).toHaveAttribute("aria-expanded", "false");
});

test("new themes apply and retain readable settings", async ({ page }) => {
  await page.goto(appOrigin + "/demo.html?site=" + siteId);
  await openSidebar(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const swatches = page.locator(".theme-choices .theme-swatch");
  await expect(swatches).toHaveCount(11);
  const previews = await swatches.evaluateAll((nodes) =>
    nodes.map((node) => ({
      theme: node.getAttribute("data-theme"),
      image: getComputedStyle(node).backgroundImage,
    })),
  );
  for (const preview of previews)
    expect(preview.image, preview.theme || "theme preview").not.toBe("none");
  for (const [label, value] of [
    ["Carbon", "carbon"],
    ["Emerald", "emerald"],
    ["Mac OS 9", "macos9"],
    ["Windows XP", "windowsxp"],
    ["Game Boy", "gameboy"],
    ["C64", "commodore64"],
    ["Windows 3.11", "windows311"],
    ["Neon", "synthwave"],
    ["Linen", "linen"],
    ["Macintosh", "macintosh"],
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator("[data-flakflak-root]")).toHaveAttribute(
      "data-theme",
      value,
    );
    const buttons = page.locator(".sidebar > .titlebar button");
    await expect(buttons).toHaveCount(4);
    const sizes = await buttons.evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return [box.width, box.height, box.y];
      }),
    );
    expect(new Set(sizes.map((size) => JSON.stringify(size))).size).toBe(1);
    await page.screenshot({
      path: "/private/tmp/flakflak-theme-" + value + ".png",
    });
  }
});

test("Shift placement cursor resets when released", async ({ page }) => {
  await page.goto(appOrigin + "/demo.html?site=" + siteId);
  await expect(
    page.getByRole("button", { name: "FlakFlak · Feedback" }),
  ).toBeVisible();
  await page.keyboard.down("Shift");
  await expect(page.locator("#intro p")).toHaveCSS("cursor", "crosshair");
  await page.keyboard.up("Shift");
  await expect(page.locator("#intro p")).not.toHaveCSS("cursor", "crosshair");
});
