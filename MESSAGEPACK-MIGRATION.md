# MessagePack Migration Guide

## Overview

Memex v4.0 introduces **MessagePack binary serialization** for 44% smaller files and improved I/O performance. This guide covers migration, troubleshooting, and rollback procedures.

## Benefits

- **44% smaller files**: JSON 40.6 KB → MessagePack 22.6 KB
- **Reduced I/O**: Less disk reads/writes
- **Better caching**: Smaller memory footprint
- **Backward compatible**: JSON fallback always available

## Migration Process

### Step 1: Verify Prerequisites

```bash
# Ensure msgpack-lite is installed
npm list msgpack-lite

# Should show: msgpack-lite@0.1.26
```

### Step 2: Backup (Optional but Recommended)

```bash
# Backup your Memex directory
cp -r ~/code/cirrus/DevOps/Memex ~/code/cirrus/DevOps/Memex.backup
```

### Step 3: Preview Migration (Dry Run)

```bash
cd ~/code/cirrus/DevOps/Memex
node scripts/migrate-to-msgpack.js migrate --dry-run
```

This shows what files would be converted without making changes.

### Step 4: Run Migration

```bash
node scripts/migrate-to-msgpack.js migrate
```

This creates `.msgpack` files alongside existing `.json` files:
- `index.json` → `index.msgpack`
- `sessions-index.json` → `sessions-index.msgpack`
- Session detail files → `.msgpack` versions

**Important**: JSON files are **preserved** as fallback!

### Step 5: Verify Migration

```bash
node scripts/migrate-to-msgpack.js verify
```

This validates data integrity across all converted files.

### Step 6: Test Memex Loader

```bash
node scripts/memex-loader.js startup
```

Should show: `Format: MSGPACK` or `Format: CACHE`

## Performance Benchmarks

### File Sizes

| File Type | JSON | MessagePack | Reduction |
|-----------|------|-------------|-----------|
| index.json | 13.5 KB | 6.2 KB | 54% |
| sessions-index (avg) | 5.0 KB | 2.9 KB | 42% |
| session details (avg) | 0.8 KB | 0.6 KB | 29% |
| **Total** | **40.6 KB** | **22.6 KB** | **44%** |

### Parse Speed

For small files (<50KB), JSON parsing may be faster due to V8 optimization:
- JSON: ~0.05ms per file
- MessagePack: ~0.16ms per file

**However**, the 44% size reduction provides significant benefits for:
- Disk I/O (faster reads)
- Network transfer (if applicable)
- Memory caching (smaller footprint)

The absolute parsing difference (0.11ms) is negligible for Memex's use case.

## Troubleshooting

### Issue: "Cannot find module 'msgpack-lite'"

**Solution**: Install dependencies

```bash
cd ~/code/cirrus/DevOps/Memex
npm install
```

### Issue: Loader still using JSON format

**Symptoms**: Memex loader shows `Format: JSON`

**Solutions**:

1. **Clear persistent cache**:
   ```bash
   rm -rf ~/.memex-cache
   node scripts/memex-loader.js startup
   ```

2. **Verify .msgpack files exist**:
   ```bash
   ls -la index.msgpack
   ls -la summaries/projects/*/sessions-index.msgpack
   ```

3. **Check file permissions**:
   ```bash
   chmod 644 *.msgpack
   ```

### Issue: Data corruption or errors

**Solution**: Rollback to JSON

```bash
# Preview rollback
node scripts/migrate-to-msgpack.js rollback --dry-run

# Execute rollback
node scripts/migrate-to-msgpack.js rollback
```

This removes all `.msgpack` files and reverts to JSON format.

**Recovery Time**: < 5 minutes
**Data Loss**: None (JSON files are preserved)

### Issue: Validation fails

**Symptoms**: `migrate-to-msgpack.js verify` shows failures

**Solutions**:

1. **Re-run conversion** for failed files:
   ```bash
   # Remove corrupted .msgpack files
   rm path/to/corrupted.msgpack

   # Re-convert
   node scripts/migrate-to-msgpack.js migrate
   ```

2. **Full rollback and re-migration**:
   ```bash
   node scripts/migrate-to-msgpack.js rollback
   node scripts/migrate-to-msgpack.js migrate
   node scripts/migrate-to-msgpack.js verify
   ```

## Rollback Procedure

