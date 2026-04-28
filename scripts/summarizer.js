#!/usr/bin/env node
/* eslint-disable */

/**
 * Provider-agnostic AI summarizer for Engram session auto-summarization.
 *
 * Provider detection order (env vars):
 *   1. ANTHROPIC_API_KEY  → Claude (claude-haiku-3-5 by default)
 *   2. OPENAI_API_KEY     → OpenAI (gpt-4o-mini by default)
 *   3. OLLAMA_HOST        → Ollama local (llama3.2 by default)
 *   4. (none)             → heuristic fallback (no API call)
 *
 * Override with ENGRAM_SUMMARIZER_PROVIDER and ENGRAM_SUMMARIZER_MODEL.
 *
 * Usage:
 *   const Summarizer = require('./summarizer');
 *   const s = new Summarizer();
 *   const result = await s.summarize({ content: 'git diff output...', topics: ['auth'] });
 *   // result: { summary: '...', provider: 'anthropic', model: '...' }
 */

const SYSTEM_PROMPT = `You are a concise technical writer. Summarize what was done in this coding session in 1-2 sentences. Focus on: what changed, why, and any key decisions. Be specific — name files, functions, or patterns when relevant. Never start with "I" or "The session". Output only the summary sentence(s), no preamble.`;

const DEFAULT_MODELS = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  ollama: 'llama3.2',
};

class Summarizer {
  constructor(options = {}) {
    this.provider = options.provider || process.env.ENGRAM_SUMMARIZER_PROVIDER || this._detectProvider();
    this.model = options.model || process.env.ENGRAM_SUMMARIZER_MODEL || DEFAULT_MODELS[this.provider] || null;
    this.timeout = options.timeout || 15000;
  }

  _detectProvider() {
    if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
    if (process.env.OPENAI_API_KEY) return 'openai';
    if (process.env.OLLAMA_HOST || process.env.OLLAMA_BASE_URL) return 'ollama';
    return 'heuristic';
  }

  /**
   * Summarize session content.
   * @param {object} opts
   * @param {string} opts.content - Raw content to summarize (git diff, notes, etc.)
   * @param {string[]} [opts.topics] - Known topics for context
   * @param {string} [opts.project] - Project name for context
   * @returns {Promise<{summary: string, provider: string, model: string|null}>}
   */
  async summarize({ content, topics = [], project = '' } = {}) {
    if (!content || !content.trim()) {
      return { summary: '', provider: this.provider, model: this.model };
    }

    const userMessage = this._buildUserMessage({ content, topics, project });

    switch (this.provider) {
      case 'anthropic':
        return this._callAnthropic(userMessage);
      case 'openai':
        return this._callOpenAI(userMessage);
      case 'ollama':
        return this._callOllama(userMessage);
      default:
        return { summary: this._heuristic(content, topics), provider: 'heuristic', model: null };
    }
  }

  _buildUserMessage({ content, topics, project }) {
    const parts = [];
    if (project) parts.push(`Project: ${project}`);
    if (topics.length) parts.push(`Topics: ${topics.join(', ')}`);
    parts.push('');
    // Truncate to ~3000 chars to stay within token budget
    const truncated = content.length > 3000 ? content.slice(0, 3000) + '\n...[truncated]' : content;
    parts.push(truncated);
    return parts.join('\n');
  }

  async _callAnthropic(userMessage) {
    const body = {
      model: this.model,
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    };

    const res = await this._fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const summary = res.content?.[0]?.text?.trim() || '';
    return { summary, provider: 'anthropic', model: this.model };
  }

  async _callOpenAI(userMessage) {
    const body = {
      model: this.model,
      max_tokens: 200,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    };

    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
    const res = await this._fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const summary = res.choices?.[0]?.message?.content?.trim() || '';
    return { summary, provider: 'openai', model: this.model };
  }

  async _callOllama(userMessage) {
    const base = process.env.OLLAMA_HOST || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const body = {
      model: this.model,
      stream: false,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    };

    const res = await this._fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const summary = res.message?.content?.trim() || '';
    return { summary, provider: 'ollama', model: this.model };
  }

  async _fetch(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      try {
        return await res.json();
      } catch (e) {
        throw new Error(`Failed to parse response: ${e.message}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Heuristic fallback: extract key phrases from content without an API.
   * Returns a best-effort summary from the first meaningful lines.
   */
  _heuristic(content, topics) {
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);

    // Prefer lines that look like descriptions (not diff markers, not file paths)
    const meaningful = lines.filter(l =>
      !l.startsWith('+++') &&
      !l.startsWith('---') &&
      !l.startsWith('@@') &&
      !l.startsWith('diff ') &&
      !l.startsWith('index ') &&
      l.length > 20
    );

    const first = meaningful.slice(0, 2).join(' ');
    const topicStr = topics.length ? ` [${topics.join(', ')}]` : '';
    return first ? `${first}${topicStr}`.slice(0, 300) : '';
  }

  /**
   * Returns which provider will be used (useful for logging/debugging).
   */
  get providerInfo() {
    return { provider: this.provider, model: this.model };
  }
}

module.exports = Summarizer;

// CLI: node summarizer.js "content text" [--provider anthropic] [--model ...]
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const content = args[0] || '';
    const providerIdx = args.indexOf('--provider');
    const modelIdx = args.indexOf('--model');
    const opts = {};
    if (providerIdx > -1) opts.provider = args[providerIdx + 1];
    if (modelIdx > -1) opts.model = args[modelIdx + 1];

    const s = new Summarizer(opts);
    console.log(`Provider: ${s.provider} / Model: ${s.model || 'n/a'}`);
    const result = await s.summarize({ content });
    console.log('Summary:', result.summary || '(empty)');
  })().catch(e => { console.error(e.message); process.exit(1); });
}
