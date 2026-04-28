#!/usr/bin/env node

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('ManifestManager', () => {
  let tmpDir;
  let ManifestManager;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-manifest-'));

    // Create minimal Engram structure
    fs.mkdirSync(path.join(tmpDir, 'metadata', 'projects'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'summaries', 'projects', 'TestProj'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'index.json'), JSON.stringify({ v: '4.0.0' }));
    fs.writeFileSync(
      path.join(tmpDir, 'summaries', 'projects', 'TestProj', 'sessions-index.json'),
      JSON.stringify({ project: 'TestProj', sessions: [] })
    );

    process.env.ENGRAM_PATH = tmpDir;

    // Clear module cache
    Object.keys(require.cache)
      .filter(k => k.includes('manifest-manager') || k.includes('paths'))
      .forEach(k => delete require.cache[k]);

    ManifestManager = require('../scripts/manifest-manager');
  });

  after(() => {
    delete process.env.ENGRAM_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('load() returns null when no manifest exists', () => {
    const manager = new ManifestManager();
    assert.equal(manager.load(), null);
  });

  it('generate() creates a manifest with correct shape', async () => {
    const manager = new ManifestManager();
    const manifest = await manager.generate();

    assert.equal(manifest.version, '4.0.0');
    assert.ok(manifest.generated_at);
    assert.equal(typeof manifest.files, 'object');
    assert.equal(typeof manifest.stats.total_files, 'number');
    assert.equal(typeof manifest.stats.total_size_bytes, 'number');
    assert.ok(manifest.stats.total_files >= 1); // at least index.json
  });

  it('save() writes manifest to disk', async () => {
    const manager = new ManifestManager();
    await manager.generate();
    manager.save();

    const manifestPath = path.join(tmpDir, '.engram-manifest.json');
    assert.ok(fs.existsSync(manifestPath));
    const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(data.version, '4.0.0');
  });

  it('save() throws when no manifest generated', () => {
    const manager = new ManifestManager();
    assert.throws(() => manager.save(), /No manifest to save/);
  });

  it('load() returns saved manifest', async () => {
    const manager1 = new ManifestManager();
    await manager1.generate();
    manager1.save();

    const manager2 = new ManifestManager();
    const loaded = manager2.load();
    assert.ok(loaded);
    assert.equal(loaded.version, '4.0.0');
    assert.ok(loaded.files['index.json']);
  });

  it('hashFile() produces consistent hashes', () => {
    const manager = new ManifestManager();
    const filePath = path.join(tmpDir, 'index.json');
    const hash1 = manager.hashFile(filePath);
    const hash2 = manager.hashFile(filePath);
    assert.equal(hash1, hash2);
    assert.equal(typeof hash1, 'string');
    assert.equal(hash1.length, 16);
  });

  it('getFileMetadata() returns correct shape', () => {
    const manager = new ManifestManager();
    const filePath = path.join(tmpDir, 'index.json');
    const meta = manager.getFileMetadata(filePath);
    assert.equal(typeof meta.hash, 'string');
    assert.equal(typeof meta.size, 'number');
    assert.equal(typeof meta.mtime, 'number');
    assert.ok(meta.size > 0);
  });

  it('detectChanges() reports added files', async () => {
    // Generate and save initial manifest
    const manager = new ManifestManager();
    await manager.generate();
    manager.save();

    // Add a new file
    fs.writeFileSync(
      path.join(tmpDir, 'metadata', 'projects', 'new-project.json'),
      JSON.stringify({ name: 'new' })
    );

    // Generate new manifest and detect changes
    await manager.generate();
    const changes = manager.detectChanges();

    assert.equal(changes.is_first_run, false);
    assert.ok(changes.added.length > 0 || changes.changed.length > 0);
  });

  it('detectChanges() returns is_first_run when no previous manifest', async () => {
    // Remove manifest
    const manifestPath = path.join(tmpDir, '.engram-manifest.json');
    if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);

    const manager = new ManifestManager();
    await manager.generate();
    const changes = manager.detectChanges();
    assert.equal(changes.is_first_run, true);
  });

  it('needsIndexUpdate() returns true when no manifest exists', () => {
    const manifestPath = path.join(tmpDir, '.engram-manifest.json');
    if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);

    const manager = new ManifestManager();
    assert.equal(manager.needsIndexUpdate(), true);
  });

  it('needsIndexUpdate() returns false when index unchanged', async () => {
    const manager = new ManifestManager();
    await manager.generate();
    manager.save();

    assert.equal(manager.needsIndexUpdate(), false);
  });

  it('needsIndexUpdate() returns true when index content changes', async () => {
    const manager = new ManifestManager();
    await manager.generate();
    manager.save();

    // Modify index.json
    fs.writeFileSync(path.join(tmpDir, 'index.json'), JSON.stringify({ v: '4.0.0', modified: true }));

    assert.equal(manager.needsIndexUpdate(), true);
  });
});
