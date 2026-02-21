# [Project Name]

[One sentence description]

## Quick Start

```bash
# Install
npm install

# Development
npm run dev

# Test
npm test

# Build
npm run build
```

## Tech Stack

- **Frontend:** [React, TypeScript, Tailwind]
- **Backend:** [NestJS / Vercel Serverless / none]
- **Database:** [PostgreSQL + Drizzle / none]
- **Deploy:** [Vercel / DigitalOcean / Netlify]

## Project Structure

```
src/
  components/    # UI components
  pages/         # Page components
  lib/           # Utilities and helpers
  db/            # Database schema and queries
api/             # API routes
tests/           # Test files
```

## Environment Variables

Copy `.env.example` to `.env` and fill in values:

```bash
cp .env.example .env
```

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `JWT_SECRET` | Auth token signing secret | Yes |

## Contributing

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make changes and add tests
3. Push and create a PR
4. All CI checks must pass

## License

MIT
