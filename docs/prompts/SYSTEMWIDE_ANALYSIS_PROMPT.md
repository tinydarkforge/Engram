# Systemwide Codebase Analysis & EPIC Preparation Prompt

> **Use this prompt to have Claude perform a comprehensive codebase analysis and create an EPIC for platform evolution.**
>
> **Last used:** December 12, 2025 - Created issue #570 for CirrusTranslate
> **Duration:** ~2-3 hours autonomous work
> **Output:** EPIC document + Memex knowledge persistence

---

## The Prompt

```
🔍 Systemwide Codebase Analysis & EPIC Preparation

You have full access to the entire repository.
You do NOT need my permission to read, analyze, explore, or traverse any part of the codebase.

I will be offline, so I need you to operate autonomously.

📦 Repository

https://github.com/Cirrus-Inc/CirrusTranslate

🎯 Mission Overview

1. Build a complete understanding of the system

Load, read, and analyze all modules, workflows, services, utilities, and integrations.
Construct an accurate mental model of the entire platform—how components interact, data flows, boundaries, and responsibilities.

2. Perform a deep technical examination

Identify and document:

**Code Quality Issues**
- duplicated logic
- redundant or repeated patterns
- areas that should be abstracted
- legacy or outdated approaches
- unnecessary complexity
- inconsistent naming or structure

**Engineering & Architecture Issues**
- performance bottlenecks
- tight coupling / poor separation of concerns
- places where modularization can improve
- architecture smells
- weak error-handling paths
- missing safety or security considerations

**Refactoring & Modernization Opportunities**
- simplify logic
- streamline workflows
- make code more maintainable and elegant
- improve patterns, readability, consistency
- adopt modern best practices where appropriate

Think and analyze as if you were a principal engineer / senior architect.

3. Prepare a single high-level EPIC

The EPIC should concisely summarize:

A. What the system currently does
   (Your synthesized understanding of the platform.)

B. The major weaknesses or pain points
   Not every issue—just the biggest structural or architectural concerns.

C. The key improvements that should be prioritized
   Across architecture, performance, maintainability, developer experience, and clarity.

D. A high-level vision for evolving the system
   How we can make the platform:
   - cleaner
   - faster
   - more robust
   - more maintainable
   - more consistent
   - easier to enhance in the future

⚠️ Do NOT break the EPIC into tasks yet.
Only deliver the full EPIC narrative for now; we'll decompose later.

4. Persist all knowledge in Memex

Store your findings, insights, mental model, and system map in Memex within the repository, so future sessions can use this context immediately without starting from zero.

🏁 Goal

Lay the groundwork to transform the project into a system that is:
- more solid
- faster
- smoother
- easier to use
- easier to improve
- easier to maintain
- architecturally stronger
- delightful to work with
```

---

## Expected Outputs

1. **EPIC Document** - `docs/EPIC_PLATFORM_EVOLUTION.md`
   - System overview
   - Major weaknesses identified
   - Prioritized improvements
   - High-level vision

2. **Technical Debt Tracking** - `docs/memex/TECHNICAL_DEBT.md`
   - Categorized issues by severity
   - Code locations
   - Suggested fixes

3. **System Architecture** - `docs/memex/SYSTEM_ARCHITECTURE.md`
   - Full platform knowledge map
   - Component relationships
   - Data flows

4. **GitHub Issue** - Tracking issue for the analysis
   - Summary of findings
   - Links to documentation

5. **Memex Session** - Persisted for future sessions

---

## Customization

Replace the repository URL for other projects:

```
📦 Repository
https://github.com/YOUR-ORG/YOUR-REPO
```

Add specific focus areas if needed:

```
🔎 Special Focus
- Pay particular attention to the authentication flow
- The billing/payment module needs extra scrutiny
- Look for security vulnerabilities in API endpoints
```

---

## Tips

- Run this when you'll be away for 2-3 hours
- Works best with Claude Code's autonomous mode
- The analysis is thorough - expect detailed findings
- Follow up with "decompose the EPIC into GitHub issues" to create actionable tasks
