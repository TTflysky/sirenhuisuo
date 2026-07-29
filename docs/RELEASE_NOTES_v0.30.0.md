# Taiji v0.30.0

## Root cause confirmed

The previous SkillHub failure was caused by the execution route, not by every Skill lacking permission. The old route asked Windows to run `skillhub.bat`, which depends on an executable named `python3`. On this machine that command is unavailable, so every installation that used that route failed before the Skill could be downloaded or written.

## Fixed behavior

- Explicit SkillHub installation requests are routed directly to the Electron native `install_skill` tool.
- SkillHub slugs are resolved through the official download API and installed as complete ZIP bundles.
- GitHub, ZIP, and SkillHub installs use the same atomic staging and validation path.
- The installed Skill is read back before the task reports success.
- `run_command` rejects the obsolete SkillHub CLI route with an actionable diagnostic instead of silently retrying the same broken command.
- IMA uses a native adapter for knowledge-base and note operations, with latency, retry, HTTP/business error stages, and credential redaction.

## Verification

Passed: `verify:connector-adapters`, `verify:agent-kernel`, `verify:skill-atomic`, `build`.

`lint` passes with the repository's existing warnings only.
