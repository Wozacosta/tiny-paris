import { expect, test, type Page } from "@playwright/test";

/** Loads the map and waits for the whole city, failing on any page error. */
async function open(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#stats")).toContainText(/\d{2,3},\d{3} buildings/, { timeout: 90_000 });
  return errors;
}

/** Share of the map canvas that isn't the plain sky: it has drawn something. */
const drawn = (page: Page) =>
  page.evaluate(() => {
    const c = document.getElementById("map") as HTMLCanvasElement;
    const g = document.createElement("canvas").getContext("2d")!;
    g.canvas.width = 200; g.canvas.height = 120;
    g.drawImage(c, 0, 0, 200, 120);
    const d = g.getImageData(0, 0, 200, 120).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) n++;
    return n / (d.length / 4);
  });

test("the city loads and draws, with no errors", async ({ page }) => {
  const errors = await open(page);
  await expect.poll(() => drawn(page)).toBeGreaterThan(0.2);
  expect(errors).toEqual([]);
});

test("Go to flies to a landmark, and a tap there names its building", async ({ page }) => {
  await open(page);
  await page.click("#places-toggle");
  await page.locator("#landmarks button", { hasText: /^Louvre/ }).click();
  await page.waitForTimeout(2500); // the flight
  const box = (await page.locator("#map").boundingBox())!;
  // The landmark is in the middle of the screen; try a few points around it.
  for (const [dx, dy] of [[0, 0], [0, 20], [20, 0], [-20, 0], [0, -20]]) {
    await page.mouse.click(box.width / 2 + dx, box.height / 2 + dy);
    if (await page.locator("#info").isVisible()) break;
  }
  await expect(page.locator("#info")).toBeVisible();
  await expect(page.locator("#info-title")).not.toBeEmpty();
});

test("search finds a building by name and opens its card", async ({ page }) => {
  await open(page);
  // Addresses come from the IGN geocoder: answer for it, so the test doesn't need it.
  await page.route("https://data.geopf.fr/**", (route) => route.fulfill({ json: { features: [] } }));
  await page.click("#places-toggle");
  await page.locator("#search").fill("carreau temple");
  await expect(page.locator("#landmarks button").first()).toContainText("Carreau du Temple");
  await page.locator("#search").press("Enter");
  await expect(page.locator("#info-title")).toHaveText("Carreau du Temple");
});

test("the Names switch hides place names and is remembered", async ({ page }) => {
  await open(page);
  const names = page.locator("#names");
  await expect(names).toHaveAttribute("aria-pressed", "true");
  await names.click();
  await expect(names).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(page.locator("#names")).toHaveAttribute("aria-pressed", "false");
});

test("a problem can be reported", async ({ page }) => {
  await open(page);
  let sent: Record<string, unknown> | null = null;
  await page.route("/api/report", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 204 });
  });
  // Phones: the ticket, with the link, opens from the plaque.
  if (await page.locator("#title-more").isVisible()) await page.click("#title-more");
  await page.click("#report-view");
  await page.check("input[value=missing]");
  await page.fill("textarea[name=note]", "A test report");
  await page.click("#report .send");
  await expect(page.locator("#report-status")).toHaveText("Thanks! I'll fix it.");
  expect(sent).toMatchObject({ kind: "missing", note: "A test report" });
});

test.describe("desktop", () => {
  test.skip(({ isMobile }) => isMobile, "desktop only");

  test("the strip shows the ten landmarks and flies to one", async ({ page }) => {
    await open(page);
    const cards = page.locator("#line-track button");
    await expect(cards).toHaveCount(10);
    for (const img of await page.locator("#line-track img").all()) {
      await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
    }
    await cards.nth(0).click();
    await expect(cards.nth(0)).toHaveAttribute("aria-current");
  });
});

test.describe("phone", () => {
  test.skip(({ isMobile }) => !isMobile, "phones only");

  test("the plaque opens the ticket; no strip", async ({ page }) => {
    await open(page);
    await expect(page.locator("#line")).toBeHidden();
    await expect(page.locator("#ticket")).toBeHidden();
    await page.click("#title-more");
    await expect(page.locator("#ticket")).toBeVisible();
  });
});
