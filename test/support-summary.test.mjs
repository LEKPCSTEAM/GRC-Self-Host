import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeLog } from '../src/main/support-summary.ts';

test('support summary keeps only timestamp, level and fixed category', () => {
  const secret = 'github_pat_1234567890abcdefghijklmnop';
  const password = 'short-password';
  const input = [
    `2026-09-30T10:00:00Z ERROR Runner update failed: token=${secret}`,
    `2026-09-30T10:01:00Z WARN Authentication failed password=${password}`,
    `2026-09-30T10:02:00Z INFO Running job: deploy secret=${secret}`,
  ].join('\n');
  const output = summarizeLog(input);
  assert.match(output, /runner-update-failed/);
  assert.match(output, /job-started/);
  assert.doesNotMatch(
    output,
    /github_pat|short-password|deploy|Authentication|token=/,
  );
  assert.equal(output.split('\n').length, 3);
});
