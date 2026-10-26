import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/components/home/decision-card.tsx"),
  "utf8",
);

test("Today's card only opens the review", () => {
  assert.notEqual(src.indexOf('href={`/pipeline/${app.n}`}'), -1);
  assert.match(src, /> Review\s*</);
});

test("Today's card writes nothing: every action lives on the detail page", () => {
  assert.doesNotMatch(src, /fetch\(/);
  assert.doesNotMatch(src, /setStatus\(/);
  assert.doesNotMatch(src, /LifecycleActions/);
});
