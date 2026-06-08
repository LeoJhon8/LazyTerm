import { strict as assert } from "node:assert";

import {
  DEFAULT_QUICK_COMMAND_FONT_SIZE,
  normalizeQuickCommandFontSize,
} from "../settings-values.ts";

assert.equal(DEFAULT_QUICK_COMMAND_FONT_SIZE, 12);
assert.equal(normalizeQuickCommandFontSize(14), 14);
assert.equal(normalizeQuickCommandFontSize(7), 10);
assert.equal(normalizeQuickCommandFontSize(25), 20);
assert.equal(normalizeQuickCommandFontSize(Number.NaN), DEFAULT_QUICK_COMMAND_FONT_SIZE);
