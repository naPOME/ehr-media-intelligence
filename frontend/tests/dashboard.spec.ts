import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fulfill, mockApi, patient, record } from "./fixtures";

test("overview opens the exact recent source and supports deep links and browser back", async ({
  page,
  isMobile,
}) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/overview$/);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No summaries available", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Record library overview" }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.locator(".recent-patient-row").click();
  await expect(page).toHaveURL(
    new RegExp(`/patients/${patient.patient.id}\\?record=`),
  );
  const panel = isMobile
    ? page.getByRole("dialog", { name: "Patient chart" })
    : page.getByRole("region", { name: "Selected record" });
  await expect(
    panel.getByRole("heading", { name: record.record.title }),
  ).toBeVisible();
  await page.reload();
  await expect(
    panel.getByRole("heading", { name: record.record.title }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
});

test("overview shows only ready summaries and opens the summary tab", async ({
  page,
  isMobile,
}) => {
  await mockApi(page, { ready: true });
  await page.goto("/overview");
  await page.locator(".overview-summary-card").click();
  const panel = isMobile
    ? page.getByRole("dialog", { name: "Patient chart" })
    : page.getByRole("region", { name: "Selected record" });
  await expect(
    panel.getByRole("tab", { name: "Patient summary", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByText("AI-generated", { exact: true })).toBeVisible();
});

test("patient table sends server paging and sorting, preserves selection and exports selected rows", async ({
  page,
  isMobile,
}) => {
  await mockApi(page);
  const entries = Array.from({ length: 23 }, (_, i) => ({
    patient: {
      ...patient.patient,
      id: `patient-${i}`,
      mrn: `MRN${String(i).padStart(5, "0")}`,
      name: `Patient ${String(i).padStart(2, "0")}`,
    },
    record_count: i + 1,
    latest_record_date: "2026-03-15",
    summary_status: "unavailable",
  }));
  await page.route("**/api/patients?**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const filtered = params.get("query")
      ? entries.filter((row) =>
          row.patient.name.includes(params.get("query") || ""),
        )
      : entries;
    return fulfill(route, {
      total: filtered.length,
      items: filtered.slice(
        Number(params.get("offset") || 0),
        Number(params.get("offset") || 0) + Number(params.get("limit") || 10),
      ),
    });
  });
  await page.route("**/api/patients/export?**", (route) =>
    route.fulfill({
      contentType: "text/csv",
      body: "Patient,MRN\r\nPatient 00,MRN00000\r\nPatient 10,MRN00010",
    }),
  );
  await page.goto("/patients");
  await expect(
    page.getByRole("button", { name: /^Open patient: Patient 00/ }),
  ).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (isMobile) return;
  await page
    .getByRole("checkbox", { name: "Select Patient 00", exact: true })
    .check();
  const second = page.waitForRequest(
    (req) => new URL(req.url()).searchParams.get("offset") === "10",
  );
  await page.getByRole("button", { name: "Next Page", exact: true }).click();
  await second;
  await page
    .getByRole("checkbox", { name: "Select Patient 10", exact: true })
    .check();
  await expect(
    page.getByText("2 patients selected", { exact: true }),
  ).toBeVisible();
  const exported = page.waitForRequest((req) =>
    req.url().includes("/api/patients/export"),
  );
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export selected", exact: true })
    .click();
  expect(
    new URL((await exported).url()).searchParams.getAll("patient_ids"),
  ).toEqual(["patient-0", "patient-10"]);
  expect((await downloaded).suggestedFilename()).toBe("selected-patients.csv");
  const sorted = page.waitForRequest(
    (req) =>
      req.url().includes("/api/patients?") &&
      new URL(req.url()).searchParams.get("sort_by") === "record_count",
  );
  await page.getByRole("columnheader", { name: "Documents" }).first().click();
  const sortedUrl = new URL((await sorted).url());
  expect(sortedUrl.searchParams.get("offset")).toBe("0");
  await page
    .getByRole("button", { name: "Table settings", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Date of birth", exact: true })
    .uncheck();
  await expect(
    page.getByRole("columnheader", { name: "Date of birth" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Toggle patient filters", exact: true })
    .click();
  const filteredRequest = page.waitForRequest(
    (req) => new URL(req.url()).searchParams.get("gender") === "female",
  );
  await page.getByRole("combobox", { name: "Filter by gender" }).click();
  await page.getByText("Female", { exact: true }).last().click();
  await filteredRequest;
  await page
    .getByRole("group", { name: "Patient filters" })
    .getByRole("button", { name: "Reset", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Filter by gender" }),
  ).toHaveValue("");
});
