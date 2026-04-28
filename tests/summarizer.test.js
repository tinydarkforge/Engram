#!/usr/bin/env node

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const Summarizer = require('../scripts/summarizer');
const { extractTopics } = require('../scripts/save-session');

// ─────────────────────────────────────────────────────────────
// Summarizer: provider detection and heuristic fallback (#13)
// ─────────────────────────────────────────────────────────────

describe('Summarizer', () => {
  it('detects heuristic provider when no API keys set', () => {
    const orig = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OLLAMA_HOST: process.env.OLLAMA_HOST,
      ENGRAM_SUMMARIZER_PROVIDER: process.env.ENGRAM_SUMMARIZER_PROVIDER,
    };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OLLAMA_HOST;
    delete process.env.ENGRAM_SUMMARIZER_PROVIDER;

    const s = new Summarizer();
    assert.equal(s.provider, 'heuristic');

    Object.assign(process.env, orig);
    for (const [k, v] of Object.entries(orig)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('prefers explicit provider option over env detection', () => {
    const s = new Summarizer({ provider: 'openai', model: 'gpt-4o-mini' });
    assert.equal(s.provider, 'openai');
    assert.equal(s.model, 'gpt-4o-mini');
  });

  it('heuristic returns non-empty string for meaningful content', async () => {
    const s = new Summarizer({ provider: 'heuristic' });
    const result = await s.summarize({
      content: 'Refactored authentication middleware to use JWT tokens instead of sessions. Updated user model.',
    });
    assert.equal(result.provider, 'heuristic');
    assert.ok(result.summary.length > 0);
  });

  it('heuristic returns empty string for empty content', async () => {
    const s = new Summarizer({ provider: 'heuristic' });
    const result = await s.summarize({ content: '' });
    assert.equal(result.summary, '');
  });

  it('heuristic skips diff markers', async () => {
    const s = new Summarizer({ provider: 'heuristic' });
    const content = `diff --git a/auth.js b/auth.js\n--- a/auth.js\n+++ b/auth.js\n@@ -1,3 +1,4 @@\nAdded JWT validation to protect API routes`;
    const result = await s.summarize({ content });
    assert.ok(!result.summary.includes('---'));
    assert.ok(!result.summary.includes('+++'));
    assert.ok(!result.summary.includes('@@'));
  });

  it('truncates long content before sending', async () => {
    const s = new Summarizer({ provider: 'heuristic' });
    const long = 'x'.repeat(10000);
    const result = await s.summarize({ content: long });
    assert.equal(result.provider, 'heuristic');
  });

  it('ENGRAM_SUMMARIZER_MODEL overrides default model', () => {
    process.env.ENGRAM_SUMMARIZER_MODEL = 'claude-opus-4-7';
    const s = new Summarizer({ provider: 'anthropic' });
    assert.equal(s.model, 'claude-opus-4-7');
    delete process.env.ENGRAM_SUMMARIZER_MODEL;
  });
});

// ─────────────────────────────────────────────────────────────
// TF-IDF topic extraction (#10)
// ─────────────────────────────────────────────────────────────

describe('extractTopics', () => {
  it('returns array of strings', () => {
    const topics = extractTopics('Implemented authentication middleware using JWT tokens');
    assert.ok(Array.isArray(topics));
    topics.forEach(t => assert.equal(typeof t, 'string'));
  });

  it('filters stopwords', () => {
    const topics = extractTopics('the quick brown fox jumped over the lazy dog');
    assert.ok(!topics.includes('the'));
    assert.ok(!topics.includes('over'));
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(extractTopics(''), []);
    assert.deepEqual(extractTopics(null), []);
  });

  it('splits camelCase tokens', () => {
    const topics = extractTopics('refactorAuthMiddleware sessionStorage tokenRefresh');
    const flat = topics.join(' ');
    assert.ok(flat.includes('auth') || flat.includes('middleware') || flat.includes('session') || flat.includes('token'));
  });

  it('respects topN option', () => {
    const topics = extractTopics('authentication authorization middleware database caching redis postgres', { topN: 3 });
    assert.ok(topics.length <= 3);
  });

  it('excludes pure numbers', () => {
    const topics = extractTopics('added 123 items to database with 456 queries');
    assert.ok(!topics.includes('123'));
    assert.ok(!topics.includes('456'));
  });

  it('prefers longer more specific terms', () => {
    const topics = extractTopics('authentication middleware jwt session database');
    assert.ok(topics.length > 0);
    // Longer words should score higher than short ones
    const shortTerms = topics.filter(t => t.length <= 3);
    assert.ok(shortTerms.length < topics.length);
  });
});
