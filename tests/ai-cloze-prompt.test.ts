import { describe, expect, it } from 'vitest';
import { buildClozeMessages } from '../lib/ai/cloze-prompt';

describe('buildClozeMessages', () => {
  it('returns a system + user message with the sentence embedded', () => {
    const messages = buildClozeMessages('满足人们的刚需');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('blanks');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('满足人们的刚需');
  });
});
