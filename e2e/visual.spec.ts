import { test, expect, type Page } from "@playwright/test";

/**
 * Visual and layout verification.
 *
 * jsdom has no layout engine, so nothing in the Vitest suite can tell whether an
 * element overflows, wraps badly, or renders off-screen. These tests measure real
 * layout in a real browser and capture screenshots for human review.
 */

// A live Base hook: beforeSwap + afterSwap + both swap-delta flags (0x00cc).
const HOOK = "0x335c39D5AB526092E9e8619987b4f6B5B77ac0cC";
const RESULT_URL = `/?address=${HOOK}&chain=base`;

const BREAKPOINTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

/** Horizontal overflow of the document, in pixels. Must be 0. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
}

/**
 * Elements whose content spills out of them horizontally in a way the page does not
 * handle.
 *
 * Three categories are excluded because overflowing is their defined behaviour, not a
 * bug: anything with a non-visible `overflow-x` (a deliberate scroll container, a
 * `truncate` ellipsis, or an `sr-only` clipped box), and native form controls, which
 * scroll their own value internally.
 */
async function unexpectedOverflowers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const SELF_SCROLLING = new Set(["INPUT", "TEXTAREA", "SELECT"]);
    const bad: string[] = [];

    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      if (SELF_SCROLLING.has(el.tagName)) continue;
      if (getComputedStyle(el).overflowX !== "visible") continue;
      if (el.clientWidth === 0) continue;

      if (el.scrollWidth > el.clientWidth + 1) {
        const cls = el.className.toString().split(/\s+/).slice(0, 3).join(".");
        bad.push(
          `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""} (${el.scrollWidth} > ${el.clientWidth})`,
        );
      }
    }
    return bad;
  });
}

/** Waits for the on-chain panel and pool scan to settle, or time out gracefully. */
async function waitForSettled(page: Page) {
  // The decoded permissions are synchronous; they must be present immediately.
  await expect(page.getByRole("heading", { name: "Hook permissions" })).toBeVisible();
  // Give the two fetches a chance, but never fail the visual test on a slow RPC.
  await page
    .getByRole("heading", { name: "On-chain state" })
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => {});
  await page
    .getByRole("status")
    .last()
    .waitFor({ state: "detached", timeout: 45_000 })
    .catch(() => {});
}

test.describe("no horizontal overflow at any breakpoint", () => {
  for (const bp of BREAKPOINTS) {
    test(`${bp.name} (${bp.width}px) result page`, async ({ page }) => {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.goto(RESULT_URL);
      await waitForSettled(page);

      const overflow = await horizontalOverflow(page);
      expect(overflow, `document scrolls horizontally by ${overflow}px`).toBeLessThanOrEqual(0);

      const bad = await unexpectedOverflowers(page);
      expect(bad, `elements overflowing without overflow-x set:\n${bad.join("\n")}`).toEqual([]);

      await page.screenshot({
        path: `screenshots/result-${bp.name}-${bp.width}.png`,
        fullPage: true,
      });
    });

    test(`${bp.name} (${bp.width}px) landing page`, async ({ page }) => {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Hook Explorer" })).toBeVisible();

      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      expect(await unexpectedOverflowers(page)).toEqual([]);

      await page.screenshot({
        path: `screenshots/landing-${bp.name}-${bp.width}.png`,
        fullPage: true,
      });
    });
  }
});

test.describe("the bit table sizes to its content", () => {
  test("does not scroll on desktop, where the column is wider than the content", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(RESULT_URL);
    await waitForSettled(page);

    const wrapper = page.locator("section", { has: page.getByText("Raw masked bits") }).first();
    const scroller = wrapper.locator("div.overflow-x-auto").first();

    const metrics = await scroller.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      tableWidth: el.querySelector("table")!.getBoundingClientRect().width,
    }));

    // The regression this guards: a hard min-width wider than the column forced a
    // permanent scrollbar on desktop.
    expect(
      metrics.scrollWidth,
      `bit table scrolls on desktop: content ${metrics.scrollWidth} > box ${metrics.clientWidth}`,
    ).toBeLessThanOrEqual(metrics.clientWidth);
  });

  test("scrolls only when the viewport is genuinely narrower than the content", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(RESULT_URL);
    await waitForSettled(page);

    const scroller = page
      .locator("section", { has: page.getByText("Raw masked bits") })
      .first()
      .locator("div.overflow-x-auto")
      .first();

    const metrics = await scroller.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));

    // On a 390px phone the table genuinely cannot fit, so scrolling is correct --
    // and it must be contained here rather than pushing the whole page sideways.
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("headers stay on one line", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(RESULT_URL);
    await waitForSettled(page);

    // A wrapped header would make the table taller and look broken.
    for (const name of ["Bit", "Value", "Mask", "Permission"]) {
      const th = page.getByRole("columnheader", { name, exact: true }).first();
      const box = await th.boundingBox();
      expect(box, `header ${name} not found`).not.toBeNull();
      expect(box!.height, `header "${name}" wrapped to ${box!.height}px`).toBeLessThan(28);
    }
  });
});

test.describe("page states", () => {
  test("empty state lists the example hooks", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    await expect(page.getByText("Or try one of these live hooks:")).toBeVisible();
    await expect(page.getByRole("button", { name: /Swap-delta hook/ })).toBeVisible();
    // Nothing result-shaped should be on screen yet.
    await expect(page.getByRole("heading", { name: "Hook permissions" })).toHaveCount(0);

    await page.screenshot({ path: "screenshots/state-empty.png", fullPage: true });
  });

  test("invalid address shows an inline error and no results", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    await page.getByLabel("Hook contract address").fill("0xnot-a-real-address");
    await page.getByRole("button", { name: "Decode" }).click();

    // Scoped by id: Next injects its own role="alert" route announcer into every page.
    const error = page.locator("#address-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("non-hexadecimal");
    await expect(page.getByRole("heading", { name: "Hook permissions" })).toHaveCount(0);

    await page.screenshot({ path: "screenshots/state-invalid-address.png", fullPage: true });
  });

  test("wrong-length address is reported distinctly", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Hook contract address").fill("0xabc123");
    await page.getByRole("button", { name: "Decode" }).click();

    await expect(page.locator("#address-error")).toContainText("40 hex characters");
  });

  test("loading state appears while the scans are in flight", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    // Hold both requests open so the loading UI is observable and screenshot-able.
    await page.route("**/api/inspect**", async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route.continue();
    });
    await page.route("**/api/pools**", async (route) => {
      await new Promise((r) => setTimeout(r, 6000));
      await route.continue();
    });

    await page.goto(RESULT_URL);

    // Permissions decode with no network, so they must be up before anything resolves.
    await expect(page.getByRole("heading", { name: "Hook permissions" })).toBeVisible();
    await expect(page.getByText("Reading on-chain state…")).toBeVisible();
    await expect(page.getByText("Scanning PoolManager Initialize events…")).toBeVisible();

    await page.screenshot({ path: "screenshots/state-loading.png", fullPage: true });
  });
});
