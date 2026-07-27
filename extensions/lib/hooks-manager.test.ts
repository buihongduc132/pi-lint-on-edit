/**
 * hooks-manager.test.ts — Unit tests for the hook registry + state persistence.
 *
 * Uses real temp dirs (node:fs is NOT mocked) so file IO branches are
 * genuinely exercised.
 */
// @ts-nocheck

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	registerHook,
	getRegistry,
	clearRegistry,
	setCurrentDisabled,
	getCurrentDisabled,
	isEnabled,
	isEnabledWithState,
	loadState,
	saveState,
	switchScope,
	addDisabled,
	removeDisabled,
} from "./hooks-manager.ts";

import type { HookState, StatePaths } from "./types.ts";

// ─── Temp dir helpers ────────────────────────────────────────────────────────

function makePaths(): StatePaths & { _root: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-hooks-"));
	return {
		globalDir: path.join(root, "global"),
		localDir: path.join(root, "local"),
		_root: root,
	};
}

function writeFile(dir: string, contents: string): void {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "hooks-state.json"), contents, "utf-8");
}

function rmrf(target: string): void {
	if (!fs.existsSync(target)) return;
	fs.rmSync(target, { recursive: true, force: true });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("hooks-manager", () => {
	let paths: StatePaths & { _root: string };

	beforeEach(() => {
		clearRegistry();
		setCurrentDisabled({});
		paths = makePaths();
	});

	afterEach(() => {
		rmrf(paths._root);
	});

	// ── Registry ───────────────────────────────────────────────────────────

	describe("registerHook / getRegistry / clearRegistry", () => {
		it("adds a hook with defaults", () => {
			registerHook("ext-a", "tool_call");
			const reg = getRegistry();
			expect(reg).toHaveLength(1);
			expect(reg[0]).toEqual({
				extension: "ext-a",
				event: "tool_call",
				blocking: false,
				source: "pi",
				origin: "global",
			});
		});

		it("passes through explicit opts", () => {
			registerHook("ext-b", "ctx", {
				blocking: true,
				source: "claude",
				origin: "package",
			});
			expect(getRegistry()[0]).toEqual({
				extension: "ext-b",
				event: "ctx",
				blocking: true,
				source: "claude",
				origin: "package",
			});
		});

		it("treats blocking: false explicitly", () => {
			registerHook("ext-c", "e", { blocking: false });
			expect(getRegistry()[0].blocking).toBe(false);
		});

		it("does NOT add a duplicate (same extension + event)", () => {
			registerHook("ext-d", "tool_call", { source: "pi" });
			registerHook("ext-d", "tool_call", { source: "claude" });
			expect(getRegistry()).toHaveLength(1);
			// First registration wins
			expect(getRegistry()[0].source).toBe("pi");
		});

		it("allows same extension with different events", () => {
			registerHook("ext-e", "tool_call");
			registerHook("ext-e", "session_start");
			expect(getRegistry()).toHaveLength(2);
		});

		it("allows same event across different extensions", () => {
			registerHook("ext-f", "tool_call");
			registerHook("ext-g", "tool_call");
			expect(getRegistry()).toHaveLength(2);
		});

		it("getRegistry returns a defensive copy", () => {
			registerHook("ext-h", "e");
			const a = getRegistry();
			a.push({ extension: "x", event: "y", blocking: false, source: "pi", origin: "global" });
			expect(getRegistry()).toHaveLength(1);
		});

		it("clearRegistry empties the registry", () => {
			registerHook("ext-i", "e");
			expect(getRegistry()).toHaveLength(1);
			clearRegistry();
			expect(getRegistry()).toHaveLength(0);
		});

		it("clearRegistry works on an empty registry", () => {
			clearRegistry();
			expect(getRegistry()).toHaveLength(0);
		});
	});

	// ── Disabled map ───────────────────────────────────────────────────────

	describe("setCurrentDisabled / getCurrentDisabled", () => {
		it("set + get round-trips", () => {
			setCurrentDisabled({ ext: ["a", "b"] });
			expect(getCurrentDisabled()).toEqual({ ext: ["a", "b"] });
		});

		it("replaces the map (not merge)", () => {
			setCurrentDisabled({ a: ["1"] });
			setCurrentDisabled({ b: ["2"] });
			expect(getCurrentDisabled()).toEqual({ b: ["2"] });
		});

		it("getCurrentDisabled initialises to empty object when unset", () => {
			// Force unset state for this assertion
			delete (globalThis as any).__PI_HOOKS_DISABLED__;
			expect(getCurrentDisabled()).toEqual({});
		});
	});

	describe("isEnabled (uses global disabled state)", () => {
		it("returns true when extension not in disabled map", () => {
			setCurrentDisabled({});
			expect(isEnabled("ext", "tool_call")).toBe(true);
		});

		it("returns true when extension present but event not in list", () => {
			setCurrentDisabled({ ext: ["other-event"] });
			expect(isEnabled("ext", "tool_call")).toBe(true);
		});

		it("returns false when event IS in the disabled list", () => {
			setCurrentDisabled({ ext: ["tool_call"] });
			expect(isEnabled("ext", "tool_call")).toBe(false);
		});
	});

	describe("isEnabledWithState (explicit map)", () => {
		it("returns true when extension not in map", () => {
			expect(isEnabledWithState("ext", "e", {})).toBe(true);
		});

		it("returns true when event not in list", () => {
			expect(isEnabledWithState("ext", "e", { ext: ["other"] })).toBe(true);
		});

		it("returns false when event in list", () => {
			expect(isEnabledWithState("ext", "e", { ext: ["e"] })).toBe(false);
		});

		it("does not mutate the passed-in map", () => {
			const map = { ext: ["e"] };
			isEnabledWithState("ext", "e", map);
			expect(map).toEqual({ ext: ["e"] });
		});
	});

	// ── State persistence: loadState ───────────────────────────────────────

	describe("loadState", () => {
		it("scope=global + no files → default", () => {
			const st = loadState(paths, "global");
			expect(st).toEqual({ scope: "global", disabled: {} });
		});

		it("scope=global + global file present → returns it", () => {
			writeFile(paths.globalDir, JSON.stringify({ scope: "global", disabled: { a: ["x"] } }));
			const st = loadState(paths, "global");
			expect(st.scope).toBe("global");
			expect(st.disabled).toEqual({ a: ["x"] });
		});

		it("scope=global ignores local file entirely", () => {
			writeFile(paths.globalDir, JSON.stringify({ scope: "global", disabled: { g: ["1"] } }));
			writeFile(paths.localDir, JSON.stringify({ scope: "local", disabled: { l: ["2"] } }));
			const st = loadState(paths, "global");
			expect(st.disabled).toEqual({ g: ["1"] });
		});

		it("scope=local + both missing → default local", () => {
			const st = loadState(paths, "local");
			expect(st).toEqual({ scope: "local", disabled: {} });
		});

		it("scope=local + local missing + global present → global with scope forced local", () => {
			writeFile(paths.globalDir, JSON.stringify({ scope: "global", disabled: { g: ["1"] } }));
			const st = loadState(paths, "local");
			expect(st.scope).toBe("local");
			expect(st.disabled).toEqual({ g: ["1"] });
		});

		it("scope=local + global missing + local present → local as-is", () => {
			writeFile(paths.localDir, JSON.stringify({ scope: "local", disabled: { l: ["2"] } }));
			const st = loadState(paths, "local");
			expect(st.scope).toBe("local");
			expect(st.disabled).toEqual({ l: ["2"] });
		});

		it("scope=local + both present → merges, local overrides global per-extension", () => {
			writeFile(
				paths.globalDir,
				JSON.stringify({ scope: "global", disabled: { shared: ["g-only"], onlyGlobal: ["1"] } }),
			);
			writeFile(
				paths.localDir,
				JSON.stringify({ scope: "local", disabled: { shared: ["local-wins"], onlyLocal: ["2"] } }),
			);
			const st = loadState(paths, "local");
			expect(st.scope).toBe("local");
			expect(st.disabled).toEqual({
				shared: ["local-wins"], // local overrides
				onlyGlobal: ["1"], // preserved from global
				onlyLocal: ["2"], // from local
			});
		});

		it("invalid JSON → null → falls back to default", () => {
			writeFile(paths.globalDir, "{ not valid json");
			const st = loadState(paths, "global");
			expect(st).toEqual({ scope: "global", disabled: {} });
		});

		it("non-object root (array) → sanitized to default", () => {
			writeFile(paths.globalDir, JSON.stringify([1, 2, 3]));
			const st = loadState(paths, "global");
			expect(st).toEqual({ scope: "global", disabled: {} });
		});

		it("non-object root (string) → sanitized to default", () => {
			writeFile(paths.globalDir, JSON.stringify("hello"));
			const st = loadState(paths, "global");
			expect(st).toEqual({ scope: "global", disabled: {} });
		});

		it("null root → sanitized to default", () => {
			writeFile(paths.globalDir, JSON.stringify(null));
			const st = loadState(paths, "global");
			expect(st).toEqual({ scope: "global", disabled: {} });
		});

		it("scope value coerced: anything non-'local' → 'global'", () => {
			writeFile(paths.globalDir, JSON.stringify({ scope: "weird", disabled: {} }));
			const st = loadState(paths, "global");
			expect(st.scope).toBe("global");
		});

		it("disabled not an object (array) → filtered to {}", () => {
			writeFile(paths.globalDir, JSON.stringify({ scope: "global", disabled: ["a", "b"] }));
			const st = loadState(paths, "global");
			expect(st.disabled).toEqual({});
		});

		it("disabled missing → {}", () => {
			writeFile(paths.globalDir, JSON.stringify({ scope: "global" }));
			const st = loadState(paths, "global");
			expect(st.disabled).toEqual({});
		});

		it("disabled entry with non-array value → filtered out", () => {
			writeFile(
				paths.globalDir,
				JSON.stringify({ scope: "global", disabled: { good: ["a"], bad: "not-array", bad2: 42 } }),
			);
			const st = loadState(paths, "global");
			expect(st.disabled).toEqual({ good: ["a"] });
		});

		it("disabled array with non-string elements → filtered out", () => {
			writeFile(
				paths.globalDir,
				JSON.stringify({ scope: "global", disabled: { good: ["a"], mixed: ["ok", 1, { x: 1 }] } }),
			);
			const st = loadState(paths, "global");
			expect(st.disabled).toEqual({ good: ["a"] });
		});

		it("disabled empty array entry is kept (all elements vacuously string)", () => {
			writeFile(paths.globalDir, JSON.stringify({ scope: "global", disabled: { empty: [] } }));
			const st = loadState(paths, "global");
			expect(st.disabled).toEqual({ empty: [] });
		});

		it("scope=local + invalid global JSON + valid local → uses local only", () => {
			writeFile(paths.globalDir, "{ broken");
			writeFile(paths.localDir, JSON.stringify({ scope: "local", disabled: { l: ["1"] } }));
			const st = loadState(paths, "local");
			expect(st.disabled).toEqual({ l: ["1"] });
		});
	});

	// ── saveState ──────────────────────────────────────────────────────────

	describe("saveState", () => {
		it("writes to globalDir when scope is global", () => {
			saveState({ scope: "global", disabled: { a: ["x"] } }, paths);
			const raw = fs.readFileSync(path.join(paths.globalDir, "hooks-state.json"), "utf-8");
			expect(JSON.parse(raw)).toEqual({ scope: "global", disabled: { a: ["x"] } });
		});

		it("writes to localDir when scope is local", () => {
			saveState({ scope: "local", disabled: { b: ["y"] } }, paths);
			const raw = fs.readFileSync(path.join(paths.localDir, "hooks-state.json"), "utf-8");
			expect(JSON.parse(raw)).toEqual({ scope: "local", disabled: { b: ["y"] } });
		});

		it("creates the directory if it does not exist", () => {
			const deepDir = path.join(paths._root, "deep", "nest", "global");
			const p = { globalDir: deepDir, localDir: path.join(paths._root, "deep", "nest", "local") };
			saveState({ scope: "global", disabled: {} }, p);
			expect(fs.existsSync(path.join(deepDir, "hooks-state.json"))).toBe(true);
		});
	});

	// ── switchScope ────────────────────────────────────────────────────────

	describe("switchScope", () => {
		it("same scope → returns current unchanged and writes nothing", () => {
			const current: HookState = { scope: "global", disabled: { a: ["1"] } };
			const result = switchScope(current, "global", paths);
			expect(result).toBe(current); // identity
			expect(fs.existsSync(path.join(paths.globalDir, "hooks-state.json"))).toBe(false);
		});

		it("different scope → loads target + saves it", () => {
			// Pre-seed the local file
			writeFile(paths.localDir, JSON.stringify({ scope: "local", disabled: { seeded: ["1"] } }));
			const current: HookState = { scope: "global", disabled: { a: ["1"] } };
			const result = switchScope(current, "local", paths);
			expect(result.scope).toBe("local");
			expect(result.disabled).toEqual({ seeded: ["1"] });
			// And it was saved to local dir
			const raw = fs.readFileSync(path.join(paths.localDir, "hooks-state.json"), "utf-8");
			expect(JSON.parse(raw).disabled).toEqual({ seeded: ["1"] });
		});

		it("different scope + target missing → loads default + saves default", () => {
			const current: HookState = { scope: "global", disabled: { a: ["1"] } };
			const result = switchScope(current, "local", paths);
			expect(result).toEqual({ scope: "local", disabled: {} });
			expect(fs.existsSync(path.join(paths.localDir, "hooks-state.json"))).toBe(true);
		});
	});

	// ── addDisabled ────────────────────────────────────────────────────────

	describe("addDisabled", () => {
		it("creates a new key with the event", () => {
			const state: HookState = { scope: "global", disabled: {} };
			addDisabled(state, "ext", "tool_call");
			expect(state.disabled).toEqual({ ext: ["tool_call"] });
		});

		it("is idempotent (event already present)", () => {
			const state: HookState = { scope: "global", disabled: { ext: ["tool_call"] } };
			addDisabled(state, "ext", "tool_call");
			expect(state.disabled.ext).toEqual(["tool_call"]);
		});

		it("appends to an existing list (new event)", () => {
			const state: HookState = { scope: "global", disabled: { ext: ["tool_call"] } };
			addDisabled(state, "ext", "session_start");
			expect(state.disabled.ext).toEqual(["tool_call", "session_start"]);
		});

		it("does not touch other extensions", () => {
			const state: HookState = { scope: "global", disabled: { other: ["x"] } };
			addDisabled(state, "ext", "e");
			expect(state.disabled).toEqual({ other: ["x"], ext: ["e"] });
		});
	});

	// ── removeDisabled ─────────────────────────────────────────────────────

	describe("removeDisabled", () => {
		it("no-op when extension not present", () => {
			const state: HookState = { scope: "global", disabled: { other: ["x"] } };
			removeDisabled(state, "ext", "e");
			expect(state.disabled).toEqual({ other: ["x"] });
		});

		it("no-op when event not in list", () => {
			const state: HookState = { scope: "global", disabled: { ext: ["tool_call"] } };
			removeDisabled(state, "ext", "session_start");
			expect(state.disabled.ext).toEqual(["tool_call"]);
		});

		it("removes event but leaves others", () => {
			const state: HookState = {
				scope: "global",
				disabled: { ext: ["tool_call", "session_start", "ctx"] },
			};
			removeDisabled(state, "ext", "session_start");
			expect(state.disabled.ext).toEqual(["tool_call", "ctx"]);
		});

		it("deletes the key when last event removed", () => {
			const state: HookState = { scope: "global", disabled: { ext: ["tool_call"] } };
			removeDisabled(state, "ext", "tool_call");
			expect(state.disabled).toEqual({});
			expect("ext" in state.disabled).toBe(false);
		});

		it("removes only the first matching occurrence", () => {
			const state: HookState = { scope: "global", disabled: { ext: ["a", "a", "b"] } };
			removeDisabled(state, "ext", "a");
			expect(state.disabled.ext).toEqual(["a", "b"]);
		});
	});
});
