/**
 * index.test.ts — Tests for lint-on-edit/index.ts hook logic.
 *
 * index.ts depends on the pi ExtensionAPI runtime, so we mock
 * it thoroughly to test the hook paths, config parsing, and
 * queue operations that Stryker mutates.
 */
// @ts-nocheck

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// Shared hook-enabled state — vi.mock factory reads this at import time
(globalThis as any).__lintOnEditHookState = {
  "lint-on-edit:session_start": true,
  "lint-on-edit:tool_result": true,
  "lint-on-edit:context": true,
  "lint-on-edit:session_shutdown": true,
};

// Shared diagnostics mock result
(globalThis as any).__lintOnEditMockResult = null;
(globalThis as any).__lintOnEditMockCalls = [];

vi.mock("./lib/plugin-logger.ts", () => ({
  createPluginLogger: vi.fn(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    filePath: "/fake/log/path.log",
  })),
}));

vi.mock("./lib/hooks-manager.ts", () => ({
  registerHook: vi.fn(),
  isEnabled: vi.fn((ext: string, hook: string) => {
    const key = `${ext}:${hook}`;
    return (globalThis as any).__lintOnEditHookState[key] ?? true;
  }),
}));

vi.mock("../implementations/lint-on-edit.ts", () => ({
  buildAsyncDiagnosticContextMessage: vi.fn(
    (path: string, text: string) => `DIAG:${path}:${text}`
  ),
  runDiagnostics: vi.fn(async (...args: any[]) => {
    (globalThis as any).__lintOnEditMockCalls.push(args);
    return (globalThis as any).__lintOnEditMockResult;
  }),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 0 })),
  readFileSync: vi.fn(() => "{}"),
}));

// Now import index (the default export is the extension factory)
import extensionFactory from "./index.ts";
import { registerHook as _registerHook } from "./lib/hooks-manager.ts";
import * as ss from "./session-state.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockPi() {
  const handlers = new Map<string, Function[]>();
  const pi = {
    on: vi.fn((event: string, handler: Function) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    }),
    sendMessage: vi.fn(),
    _handlers: handlers,
  };
  return pi as unknown as ExtensionAPI & { _handlers: Map<string, Function[]> };
}

