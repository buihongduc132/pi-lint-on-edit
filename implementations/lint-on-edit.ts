/**
 * lint-on-edit.ts — LSP diagnostics after file write/edit
 *
 * Uses `cli-lsp-client claude-code-hook` which is purpose-built for
 * Claude Code / coding agent integration. It:
 *   1. Receives hook JSON on stdin (Claude-compatible format)
 *   2. Pushes file content to LSP via didOpen/didChange protocol
 *   3. Runs diagnostics and outputs errors on stdout
 *
 * Why NOT raw `cli-lsp-client diagnostics`:
 *   - Raw `diagnostics` does NOT sync file state with the LSP daemon.
 *   - It only reads from disk — misses files that were just written
 *     if the LSP hasn't re-indexed yet.
 *   - `claude-code-hook` receives the content directly and pushes it
 *     to the LSP, so diagnostics are always accurate and immediate.
 *
 * Resilience: falls back silently on any failure.
 *
 * @see https://github.com/eli0shin/cli-lsp-client (claude-code-hook command)
 * @see https://code.claude.com/docs/en/hooks (Claude Code hook JSON format)
 */
// @ts-nocheck


import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile) as (
	file: string,
	args: readonly string[],
	options: Record<string, unknown>,
) => Promise<{ stdout: string; stderr: string }>;

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PiTool } from "../extensions/enums.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const CLI_LSP_CLIENT = "cli-lsp-client";
const MAX_LINES = 20;
const MAX_BYTES = 3072; // 3KB
const TIMEOUT_MS = 8000;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LintOnEditConfig {
	binary: string;
	maxLines: number;
	maxBytes: number;
	timeoutMs: number;
	skipExtensions: string[];
}

export const DEFAULT_CONFIG: LintOnEditConfig = {
	binary: CLI_LSP_CLIENT,
	maxLines: MAX_LINES,
	maxBytes: MAX_BYTES,
	timeoutMs: TIMEOUT_MS,
	skipExtensions: [],
};

// ─── Diagnostic parsing ─────────────────────────────────────────────────────

interface DiagnosticEntry {
	severity: "ERROR" | "WARNING" | "HINT" | "INFO";
	language: string;
	line: number;
	column: number;
	message: string;
	code?: number;
}

export function parseDiagnostics(raw: string): DiagnosticEntry[] {
	const entries: DiagnosticEntry[] = [];
	// eslint-disable-next-line no-control-regex
	const stripped = raw.replace(/\x1b\[[0-9;]*m/g, "");

	const lineRegex =
		/^\[([^\]]+)\]\s+(ERROR|WARNING|HINT|INFO)\s+at line (\d+), column (\d+):\s+(.+?)(?:\s+\[(\d+)\])?$/gm;
	let match: RegExpExecArray | null;

	while ((match = lineRegex.exec(stripped)) !== null) {
		entries.push({
			language: match[1],
			severity: match[2] as DiagnosticEntry["severity"],
			line: parseInt(match[3], 10),
			column: parseInt(match[4], 10),
			message: match[5].trim(),
			code: match[6] ? parseInt(match[6], 10) : undefined,
		});
	}

	return entries;
}

export function formatDiagnostics(
	entries: DiagnosticEntry[],
	filePath: string,
): string | null {
	const errors = entries.filter((e) => e.severity === "ERROR");
	if (errors.length === 0) return null;

	const lines: string[] = [];
	lines.push(
		`\n⚠ LSP diagnostics for ${filePath} (${errors.length} error${errors.length > 1 ? "s" : ""}):`,
	);

	for (const entry of errors.slice(0, MAX_LINES)) {
		lines.push(
			`  L${entry.line}:${entry.column} [${entry.language}] ${entry.message}`,
		);
	}

	if (errors.length > MAX_LINES) {
		lines.push(
			`  ... and ${errors.length - MAX_LINES} more error(s). Run: ${CLI_LSP_CLIENT} diagnostics "${filePath}"`,
		);
	}

	const text = lines.join("\n");
	return text.length > MAX_BYTES
		? text.slice(0, MAX_BYTES) + "\n  ... (truncated)"
		: text;
}

export function buildAsyncDiagnosticContextMessage(
	filePath: string,
	diagnosticText: string,
): string {
	return [
		`The latest edit introduced diagnostics in ${filePath}.`,
		"Fix that file before continuing.",
		"Diagnostics:",
		diagnosticText,
	].join("\n");
}

function parseRawDiagnostics(raw: string, absPath: string): string | null {
	if (!raw.trim()) return null;

	const entries = parseDiagnostics(raw);
	if (entries.length === 0) return null;

	const errorText = formatDiagnostics(entries, absPath);
	return errorText;
}

// ─── Core logic ──────────────────────────────────────────────────────────────

/**
 * Run LSP diagnostics via cli-lsp-client claude-code-hook.
 *
 * Uses the built-in Claude Code integration command which:
 *   - Accepts Claude-compatible hook JSON on stdin
 *   - Pushes file content to LSP via didOpen/didChange
 *   - Runs diagnostics immediately
 *   - Outputs errors on stdout (exit code 2 = errors found)
 *
 * Returns formatted error text, or null if no errors / unavailable.
 * Includes the exact target path in the rendered diagnostics.
 */
export async function runDiagnostics(
	filePath: string,
	cwd: string,
	fileContentOrConfig?: string | LintOnEditConfig,
	maybeConfig?: LintOnEditConfig,
): Promise<string | null> {
	// Overload: (path, cwd, fileContent, config) or (path, cwd, config)
	let fileContent: string | undefined;
	let config: LintOnEditConfig;
	if (typeof fileContentOrConfig === "string") {
		fileContent = fileContentOrConfig;
		config = maybeConfig ?? DEFAULT_CONFIG;
	} else {
		fileContent = undefined;
		config = fileContentOrConfig ?? DEFAULT_CONFIG;
	}
	const absPath = resolve(cwd, filePath);

	// For write: file must exist on disk (just written)
	// For edit: file should exist (was edited in place)
	if (!existsSync(absPath)) return null;

	const ext = absPath.split(".").pop()?.toLowerCase() ?? "";
	if (config.skipExtensions.includes(`.${ext}`)) return null;

	// Build Claude Code PostToolUse hook JSON
	// cli-lsp-client claude-code-hook reads this format on stdin
	const hookInput = JSON.stringify({
		session_id: "pi-lint-on-edit",
		hook_event_name: "PostToolUse",
		hook_name: "lsp",
		tool_name: PiTool.WRITE,
		tool_input: {
			file_path: absPath,
			content: fileContent ?? undefined,
		},
	});

	try {
		const { stdout } = await execFileAsync(
			config.binary,
			["claude-code-hook"],
			{
				cwd,
				timeout: config.timeoutMs,
				encoding: "utf-8",
				input: hookInput,
				maxBuffer: config.maxBytes * 2,
			} as Record<string, unknown>,
		);

		return parseRawDiagnostics(stdout, absPath);
	} catch (err: unknown) {
		// cli-lsp-client exits 2 when diagnostics found — output on stdout/stderr
		const error = err as { stdout?: string; stderr?: string; status?: number };
		const raw = error.stdout || error.stderr || "";

		return parseRawDiagnostics(raw, absPath);
	}
}
