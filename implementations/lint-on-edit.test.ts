// @ts-nocheck
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
	buildAsyncDiagnosticContextMessage,
	formatDiagnostics,
	parseDiagnostics,
	DEFAULT_CONFIG,
} from "./lint-on-edit.ts";

// ─── parseDiagnostics ────────────────────────────────────────────────────────

describe("parseDiagnostics", () => {
	it("parses a single ERROR line", () => {
		const raw = "[typescript] ERROR at line 4, column 9: Missing semicolon [1005]";
		const entries = parseDiagnostics(raw);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toEqual({
			language: "typescript",
			severity: "ERROR",
			line: 4,
			column: 9,
			message: "Missing semicolon",
			code: 1005,
		});
	});

	it("parses a WARNING without error code", () => {
		const raw = "[eslint] WARNING at line 10, column 1: 'x' is assigned but never used";
		const entries = parseDiagnostics(raw);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toEqual({
			language: "eslint",
			severity: "WARNING",
			line: 10,
			column: 1,
			message: "'x' is assigned but never used",
			code: undefined,
		});
	});

	it("parses multiple diagnostic lines", () => {
		const raw = [
			"[typescript] ERROR at line 1, column 1: Cannot find module 'foo' [2307]",
			"[typescript] ERROR at line 5, column 3: Property 'bar' does not exist [2339]",
		].join("\n");
		const entries = parseDiagnostics(raw);
		expect(entries).toHaveLength(2);
		expect(entries[0].line).toBe(1);
		expect(entries[1].line).toBe(5);
	});

	it("handles HINT and INFO severities", () => {
		const raw =
			"[ts] HINT at line 2, column 3: Consider using const [8000]\n" +
			"[ts] INFO at line 3, column 4: File is part of program [6000]";
		const entries = parseDiagnostics(raw);
		expect(entries).toHaveLength(2);
		expect(entries[0].severity).toBe("HINT");
		expect(entries[1].severity).toBe("INFO");
	});

	it("returns empty array for non-matching text", () => {
		const raw = "just some random output\nno diagnostics here";
		expect(parseDiagnostics(raw)).toEqual([]);
	});

	it("returns empty array for empty string", () => {
		expect(parseDiagnostics("")).toEqual([]);
	});

	it("strips ANSI color codes before parsing", () => {
		const raw = "\x1b[31m[typescript] ERROR at line 1, column 1: Bad thing [1000]\x1b[0m";
		const entries = parseDiagnostics(raw);
		expect(entries).toHaveLength(1);
		expect(entries[0].severity).toBe("ERROR");
	});

	it("parses messages containing colons", () => {
		const raw =
			"[typescript] ERROR at line 1, column 1: Type '{ a: string }' is not assignable [2322]";
		const entries = parseDiagnostics(raw);
		expect(entries).toHaveLength(1);
		expect(entries[0].message).toBe("Type '{ a: string }' is not assignable");
	});
});

// ─── formatDiagnostics ───────────────────────────────────────────────────────

