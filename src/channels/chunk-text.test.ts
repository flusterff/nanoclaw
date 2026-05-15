import { describe, expect, it } from 'vitest';

import { chunkText } from './chunk-text.js';

describe('chunkText', () => {
  it('returns the original text under the limit', () => {
    expect(chunkText('hello', 10)).toEqual(['hello']);
  });

  it('returns the original text exactly at the limit', () => {
    expect(chunkText('hello', 5)).toEqual(['hello']);
  });

  it('splits over-limit text into ordered chunks', () => {
    expect(chunkText('abcdefgh', 3)).toEqual(['abc', 'def', 'gh']);
  });

  it('returns an empty string chunk for empty text', () => {
    expect(chunkText('', 10)).toEqual(['']);
  });
});
