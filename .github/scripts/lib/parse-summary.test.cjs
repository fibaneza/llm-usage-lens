'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseBlock, parseTier } = require('./parse-summary.cjs');

// --- parseBlock ---

test('parseBlock: returns block body for a valid fence', () => {
  const output = 'some prose\n```security-summary\nHIGH: 1\n```\ntrailing';
  const result = parseBlock(output, 'security-summary');
  assert.equal(result, 'HIGH: 1\n');
});

test('parseBlock: returns null when fence is absent', () => {
  const output = 'no fenced blocks here';
  assert.equal(parseBlock(output, 'security-summary'), null);
});

test('parseBlock: handles code-review-summary fence', () => {
  const output = '```code-review-summary\nHIGH: 0\nHIGH_FINDINGS:\n- none\n```';
  const result = parseBlock(output, 'code-review-summary');
  assert.ok(result.includes('HIGH: 0'));
});

// --- parseTier ---

test('parseTier: parses count and findings for HIGH tier', () => {
  const text = [
    'HIGH: 2',
    'MEDIUM: 0',
    'LOW: 1',
    'HIGH_FINDINGS:',
    '- Missing session check in /api/users',
    '- Static AWS key found in config.ts',
    'MEDIUM_FINDINGS:',
    '- none',
  ].join('\n');

  const { count, findings } = parseTier(text, 'HIGH');
  assert.equal(count, 2);
  assert.deepEqual(findings, [
    '- Missing session check in /api/users',
    '- Static AWS key found in config.ts',
  ]);
});

test('parseTier: returns count=0 and empty findings when tier is zero', () => {
  const text = 'HIGH: 0\nHIGH_FINDINGS:\n- none\n';
  const { count, findings } = parseTier(text, 'HIGH');
  assert.equal(count, 0);
  assert.deepEqual(findings, []);
});

test('parseTier: returns count=0 when tier line is absent', () => {
  const text = 'MEDIUM: 1\nMEDIUM_FINDINGS:\n- Some finding\n';
  const { count } = parseTier(text, 'HIGH');
  assert.equal(count, 0);
});

test('parseTier: handles malformed count gracefully (non-numeric defaults to 0)', () => {
  // The regex requires \d+ so non-numeric values produce no match → count = 0.
  const text = 'HIGH: abc\nHIGH_FINDINGS:\n- none\n';
  const { count } = parseTier(text, 'HIGH');
  assert.equal(count, 0);
});

test('parseTier: prose after the block does not bleed into findings', () => {
  const text = [
    'HIGH: 1',
    'HIGH_FINDINGS:',
    '- Real finding here',
    'MEDIUM: 0',
    'MEDIUM_FINDINGS:',
    '- none',
    'LOW: 0',
  ].join('\n');

  const { findings } = parseTier(text, 'HIGH');
  assert.deepEqual(findings, ['- Real finding here']);
});
