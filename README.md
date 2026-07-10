# pi-lint-on-edit

LSP diagnostics after file write/edit for pi coding agent — with proper daemon lifecycle management.

## Features

- Runs `cli-lsp-client` diagnostics after file write/edit
- **Fixes socket leak**: Properly kills daemon on session shutdown
- **Prevents double-spawn**: Checks for existing daemon before spawning
- **Cleans stale sockets**: Removes orphaned socket files on startup
- Non-blocking: diagnostics run asynchronously

## Installation

```bash
pi install https://github.com/buihongduc132/pi-lint-on-edit
```

## Bug Fix: Socket Leak → EMFILE

**Original bug**: `lint-on-edit` spawned `cli-lsp-client start` as a detached daemon but never killed it on `session_shutdown`. Under high session-spawn rate (teams, jewilo verifier loops), orphaned daemons accumulated → 65k+ sockets per process → EMFILE cascade killed all pi sessions.

**Fix**:
1. Track spawned child PID in module state
2. `session_shutdown`: kill the daemon we spawned
3. `session_start`: clean stale `/tmp/cli-lsp-client-*.sock` + check for existing daemon

## Configuration

Environment variables:
- `LINT_ON_EDIT_BINARY`: Path to cli-lsp-client (default: `cli-lsp-client`)
- `LINT_ON_EDIT_TIMEOUT`: Diagnostics timeout in ms (default: `8000`)
- `LINT_ON_EDIT_SKIP`: Comma-separated extensions to skip (e.g., `.md,.txt`)

## License

MIT
