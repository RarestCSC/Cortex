import { describe, expect, it } from 'vitest';
import type { MessageDescriptor } from '@formatjs/intl';
import { getSkillDescription } from './skillDescriptions';

const intl = (locale: string) => ({
  formatMessage: (descriptor: MessageDescriptor) =>
    `${locale}:${String(descriptor.id).replace(/^skillDescriptions\./, '')}`,
});

describe('getSkillDescription', () => {
  it('keeps names as authored but localizes known descriptions', () => {
    expect(getSkillDescription('web-search', intl('zh-CN'), 'authored')).toBe('zh-CN:webSearch');
    expect(getSkillDescription('context-compression-fast-workflow', intl('zh-CN'), 'a')).toBe(
      'zh-CN:contextCompressionFastWorkflow'
    );
    expect(getSkillDescription('session-task-scheduling', intl('zh-CN'), 'a')).toBe(
      'zh-CN:sessionTaskScheduling'
    );
  });

  it('falls back to the SKILL.md text for skills it does not know', () => {
    expect(getSkillDescription('my-private-skill', intl('zh-CN'), 'authored text')).toBe(
      'authored text'
    );
  });

  it('matches on the squashed name so casing and separators do not matter', () => {
    expect(getSkillDescription('Web_Search', intl('en'), 'authored')).toBe('en:webSearch');
    expect(getSkillDescription('WEB-SEARCH', intl('en'), 'authored')).toBe('en:webSearch');
  });
});