#!/usr/bin/env node

/**
 * Smart Topic Extraction using TF-IDF
 *
 * Replaces simple regex with statistical relevance scoring.
 * Terms that appear frequently in ONE session but rarely across ALL sessions
 * get higher scores (more distinctive/useful as topics).
 *
 * Usage:
 *   node smart-topics.js extract "your summary text"
 *   node smart-topics.js analyze                       # Show corpus statistics
 *   node smart-topics.js test                          # Test extraction
 */

const fs = require('fs');
const path = require('path');
const cli = require('./cli-utils');

const MEMEX_PATH = process.env.MEMEX_PATH || path.join(process.env.HOME, 'code/cirrus/DevOps/Memex');

// Common words to always exclude (expanded stop words)
const STOP_WORDS = new Set([
  // Articles & pronouns
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'it', 'its',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they',
  // Prepositions & conjunctions
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as',
  'and', 'or', 'but', 'if', 'then', 'so', 'yet', 'both', 'either',
  // Common verbs
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'may',
  'get', 'got', 'make', 'made', 'use', 'used', 'using',
  // Generic programming terms (too common to be useful)
  'file', 'files', 'code', 'function', 'method', 'class', 'variable',
  'add', 'added', 'update', 'updated', 'fix', 'fixed', 'change', 'changed',
  'new', 'create', 'created', 'remove', 'removed', 'delete', 'deleted',
  // File extensions (captured separately)
  'js', 'ts', 'tsx', 'jsx', 'json', 'md', 'css', 'scss', 'html',
  // Common directories
  'src', 'lib', 'test', 'tests', 'spec', 'dist', 'build', 'node_modules'
]);

// Domain-specific terms that ARE valuable (boost these)
const BOOST_TERMS = new Set([
  // Auth & Security
  'auth', 'oauth', 'jwt', 'token', 'session', 'login', 'logout', 'password',
  'security', 'encryption', 'ssl', 'tls', 'certificate', 'cors',
  // Infrastructure
  'docker', 'kubernetes', 'k8s', 'container', 'pod', 'helm', 'terraform',
  'aws', 'gcp', 'azure', 'lambda', 's3', 'ec2', 'cloudfront',
  // Databases
  'database', 'postgres', 'postgresql', 'mysql', 'mongodb', 'redis', 'sqlite',
  'migration', 'schema', 'query', 'index', 'transaction',
  // API & Networking
  'api', 'rest', 'graphql', 'websocket', 'http', 'endpoint', 'route', 'middleware',
  // Frontend
  'react', 'vue', 'angular', 'component', 'hook', 'state', 'redux', 'context',
  // Testing
  'test', 'jest', 'mocha', 'cypress', 'e2e', 'unit', 'integration', 'coverage',
  // CI/CD
  'cicd', 'pipeline', 'deploy', 'deployment', 'release', 'build', 'github', 'gitlab',
  // Performance
  'performance', 'optimization', 'cache', 'caching', 'lazy', 'async', 'parallel',
  // Memex-specific
  'memex', 'neural', 'embedding', 'vector', 'bloom', 'msgpack', 'semantic'
]);

class SmartTopics {
  constructor() {
    this.documentFrequency = new Map(); // term -> number of sessions containing it
    this.totalDocuments = 0;
    this.corpusLoaded = false;
  }

  /**
   * Load corpus statistics from all sessions
   * This builds the IDF (Inverse Document Frequency) denominator
   */
  loadCorpus() {
    if (this.corpusLoaded) return;

    const projectsDir = path.join(MEMEX_PATH, 'summaries/projects');
    if (!fs.existsSync(projectsDir)) {
      console.warn('⚠️  No projects directory found');
      return;
    }

    for (const project of fs.readdirSync(projectsDir)) {
      const indexPath = path.join(projectsDir, project, 'sessions-index.json');
      if (!fs.existsSync(indexPath)) continue;

      try {
        const data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        for (const session of data.sessions || []) {
          this.totalDocuments++;

          // Get unique terms from this session
          const sessionTerms = new Set();
          const text = [
            session.summary || '',
            (session.topics || []).join(' ')
          ].join(' ');

          this.tokenize(text).forEach(term => sessionTerms.add(term));

          // Update document frequency
          for (const term of sessionTerms) {
            this.documentFrequency.set(
              term,
              (this.documentFrequency.get(term) || 0) + 1
            );
          }
        }
      } catch (e) {
        // Skip malformed files
      }
    }

    this.corpusLoaded = true;
  }

