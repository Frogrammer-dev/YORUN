import { test } from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { reviewHtml, comparisonHtml } from "./review.mjs";
import { uiFixture } from "./ui-fixture.mjs";


test("standalone human and analyst pages contain valid JavaScript", () => {
  const { dataset, files } = uiFixture();
  for (const html of [reviewHtml(dataset, files, dataset.candidates), comparisonHtml(dataset, files)]) {
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    assert.doesNotThrow(() => new Script(script));
  }
});
test("model text cannot terminate embedded data or execute markup", () => {
  const { dataset, files } = uiFixture();
  files[0].predictions[0].label = "</script><img onerror=bad()>";
  const html = reviewHtml(dataset, files, dataset.candidates);
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
  assert.ok(!html.includes("<img onerror=bad()>"));
});
