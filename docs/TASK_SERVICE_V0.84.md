# v0.84 Release Lint Cleanup

Filename and workspace path sanitization now uses the Unicode control-character property class `\p{Cc}`. It preserves the original security property, which is to replace all control characters before persisting a user-controlled path, while avoiding explicit control-code ranges in regular expressions.

The v1 core gate was rerun after the change. Its remaining warnings are unrelated Fast Refresh helper exports and a legacy declaration-module marker, which require structural cleanup rather than lint suppression.
