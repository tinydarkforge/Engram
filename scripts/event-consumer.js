#!/usr/bin/env node

/**
 * AgentBridge Event Consumer for Engram
 *
 * Polls AgentBridge for incoming events and processes them.
 * Completes the bidirectional integration: Engram can now both
 * emit events (via agentbridge-client) and consume them.
 *
 * Handles:
 *   engram.query.requested → runs search, emits engram.query.result
 *
 * Opt-in via AGENTBRIDGE_URL env var. When unset, does nothing.
 */

const { request, AGENT_ID } = require('./agentbridge-client');

const DEFAULT_POLL_INTERVAL = 5000; // 5 seconds

class EventConsumer {
  constructor(options = {}) {
    this.baseUrl = options.url || process.env.AGENTBRIDGE_URL;
    this.token = options.token || process.env.AGENTBRIDGE_TOKEN;
    this.pollInterval = options.pollInterval || DEFAULT_POLL_INTERVAL;
    this.engram = options.engram || null;
    this.bridge = options.bridge || null;

    this._timer = null;
    this._running = false;
    this._lastPoll = null;
    this._since = new Date().toISOString();
    this._processedIds = new Set();

    // Stats
    this.stats = {
      events_received: 0,
      events_processed: 0,
      errors: 0,
      last_event_at: null,
      started_at: null,
    };
  }

  /**
   * Start polling for events.
   * Returns false if AgentBridge is not configured.
   */
  start() {
    if (!this.baseUrl) return false;
    if (this._running) return true;

    this._running = true;
    this.stats.started_at = new Date().toISOString();
    this._poll();
    return true;
  }

  /**
   * Stop polling.
   */
  stop() {
    this._running = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /**
   * Single poll cycle: fetch events, process them, schedule next poll.
   */
  async _poll() {
    try {
      const url = `${this.baseUrl}/bus/events?agent_id=${AGENT_ID}&event_type=engram.query.requested&since=${encodeURIComponent(this._since)}`;
      const res = await request(url, 'GET', null, this.token);

      this._lastPoll = new Date().toISOString();

      if (res.status === 200 && Array.isArray(res.body)) {
        for (const event of res.body) {
          await this._processEvent(event);
        }
      }
    } catch {
      this.stats.errors++;
    }

    // Schedule next poll
    if (this._running) {
      this._timer = setTimeout(() => this._poll(), this.pollInterval);
    }
  }

  /**
   * Process a single event.
   */
  async _processEvent(event) {
    // Deduplicate
    const eventId = event.id || event.event_id || `${event.event_type}-${event.timestamp}`;
    if (this._processedIds.has(eventId)) return;
    this._processedIds.add(eventId);

    // Cap dedup set size
    if (this._processedIds.size > 1000) {
      const arr = [...this._processedIds];
      this._processedIds = new Set(arr.slice(-500));
    }

    this.stats.events_received++;
    this._since = event.timestamp || this._since;

    const meta = event.metadata || {};
    const query = meta.query;
    const requester = meta.requester || 'unknown';
    const mode = meta.mode || 'keyword';

    if (!query || !this.engram) {
      this.stats.errors++;
      return;
    }

    try {
      const startTime = Date.now();
      let results;

      if (mode === 'semantic') {
        results = await this.engram.semanticSearch(query, { limit: 10 });
      } else {
        results = this.engram.search(query);
      }

      const latencyMs = Date.now() - startTime;

      // Emit result back via bridge
      if (this.bridge) {
        const bridge = typeof this.bridge.then === 'function'
          ? await this.bridge
          : this.bridge;

        bridge.emit('engram.query.result', {
          query,
          source: mode,
          requester,
          results_count: results.results?.length || results.total || 0,
          latency_ms: latencyMs,
          in_response_to: eventId,
        }).catch(() => {});
      }

      this.stats.events_processed++;
      this.stats.last_event_at = new Date().toISOString();
    } catch {
      this.stats.errors++;
    }
  }

  /**
   * Get consumer status.
   */
  getStatus() {
    return {
      running: this._running,
      configured: !!this.baseUrl,
      poll_interval_ms: this.pollInterval,
      last_poll: this._lastPoll,
      ...this.stats,
    };
  }
}

module.exports = EventConsumer;
