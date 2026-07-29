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
      const next = raw
        ? raw.includes('## v1 任务账本与恢复协议')
          ? raw
          : `${raw}${migrationAppendix}`
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
