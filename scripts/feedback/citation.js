'use strict';
// Citation parser — layer B signal
// parseCitations(replyText) => string[]

const RE_MEMEX = /\[\[A:([^\]]+)\]\]/g;
const RE_CITE_SELF_CLOSE = /<cite\s+id="([^"]+)"\s*\/>/g;
const RE_CITE_CLOSE = /<cite\s+id="([^"]+)"\s*>[^<]*<\/cite>/g;

function parseCitations(replyText) {
  if (typeof replyText !== 'string') return [];

  const ids = new Set();

  for (const re of [RE_MEMEX, RE_CITE_SELF_CLOSE, RE_CITE_CLOSE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(replyText)) !== null) {
      ids.add(m[1]);
    }
  }

  return Array.from(ids);
}

module.exports = { parseCitations };
