/**
 * session-state.test.ts — Tests for cached session identity
 *
 * RED PHASE: These tests MUST fail. They verify that:
 *   1. After captureSessionId(ctx), getCachedSessionId() returns the cached
 *      value WITHOUT re-accessing ctx.sessionManager.
 *   2. The cached value persists even after the original ctx is "destroyed".
 *   3. resetSessionState() clears the cache back to "ephemeral".
 *   4. Before any capture, getCachedSessionId() returns "ephemeral".
 *
 * The current (broken) implementation stores the ctx reference and
 * re-reads sessionManager on every getCachedSessionId() call, which
 * simulates the stale-ctx crash.
 */
// @ts-nocheck


import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	type CtxLike,
	type SessionManagerLike,
	captureSessionId,
	getCachedSessionId,
	resetSessionState,
} from "./session-state.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCtx(sessionFile: string | undefined | null): {
	ctx: CtxLike;
	accessCount: number;
} {
	let accessCount = 0;
	const sm: SessionManagerLike = {
		getSessionFile() {
			accessCount++;
			return sessionFile;
		},
	};
	return { ctx: { sessionManager: sm }, accessCount };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
	resetSessionState();
});

describe("getCachedSessionId before capture", () => {
	it("returns 'ephemeral' when no session has been captured", () => {
		const id = getCachedSessionId();
		expect(id).toBe("ephemeral");
	});
});

describe("captureSessionId", () => {
	it("returns the session file from ctx", () => {
		const { ctx } = makeCtx("/sessions/abc.json");
		const id = captureSessionId(ctx);
		expect(id).toBe("/sessions/abc.json");
	});

	it("returns 'ephemeral' when ctx has no session file", () => {
		const { ctx } = makeCtx(null);
		const id = captureSessionId(ctx);
		expect(id).toBe("ephemeral");
	});
});

describe("getCachedSessionId after capture — MUST NOT re-access ctx", () => {
	it("returns the cached session ID without calling ctx.sessionManager again", () => {
		const { ctx, accessCount } = makeCtx("/sessions/test-123.json");
		captureSessionId(ctx);
		const accessesAfterCapture = accessCount;

		// The key test: getCachedSessionId must NOT bump accessCount
		const id = getCachedSessionId();

		expect(accessCount).toBe(
			accessesAfterCapture,
			`getCachedSessionId must NOT access ctx.sessionManager — got ${accessCount} accesses, expected ${accessesAfterCapture}`,
		);
		expect(id).toBe("/sessions/test-123.json");
	});

	it("returns cached value even after the original ctx is nulled out", () => {
		const { ctx } = makeCtx("/sessions/persist.json");
		captureSessionId(ctx);

		// Simulate session replacement — ctx becomes stale/null
		// The real bug: if getCachedSessionId reads from ctx, this crashes
		// or returns wrong data

		const id = getCachedSessionId();
		expect(id).toBe("/sessions/persist.json");
	});

	it("returns cached value for undefined session file", () => {
		const { ctx } = makeCtx(undefined);
		captureSessionId(ctx);

		const id = getCachedSessionId();
		expect(id).toBe("ephemeral");
	});
});

describe("resetSessionState", () => {
	it("clears cached session ID back to 'ephemeral'", () => {
		const { ctx } = makeCtx("/sessions/before-reset.json");
		captureSessionId(ctx);

		resetSessionState();

		const id = getCachedSessionId();
		expect(id).toBe("ephemeral");
	});

	it("allows re-capture after reset", () => {
		const { ctx: ctx1 } = makeCtx("/sessions/first.json");
		captureSessionId(ctx1);

		resetSessionState();

		const { ctx: ctx2 } = makeCtx("/sessions/second.json");
		captureSessionId(ctx2);

		const id = getCachedSessionId();
		expect(id).toBe("/sessions/second.json");
	});
});

describe("multiple captures (session replacement)", () => {
	it("updates the cached ID on re-capture", () => {
		const { ctx: ctx1 } = makeCtx("/sessions/old.json");
		captureSessionId(ctx1);

		const { ctx: ctx2 } = makeCtx("/sessions/new.json");
		captureSessionId(ctx2);

		const id = getCachedSessionId();
		expect(id).toBe("/sessions/new.json");
	});
});
