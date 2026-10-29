import type { Page } from "@playwright/test";

// Known benign console.error noise. Add an entry only for a message actually
// observed, with a one-line reason. Never allowlist a real application error.
const ALLOWED_CONSOLE_ERRORS: ReadonlyArray<{
  pattern: RegExp;
  reason: string;
}> = [];

export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (ALLOWED_CONSOLE_ERRORS.some(({ pattern }) => pattern.test(text)))
      return;
    errors.push(text);
  });
  return errors;
}
