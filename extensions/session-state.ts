/**
 * session-state — Cached session identity for lint-on-edit
 *
 * Holds the current session ID so that hooks can look it up
 * WITHOUT accessing ctx.sessionManager (which becomes stale
 * after session replacement).
 *
 * The session ID is captured once in session_start (where ctx
 * is guaranteed fresh) and reused in all subsequent hooks.
 */
// @ts-nocheck


// ─── Types ───────────────────────────────────────────────────────────────────

export interface SessionManagerLike {
	getSessionFile(): string | undefined | null;
}

export interface CtxLike {
	sessionManager: SessionManagerLike;
}

// ─── State ───────────────────────────────────────────────────────────────────

let currentSessionId: string = "ephemeral";

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Capture the session ID from a fresh ctx (call in session_start only).
 * Stores the ID so getCachedSessionId() can return it later without ctx.
 */
export function captureSessionId(ctx: CtxLike): string {
	currentSessionId = ctx.sessionManager.getSessionFile() ?? "ephemeral";
	return currentSessionId;
}

/**
 * Get the cached session ID WITHOUT accessing any ctx object.
 */
export function getCachedSessionId(): string {
	return currentSessionId;
}

/**
 * Clear all cached session state (call in session_shutdown).
 */
export function resetSessionState(): void {
	currentSessionId = "ephemeral";
}
