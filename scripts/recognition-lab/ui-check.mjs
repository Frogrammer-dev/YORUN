// Browser integration smoke check. Synthetic responses never enter real reviews/.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { reviewHtml } from "./review.mjs";
import { uiFixture } from "./ui-fixture.mjs";
import { validateReview } from "../../src/lib/eval/recognitionLab.ts";

const tmp = resolve("eval/recognition/tmp"); mkdirSync(tmp, { recursive: true });
for (const key of ["TEMP", "TMP", "TMPDIR"]) process.env[key] = tmp;
const { dataset, files } = uiFixture();
const htmlPath = `${tmp}/ui-smoke.html`; writeFileSync(htmlPath, reviewHtml(dataset, files, dataset.candidates));
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "msedge" });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(htmlPath).href);
  await page.locator("#who").fill("smoke-test-only");
  assert.equal(await page.locator(".proposal").count(), 0);
  await page.locator("#next").click();
  assert.match(await page.locator("#error").textContent(), /자유 답/);
  // Both free answers must be completed before proposed names are visible.
  for (let i = 0; i < 2; i++) {
    await page.locator("#guess").fill("하트"); await page.locator("#next").click();
  }
  assert.equal(await page.locator(".proposal").count(), 1); // duplicate label grouped across methods
  for (let i = 0; i < 2; i++) {
    await page.locator('[data-field="match"]').selectOption("true");
    await page.locator('[data-field="recognized"]').selectOption("true");
    await page.locator('[data-field="agree"]').selectOption("4");
    await page.locator("#next").click();
  }
  assert.equal(await page.locator("#next").isDisabled(), true);
  const downloadPromise = page.waitForEvent("download"); await page.locator("#export").click();
  const download = await downloadPromise; const output = `${tmp}/ui-smoke-export.json`; await download.saveAs(output);
  const result = validateReview(JSON.parse(readFileSync(output, "utf8")), dataset, files);
  assert.equal(result.items.length, 2); assert.equal(result.items[0].ratings.length, 2);
  // Resume in an isolated context from exported data.
  const other = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await other.goto(pathToFileURL(htmlPath).href); await other.locator("#restore").setInputFiles(output);
  await other.waitForFunction(() => document.getElementById("next").disabled);
  assert.equal(await other.locator("#who").inputValue(), "smoke-test-only");
  const run = process.argv[2] ?? "pilot-20261010";
  if (!/^[A-Za-z0-9_-]+$/.test(run)) throw new Error("Invalid run");
  await page.goto(pathToFileURL(resolve(`eval/recognition/${run}/comparison.html`)).href);
  assert.ok(await page.locator("section").count() > 0);
  await page.goto(pathToFileURL(resolve(`eval/recognition/${run}/judge.html`)).href);
  await page.screenshot({ path: resolve(`eval/recognition/${run}/judge-mobile.png`), fullPage: true });
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("PASS browser: answer locking, grouping, export, schema, resume, analyst page and mobile layout");
} finally { await browser.close(); }
