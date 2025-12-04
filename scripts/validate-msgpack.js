#!/usr/bin/env node

/**
 * Validate MessagePack Implementation
 * Tests data integrity and functionality across all converted files
 */

const fs = require('fs');
const path = require('path');
const msgpack = require('msgpack-lite');
const Memex = require('./memex-loader');
const LazyLoader = require('./lazy-loader');

const MEMEX_PATH = process.env.MEMEX_PATH || path.join(process.env.HOME, 'code/cirrus/DevOps/Memex');

class MessagePackValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.results = {
      total_files_tested: 0,
      passed: 0,
      failed: 0,
      warnings: 0
    };
  }

  /**
   * Test 1: Validate index.msgpack vs index.json
   */
  validateIndex() {
    console.log('🧪 Test 1: Validating index.msgpack...');

    const jsonPath = path.join(MEMEX_PATH, 'index.json');
    const msgpackPath = path.join(MEMEX_PATH, 'index.msgpack');

    if (!fs.existsSync(msgpackPath)) {
      this.errors.push('index.msgpack does not exist');
      return false;
    }

    try {
      const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const msgpackBuffer = fs.readFileSync(msgpackPath);
      const msgpackData = msgpack.decode(msgpackBuffer);

      // Compare keys
      const jsonKeys = Object.keys(jsonData).sort();
      const msgpackKeys = Object.keys(msgpackData).sort();

      if (JSON.stringify(jsonKeys) !== JSON.stringify(msgpackKeys)) {
        this.errors.push('index: Key mismatch between JSON and MessagePack');
        return false;
      }

      // Compare projects count
      if (Object.keys(jsonData.p).length !== Object.keys(msgpackData.p).length) {
        this.errors.push('index: Project count mismatch');
        return false;
      }

      console.log('   ✅ index.msgpack is valid');
      this.results.passed++;
      return true;
    } catch (error) {
      this.errors.push(`index validation error: ${error.message}`);
      this.results.failed++;
      return false;
    } finally {
      this.results.total_files_tested++;
    }
  }

  /**
   * Test 2: Validate sessions-index.msgpack files
   */
  validateSessionIndexes() {
    console.log('🧪 Test 2: Validating sessions-index.msgpack files...');

    const projectDirs = fs.readdirSync(path.join(MEMEX_PATH, 'summaries/projects'));
    let allValid = true;

    for (const projectDir of projectDirs) {
      const jsonPath = path.join(MEMEX_PATH, 'summaries/projects', projectDir, 'sessions-index.json');
      const msgpackPath = path.join(MEMEX_PATH, 'summaries/projects', projectDir, 'sessions-index.msgpack');

      if (!fs.existsSync(msgpackPath)) {
        this.warnings.push(`${projectDir}: sessions-index.msgpack does not exist`);
        this.results.warnings++;
        continue;
      }

      try {
        const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const msgpackBuffer = fs.readFileSync(msgpackPath);
        const msgpackData = msgpack.decode(msgpackBuffer);

        // Compare session count
        if (jsonData.sessions.length !== msgpackData.sessions.length) {
          this.errors.push(`${projectDir}: Session count mismatch`);
          allValid = false;
          this.results.failed++;
        } else {
          this.results.passed++;
        }

        this.results.total_files_tested++;
      } catch (error) {
        this.errors.push(`${projectDir}: ${error.message}`);
        allValid = false;
        this.results.failed++;
        this.results.total_files_tested++;
      }
    }

    if (allValid && this.results.failed === 0) {
      console.log('   ✅ All sessions-index.msgpack files are valid');
    }

    return allValid;
  }

  /**
   * Test 3: Validate session detail .msgpack files
   */
  validateSessionDetails() {
    console.log('🧪 Test 3: Validating session detail .msgpack files...');

    const projectDirs = fs.readdirSync(path.join(MEMEX_PATH, 'summaries/projects'));
    let totalTested = 0;
    let allValid = true;

    for (const projectDir of projectDirs) {
      const sessionsDir = path.join(MEMEX_PATH, 'summaries/projects', projectDir, 'sessions');

      if (!fs.existsSync(sessionsDir)) {
        continue;
      }

      const sessionFiles = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.msgpack'));

      for (const msgpackFile of sessionFiles) {
        const msgpackPath = path.join(sessionsDir, msgpackFile);
        const jsonPath = msgpackPath.replace('.msgpack', '.json');

        if (!fs.existsSync(jsonPath)) {
          this.warnings.push(`${projectDir}/${msgpackFile}: JSON file missing`);
          this.results.warnings++;
          continue;
        }

        try {
          const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
          const msgpackBuffer = fs.readFileSync(msgpackPath);
          const msgpackData = msgpack.decode(msgpackBuffer);

          // Compare IDs
          if (jsonData.id !== msgpackData.id) {
            this.errors.push(`${projectDir}/${msgpackFile}: ID mismatch`);
            allValid = false;
            this.results.failed++;
          } else {
            this.results.passed++;
          }

          totalTested++;
          this.results.total_files_tested++;
        } catch (error) {
          this.errors.push(`${projectDir}/${msgpackFile}: ${error.message}`);
          allValid = false;
          this.results.failed++;
          this.results.total_files_tested++;
        }
      }
    }

    if (allValid && totalTested > 0) {
      console.log(`   ✅ All ${totalTested} session detail files are valid`);
    }

    return allValid;
  }

  /**
   * Test 4: Test Memex loader with MessagePack
   */
  testMemexLoader() {
    console.log('🧪 Test 4: Testing Memex loader with MessagePack...');

    try {
      const memex = new Memex();
      const result = memex.startup();

      if (result.status !== 'ready') {
        this.errors.push('Memex loader failed to start');
        this.results.failed++;
        return false;
      }

      if (result.format !== 'cache' && result.format !== 'msgpack') {
        this.warnings.push(`Memex loaded from ${result.format} instead of MessagePack`);
        this.results.warnings++;
      }

      console.log(`   ✅ Memex loader works (format: ${result.format}, ${result.load_time_ms}ms)`);
      this.results.passed++;
      return true;
    } catch (error) {
      this.errors.push(`Memex loader error: ${error.message}`);
      this.results.failed++;
      return false;
    } finally {
      this.results.total_files_tested++;
    }
  }

  /**
   * Test 5: Test lazy loader with MessagePack
   */
  testLazyLoader() {
    console.log('🧪 Test 5: Testing lazy loader with MessagePack...');

    try {
      const lazyLoader = new LazyLoader();

      // Find a session to test
      const projectDirs = fs.readdirSync(path.join(MEMEX_PATH, 'summaries/projects'));

      for (const projectDir of projectDirs) {
        const sessionsDir = path.join(MEMEX_PATH, 'summaries/projects', projectDir, 'sessions');

        if (!fs.existsSync(sessionsDir)) {
          continue;
        }

        const sessionFiles = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.msgpack'));

        if (sessionFiles.length > 0) {
          const sessionId = sessionFiles[0].replace('.msgpack', '');
          const details = lazyLoader.loadSessionDetails(projectDir, sessionId);

          if (details && details.id === sessionId) {
            console.log(`   ✅ Lazy loader works (loaded ${projectDir}/${sessionId})`);
            this.results.passed++;
            return true;
          } else {
            this.errors.push('Lazy loader failed to load session details');
            this.results.failed++;
            return false;
          }
        }
      }

      this.warnings.push('No session details found to test lazy loader');
      this.results.warnings++;
      return true;
    } catch (error) {
      this.errors.push(`Lazy loader error: ${error.message}`);
      this.results.failed++;
      return false;
    } finally {
      this.results.total_files_tested++;
    }
  }

  /**
   * Calculate size savings
   */
  calculateSavings() {
    console.log('📊 Calculating size savings...');

    let totalJsonSize = 0;
    let totalMsgpackSize = 0;

    // Index
    if (fs.existsSync(path.join(MEMEX_PATH, 'index.json'))) {
      totalJsonSize += fs.statSync(path.join(MEMEX_PATH, 'index.json')).size;
      totalMsgpackSize += fs.statSync(path.join(MEMEX_PATH, 'index.msgpack')).size;
    }

    // Session indexes
    const projectDirs = fs.readdirSync(path.join(MEMEX_PATH, 'summaries/projects'));
    for (const projectDir of projectDirs) {
      const jsonPath = path.join(MEMEX_PATH, 'summaries/projects', projectDir, 'sessions-index.json');
      const msgpackPath = path.join(MEMEX_PATH, 'summaries/projects', projectDir, 'sessions-index.msgpack');

      if (fs.existsSync(jsonPath)) totalJsonSize += fs.statSync(jsonPath).size;
      if (fs.existsSync(msgpackPath)) totalMsgpackSize += fs.statSync(msgpackPath).size;

      // Session details
      const sessionsDir = path.join(MEMEX_PATH, 'summaries/projects', projectDir, 'sessions');
      if (fs.existsSync(sessionsDir)) {
        const files = fs.readdirSync(sessionsDir);
        for (const file of files) {
          const filePath = path.join(sessionsDir, file);
          if (file.endsWith('.json')) totalJsonSize += fs.statSync(filePath).size;
          if (file.endsWith('.msgpack')) totalMsgpackSize += fs.statSync(filePath).size;
        }
      }
    }

    const saved = totalJsonSize - totalMsgpackSize;
    const reduction = ((saved / totalJsonSize) * 100).toFixed(1);

    console.log(`   JSON:       ${(totalJsonSize / 1024).toFixed(2)} KB`);
    console.log(`   MessagePack: ${(totalMsgpackSize / 1024).toFixed(2)} KB`);
    console.log(`   Saved:      ${(saved / 1024).toFixed(2)} KB (${reduction}%)`);

    return {
      json_size_kb: totalJsonSize / 1024,
      msgpack_size_kb: totalMsgpackSize / 1024,
      saved_kb: saved / 1024,
      reduction_percent: parseFloat(reduction)
    };
  }

  /**
   * Run all validation tests
   */
  async runAll() {
    console.log('🔍 MessagePack Implementation Validation\n');

    this.validateIndex();
    this.validateSessionIndexes();
    this.validateSessionDetails();
    this.testMemexLoader();
    this.testLazyLoader();

    const savings = this.calculateSavings();

    console.log('\n📋 Validation Summary:');
    console.log(`   Total tests: ${this.results.total_files_tested}`);
    console.log(`   Passed: ${this.results.passed}`);
    console.log(`   Failed: ${this.results.failed}`);
    console.log(`   Warnings: ${this.results.warnings}`);

    if (this.errors.length > 0) {
      console.log('\n❌ Errors:');
      this.errors.forEach(err => console.log(`   • ${err}`));
    }

    if (this.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      this.warnings.forEach(warn => console.log(`   • ${warn}`));
    }

    if (this.results.failed === 0) {
      console.log('\n✅ All tests passed!');
      console.log(`\n🎉 MessagePack implementation successful!`);
      console.log(`   Size reduction: ${savings.reduction_percent}%`);
      console.log(`   Space saved: ${savings.saved_kb.toFixed(2)} KB`);
      return true;
    } else {
      console.log('\n❌ Some tests failed. Please review errors above.');
      return false;
    }
  }
}

// CLI Usage
if (require.main === module) {
  const validator = new MessagePackValidator();

  validator.runAll().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = MessagePackValidator;
