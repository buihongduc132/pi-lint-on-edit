/**
 * plugin-logger.test.ts — Unit tests for the file-based logger + rotation.
 *
 * Uses real temp files (node:fs is NOT mocked) so rotation is genuinely
 * exercised.
 */
// @ts-nocheck

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createPluginLogger } from "./plugin-logger.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pi-logger-"));
}

const created: string[] = [];

function readFile(p: string): string {
	if (!fs.existsSync(p)) return "";
	return fs.readFileSync(p, "utf-8");
}

function rmrf(target: string): void {
	if (!fs.existsSync(target)) return;
	fs.rmSync(target, { recursive: true, force: true });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("plugin-logger", () => {
	let dir: string;

	beforeEach(() => {
		dir = tmpDir();
		created.push(dir);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		rmrf(dir);
	});

	// ── createPluginLogger: filePath resolution ────────────────────────────

	describe("filePath resolution", () => {
		it("uses options.filePath (resolved absolute)", () => {
			const rel = path.join(dir, "sub", "my.log");
			const logger = createPluginLogger("anything", { filePath: rel });
			expect(logger.filePath).toBe(path.resolve(rel));
			expect(logger.name).toBe("anything");
		});

		it("uses options.baseDir + sanitized name when no filePath", () => {
			const logger = createPluginLogger("My Plugin", { baseDir: dir });
			expect(logger.filePath).toBe(path.resolve(dir, "my-plugin.log"));
		});

		it("uses default baseDir (~/.pi/logs/extensions) when nothing given", () => {
			// Do NOT log here — would write outside temp. Just assert resolution.
			const logger = createPluginLogger("cool");
			const expected = path.resolve(os.homedir(), ".pi", "logs", "extensions", "cool.log");
			expect(logger.filePath).toBe(expected);
		});

		it("filePath takes precedence over baseDir", () => {
			const logger = createPluginLogger("x", {
				filePath: path.join(dir, "a.log"),
				baseDir: path.join(dir, "ignored"),
			});
			expect(logger.filePath).toBe(path.resolve(path.join(dir, "a.log")));
		});
	});

	// ── sanitizeFileName (via logger names) ────────────────────────────────

	describe("name sanitization", () => {
		const cases: Array<[string, string]> = [
			["My Plugin", "my-plugin"],
			["ABC!!!", "abc"],
			["!!!ABC!!!", "abc"],
			["Multi   Space", "multi-space"],
			["a.b_c-d", "a.b_c-d"],
			["UPPER-Case", "upper-case"],
			["   ", "plugin"],
			["", "plugin"],
			["---", "plugin"],
			["$$$%%%", "plugin"],
			["café-münchen", "caf-m-nchen"],
		];

		for (const [input, expected] of cases) {
			it(`sanitizes ${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
				const logger = createPluginLogger(input, { baseDir: dir });
				expect(path.basename(logger.filePath)).toBe(`${expected}.log`);
			});
		}
	});

	// ── basic logging ─────────────────────────────────────────────────────

	describe("basic logging", () => {
		it("appends a line with timestamp, name, level, message", () => {
			const fp = path.join(dir, "a.log");
			const logger = createPluginLogger("ext", { filePath: fp });
			logger.info("hello world");
			const content = readFile(fp);
			expect(content).toMatch(/\d{4}-\d{2}-\d{2}T.*\[ext\] INFO hello world\n$/);
		});

		it("writes for all four levels", () => {
			const fp = path.join(dir, "all.log");
			const logger = createPluginLogger("ext", { filePath: fp });
			logger.debug("d");
			logger.info("i");
			logger.warn("w");
			logger.error("e");
			const content = readFile(fp);
			expect(content).toMatch(/DEBUG d\n/);
			expect(content).toMatch(/INFO i\n/);
			expect(content).toMatch(/WARN w\n/);
			expect(content).toMatch(/ERROR e\n/);
		});

		it("creates parent directories on first write", () => {
			const fp = path.join(dir, "deep", "deeper", "a.log");
			const logger = createPluginLogger("ext", { filePath: fp });
			logger.info("x");
			expect(fs.existsSync(fp)).toBe(true);
		});
	});

	// ── normalizeDetails (via details arg) ────────────────────────────────

	describe("normalizeDetails", () => {
		it("undefined details → no suffix", () => {
			const fp = path.join(dir, "u.log");
			const logger = createPluginLogger("ext", { filePath: fp });
			logger.info("msg");
			expect(readFile(fp)).toMatch(/INFO msg\n$/);
		});

		it("string details → appended verbatim", () => {
			const fp = path.join(dir, "s.log");
			const logger = createPluginLogger("ext", { filePath: fp });
			logger.info("msg", "plain-string-detail");
			expect(readFile(fp)).toMatch(/INFO msg plain-string-detail\n$/);
		});

		it("Error details → JSON {name, message, stack}", () => {
			const fp = path.join(dir, "err.log");
			const logger = createPluginLogger("ext", { filePath: fp });
			const err = new Error("boom");
			logger.error("failed", err);
			const content = readFile(fp);
			const jsonPart = content.replace(/^.*ERROR failed /, "").trim();
			const parsed = JSON.parse(jsonPart);
			expect(parsed.name).toBe("Error");
			expect(parsed.message).toBe("boom");
			expect(typeof parsed.stack).toBe("string");
			expect(parsed.stack.length).toBeGreaterThan(0);
		});

		it("Error subclass keeps its name", () => {
			const fp = path.join(dir, "te.log");
			const logger = createPluginLogger("ext", { filePath: fp });
			class MyErr extends Error {
				constructor(m: string) {
					super(m);
					this.name = "MyErr";
				}
			}
			logger.error("x", new MyErr("custom"));
			const content = readFile(fp);
			const jsonPart = content.replace(/^.*ERROR x /, "").trim();
			expect(JSON.parse(jsonPart).name).toBe("MyErr");
		});

		it("plain object details → JSON.stringify", () => {
			const fp = path.join(dir, "o.log");
			const logger = createPluginLogger("ext", { filePath: fp });
			logger.info("msg", { a: 1, b: "two" });
			const content = readFile(fp);
			const jsonPart = content.replace(/^.*INFO msg /, "").trim();
			expect(JSON.parse(jsonPart)).toEqual({ a: 1, b: "two" });
		});

		it("number details → JSON.stringify", () => {
			const fp = path.join(dir, "n.log");
			const logger = createPluginLogger("ext", { filePath: fp });
			logger.info("msg", 42);
			expect(readFile(fp)).toMatch(/INFO msg 42\n$/);
		});

		it("circular object → falls back to String()", () => {
			const fp = path.join(dir, "c.log");
			const logger = createPluginLogger("ext", { filePath: fp });
			const circular: any = { name: "root" };
			circular.self = circular;
			logger.warn("cyc", circular);
			const content = readFile(fp);
			// String({name:'root', self: [Circular]}) === "[object Object]"
			expect(content).toMatch(/WARN cyc \[object Object\]\n$/);
		});

		it("null details → JSON 'null'", () => {
			const fp = path.join(dir, "null.log");
			const logger = createPluginLogger("ext", { filePath: fp });
			logger.info("msg", null);
			expect(readFile(fp)).toMatch(/INFO msg null\n$/);
		});
	});

	// ── mirrorToConsole ───────────────────────────────────────────────────

	describe("mirrorToConsole", () => {
		it("default false → console not touched", () => {
			const spyErr = vi.spyOn(console, "error").mockImplementation(() => {});
			const spyWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const spyLog = vi.spyOn(console, "log").mockImplementation(() => {});
			const fp = path.join(dir, "nm.log");
			const logger = createPluginLogger("ext", { filePath: fp });
			logger.debug("d");
			logger.info("i");
			logger.warn("w");
			logger.error("e");
			expect(spyErr).not.toHaveBeenCalled();
			expect(spyWarn).not.toHaveBeenCalled();
			expect(spyLog).not.toHaveBeenCalled();
			// File still written
			expect(readFile(fp)).toContain("INFO i");
		});

		it("true → error mirrors to console.error", () => {
			const spy = vi.spyOn(console, "error").mockImplementation(() => {});
			const fp = path.join(dir, "me.log");
			const logger = createPluginLogger("ext", { filePath: fp, mirrorToConsole: true });
			logger.error("boom");
			expect(spy).toHaveBeenCalledTimes(1);
			expect(spy.mock.calls[0][0]).toMatch(/\[ext\] ERROR boom/);
			// trimmed by mirror()
			expect(spy.mock.calls[0][0]).not.toMatch(/\n$/);
		});

		it("true → warn mirrors to console.warn", () => {
			const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
			const logger = createPluginLogger("ext", {
				filePath: path.join(dir, "mw.log"),
				mirrorToConsole: true,
			});
			logger.warn("careful");
			expect(spy).toHaveBeenCalledTimes(1);
			expect(spy.mock.calls[0][0]).toMatch(/\[ext\] WARN careful/);
		});

		it("true → debug/info mirror to console.log", () => {
			const spy = vi.spyOn(console, "log").mockImplementation(() => {});
			const logger = createPluginLogger("ext", {
				filePath: path.join(dir, "md.log"),
				mirrorToConsole: true,
			});
			logger.debug("dbg");
			logger.info("inf");
			expect(spy).toHaveBeenCalledTimes(2);
			expect(spy.mock.calls[0][0]).toMatch(/DEBUG dbg/);
			expect(spy.mock.calls[1][0]).toMatch(/INFO inf/);
		});
	});

	// ── maxBytes ──────────────────────────────────────────────────────────

	describe("maxBytes", () => {
		it("default (omitted) keeps small writes without trimming", () => {
			const fp = path.join(dir, "def.log");
			const logger = createPluginLogger("ext", { filePath: fp });
			for (let i = 0; i < 5; i++) {
				logger.info(`line ${i}`);
			}
			const content = readFile(fp);
			// All five lines preserved (default 25MB is huge)
			expect(content.split("\n").filter((l) => l.includes("line")).length).toBe(5);
		});

		it("explicit value bounds the file via rotation", () => {
			const fp = path.join(dir, "small.log");
			const logger = createPluginLogger("ext", { filePath: fp, maxBytes: 120 });
			// Each line ~40-50 bytes; write plenty to force multiple rotations
			for (let i = 0; i < 50; i++) {
				logger.info(`iteration-number-${i}-padding`);
			}
			const size = fs.statSync(fp).size;
			// After trim file should be <= maxBytes (post-trim keeps ~80%)
			expect(size).toBeLessThanOrEqual(120);
		});

		it("values < 1 are clamped to 1 (does not throw, file stays tiny)", () => {
			const fp = path.join(dir, "clamp.log");
			const logger = createPluginLogger("ext", { filePath: fp, maxBytes: 0 });
			logger.info("a reasonably long line that exceeds one byte");
			// Should not throw and the file is bounded to ~1 byte target
			const size = fs.statSync(fp).size;
			expect(size).toBeLessThanOrEqual(1);
		});

		it("negative maxBytes clamped to 1 too", () => {
			const fp = path.join(dir, "neg.log");
			const logger = createPluginLogger("ext", { filePath: fp, maxBytes: -999 });
			logger.info("data");
			expect(fs.statSync(fp).size).toBeLessThanOrEqual(1);
		});
	});

	// ── trimFileToLimit ───────────────────────────────────────────────────

	describe("trimFileToLimit (rotation behavior)", () => {
		it("trims at a newline boundary when file exceeds maxBytes", () => {
			const fp = path.join(dir, "rot.log");
			// Pre-seed a multi-line file well over the limit.
			// Each line ~20 bytes; 20 lines ~ 400 bytes.
			const lines: string[] = [];
			for (let i = 0; i < 20; i++) {
				lines.push(`LINE-${String(i).padStart(3, "0")}abcdefghij`); // ~24 chars + \n
			}
			fs.writeFileSync(fp, lines.join("\n") + "\n");
			const originalSize = fs.statSync(fp).size;

			// maxBytes=80 → targetBytes = floor(80*0.8) = 64
			const logger = createPluginLogger("ext", { filePath: fp, maxBytes: 80 });
			logger.info("trigger"); // forces a post-trim

			const newSize = fs.statSync(fp).size;
			expect(newSize).toBeLessThan(originalSize);
			expect(newSize).toBeLessThanOrEqual(80);
			// Trim happens at a newline boundary → first char is start of a line
			const content = readFile(fp);
			expect(content.startsWith("LINE-")).toBe(true);
			// No partial (unterminated first line) — each remaining line is whole
			for (const line of content.split("\n").filter((l) => l.length > 0)) {
				expect(line.startsWith("LINE-") || line.includes("[ext]")).toBe(true);
			}
		});

		it("no newline in the tail window → keeps tail bytes as-is", () => {
			const fp = path.join(dir, "nonl.log");
			// One giant line, no newlines at all.
			fs.writeFileSync(fp, "X".repeat(500));
			const logger = createPluginLogger("ext", { filePath: fp, maxBytes: 80 });
			logger.info("x"); // adds a \n at the end, then post-trim
			const size = fs.statSync(fp).size;
			// targetBytes=64; the seeded "X" run has no newline → tail kept as-is
			// (then the new short line appended before trim; final size bounded)
			expect(size).toBeLessThanOrEqual(80);
		});

		it("file under limit → unchanged by trim", () => {
			const fp = path.join(dir, "under.log");
			fs.writeFileSync(fp, "tiny\n");
			const before = fs.readFileSync(fp);
			const logger = createPluginLogger("ext", { filePath: fp, maxBytes: 1000 });
			logger.info("ok");
			const content = readFile(fp);
			// Original "tiny" line preserved (file never exceeded limit)
			expect(content.startsWith("tiny\n")).toBe(true);
		});

		it("file missing before a no-op trim path → still logs fine", () => {
			// Indirectly: a fresh logger on a non-existent file just appends.
			const fp = path.join(dir, "missing.log");
			expect(fs.existsSync(fp)).toBe(false);
			const logger = createPluginLogger("ext", { filePath: fp, maxBytes: 1000 });
			logger.info("first");
			expect(readFile(fp)).toMatch(/INFO first/);
		});
	});

	// ── appendLine pre-trim ───────────────────────────────────────────────

	describe("appendLine pre-trim", () => {
		it("triggers a pre-append trim when currentSize + incoming > maxBytes", () => {
			const fp = path.join(dir, "pre.log");
			// Pre-seed a file already larger than maxBytes.
			const lines: string[] = [];
			for (let i = 0; i < 30; i++) lines.push(`seed-line-${i}-padding-padding`);
			fs.writeFileSync(fp, lines.join("\n") + "\n");
			const seededSize = fs.statSync(fp).size;

			const logger = createPluginLogger("ext", { filePath: fp, maxBytes: 100 });
			// currentSize(seededSize ~840) + incoming(~40) > 100 → pre-trim fires
			logger.info("this triggers pre-trim then post-trim");

			const newSize = fs.statSync(fp).size;
			expect(newSize).toBeLessThan(seededSize);
			expect(newSize).toBeLessThanOrEqual(100);
			// File begins at a line boundary
			expect(readFile(fp).startsWith("seed-line-") || readFile(fp).includes("[ext]")).toBe(true);
		});
	});

	// ── write failure fallback ────────────────────────────────────────────

	describe("write failure → console.error fallback", () => {
		it("does not throw and logs to console.error when target is unwritable", () => {
			// Make "blocker" a regular file; filePath lives underneath it.
			const blocker = path.join(dir, "blocker");
			fs.writeFileSync(blocker, "i-am-a-file-not-a-dir");
			const badPath = path.join(blocker, "child", "log.log");

			const spy = vi.spyOn(console, "error").mockImplementation(() => {});
			const logger = createPluginLogger("ext", { filePath: badPath });

			// Must not throw; should fall back to console.error
			expect(() => logger.error("something")).not.toThrow();
			expect(spy).toHaveBeenCalled();
			// The fallback line documents the failure
			const lastCall = spy.mock.calls[spy.mock.calls.length - 1][0];
			expect(lastCall).toMatch(/log-write-failed/);
			// No file was created
			expect(fs.existsSync(badPath)).toBe(false);
		});

		it("non-error level also falls back silently on write failure", () => {
			const blocker = path.join(dir, "blocker2");
			fs.writeFileSync(blocker, "x");
			const badPath = path.join(blocker, "c.log");

			const spy = vi.spyOn(console, "error").mockImplementation(() => {});
			const logger = createPluginLogger("ext", { filePath: badPath });
			expect(() => logger.info("nope")).not.toThrow();
			expect(spy).toHaveBeenCalled();
			expect(spy.mock.calls[spy.mock.calls.length - 1][0]).toMatch(/log-write-failed/);
		});
	});

	// ── logger object shape ───────────────────────────────────────────────

	describe("returned logger shape", () => {
		it("exposes name, filePath, and all four level methods", () => {
			const fp = path.join(dir, "shape.log");
			const logger = createPluginLogger("ext", { filePath: fp });
			expect(logger.name).toBe("ext");
			expect(logger.filePath).toBe(path.resolve(fp));
			expect(typeof logger.debug).toBe("function");
			expect(typeof logger.info).toBe("function");
			expect(typeof logger.warn).toBe("function");
			expect(typeof logger.error).toBe("function");
		});
	});
});
