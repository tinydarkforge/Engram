'use strict';
// Render — converts assertions to prompt-ready text fragments via registry
// Exports: renderAssertion(assertion, opts), renderBlock(assertions, opts)

const MONTH = 30 * 24 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

function fmtAge(isoTimestamp) {
  if (!isoTimestamp) return 'never';
  const ms = Date.now() - new Date(isoTimestamp).getTime();
  if (ms < MIN) return 'now';
  if (ms < HOUR) return `${Math.floor(ms / MIN)}m ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`;
  if (ms < MONTH) return `${Math.floor(ms / DAY)}d ago`;
  return `${Math.floor(ms / MONTH)}M ago`;
}

function statusBadge(status) {
  const badges = {
    tentative: '◯',
    established: '●',
    fossilized: '✕',
    quarantined: '⚠',
  };
  return badges[status] || '?';
}

function confidencePct(confidence) {
  return Math.round(confidence * 100);
}

// Registry: density_hint × class_
const RENDERERS = {
  terse: {
    monotonic: (a) => a.claim,
    episodic: (a) => a.claim,
    state_bound: (a) => `${a.claim} [verified: ${fmtAge(a.last_verified)}]`,
    contextual: (a) => `${a.claim} [session-scoped]`,
  },
  standard: {
    monotonic: (a) => `${a.claim} (${confidencePct(a.confidence)}%)`,
    episodic: (a) => `${a.claim} (${confidencePct(a.confidence)}%)`,
    state_bound: (a) => `${a.claim} (${confidencePct(a.confidence)}%, verified: ${fmtAge(a.last_verified)})`,
    contextual: (a) => `${a.claim} (${confidencePct(a.confidence)}%, session-scoped)`,
  },
  verbose: {
    monotonic: (a) => {
      const body = a.body ? `\n${a.body}` : '';
      return `${a.claim}${body}\n${statusBadge(a.status)} ${a.status} · confidence ${confidencePct(a.confidence)}% · quorum ${a.quorum_count}`;
    },
    episodic: (a) => {
      const body = a.body ? `\n${a.body}` : '';
      return `${a.claim}${body}\n${statusBadge(a.status)} ${a.status} · confidence ${confidencePct(a.confidence)}% · quorum ${a.quorum_count} · created ${fmtAge(a.created_at)}`;
    },
    state_bound: (a) => {
      const body = a.body ? `\n${a.body}` : '';
      return `${a.claim}${body}\n${statusBadge(a.status)} ${a.status} · verified ${fmtAge(a.last_verified)} · confidence ${confidencePct(a.confidence)}% · quorum ${a.quorum_count}`;
    },
    contextual: (a) => {
      const body = a.body ? `\n${a.body}` : '';
      return `${a.claim}${body}\n${statusBadge(a.status)} ${a.status} [session-scoped] · confidence ${confidencePct(a.confidence)}% · quorum ${a.quorum_count}`;
    },
  },
};

function renderAssertion(assertion, opts = {}) {
  if (!assertion) return '';

  const density = assertion.density_hint || 'terse';
  const cls = assertion.class || 'monotonic';
  const renderer =
    RENDERERS[density]?.[cls] ||
    RENDERERS.terse.monotonic;

  let text = renderer(assertion);

  if (assertion.in_tension) {
    text += ' ⚠ tension';
  }

  if (opts.citation && assertion.id) {
    text += ` [[A:${assertion.id}]]`;
  }

  return text;
}

function renderBlock(assertions, opts = {}) {
  const lines = assertions.map((a) => renderAssertion(a, opts));
  const text = lines.join('\n');

  if (opts.header) {
    return `## ${opts.header}\n${text}`;
  }

  return text;
}

module.exports = {
  renderAssertion,
  renderBlock,
};