describe("formatDiagnostics", () => {
	it("includes the exact file path in the header", () => {
		const entries = parseDiagnostics(
			"[typescript] ERROR at line 4, column 9: Missing semicolon [1005]",
		);
		const text = formatDiagnostics(entries, "/repo/src/foo.ts");
		expect(text).toBeTruthy();
		expect(text).toMatch(/\/repo\/src\/foo\.ts/);
		expect(text).toMatch(/Missing semicolon/);
	});

	it("returns null when there are no ERROR entries", () => {
		const entries = parseDiagnostics(
			"[eslint] WARNING at line 1, column 1: unused variable",
		);
		expect(formatDiagnostics(entries, "/foo.ts")).toBeNull();
	});

	it("returns null for empty entries array", () => {
		expect(formatDiagnostics([], "/foo.ts")).toBeNull();
	});

	it("formats plural 'errors' when count > 1", () => {
		const raw =
			"[ts] ERROR at line 1, column 1: err1 [1]\n[ts] ERROR at line 2, column 1: err2 [2]";
		const entries = parseDiagnostics(raw);
		const text = formatDiagnostics(entries, "/foo.ts");
		expect(text).toContain("2 errors");
	});

	it("formats singular 'error' when count === 1", () => {
		const entries = parseDiagnostics(
			"[ts] ERROR at line 1, column 1: only one [1]",
		);
		const text = formatDiagnostics(entries, "/foo.ts");
		expect(text).toContain("1 error");
		expect(text).not.toContain("1 errors");
	});

	it("truncates to MAX_LINES (20) when there are many errors", () => {
		const lines: string[] = [];
		for (let i = 1; i <= 30; i++) {
			lines.push(`[ts] ERROR at line ${i}, column 1: error ${i} [${i}]`);
		}
		const entries = parseDiagnostics(lines.join("\n"));
		const text = formatDiagnostics(entries, "/foo.ts");
		expect(text).toContain("10 more error(s)");
		// Should not contain the 21st error in the list
		expect(text).not.toContain("L21:");
	});

	it("truncates output with byte limit message when exceeding MAX_BYTES", () => {
		// Create entries with very long messages to exceed 3072 bytes
		const longMsg = "x".repeat(300);
		const lines: string[] = [];
		for (let i = 1; i <= 15; i++) {
			lines.push(`[ts] ERROR at line ${i}, column 1: ${longMsg} [${i}]`);
		}
		const entries = parseDiagnostics(lines.join("\n"));
		const text = formatDiagnostics(entries, "/foo.ts");
		expect(text).toMatch(/\.\.\. \(truncated\)/);
	});

	it("includes 'Run: cli-lsp-client diagnostics' hint in truncation", () => {
		const lines: string[] = [];
		for (let i = 1; i <= 30; i++) {
			lines.push(`[ts] ERROR at line ${i}, column 1: error ${i} [${i}]`);
		}
		const entries = parseDiagnostics(lines.join("\n"));
		const text = formatDiagnostics(entries, "/foo.ts");
		expect(text).toContain("Run: cli-lsp-client diagnostics");
	});

	it("formats each error with L{line}:{column} [language] message", () => {
		const entries = parseDiagnostics(
			"[typescript] ERROR at line 42, column 7: Bad type [1234]",
		);
		const text = formatDiagnostics(entries, "/foo.ts");
		expect(text).toContain("L42:7 [typescript] Bad type");
	});

	it("filters out non-ERROR entries (WARNING, HINT, INFO)", () => {
		const raw =
			"[ts] WARNING at line 1, column 1: maybe bad\n" +
			"[ts] ERROR at line 2, column 1: definitely bad [1]\n" +
			"[ts] HINT at line 3, column 1: suggestion";
		const entries = parseDiagnostics(raw);
		const text = formatDiagnostics(entries, "/foo.ts");
		expect(text).toContain("1 error");
		expect(text).toContain("definitely bad");
		expect(text).not.toContain("maybe bad");
		expect(text).not.toContain("suggestion");
	});
});

// ─── buildAsyncDiagnosticContextMessage ──────────────────────────────────────

describe("buildAsyncDiagnosticContextMessage", () => {
	it("produces hidden context instructions with file path", () => {
		const message = buildAsyncDiagnosticContextMessage(
			"/repo/src/foo.ts",
			"⚠ LSP diagnostics for /repo/src/foo.ts (1 error):\n  L4:9 [typescript] Missing semicolon",
		);
		expect(message).toMatch(/\/repo\/src\/foo\.ts/);
		expect(message).toMatch(/latest edit introduced diagnostics/i);
		expect(message).toMatch(/fix that file before continuing/i);
	});

	it("includes the 'Diagnostics:' separator", () => {
		const message = buildAsyncDiagnosticContextMessage(
			"/foo.ts",
			"some diagnostic text",
		);
		expect(message).toContain("Diagnostics:");
	});

	it("includes the full diagnostic text in the message", () => {
		const diagText = "⚠ LSP diagnostics for /foo.ts (2 errors):\n  L1:1 error one\n  L2:2 error two";
		const message = buildAsyncDiagnosticContextMessage("/foo.ts", diagText);
		expect(message).toContain(diagText);
	});

	it("starts with the 'latest edit' preamble", () => {
		const message = buildAsyncDiagnosticContextMessage("/foo.ts", "diag");
		expect(message).toMatch(/^The latest edit introduced diagnostics/);
	});
});
