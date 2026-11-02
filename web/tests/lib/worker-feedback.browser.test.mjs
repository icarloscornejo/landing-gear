// Optional real-Chrome keyboard + CDP accessibility-tree regression.
// Run against a loopback server backed by disposable data. No write goes
// through an API, no CLI is invoked and no application is submitted.
import assert from "node:assert/strict";
import { test } from "node:test";

const url = process.env.WORKER_FEEDBACK_TEST_URL;

// Settled fictional history exercises the shared control without starting jobs.
test("worker dismiss stays discoverable without hover and by keyboard", { skip: !url, timeout: 60_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  for (const mode of [
    { name: "desktop", width: 1440, hasTouch: false },
    { name: "wide-touch", width: 1440, hasTouch: true },
    { name: "mobile-touch", width: 390, hasTouch: true },
  ]) {
    await t.test(mode.name, async () => {
      const context = await browser.newContext({ viewport: { width: mode.width, height: 900 }, hasTouch: mode.hasTouch });
      try {
        const page = await context.newPage();
        const unexpected = [];
        await page.addInitScript(() => localStorage.setItem("career-ops:jobs", JSON.stringify([{
          id: "dismiss-fixture", title: "Fictional evaluation", subtitle: "Engineer", status: "done",
          steps: [], text: "", startedAt: 1, endedAt: 2,
        }])));
        await page.route("**/api/**", (route) => {
          if (route.request().method() === "GET") return route.continue();
          unexpected.push(route.request().url());
          return route.abort();
        });
        await page.goto(`${origin.origin}/pipeline?tab=ALL`);
        assert.equal(await page.evaluate(() => matchMedia("(hover: hover)").matches), !mode.hasTouch);
        const tray = mode.width < 768
          ? page.getByRole("dialog", { name: "Navigation menu", exact: true })
          : page.getByRole("complementary");
        if (mode.width < 768) await page.getByRole("button", { name: "Open menu", exact: true }).tap();
        const dismiss = tray.getByRole("button", { name: "Dismiss worker: Fictional evaluation · Engineer", exact: true });
        await dismiss.waitFor();
        async function until(check, message) {
          for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise((r) => setTimeout(r, 25)); }
          assert.fail(`${mode.name}: ${message}`);
        }
        const opacity = () => dismiss.evaluate((el) => getComputedStyle(el).opacity);
        if (mode.hasTouch) {
          assert.equal(await dismiss.evaluate((el) => el === document.activeElement), false);
          await until(async () => (await opacity()) === "1", "dismiss must be visible before hover or focus");
          await dismiss.tap();
        } else {
          await until(async () => (await opacity()) === "0", "desktop default stays hidden");
          await tray.getByRole("link", { name: "Open worker: Fictional evaluation · Engineer, Completed", exact: true }).hover();
          await until(async () => (await opacity()) === "1", "pointer hover reveals dismiss");
          await page.mouse.move(1100, 850);
          await until(async () => (await opacity()) === "0", "leaving hover hides dismiss");
          for (let i = 0; i < 100 && !(await dismiss.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
          assert.equal(await dismiss.evaluate((el) => el === document.activeElement), true);
          await until(async () => (await opacity()) === "1", "keyboard focus reveals dismiss without hover");
          const cdp = await context.newCDPSession(page);
          const { nodes } = await cdp.send("Accessibility.getFullAXTree");
          assert.ok(nodes.some((n) => !n.ignored && n.role?.value === "button" && n.name?.value === "Dismiss worker: Fictional evaluation · Engineer" && n.properties?.some((p) => p.name === "focused" && p.value.value === true)));
          await page.keyboard.press("Enter");
        }
        await until(() => page.evaluate(() => JSON.parse(localStorage.getItem("career-ops:jobs") || "[]").length === 0), "dismiss removes the worker");
        assert.equal(page.url(), `${origin.origin}/pipeline?tab=ALL`, "dismiss must not follow the details link");
        assert.deepEqual(unexpected, [], "dismiss must not write through an API");
      } finally {
        await context.close();
      }
    });
  }
});