  /**
   * Tokenize text into normalized terms
   */
  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')  // Keep alphanumeric and hyphens
      .split(/\s+/)
      .map(word => word.replace(/^-+|-+$/g, ''))  // Trim hyphens
      .filter(word =>
        word.length >= 2 &&
        !STOP_WORDS.has(word) &&
        !/^\d+$/.test(word)  // Exclude pure numbers
      );
  }

  /**
   * Calculate TF-IDF score for a term in a document
   *
   * TF (Term Frequency) = occurrences in this document / total terms in document
   * IDF (Inverse Document Frequency) = log(total documents / documents containing term)
   *
   * Higher score = term is frequent in THIS doc but rare across ALL docs
   */
  tfidf(term, termFrequency, documentLength) {
    // Term frequency (normalized)
    const tf = termFrequency / documentLength;

    // Inverse document frequency
    const docFreq = this.documentFrequency.get(term) || 0;
    // Add 1 to avoid division by zero and smooth rare terms
    const idf = Math.log((this.totalDocuments + 1) / (docFreq + 1)) + 1;

    // Apply boost for domain-specific terms
    const boost = BOOST_TERMS.has(term) ? 1.5 : 1.0;

    return tf * idf * boost;
  }

  /**
   * Extract topics using TF-IDF scoring
   *
   * @param {string} text - The text to extract topics from
   * @param {object} options - { limit: number, minScore: number }
   * @returns {Array<{term: string, score: number}>}
   */
  extract(text, options = {}) {
    const { limit = 8, minScore = 0.1 } = options;

    // Ensure corpus is loaded for IDF calculation
    this.loadCorpus();

    // Tokenize input
    const tokens = this.tokenize(text);
    if (tokens.length === 0) return [];

    // Count term frequencies
    const termFreq = new Map();
    for (const term of tokens) {
      termFreq.set(term, (termFreq.get(term) || 0) + 1);
    }

    // Calculate TF-IDF for each unique term
    const scores = [];
    for (const [term, freq] of termFreq) {
      const score = this.tfidf(term, freq, tokens.length);
      if (score >= minScore) {
        scores.push({ term, score });
      }
    }

    // Sort by score descending, take top N
    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Extract topics from git diff/file changes
   * Complements text-based extraction
   */
  extractFromFiles(files) {
    const topics = new Set();

    for (const file of files) {
      const parts = file.toLowerCase().split(/[\/\.\-_]/);

      for (const part of parts) {
        // Skip common directories and extensions
        if (STOP_WORDS.has(part)) continue;
        if (part.length < 2) continue;

        // Boost if it's a known valuable term
        if (BOOST_TERMS.has(part)) {
          topics.add(part);
        } else if (part.length >= 3 && !/^\d+$/.test(part)) {
          topics.add(part);
        }
      }
    }

    return Array.from(topics);
  }

  /**
   * Show corpus statistics
   */
  analyze() {
    this.loadCorpus();

    cli.header('Corpus Statistics', cli.icons.stats);
    cli.stats({
      'Total sessions': this.totalDocuments,
      'Unique terms': this.documentFrequency.size
    });

    // Top terms by document frequency
    const sorted = [...this.documentFrequency.entries()]
      .sort((a, b) => b[1] - a[1]);

    cli.section('Most Common Terms');
    const commonData = sorted.slice(0, 15).map(([term, count]) => ({
      term: cli.topicTag(term, count),
      count,
      pct: `${Math.round(count / this.totalDocuments * 100)}%`
    }));
    cli.table(commonData, [
      { key: 'term', label: 'Term', width: 22 },
      { key: 'count', label: 'Sessions', width: 10, align: 'right' },
      { key: 'pct', label: '%', width: 6, align: 'right' }
    ]);

    cli.section('Rarest Terms (High IDF)');
    const rareTerms = sorted.slice(-10).reverse().filter(([, count]) => count === 1);
    rareTerms.forEach(([term]) => {
      const idf = Math.log((this.totalDocuments + 1) / 2) + 1;
      cli.indent(`${cli.colors.cold(term)} ${cli.colors.muted(`(IDF: ${idf.toFixed(2)})`)}`);
    });
  }
}

// CLI
if (require.main === module) {
  const topics = new SmartTopics();
  const command = process.argv[2];

  switch (command) {
    case 'extract': {
      const text = process.argv.slice(3).join(' ');
      if (!text) {
        cli.error('Usage: node smart-topics.js extract "your text here"');
        process.exit(1);
      }
      const results = topics.extract(text);
      cli.header('Extracted Topics', cli.icons.search);
      cli.table(results, [
        { key: 'term', label: 'Topic', width: 22 },
        { key: 'score', label: 'Score', width: 10, align: 'right' }
      ]);
      break;
    }

    case 'analyze':
      topics.analyze();
      break;

    case 'test': {
      cli.header('TF-IDF Extraction Test');

      const testCases = [
        'Implemented OAuth2 authentication with Google SSO',
        'Fixed Docker container networking issues in kubernetes deployment',
        'Added bloom filter for faster negative lookups in memex',
        'Updated README with installation instructions'
      ];

      for (const text of testCases) {
        console.log();
        cli.keyValue('Input', cli.colors.muted(`"${text}"`));
        const results = topics.extract(text, { limit: 5 });
        const topicStr = results.map(r => cli.topicTag(r.term, 3)).join(', ');
        cli.keyValue('Topics', topicStr || cli.colors.muted('(none)'));
      }
      break;
    }

    default:
      cli.header('Smart Topics (TF-IDF)');
      console.log(cli.colors.muted('Statistical topic extraction\n'));
      cli.simpleTable([
        ['extract "text"', 'Extract topics from text'],
        ['analyze', 'Show corpus statistics'],
        ['test', 'Run test cases']
      ], 18);
  }
}

module.exports = SmartTopics;
