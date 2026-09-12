import assert from "node:assert/strict";
import {
  firstNonBlank,
  resolveCallSelection,
  resolveIntelligencePreference,
  resolveModelPreference,
} from "../src/intelligence-policy.mjs";

assert.equal(firstNonBlank("   ", "GPT-5.5"), "GPT-5.5");
assert.equal(firstNonBlank("", "  ", "GPT-5.6 Sol"), "GPT-5.6 Sol");
assert.equal(firstNonBlank("  ", ""), "");

assert.equal(
  resolveIntelligencePreference({ explicitLevel: "GPT-5.5", environmentDefault: "GPT-5.6 Sol" }),
  "GPT-5.5",
);
assert.equal(
  resolveIntelligencePreference({ environmentDefault: "GPT-5.6 Sol" }),
  "GPT-5.6 Sol",
);
assert.equal(
  resolveIntelligencePreference({ explicitLevel: "  High  " }),
  "High",
);
assert.equal(
  resolveIntelligencePreference({}),
  "",
);
assert.equal(
  resolveIntelligencePreference({ environmentDefault: "Pro", noDefault: true }),
  "",
);
assert.equal(
  resolveIntelligencePreference({ explicitLevel: "GPT-5.5", environmentDefault: "Pro", noDefault: true }),
  "GPT-5.5",
);
assert.equal(resolveModelPreference({ explicitModel: "5.6", environmentModel: "5.5" }), "5.6");
assert.equal(resolveModelPreference({ environmentModel: "5.5" }), "5.5");
assert.equal(resolveModelPreference({ explicitModel: "   ", environmentModel: "5.5" }), "5.5");

assert.deepEqual(
  resolveCallSelection({
    explicitLevel: "GPT-5.5",
    environmentLevel: "GPT-5.6 Sol",
    environmentDefault: "Pro",
    explicitModel: "5.6",
    environmentModel: "5.5",
    noDefault: true,
  }),
  {
    requestedLevel: "GPT-5.5",
    requestedModel: "5.6",
    intelligenceSource: "cli",
    modelSource: "cli",
  },
);
assert.deepEqual(
  resolveCallSelection({ environmentLevel: "GPT-5.6 Sol", environmentDefault: "Pro", environmentModel: "5.5" }),
  {
    requestedLevel: "GPT-5.6 Sol",
    requestedModel: "5.5",
    intelligenceSource: "environment",
    modelSource: "environment",
  },
);
assert.deepEqual(
  resolveCallSelection({ environmentLevel: "GPT-5.6 Sol", environmentDefault: "Pro", noDefault: true }),
  {
    requestedLevel: "GPT-5.6 Sol",
    requestedModel: "",
    intelligenceSource: "environment",
    modelSource: "account-default",
  },
);
assert.deepEqual(
  resolveCallSelection({ explicitLevel: "   ", environmentLevel: "   ", environmentDefault: "Pro" }),
  {
    requestedLevel: "Pro",
    requestedModel: "",
    intelligenceSource: "environment-default",
    modelSource: "account-default",
  },
);
assert.deepEqual(
  resolveCallSelection({ environmentDefault: "High" }),
  {
    requestedLevel: "High",
    requestedModel: "",
    intelligenceSource: "environment-default",
    modelSource: "account-default",
  },
);
assert.deepEqual(
  resolveCallSelection({}),
  {
    requestedLevel: "",
    requestedModel: "",
    intelligenceSource: "account-default",
    modelSource: "account-default",
  },
);

console.log(JSON.stringify({ ok: true, tested: "intelligence-policy" }, null, 2));
