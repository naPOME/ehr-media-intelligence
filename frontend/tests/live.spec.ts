import { test, expect } from "@playwright/test";

test("real backend opens a patient source in the desktop reader", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.EHR_LIVE_API !== "1",
    "Set EHR_LIVE_API=1 with the real backend on port 8011",
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("menuitem", { name: "Record search", exact: true })
    .click();
  const response = page.waitForResponse(
    (res) => res.url().includes("/api/search") && res.status() === 200,
  );
  await page
    .getByRole("button", { name: "Chest imaging findings", exact: true })
    .click();
  const body = await (await response).json();
  expect(body.matches.length).toBeGreaterThan(0);
  await page
    .getByRole("button", { name: /^Open record:/ })
    .first()
    .click();
  const panel = page.getByRole("region", { name: "Selected record" });
  await expect(
    panel.getByRole("heading", {
      name: body.matches[0].patient_name,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    panel.getByRole("region", { name: "Source record content" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("real-backend-source.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
