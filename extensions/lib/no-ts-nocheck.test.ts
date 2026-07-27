/**
 * no-ts-nocheck.test.ts — Regression guard for issue #1.
 *
 * Asserts that the source files under extensions/lib/ do NOT carry a
 * top-level `// @ts-nocheck` pragma. That pragma disables ALL TypeScript
 * checking for a file, silently masking future type errors. Issue #1 found
 * it was hiding (a) the NodeNext relative-import extension requirement and
 * (b) a cascading unknown→string[] unsoundness.
 *
 * `npm run typecheck` is the primary guard (it fails on any real type error),
 * but this test makes the "no pragma" invariant explicit and test-enforced
 * so the pragma cannot be silently re-introduced.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIB_DIR = __dirname;

/** Source files (non-test) under extensions/lib/ that must stay type-checked. */
function libSourceFiles(): string[] {
	return fs
		.readdirSync(LIB_DIR)
		.filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
		.map((f) => path.join(LIB_DIR, f));
}

describe("extensions/lib source files must not use // @ts-nocheck (issue #1)", () => {
	it("no source file carries a // @ts-nocheck pragma", () => {
		const offenders: string[] = [];
		for (const file of libSourceFiles()) {
			const content = fs.readFileSync(file, "utf-8");
			if (/(^|\n)\s*\/\/\s*@ts-nocheck/.test(content)) {
				offenders.push(path.relative(LIB_DIR, file));
			}
		}
		expect(offenders).toEqual([]);
	});
});
