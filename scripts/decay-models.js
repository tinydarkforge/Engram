'use strict';
// Decay Models — registry of pure functions: (assertion, now, context?) => effectiveConfidence
// Keeps all decay math out of selection and projection.

const { daysBetween } = require('./vector-search');

const EXPONENTIAL_RATE = 0.98; // 2% decay per day
const STATE_BOUND_VERIFY_DAYS = 14; // confidence halves if not verified in this window
const EPISODIC_IDLE_DAYS = 30; // plane inactivity threshold before exponential kicks in

module.exports = {
  /**
   * flat: confidence never decays. Use for stable, monotonic facts.
   */
  flat(assertion /*, now, context */) {
    return assertion.confidence;
  },

  /**
   * exponential: 2% per day from last_reinforced (or created_at if never reinforced).
   * Floors at 0.1 after 365 days.
   */
  exponential(assertion, now = new Date()) {
    const days = daysBetween(assertion.last_reinforced ?? assertion.created_at, now);
    if (days <= 0) return assertion.confidence;
    if (days > 365) return Math.min(assertion.confidence, 0.1);
    return assertion.confidence * Math.pow(EXPONENTIAL_RATE, days);
  },

  /**
   * episodic: flat if the plane has been active recently; exponential if idle > EPISODIC_IDLE_DAYS.
   * context.planeActivity: { [plane]: ISO8601 string of last activity } (optional)
   */
  episodic(assertion, now = new Date(), context = {}) {
    const planeActivity = context.planeActivity || {};
    const lastActive = planeActivity[assertion.plane];
    if (lastActive) {
      const idleDays = daysBetween(lastActive, now);
      if (idleDays <= EPISODIC_IDLE_DAYS) return assertion.confidence; // flat
      // exponential on the idle window beyond the threshold
      const excessDays = idleDays - EPISODIC_IDLE_DAYS;
      return assertion.confidence * Math.pow(EXPONENTIAL_RATE, excessDays);
    }
    // No activity data — treat as flat (can't determine idleness)
    return assertion.confidence;
  },

  /**
   * state_bound: confidence halves if last_verified is null or > STATE_BOUND_VERIFY_DAYS old.
   * Returns 0 if status is 'fossilized'.
   */
  state_bound(assertion, now = new Date()) {
    if (assertion.status === 'fossilized') return 0;
    if (!assertion.last_verified) return assertion.confidence * 0.5;
    const daysSinceVerified = daysBetween(assertion.last_verified, now);
    if (daysSinceVerified > STATE_BOUND_VERIFY_DAYS) return assertion.confidence * 0.5;
    return assertion.confidence;
  },

  /**
   * contextual: returns 0 if session is no longer active.
   * context.session_active: boolean (default true if not provided)
   */
  contextual(assertion, now = new Date(), context = {}) {
    const sessionActive = context.session_active !== undefined ? context.session_active : true;
    if (!sessionActive) return 0;
    return assertion.confidence;
  },
};
