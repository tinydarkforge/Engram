# Security Policy

## Supported versions

The latest release on the `main` branch receives security fixes.

## Reporting a vulnerability

Email **tinydarkforge@gmail.com** with:

1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Any suggested fix (optional)

**Response SLA:** 72 hours acknowledgement; fix timeline communicated in that response.

Please do not open a public GitHub issue for security vulnerabilities.

## Scope

Issues in these areas are in scope:

- MCP server (stdio and HTTP transport)
- Session storage and index files
- Neural/semantic search pipeline
- Assertion ledger (SQLite storage, confidence model)

Out of scope: vulnerabilities in upstream dependencies that have no available fix.