function createMockCtx(overrides: Record<string, unknown> = {}): ExtensionContext {
  return {
    cwd: "/test/cwd",
    sessionManager: { getSessionFile: () => "/test/sessions/ses_abc.jsonl" },
    ...overrides,
  } as unknown as ExtensionContext;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("lint-on-edit extension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).__lintOnEditHookState = {
      "lint-on-edit:session_start": true,
      "lint-on-edit:tool_result": true,
      "lint-on-edit:context": true,
      "lint-on-edit:session_shutdown": true,
    };
    (globalThis as any).__lintOnEditMockResult = null;
    (globalThis as any).__lintOnEditMockCalls = [];
    ss.resetSessionState();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("hook registration", () => {
    it("registers all four lifecycle hooks", async () => {
      const pi = createMockPi();
      await extensionFactory(pi);
      expect(_registerHook).toHaveBeenCalledWith(
        "lint-on-edit", "session_start",
        { blocking: false, source: "pi", origin: "global" }
      );
      expect(_registerHook).toHaveBeenCalledWith(
        "lint-on-edit", "tool_result",
        { blocking: false, source: "pi", origin: "global" }
      );
      expect(_registerHook).toHaveBeenCalledWith(
        "lint-on-edit", "context",
        { blocking: false, source: "pi", origin: "global" }
      );
      expect(_registerHook).toHaveBeenCalledWith(
        "lint-on-edit", "session_shutdown",
        { blocking: false, source: "pi", origin: "global" }
      );
    });
  });

  describe("SESSION_START handler", () => {
    it("captures session ID", async () => {
      const pi = createMockPi();
      await extensionFactory(pi);
      const startHandlers = pi._handlers.get("session_start");
      expect(startHandlers).toBeDefined();
      expect(startHandlers).toHaveLength(1);
      await startHandlers![0]({}, createMockCtx());
      expect(ss.getCachedSessionId()).toBe("/test/sessions/ses_abc.jsonl");
    });

    it("skips when session_start hook is disabled", async () => {
      (globalThis as any).__lintOnEditHookState["lint-on-edit:session_start"] = false;
      const pi = createMockPi();
      await extensionFactory(pi);
      const startHandlers = pi._handlers.get("session_start");
      const ctx = createMockCtx();
      // Should not throw even with disabled hook
      await startHandlers![0]({}, ctx);
      (globalThis as any).__lintOnEditHookState["lint-on-edit:session_start"] = true;
    });
  });

  describe("TOOL_RESULT handler", () => {
    it("runs diagnostics for write tool", async () => {
      const pi = createMockPi();
      await extensionFactory(pi);
      const toolHandlers = pi._handlers.get("tool_result");
      expect(toolHandlers).toBeDefined();
      (globalThis as any).__lintOnEditMockResult = "error text";
      await toolHandlers![0]({
        toolName: "write",
        isError: false,
        input: { path: "src/foo.ts", content: "const x = 1;" },
      }, createMockCtx());
      await vi.waitFor(() => {
        expect((globalThis as any).__lintOnEditMockCalls).toHaveLength(1);
      });
    });

    it("runs diagnostics for edit tool", async () => {
      const pi = createMockPi();
      await extensionFactory(pi);
      const toolHandlers = pi._handlers.get("tool_result");
      (globalThis as any).__lintOnEditMockResult = null;
      await toolHandlers![0]({
        toolName: "edit",
        isError: false,
        input: { path: "src/bar.ts", content: "let y = 2;" },
      }, createMockCtx());
      await vi.waitFor(() => {
        expect((globalThis as any).__lintOnEditMockCalls).toHaveLength(1);
      });
    });

    it("skips for non-write/edit tools", async () => {
      const pi = createMockPi();
      await extensionFactory(pi);
      const toolHandlers = pi._handlers.get("tool_result");
      const result = await toolHandlers![0]({
        toolName: "read",
        isError: false,
        input: { path: "src/foo.ts" },
      }, createMockCtx());
      expect(result).toBeUndefined();
      expect((globalThis as any).__lintOnEditMockCalls).toHaveLength(0);
    });

    it("skips when tool result has error", async () => {
      const pi = createMockPi();
      await extensionFactory(pi);
      const toolHandlers = pi._handlers.get("tool_result");
      const result = await toolHandlers![0]({
        toolName: "write",
        isError: true,
        input: { path: "src/foo.ts" },
      }, createMockCtx());
      expect(result).toBeUndefined();
      expect((globalThis as any).__lintOnEditMockCalls).toHaveLength(0);
    });

    it("skips when path is missing", async () => {
      const pi = createMockPi();
      await extensionFactory(pi);
      const toolHandlers = pi._handlers.get("tool_result");
      const result = await toolHandlers![0]({
        toolName: "write",
        isError: false,
        input: {},
      }, createMockCtx());
      expect(result).toBeUndefined();
      expect((globalThis as any).__lintOnEditMockCalls).toHaveLength(0);
    });

    it("sends message when diagnostics are found", async () => {
      const pi = createMockPi();
      await extensionFactory(pi);
      const toolHandlers = pi._handlers.get("tool_result");
      (globalThis as any).__lintOnEditMockResult = "⚠ ERROR: bad thing";
      await toolHandlers![0]({
        toolName: "write",
        isError: false,
        input: { path: "src/foo.ts", content: "const x = 1;" },
      }, createMockCtx());
      await vi.waitFor(() => {
        expect(pi.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            customType: "lint-on-edit-context-driver",
            display: false,
          }),
          expect.objectContaining({
            triggerTurn: true,
            deliverAs: "followUp",
          })
        );
      });
    });

    it("does NOT send message when no diagnostics", async () => {
      const pi = createMockPi();
      await extensionFactory(pi);
      const toolHandlers = pi._handlers.get("tool_result");
      (globalThis as any).__lintOnEditMockResult = null;
      await toolHandlers![0]({
        toolName: "write",
        isError: false,
        input: { path: "src/clean.ts", content: "const x = 1;" },
      }, createMockCtx());
      await vi.waitFor(() => {
        expect(pi.sendMessage).not.toHaveBeenCalled();
      });
    });

    it("skips when tool_result hook is disabled", async () => {
      (globalThis as any).__lintOnEditHookState["lint-on-edit:tool_result"] = false;
      // Reset mock state to avoid counting calls from other tests
      (globalThis as any).__lintOnEditMockCalls = [];
      (globalThis as any).__lintOnEditMockResult = null;
      const pi = createMockPi();
      await extensionFactory(pi);
      const toolHandlers = pi._handlers.get("tool_result");
      const result = await toolHandlers![0]({
        toolName: "write",
        isError: false,
        input: { path: "src/foo.ts", content: "" },
      }, createMockCtx());
      expect(result).toBeUndefined();
      expect((globalThis as any).__lintOnEditMockCalls).toHaveLength(0);
      (globalThis as any).__lintOnEditHookState["lint-on-edit:tool_result"] = true;
    });
  });

  describe("CONTEXT handler", () => {
    it("injects pending diagnostics into context", async () => {
      const pi = createMockPi();
      await extensionFactory(pi);
      // Queue diagnostics
      const toolHandlers = pi._handlers.get("tool_result");
      (globalThis as any).__lintOnEditMockResult = "⚠ ERROR: bad";
      await toolHandlers![0]({
        toolName: "write",
        isError: false,
        input: { path: "src/diag.ts", content: "bad" },
      }, createMockCtx());
      await vi.waitFor(() => {
        expect((globalThis as any).__lintOnEditMockCalls).toHaveLength(1);
      });
      // Consume via context
      const ctxHandlers = pi._handlers.get("context");
      const event = { messages: [{ role: "user", content: "hello" }] };
      const result = await ctxHandlers![0](event, createMockCtx());
      expect(result).toBeDefined();
      expect(result!.messages.length).toBeGreaterThan(event.messages.length);
      expect(result!.messages[result!.messages.length - 1]).toMatchObject({
        role: "custom",
        customType: "lint-on-edit-context",
        display: false,
      });
    });

    it("returns undefined when no pending diagnostics", async () => {
      const pi = createMockPi();
      await extensionFactory(pi);
      const ctxHandlers = pi._handlers.get("context");
      const result = await ctxHandlers![0]({ messages: [] }, createMockCtx());
      expect(result).toBeUndefined();
    });

    it("skips when context hook is disabled", async () => {
      (globalThis as any).__lintOnEditHookState["lint-on-edit:context"] = false;
      const pi = createMockPi();
      await extensionFactory(pi);
      const ctxHandlers = pi._handlers.get("context");
      const result = await ctxHandlers![0]({ messages: [] }, createMockCtx());
      expect(result).toBeUndefined();
      (globalThis as any).__lintOnEditHookState["lint-on-edit:context"] = true;
    });
  });

  describe("SESSION_SHUTDOWN handler", () => {
    it("resets session state and clears pending diagnostics", async () => {
      const pi = createMockPi();
      await extensionFactory(pi);
      const shutdownHandlers = pi._handlers.get("session_shutdown");
      expect(shutdownHandlers).toBeDefined();
      // Capture a session first
      const startHandlers = pi._handlers.get("session_start");
      await startHandlers![0]({}, createMockCtx());
      await shutdownHandlers![0]();
      expect(ss.getCachedSessionId()).toBe("ephemeral");
    });

    it("skips when session_shutdown hook is disabled", async () => {
      (globalThis as any).__lintOnEditHookState["lint-on-edit:session_shutdown"] = false;
      const pi = createMockPi();
      await extensionFactory(pi);
      const shutdownHandlers = pi._handlers.get("session_shutdown");
      await shutdownHandlers![0]();
      (globalThis as any).__lintOnEditHookState["lint-on-edit:session_shutdown"] = true;
    });

    it("handles errors gracefully in shutdown", async () => {
      const pi = createMockPi();
      await extensionFactory(pi);
      const shutdownHandlers = pi._handlers.get("session_shutdown");
      await shutdownHandlers![0]();
      // Should not throw
    });
  });

  describe("diagnostics queue (Map operations)", () => {
    it("queues diagnostics for a session", async () => {
      const pi = createMockPi();
      await extensionFactory(pi);
      const toolHandlers = pi._handlers.get("tool_result");
      (globalThis as any).__lintOnEditMockResult = "error text";
      await toolHandlers![0]({
        toolName: "write",
        isError: false,
        input: { path: "src/q.ts", content: "x" },
      }, createMockCtx());
      await vi.waitFor(() => {
        expect((globalThis as any).__lintOnEditMockCalls).toHaveLength(1);
      });
    });

    it("consumes and clears pending diagnostics for a session", async () => {
      const pi = createMockPi();
      await extensionFactory(pi);
      const toolHandlers = pi._handlers.get("tool_result");
      (globalThis as any).__lintOnEditMockResult = "error text";
      await toolHandlers![0]({
        toolName: "write",
        isError: false,
        input: { path: "src/c.ts", content: "x" },
      }, createMockCtx());
      await vi.waitFor(() => {
        expect((globalThis as any).__lintOnEditMockCalls).toHaveLength(1);
      });
      // Consume via context handler
      const ctxHandlers = pi._handlers.get("context");
      const result = await ctxHandlers![0]({ messages: [] }, createMockCtx());
      expect(result).toBeDefined();
      // Second consume should return nothing
      const result2 = await ctxHandlers![0]({ messages: [] }, createMockCtx());
      expect(result2).toBeUndefined();
    });
  });

  describe("config defaults", () => {
    it("uses cli-lsp-client as default binary", async () => {
      const pi = createMockPi();
      await extensionFactory(pi);
      const toolHandlers = pi._handlers.get("tool_result");
      (globalThis as any).__lintOnEditMockResult = null;
      await toolHandlers![0]({
        toolName: "write",
        isError: false,
        input: { path: "src/foo.ts", content: "" },
      }, createMockCtx());
      await vi.waitFor(() => {
        const callArgs = (globalThis as any).__lintOnEditMockCalls[0];
        expect(callArgs[3]).toEqual(
          expect.objectContaining({ binary: "cli-lsp-client" })
        );
      });
    });

    it("passes skipExtensions array to diagnostics", async () => {
      const pi = createMockPi();
      await extensionFactory(pi);
      const toolHandlers = pi._handlers.get("tool_result");
      (globalThis as any).__lintOnEditMockResult = null;
      await toolHandlers![0]({
        toolName: "write",
        isError: false,
        input: { path: "src/foo.ts", content: "" },
      }, createMockCtx());
      await vi.waitFor(() => {
        const callArgs = (globalThis as any).__lintOnEditMockCalls[0];
        expect(callArgs[3]).toEqual(
          expect.objectContaining({ skipExtensions: expect.any(Array) })
        );
      });
    });
  });
});
