'use strict';
// Capture — entry point for post-session feedback scoring
//
// scoreReply(sessionId, replyText, opts) scores a completed reply against
// the assertions that were selected for the session. Called by the MCP server
// after a reply is observed, or manually for backfill.
//
// File-watching / automatic reply boundary detection is a future addition.
// For now: callers invoke scoreReply explicitly.

const { scoreSession } = require('./feedback/post-hoc');

let _vectorSearch = null;

function getEmbedFn() {
  if (!_vectorSearch) {
    const VectorSearch = require('./vector-search');
    _vectorSearch = new VectorSearch();
  }
  return (text) => _vectorSearch.embed(text);
}

async function scoreReply(sessionId, replyText, { db, embedFn } = {}) {
  if (!db) throw new Error('scoreReply: db is required');
  return scoreSession({
    sessionId,
    replyText,
    db,
    embedFn: embedFn ?? getEmbedFn(),
  });
}

module.exports = { scoreReply };
