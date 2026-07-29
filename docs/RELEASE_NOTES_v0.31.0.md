# Taiji v0.31.0

## Skill picker

- The `@` Skill picker is now rendered in a top-level fixed layer, so the chat composer cannot clip it into a narrow strip.
- Added a visible search field with name, description, and source matching.
- Added loading and empty-result states.
- The list now supports scrolling through up to 100 matching Skills instead of truncating at 8.

## Skill library synchronization

- Installing, deleting, or repairing a Skill broadcasts a `skills:changed` event to every renderer window.
- Assistant chat and the toolbar Skill picker refresh immediately after an install.
- Chat windows refresh again when they regain focus or become visible, covering installs made by another window or by the native assistant tool.
