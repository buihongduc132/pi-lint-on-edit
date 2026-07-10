# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-07-11

### Added
- Initial release as standalone package
- **Bug fix**: Proper daemon lifecycle management to prevent socket leaks
  - Track spawned child PID in module state
  - Kill daemon on session_shutdown
  - Clean stale `/tmp/cli-lsp-client-*.sock` on startup
  - Check for existing daemon before spawning (prevents double-spawn)
- Non-blocking diagnostics (async, fire-and-forget)
- Configurable via environment variables
- Full test coverage

### Fixed
- **EMFILE cascade**: Original lint-on-edit spawned detached daemon but never killed it → orphaned daemons accumulated → 65k+ sockets per process → EMFILE cascade killed all pi sessions
