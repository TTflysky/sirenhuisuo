# v0.85 Skill Context Module

The Skill mention input is now UI-only. Reading selected `SKILL.md` content and producing verified readback evidence lives in `src/engine/skillContext.ts`, which is shared by assistant, employee, and team chat execution paths.

This preserves the required real Skill-read behavior while preventing the component from exporting non-component execution helpers. The v1 core gate and the dedicated Skill activation evidence verification both pass after the move.
