/**
 * pi-lint-on-edit — LSP diagnostics after file write/edit
 *
 * Fixed version: properly manages daemon lifecycle to prevent socket leaks.
 *
 * Bug fix: Original lint-on-edit spawned detached daemon but never killed it
 * on session_shutdown → orphaned daemons accumulated → EMFILE cascade.
 *
 * This version:
 * 1. Tracks spawned child PID in module state
 * 2. Kills daemon on session_shutdown
 * 3. Cleans stale /tmp/cli-lsp-client-*.sock on startup
 * 4. Checks for existing daemon before spawning (prevents double-spawn)
 */
// @ts-nocheck

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createPluginLogger } from "./lib/plugin-logger.ts";
import { registerHook, isEnabled } from "./lib/hooks-manager.ts";
import { PiEvent, PiTool } from "./enums.ts";
import {
  buildAsyncDiagnosticContextMessage,
  runDiagnostics as packageRunDiagnostics,
} from "../implementations/lint-on-edit.ts";
import {
  captureSessionId,
  getCachedSessionId,
  resetSessionState,
} from "./session-state.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

interface LintOnEditConfig {
  binary: string;
  maxLines: number;
  maxBytes: number;
  timeoutMs: number;
  skipExtensions: string[];
}

type DiagnosticsFn = (
  filePath: string,
  cwd: string,
  fileContentOrConfig?: string | LintOnEditConfig,
  maybeConfig?: LintOnEditConfig,
) => Promise<string | null>;

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: LintOnEditConfig = {
  binary: process.env.LINT_ON_EDIT_BINARY ?? "cli-lsp-client",
  maxLines: 20,
  maxBytes: 3072,
  timeoutMs: parseInt(process.env.LINT_ON_EDIT_TIMEOUT ?? "", 10) || 8000,
  skipExtensions: (process.env.LINT_ON_EDIT_SKIP ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = createPluginLogger("lint-on-edit");

// ─── Daemon lifecycle management ─────────────────────────────────────────────

let daemonChild: any = null;
let daemonPid: number | null = null;

/**
 * Clean stale socket files from previous sessions.
 * Sockets at /tmp/cli-lsp-client-*.sock are left behind when daemons crash.
 */
async function cleanStaleSockets(): Promise<void> {
  try {
    const { glob } = await import("node:fs/promises");
    const sockets = await glob("/tmp/cli-lsp-client-*.sock");
    for (const sock of sockets) {
      try {
        const { unlink } = await import("node:fs/promises");
        await unlink(sock);
        logger.info("cleaned-stale-socket", { path: sock });
      } catch (err) {
        // Ignore unlink errors (already gone, permissions, etc.)
      }
    }
  } catch (err) {
    logger.warn("stale-socket-cleanup-failed", { err });
  }
}

/**
 * Check if a daemon is already running for this cwd.
 * Uses pgrep to find cli-lsp-client processes with matching cwd.
 */
async function isDaemonRunning(cwd: string): Promise<boolean> {
  try {
    const { execSync } = await import("node:child_process");
    // Check if any cli-lsp-client process has this cwd
    const result = execSync(
      `pgrep -f "cli-lsp-client" | xargs -I {} sh -c 'readlink /proc/{}/cwd 2>/dev/null | grep -q "^${cwd}$" && echo {}'`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    return result.length > 0;
  } catch {
    return false;
  }
}

/**
 * Kill the daemon we spawned.
 */
function killDaemon(): void {
  if (daemonChild) {
    try {
      daemonChild.kill("SIGTERM");
      logger.info("daemon-killed", { pid: daemonPid });
    } catch (err) {
      logger.warn("daemon-kill-failed", { pid: daemonPid, err });
    }
    daemonChild = null;
    daemonPid = null;
  }
}

// ─── Dynamic loader ──────────────────────────────────────────────────────────

async function loadImplementation(cwd: string): Promise<DiagnosticsFn | null> {
  // 1. Project-local override
  // 2. Global (this package's implementations/ dir)
  const candidates = [
    resolve(cwd, ".pi/hooks/implementations/lint-on-edit.ts"),
    resolve(__dirname, "implementations/lint-on-edit.ts"),
  ];

  for (const implPath of candidates) {
    if (!existsSync(implPath)) continue;

    try {
      const mod = await import(implPath);
      const fn = (mod.runDiagnostics ?? mod.default?.runDiagnostics) as
        | DiagnosticsFn
        | undefined;

      if (typeof fn !== "function") {
        logger.error("missing runDiagnostics export", { implPath });
        continue;
      }

      logger.info("implementation-loaded", { implPath });
      return fn;
    } catch (err) {
      logger.error("failed to import implementation", { implPath, err });
    }
  }

  logger.warn("no valid implementation found — hook deactivated");
  return null;
}

// ─── Extension factory ───────────────────────────────────────────────────────

export default async function (pi: ExtensionAPI) {
  registerHook("lint-on-edit", "session_start", { blocking: false, source: "pi", origin: "global" });
  registerHook("lint-on-edit", "tool_result", { blocking: false, source: "pi", origin: "global" });
  registerHook("lint-on-edit", "context", { blocking: false, source: "pi", origin: "global" });
  registerHook("lint-on-edit", "session_shutdown", { blocking: false, source: "pi", origin: "global" });

  const cwd = process.cwd();
  const binary = DEFAULT_CONFIG.binary;
  const pendingDiagnostics = new Map<string, string[]>();
  const queueDiagnostic = (sessionId: string, content: string): void => {
    const existing = pendingDiagnostics.get(sessionId) ?? [];
    existing.push(content);
    pendingDiagnostics.set(sessionId, existing);
  };
  const consumeDiagnostics = (sessionId: string): string[] => {
    const pending = pendingDiagnostics.get(sessionId) ?? [];
    pendingDiagnostics.delete(sessionId);
    return pending;
  };

  // ─── Ensure LSP daemon is running for this project ─────────────────────
  // FIXED: Track child PID, clean stale sockets, check for existing daemon
  pi.on(PiEvent.SESSION_START, async (_event, ctx) => {
    if (!isEnabled("lint-on-edit", "session_start")) return;

    captureSessionId(ctx);
    logger.info("session-start", {
      cwd: ctx.cwd,
      binary,
      logFile: logger.filePath,
    });

    // Clean stale sockets from previous crashes
    await cleanStaleSockets();

    // Check if daemon already running for this cwd
    const alreadyRunning = await isDaemonRunning(ctx.cwd);
    if (alreadyRunning) {
      logger.info("daemon-already-running", { cwd: ctx.cwd });
      return;
    }

    // Spawn new daemon (track PID for cleanup)
    const { spawn } = await import("node:child_process");
    const child = spawn(binary, ["start"], {
      cwd: ctx.cwd,
      stdio: "ignore",
      detached: true,
    });
    
    daemonChild = child;
    daemonPid = child.pid ?? null;
    
    child.unref();
    child.on("error", (error) => {
      logger.error("daemon start failed", { cwd: ctx.cwd, error });
      daemonChild = null;
      daemonPid = null;
    });
    
    logger.info("daemon-spawned", { pid: daemonPid, cwd: ctx.cwd });
  });

  // ─── Load implementation ─────────────────────────────────────────────────
  const runDiagnostics = await loadImplementation(cwd);
  const activeDiagnostics = runDiagnostics ?? packageRunDiagnostics;

  pi.on(PiEvent.TOOL_RESULT, async (event, ctx) => {
    if (!isEnabled("lint-on-edit", "tool_result")) return undefined;

    if (event.toolName !== PiTool.WRITE && event.toolName !== PiTool.EDIT)
      return undefined;
    if (event.isError) return undefined;

    const filePath = (event.input as { path?: string }).path;
    if (!filePath || typeof filePath !== "string") return undefined;

    const fileContent = (event.input as { content?: string }).content;
    const sessionId = getCachedSessionId();

    void activeDiagnostics(filePath, ctx.cwd, fileContent, DEFAULT_CONFIG)
      .then((diagnosticText) => {
        if (!diagnosticText) return;
        const absolutePath = resolve(ctx.cwd, filePath);
        logger.info("diagnostics-queued", { sessionId, absolutePath });
        queueDiagnostic(
          sessionId,
          buildAsyncDiagnosticContextMessage(absolutePath, diagnosticText),
        );
        pi.sendMessage(
          {
            customType: "lint-on-edit-context-driver",
            content: `Pending lint diagnostics for ${absolutePath}.`,
            display: false,
            details: { path: absolutePath },
          },
          {
            triggerTurn: true,
            deliverAs: "followUp",
          },
        );
      })
      .catch((err) => {
        logger.error("runtime error", { filePath, err });
      });

    return undefined;
  });

  pi.on(PiEvent.CONTEXT, async (event, _ctx) => {
    if (!isEnabled("lint-on-edit", "context")) return undefined;

    const sessionId = getCachedSessionId();
    const pending = consumeDiagnostics(sessionId);
    if (pending.length === 0) return undefined;

    const injectedMessages = pending.map((content) => ({
      role: "custom" as const,
      customType: "lint-on-edit-context",
      content,
      display: false,
      timestamp: Date.now(),
    }));

    return {
      messages: [...event.messages, ...injectedMessages],
    };
  });

  // ─── Cleanup on session shutdown ───────────────────────────────────
  // FIXED: Kill daemon we spawned
  pi.on("session_shutdown" as PiEvent, async () => {
    if (!isEnabled("lint-on-edit", "session_shutdown")) return;

    try {
      // Kill the daemon we spawned
      killDaemon();
      
      // Reset session state
      resetSessionState();
      pendingDiagnostics.delete(getCachedSessionId());
      
      logger.info("session-shutdown-complete");
    } catch (error) {
      logger.error("session_shutdown error", { error });
    }
  });
}
