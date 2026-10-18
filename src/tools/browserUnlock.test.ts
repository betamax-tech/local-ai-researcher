import { it, expect, vi } from 'vitest';
import { createBrowserUnlockTool } from './browserUnlock.js';

it('exposes browser_unlock and allowlists its result, never credentials', async () => {
  const unlock = vi.fn(async () => ({ captured: true, status: 'captured' as const, domain: 'example.com', hint: 'Retry once', cookies: 'secret' }));
  const tool = createBrowserUnlockTool({ unlock });
  expect(tool.name).toBe('browser_unlock');
  const result = await tool.handler({ url: 'https://example.com' });
  expect(JSON.parse(result.content[0]!.text).result).toEqual({ captured: true, status: 'captured', domain: 'example.com', hint: 'Retry once' });
  expect(result.content[0]!.text).not.toContain('secret');
});
it('does not echo invalid URLs or backend errors', async () => {
  const unlock = vi.fn().mockRejectedValue(new Error('credential material'));
  const tool = createBrowserUnlockTool({ unlock });
  expect(JSON.stringify(await tool.handler({ url: 'secret-invalid-url' }))).not.toContain('secret-invalid-url');
  expect(unlock).not.toHaveBeenCalled();
  expect(JSON.stringify(await tool.handler({ url: 'https://example.com' }))).not.toContain('credential material');
});
