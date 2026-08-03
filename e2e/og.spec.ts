import { test, expect } from "@playwright/test";

/**
 * Open Graph card.
 *
 * The regression worth guarding: Next's `opengraph-image.tsx` convention receives only
 * route segment params, never search params, so a first attempt at this silently
 * rendered the generic landing card for every hook. The image must therefore be served
 * by something that reads the query string, and the meta tag must carry that query
 * string through.
 */

const HOOK = "0x335c39D5AB526092E9e8619987b4f6B5B77ac0cC";
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

test.describe("/api/og", () => {
  test("returns a 1200x630 PNG for a hook", async ({ request }) => {
    const res = await request.get(`/api/og?address=${HOOK}&chain=base`);

    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");

    const body = await res.body();
    expect(body.subarray(0, 4).equals(PNG_MAGIC), "response is not a PNG").toBe(true);
    // PNG IHDR: width and height are big-endian uint32 at bytes 16 and 20.
    expect(body.readUInt32BE(16)).toBe(1200);
    expect(body.readUInt32BE(20)).toBe(630);
  });

  test("returns a PNG for the landing card with no params", async ({ request }) => {
    const res = await request.get("/api/og");
    expect(res.status()).toBe(200);
    expect((await res.body()).subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
  });

  test("falls back to the landing card for an invalid address rather than erroring", async ({
    request,
  }) => {
    const res = await request.get("/api/og?address=0xnope&chain=base");
    expect(res.status()).toBe(200);
    expect((await res.body()).subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
  });

  test("renders a visibly different card per hook", async ({ request }) => {
    // Two hooks with different permission sets must not produce the same image --
    // which is exactly what the broken opengraph-image approach did.
    const a = await (await request.get(`/api/og?address=${HOOK}&chain=base`)).body();
    const b = await (
      await request.get("/api/og?address=0x44A0d07e76d5b3fA1bc2cfE3ac37073c9cf94040&chain=base")
    ).body();
    const landing = await (await request.get("/api/og")).body();

    expect(a.equals(b), "two different hooks produced identical cards").toBe(false);
    expect(a.equals(landing), "a hook card is identical to the landing card").toBe(false);
  });

  test("renders a different card per chain", async ({ request }) => {
    const base = await (await request.get(`/api/og?address=${HOOK}&chain=base`)).body();
    const eth = await (await request.get(`/api/og?address=${HOOK}&chain=ethereum`)).body();
    expect(base.equals(eth)).toBe(false);
  });
});

test.describe("unfurl metadata", () => {
  test("the og:image URL carries the address and chain", async ({ page }) => {
    await page.goto(`/?address=${HOOK}&chain=base`);

    const image = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(image).toBeTruthy();
    // Absolute, or Discord and Twitter cannot fetch it.
    expect(image!).toMatch(/^https?:\/\//);
    expect(image!).toContain(`address=${HOOK}`);
    expect(image!).toContain("chain=base");
  });

  test("declares dimensions and a large-image twitter card", async ({ page }) => {
    await page.goto(`/?address=${HOOK}&chain=base`);

    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute(
      "content",
      "1200",
    );
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute(
      "content",
      "630",
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
    );
  });

  test("the og:image is actually fetchable at the advertised URL", async ({ page, request }) => {
    await page.goto(`/?address=${HOOK}&chain=base`);
    const image = (await page.locator('meta[property="og:image"]').getAttribute("content"))!;

    // Rewrite the origin: metadataBase points at the production domain, not the test port.
    const url = new URL(image);
    const res = await request.get(`${url.pathname}${url.search}`);

    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  });

  test("the title and description describe the specific hook", async ({ page }) => {
    await page.goto(`/?address=${HOOK}&chain=base`);

    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      /0x335c…c0cC on Base/,
    );
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
      "content",
      /4 of 14 hook permissions active/,
    );
  });
});
