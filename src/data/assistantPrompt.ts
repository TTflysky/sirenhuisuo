const LS_SYSTEM_PROMPT = 'hermes_office_assistant_system_prompt';
const LS_SYSTEM_PROMPT_VERSION = 'hermes_office_assistant_system_prompt_version';

export function getAssistantPrompt(
  defaultPrompt: string,
  defaultPromptVersion: string,
  migrationAppendix: string,
): string {
  try {
    const version = localStorage.getItem(LS_SYSTEM_PROMPT_VERSION);
    const raw = localStorage.getItem(LS_SYSTEM_PROMPT)?.trim();
    if (version !== defaultPromptVersion) {
      const appendixSections = migrationAppendix.trim().split(/(?=^## )/gmu).filter(Boolean);
      const missingSections = raw
        ? appendixSections.filter((section) => {
          const heading = section.split('\n', 1)[0]?.trim();
          return heading && !raw.includes(heading);
        })
        : [];
      const next = raw
        ? [raw, ...missingSections].filter(Boolean).join('\n\n')
        : defaultPrompt;
      localStorage.setItem(LS_SYSTEM_PROMPT, next);
      localStorage.setItem(LS_SYSTEM_PROMPT_VERSION, defaultPromptVersion);
      return next;
    }
    if (raw) return raw;
  } catch {}
  return defaultPrompt;
}

export function saveAssistantPrompt(prompt: string, defaultPromptVersion: string): void {
  try {
    localStorage.setItem(LS_SYSTEM_PROMPT, prompt);
    localStorage.setItem(LS_SYSTEM_PROMPT_VERSION, defaultPromptVersion);
  } catch {}
}
