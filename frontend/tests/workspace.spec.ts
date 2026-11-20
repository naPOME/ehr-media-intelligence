import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  fulfill,
  match,
  mockApi,
  patient,
  patientId,
  record,
} from "./fixtures";

async function navigateRecords(page: Page) {
  const menu = page.getByRole("menuitem", {
    name: "Record search",
    exact: true,
  });
  if (!(await menu.isVisible()))
    await page.getByRole("button", { name: "Open navigation" }).click();
  await menu.click();
  await expect(
    page.getByRole("dialog", { name: "Everwell Clinic workspace" }),
  ).not.toBeVisible();
  await expect(page.locator(".navigation-drawer")).toHaveCount(0);
}

async function search(page: Page) {
  await page
    .getByRole("button", { name: "Abnormal kidney results", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /^Open record:/ }).first(),
  ).toBeVisible();
}
const panelFor = (page: Page, isMobile: boolean) =>
  isMobile
    ? page.getByRole("dialog", { name: "Patient chart" })
    : page.getByRole("region", { name: "Selected record" });

async function selectRecord(page: Page, isMobile: boolean) {
  await page
    .getByRole("button", { name: /^Open record:/ })
    .first()
    .click();
  const panel = panelFor(page, isMobile);
  await expect(
    panel.getByRole("region", { name: "Source record content" }),
  ).toBeVisible();
  return panel;
}

async function checkAccessibility(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        message: node.failureSummary,
      })),
    })),
  ).toEqual([]);
}

