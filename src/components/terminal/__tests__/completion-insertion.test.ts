import { strict as assert } from "node:assert";

import { getCompletionInsertion } from "../completion-insertion.ts";

const suffixInsertion = getCompletionInsertion("git commit ", "git commit --amend ");
assert.equal(suffixInsertion, "--amend ");

const replacementInsertion = getCompletionInsertion("gcm ", "git commit ");
assert.equal(replacementInsertion, "\b\b\b\bgit commit ");
