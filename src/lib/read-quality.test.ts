import { describe, expect, it } from 'vitest';
import { readQuality } from './read-quality.js';

describe('reader quality diagnostics', () => {
  it.each(['', 'Loading...', 'Please enable JavaScript', 'Sign in to continue. Password required.'])
  ('does not accept shell %j as useful content', content => { expect(readQuality(content)).toBeDefined(); });
  it('does not classify an article quoting login or JavaScript instructions as a shell', () => {
    expect(readQuality('This article explains why applications sometimes ask visitors to sign in or enable JavaScript. '
      + 'There are several ways developers can handle authentication, rendering, content extraction, and safe fallback behavior.')).toBeUndefined();
  });
});
