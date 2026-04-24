# Save Session

Save what was accomplished in this coding session to Codicil.

## Usage
`/save-session` -- saves current session summary to Codicil

## Steps

1. Summarize what was accomplished in this session (based on git log and conversation):
```bash
git log --oneline -10
```

2. Identify topics from the changes (e.g., auth, database, ui, testing).

3. Save to Codicil:
```bash
~/code/TinyDarkForge/Codicil/scripts/remember "<summary of what was done>" --topics <topic1>,<topic2>
```

4. Report what was saved.

## Rules
- Keep the summary concise (1-2 sentences)
- Include specific technical details (not vague "worked on stuff")
- Good: "Added JWT auth with refresh tokens, password reset via Resend email"
- Bad: "Worked on authentication"
