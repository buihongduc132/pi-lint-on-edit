/**
 * pi extension event & tool name constants.
 *
 * Exhaustive enumeration derived from pi's ExtensionAPI.on() overloads
 * and ExtensionEvent union type (pi-coding-agent/dist/core/extensions/types.d.ts).
 *
 * Usage:
 *   import { PiEvent, PiTool } from "./enums";
 *   pi.on(PiEvent.SESSION_START, ...);
 *   if (event.toolName === PiTool.WRITE || event.toolName === PiTool.EDIT) ...
 *
 * NEVER use raw strings — always import from here.
 */
// @ts-nocheck


// ─── Lifecycle Events ──────────────────────────────────────────────────────

export const PiEvent = {
  /** Fired after session_start, extensions contribute skill/prompt/theme paths */
  RESOURCES_DISCOVER: "resources_discover" as const,

  /** Fired when a session starts, loads, or reloads */
  SESSION_START: "session_start" as const,

  /** Fired before switching sessions (/new, /resume) — can cancel */
  SESSION_BEFORE_SWITCH: "session_before_switch" as const,

  /** Fired before forking/cloning — can cancel */
  SESSION_BEFORE_FORK: "session_before_fork" as const,

  /** Fired before compaction — can cancel or customize summary */
  SESSION_BEFORE_COMPACT: "session_before_compact" as const,

  /** Fired after compaction completes */
  SESSION_COMPACT: "session_compact" as const,

  /** Fired before extension runtime teardown (quit/reload/session-replace) */
  SESSION_SHUTDOWN: "session_shutdown" as const,

  /** Fired before /tree navigation — can cancel or provide custom summary */
  SESSION_BEFORE_TREE: "session_before_tree" as const,

  /** Fired after /tree navigation completes */
  SESSION_TREE: "session_tree" as const,

  // ─── Agent Events ─────────────────────────────────────────────────────────

  /** Fired before each LLM call — can modify messages */
  CONTEXT: "context" as const,

  /** Fired after provider payload built, before HTTP request — can replace */
  BEFORE_PROVIDER_REQUEST: "before_provider_request" as const,

  /** Fired after HTTP response received, before stream consumed */
  AFTER_PROVIDER_RESPONSE: "after_provider_response" as const,

  /** Fired after user prompt, before agent loop — can inject message, modify system prompt */
  BEFORE_AGENT_START: "before_agent_start" as const,

  /** Fired once per user prompt — agent loop starts */
  AGENT_START: "agent_start" as const,

  /** Fired once per user prompt — agent loop ends */
  AGENT_END: "agent_end" as const,

  /** Fired at start of each turn (one LLM response + tool calls) */
  TURN_START: "turn_start" as const,

  /** Fired at end of each turn */
  TURN_END: "turn_end" as const,

  // ─── Message Events ───────────────────────────────────────────────────────

  /** Fired when a message starts (user, assistant, or toolResult) */
  MESSAGE_START: "message_start" as const,

  /** Fired during assistant streaming with token-by-token updates */
  MESSAGE_UPDATE: "message_update" as const,

  /** Fired when a message ends */
  MESSAGE_END: "message_end" as const,

  // ─── Tool Execution Events ────────────────────────────────────────────────

  /** Fired when a tool starts executing */
  TOOL_EXECUTION_START: "tool_execution_start" as const,

  /** Fired during tool execution with partial/streaming output */
  TOOL_EXECUTION_UPDATE: "tool_execution_update" as const,

  /** Fired when a tool finishes executing */
  TOOL_EXECUTION_END: "tool_execution_end" as const,

  /** Fired before a tool executes — can block, can mutate event.input */
  TOOL_CALL: "tool_call" as const,

  /** Fired after a tool executes — can modify result content/details/isError */
  TOOL_RESULT: "tool_result" as const,

  // ─── Model Events ─────────────────────────────────────────────────────────

  /** Fired when the model changes via /model, Ctrl+P, or session restore */
  MODEL_SELECT: "model_select" as const,

  // ─── User Events ──────────────────────────────────────────────────────────

  /** Fired when user executes ! or !! bash commands — can intercept */
  USER_BASH: "user_bash" as const,

  /** Fired on user input, before skill/template expansion — can intercept/transform */
  INPUT: "input" as const,
} as const;

/** All event name literals — use for exhaustive checks */
export type PiEventName = (typeof PiEvent)[keyof typeof PiEvent];

// ─── Built-in Tool Names ────────────────────────────────────────────────────

export const PiTool = {
  BASH: "bash" as const,
  READ: "read" as const,
  EDIT: "edit" as const,
  WRITE: "write" as const,
  GREP: "grep" as const,
  FIND: "find" as const,
  LS: "ls" as const,
} as const;

/** All built-in tool name literals */
export type PiToolName = (typeof PiTool)[keyof typeof PiTool];

// ─── Session Reason Values ──────────────────────────────────────────────────

export const SessionReason = {
  STARTUP: "startup" as const,
  RELOAD: "reload" as const,
  NEW: "new" as const,
  RESUME: "resume" as const,
  FORK: "fork" as const,
} as const;

export type SessionReasonValue = (typeof SessionReason)[keyof typeof SessionReason];

// ─── Shutdown Reason Values ─────────────────────────────────────────────────

export const ShutdownReason = {
  QUIT: "quit" as const,
  RELOAD: "reload" as const,
  NEW: "new" as const,
  RESUME: "resume" as const,
  FORK: "fork" as const,
} as const;

export type ShutdownReasonValue = (typeof ShutdownReason)[keyof typeof ShutdownReason];

// ─── Input Source Values ────────────────────────────────────────────────────

export const InputSource = {
  INTERACTIVE: "interactive" as const,
  RPC: "rpc" as const,
  EXTENSION: "extension" as const,
} as const;

export type InputSourceValue = (typeof InputSource)[keyof typeof InputSource];

// ─── Model Select Source Values ─────────────────────────────────────────────

export const ModelSelectSource = {
  SET: "set" as const,
  CYCLE: "cycle" as const,
  RESTORE: "restore" as const,
} as const;

export type ModelSelectSourceValue = (typeof ModelSelectSource)[keyof typeof ModelSelectSource];
