import { describe, expect, it } from 'vitest';
import { isUpstreamUrl } from './upstreamIsolation';

describe('Cortex upstream isolation', () => {
  it.each([
    'https://goose-docs.ai/docs/quickstart',
    'https://us.i.posthog.com/capture/',
    'https://cash-f.squarecdn.com/static/fonts/font.woff2',
    'https://github.com/aaif-goose/goose/releases/latest',
    'https://api.github.com/repos/aaif-goose/goose/releases/latest',
    'https://raw.githubusercontent.com/block/goose/main/file',
  ])('blocks inherited product endpoints: %s', (url) => {
    expect(isUpstreamUrl(url)).toBe(true);
  });

  it.each([
    'http://127.0.0.1:3000/acp',
    'https://api.openai.com/v1/chat/completions',
    'https://github.com/modelcontextprotocol/servers',
    'https://github.com/aaif-goose/goose-other',
    'https://goose-docs.ai.example.com/',
  ])('allows user services and unrelated endpoints: %s', (url) => {
    expect(isUpstreamUrl(url)).toBe(false);
  });
});
