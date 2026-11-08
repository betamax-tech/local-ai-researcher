/** Conservative content checks, not a claim that every page is complete. */
export function readQuality(content: string): string | undefined {
  const text = content.trim();
  if (!text) return 'empty_content';
  // Match a shell, not an article merely mentioning login or JavaScript.
  if (text.length < 1500 && /get responses tailored to you|log in to get answers based on saved chats/i.test(text)) {
    return 'login_shell';
  }
  if (text.length < 1500 && /^(?:loading(?:\.{3}|…)?|please enable javascript|you need to enable javascript|enable javascript to continue)[\s.!]*$/i.test(text)) {
    return 'javascript_shell';
  }
  if (text.length < 1500 && /^(?:sign in|log in|login required|authentication required)/i.test(text)
      && /(?:to (?:continue|view|access)|required|password)/i.test(text)) return 'login_shell';
  if (text.split(/\s+/).length < 20) return 'short_content';
  return undefined;
}

/** Shared chats can yield one plausible-looking message while dropping the rest. */
export function needsConversationRendering(url: string): boolean {
  const parsed = new URL(url);
  return parsed.hostname === 'chatgpt.com' && /^\/share\/[^/]+\/?$/.test(parsed.pathname);
}