test("initial screen has a clear scope, keyboard search, and accessible controls", async ({
  page,
  isMobile,
}, testInfo) => {
  await mockApi(page);
  await page.goto("/");
  await navigateRecords(page);
  await expect(
    page.getByRole("heading", { name: "Record search", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Across all patients", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Search records", exact: true }),
  ).toBeDisabled();
  if (!isMobile)
    await expect(
      page.getByRole("heading", { name: "Select a record to review" }),
    ).toBeVisible();
  await page.keyboard.press("/");
  await expect(
    page.getByRole("textbox", { name: "Search patient records" }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await checkAccessibility(page);
  await page.screenshot({
    path: testInfo.outputPath("start.png"),
    fullPage: true,
  });
});

test("resource and inclusive date filters are sent together and can be cleared", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/");
  await navigateRecords(page);
  await search(page);
  await page.getByRole("button", { name: "Toggle search filters" }).click();
  await page
    .getByRole("combobox", { name: "Record type", exact: true })
    .click();
  await page.getByText("Diagnostic reports", { exact: true }).last().click();
  const request = page.waitForRequest(
    (req) =>
      req.url().includes("/api/search") &&
      req.url().includes("date_from=2026-03-01") &&
      req.url().includes("date_to=2026-03-31"),
  );
  await page.locator("#record-date-from").fill("01 Mar 2026");
  await page.locator("#record-date-from").press("Enter");
  await page.locator("#record-date-to").fill("31 Mar 2026");
  await page.locator("#record-date-to").press("Enter");
  expect(new URL((await request).url()).searchParams.get("resource_type")).toBe(
    "DiagnosticReport",
  );
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(page.locator("#record-date-from")).toHaveValue("");
  await expect(
    page.getByRole("combobox", { name: "Record type", exact: true }),
  ).toHaveValue("");
});

test("a match opens its source immediately and keeps patient identity visible while scrolling", async ({
  page,
  isMobile,
}, testInfo) => {
  await mockApi(page);
  await page.goto("/");
  await navigateRecords(page);
  await search(page);
  const panel = await selectRecord(page, isMobile);
  await expect(
    panel.getByRole("heading", { name: "Patient 02", exact: true }),
  ).toBeVisible();
  await expect(panel.getByText("14 Mar 1985", { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("region", { name: "Source record content" }),
  ).toContainText("Creatinine 2.1 mg/dL");
  await expect(panel.getByRole("table")).toContainText("0.6 - 1.2");
  await panel.getByText("Source details", { exact: true }).click();
  await expect(
    panel.getByText("synthetic-labs.csv", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: isMobile ? 390 : 1280, height: 600 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const identity = panel.getByRole("region", { name: "Patient demographics" });
  const before = await identity.boundingBox();
  await panel
    .getByRole("region", { name: "Document scroll area", exact: true })
    .evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
  expect(
    await panel
      .getByRole("region", { name: "Document scroll area", exact: true })
      .evaluate((node) => node.scrollTop),
  ).toBeGreaterThan(0);
  expect((await identity.boundingBox())?.y).toBe(before?.y);
  await expect(
    identity.getByRole("heading", {
      name: "Patient 02",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("source-review.png"),
    fullPage: true,
  });
});

test("summary states do not block source review and mobile focus returns to its match", async ({
  page,
  isMobile,
}) => {
  await mockApi(page);
  await page.goto("/");
  await navigateRecords(page);
  await search(page);
  const trigger = page.getByRole("button", { name: /^Open record:/ }).first();
  const panel = await selectRecord(page, isMobile);
  await panel
    .getByRole("tab", { name: "Patient summary", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "AI summary not available" }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Review source records", exact: true })
    .click();
  await expect(
    panel.getByRole("tab", { name: "Source record", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  if (isMobile) {
    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
});

test("ready summary citations open the source and export is scoped to the selected patient", async ({
  page,
  isMobile,
}) => {
  await mockApi(page, { ready: true });
  await page.goto("/");
  await navigateRecords(page);
  await search(page);
  const panel = await selectRecord(page, isMobile);
  await panel
    .getByRole("tab", { name: "Patient summary", exact: true })
    .click();
  await expect(panel.getByText("AI-generated", { exact: true })).toBeVisible();

  const download = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "Download patient FHIR Bundle", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe(
    `patient-${patientId}.fhir.json`,
  );
  await panel
    .getByRole("button", { name: "View source: Renal panel", exact: true })
    .first()
    .click();
  await expect(
    panel.getByRole("tab", { name: "Source record", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    panel.getByRole("region", { name: "Source record content" }),
  ).toContainText("Creatinine");
  await panel
    .getByRole("tab", { name: "All records (1)", exact: true })
    .click();
  await expect(
    panel.getByRole("button", {
      name: "View source: Renal panel",
      exact: true,
    }),
  ).toBeVisible();
});

test("empty results and backend errors have working recovery actions", async ({
  page,
}) => {
  await mockApi(page, { matches: [] });
  await page.goto("/");
  await navigateRecords(page);
  await page
    .getByRole("button", { name: "Low hemoglobin", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No records in this view" }),
  ).toBeVisible();
  await page.route("**/api/search**", (route) =>
    fulfill(route, { detail: "internal implementation detail" }, 503),
  );
  await page
    .getByRole("textbox", { name: "Search patient records" })
    .fill("chest imaging");
  await expect(
    page.getByRole("heading", { name: "Search could not be completed" }),
  ).toBeVisible();
  await expect(page.getByText("internal implementation detail")).toHaveCount(0);
  await page.route("**/api/search**", (route) =>
    fulfill(route, {
      query: "chest imaging",
      matches: [match],
      elapsed_ms: 100,
    }),
  );
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^Open record:/ }).first(),
  ).toBeVisible();
});

test("a superseded search cannot replace the current result", async ({
  page,
}) => {
  await mockApi(page);
  await page.route("**/api/search**", async (route) => {
    const body: { query: string } = route.request().postDataJSON();
    if (body.query === "slow query")
      await new Promise((resolve) => setTimeout(resolve, 1000));
    await fulfill(route, {
      query: body.query,
      matches: [
        {
          ...match,
          title:
            body.query === "slow query"
              ? "Superseded record"
              : "Current record",
        },
      ],
      elapsed_ms: 95,
    });
  });
  await page.goto("/");
  await navigateRecords(page);
  const input = page.getByRole("textbox", { name: "Search patient records" });
  const first = page.waitForRequest((request) =>
    request.url().includes("/api/search"),
  );
  await input.fill("slow query");
  await first;
  await input.fill("current query");
  await expect(
    page.getByRole("button", { name: /^Open record: Current record/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Open record: Superseded record/ }),
  ).toHaveCount(0);
  await input.fill("");
  await expect(
    page.getByRole("heading", { name: "Search to find records", exact: true }),
  ).toBeVisible();
});

test("switching patients cannot put an old document beneath the new patient banner", async ({
  page,
  isMobile,
}) => {
  test.skip(
    isMobile,
    "Mobile review closes before selecting a different patient",
  );
  const second = {
    ...match,
    patient_id: "patient-2",
    patient_name: "Synthetic Second Patient",
    record_id: "record-2",
    title: "Second patient's note",
    mrn: "MRN00099",
  };
  await mockApi(page, { matches: [match, second] });
  let finishFirst: (() => void) | undefined;
  const firstFinished = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  await page.route(`**/api/patients/${patientId}`, async (route) => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await fulfill(route, patient);
    } finally {
      finishFirst?.();
    }
  });
  const secondPatient = {
    ...patient,
    patient: {
      ...patient.patient,
      id: "patient-2",
      name: second.patient_name,
      mrn: second.mrn,
    },
    records: [{ ...patient.records[0], id: "record-2", title: second.title }],
  };
  await page.route("**/api/patients/patient-2", (route) =>
    fulfill(route, secondPatient),
  );
  await page.route("**/api/records/record-2", (route) =>
    fulfill(route, {
      ...record,
      record: {
        ...record.record,
        id: "record-2",
        patient: secondPatient.patient,
        title: second.title,
        text: "This is the second patient's original source.",
      },
    }),
  );
  await page.goto("/");
  await navigateRecords(page);
  await search(page);
  const firstRequest = page.waitForRequest((req) =>
    req.url().includes(`/api/patients/${patientId}`),
  );
  await page.getByRole("button", { name: /^Open record: Renal panel/ }).click();
  await firstRequest;
  await page
    .getByRole("button", { name: /^Open record: Second patient's note/ })
    .click();
  const panel = panelFor(page, false);
  await expect(
    panel.getByRole("heading", { name: second.patient_name, exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("region", { name: "Source record content" }),
  ).toContainText("second patient's original source");
  await firstFinished;
  await expect(
    panel.getByRole("heading", { name: "Patient 02", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("region", { name: "Source record content" }),
  ).not.toContainText("Creatinine 2.1");
});

test("long multilingual records fit and source/summary views meet automated accessibility checks", async ({
  page,
  isMobile,
}) => {
  test.setTimeout(60_000);
  await mockApi(page, {
    ready: true,
    matches: [
      {
        ...match,
        patient_name:
          "\u1200\u1293 \u1260\u1240\u1208 Patient " + "VeryLongName".repeat(8),
        mrn: "MRN" + "0123456789".repeat(7),
        title:
          "Diagnostic report " +
          "\u9577\u3044\u8a3a\u7642\u8a18\u9332".repeat(12),
      },
    ],
  });
  await page.goto("/");
  await navigateRecords(page);
  await search(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await checkAccessibility(page);
  const panel = await selectRecord(page, isMobile);
  await checkAccessibility(page);
  await panel
    .getByRole("tab", { name: "Patient summary", exact: true })
    .click();
  await expect(panel.getByText("AI-generated", { exact: true })).toBeVisible();
  await checkAccessibility(page);
});

test("patient entry opens a chart and scopes subsequent searches on the backend", async ({
  page,
  isMobile,
}) => {
  await mockApi(page);
  await page.goto("/patients");
  await expect(page.getByRole("heading", { name: /^Patients/ })).toBeVisible();
  await page.getByRole("button", { name: /^Open patient:/ }).click();
  const panel = panelFor(page, isMobile);
  await expect(
    panel.getByRole("region", { name: "Source record content" }),
  ).toBeVisible();
  if (isMobile) await page.keyboard.press("Escape");
  const scoped = page.waitForRequest(
    (req) =>
      req.url().includes("/api/search") &&
      new URL(req.url()).searchParams.get("patient_id") === patientId,
  );
  await page
    .getByRole("textbox", { name: "Search patient records" })
    .fill("creatinine");
  await scoped;
  await expect(
    page.getByText("Selected patient only", { exact: true }),
  ).toBeHidden();
  const all = page.getByRole("button", {
    name: "Search all patients",
    exact: true,
  });
  await all.click();
  await expect(
    page.getByText("Across all patients", { exact: true }).first(),
  ).toBeVisible();
});