If you need to revert to JSON format:

```bash
# 1. Preview rollback (optional)
node scripts/migrate-to-msgpack.js rollback --dry-run

# 2. Execute rollback
node scripts/migrate-to-msgpack.js rollback

# 3. Verify Memex works
node scripts/memex-loader.js startup
```

**What happens**:
- All `.msgpack` files are removed
- `.json` files remain intact
- Memex automatically falls back to JSON
- No data is lost

## Format Detection Logic

Memex loader tries formats in this order:

1. **Persistent cache** (fastest, instant)
2. **MessagePack** (.msgpack files)
3. **Gzip JSON** (.json.gz files)
4. **Plain JSON** (.json files)

This ensures:
- Maximum performance with MessagePack
- Automatic fallback if MessagePack missing
- No breaking changes

## Best Practices

### Development

- Keep both JSON and MessagePack versions
- Use JSON for editing/debugging
- Let Memex load MessagePack for performance

### Production

- Run validation after migration: `migrate-to-msgpack.js verify`
- Monitor first startup with MessagePack
- Keep backup of JSON files

### Debugging

If you need to inspect MessagePack files:

```bash
# Convert back to JSON for viewing
node -e "const fs = require('fs'); const msgpack = require('msgpack-lite'); const data = msgpack.decode(fs.readFileSync('file.msgpack')); console.log(JSON.stringify(data, null, 2));" > file-decoded.json
```

## Migration Scripts Reference

### migrate-to-msgpack.js

**Commands**:
- `migrate` - Convert all JSON to MessagePack
- `rollback` - Remove all MessagePack files
- `verify` - Validate data integrity

**Options**:
- `--dry-run` - Preview without changes

### validate-msgpack.js

Comprehensive validation suite:
- Tests index integrity
- Tests session indexes
- Tests session details
- Tests Memex loader
- Tests lazy loader
- Calculates size savings

**Usage**:
```bash
node scripts/validate-msgpack.js
```

### benchmark-msgpack.js

Performance comparison:
- Parse speed (JSON vs MessagePack)
- File size comparison
- 100 iterations for accuracy

**Usage**:
```bash
node scripts/benchmark-msgpack.js
```

## FAQ

### Q: Do I need to convert to MessagePack?

**A**: No, it's optional. Memex works fine with JSON. MessagePack provides:
- 44% smaller files
- Better disk I/O
- Smaller cache footprint

Choose MessagePack if you care about file size and I/O performance.

### Q: Can I mix JSON and MessagePack?

**A**: Yes! Memex supports mixed formats:
- Some files as MessagePack
- Others as JSON
- Automatic format detection per file

### Q: What if MessagePack parsing fails?

**A**: Memex automatically falls back to JSON. No manual intervention needed.

### Q: Is data lost during migration?

**A**: No. JSON files are preserved. MessagePack files are created alongside them.

### Q: How do I know migration succeeded?

**A**: Run these checks:
```bash
# 1. Verify files exist
ls -la index.msgpack

# 2. Run validation
node scripts/migrate-to-msgpack.js verify

# 3. Test loader
node scripts/memex-loader.js startup
```

All should succeed without errors.

### Q: What's the recommended workflow?

**A**:
1. Backup Memex directory (optional)
2. Run dry-run: `migrate --dry-run`
3. Run migration: `migrate`
4. Verify: `verify`
5. Test: `memex-loader.js startup`
6. If issues: `rollback`

### Q: Do I need to update my code?

**A**: No. Memex loader handles MessagePack automatically. Your existing code works unchanged.

## Support

If you encounter issues:

1. **Check this guide** for troubleshooting steps
2. **Run validation**: `migrate-to-msgpack.js verify`
3. **Check logs** in console output
4. **Rollback** if needed: `rollback`

## Version History

- **v4.0.0** (2025-12-04): Initial MessagePack implementation
  - 44% size reduction achieved
  - Full backward compatibility maintained
  - Comprehensive migration tooling

## Related Documentation

- [QUICKSTART.md](QUICKSTART.md) - Getting started with Memex
- [README.md](README.md) - Memex overview
- [ROADMAP-V4.md](ROADMAP-V4.md) - v4.0 optimization roadmap
- [CHANGELOG.md](CHANGELOG.md) - Version history

---

**Need help?** Check the troubleshooting section or rollback to JSON format.
