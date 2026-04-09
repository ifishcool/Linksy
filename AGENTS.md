# Repository Guidelines

## Project Structure & Module Organization
This repository is a Next.js 16 app with a pnpm workspace. Main application code lives in `app/` (App Router pages and API routes), `components/` (UI and feature components), and `lib/` (shared orchestration, media, server, storage, and utility code). Static assets are in `public/` and `assets/`. Automated tests are split between `tests/` for Vitest unit coverage and `e2e/` for Playwright browser flows. Workspace packages under `packages/` contain bundled libraries such as `mathml2omml` and `pptxgenjs`.

## Build, Test, and Development Commands
Use Node `>=20.9.0` and `pnpm`.

- `pnpm install` installs dependencies and builds workspace packages via `postinstall`.
- `pnpm dev` starts the local app on `http://localhost:3000`.
- `pnpm build` creates the production build; `pnpm start` serves it.
- `pnpm lint` runs ESLint with the Next.js + TypeScript config.
- `pnpm check` verifies Prettier formatting; `pnpm format` rewrites files.
- `pnpm test` runs unit tests in `tests/**/*.test.ts`.
- `pnpm test:e2e` runs Playwright flows in `e2e/tests` against port `3002`.
- `npx tsc --noEmit` is the expected type-check before opening a PR.

## Coding Style & Naming Conventions
Prettier is authoritative: 2-space indentation, semicolons, single quotes, trailing commas, and `printWidth: 100`. Prefer TypeScript for app code. Use `PascalCase` for React components, `camelCase` for functions/hooks/utilities, and `kebab-case` for route folders and most file names. Keep user-facing strings internationalized; do not hardcode copy in UI changes. ESLint allows intentionally unused variables only when prefixed with `_`.

## Testing Guidelines
Add or update Vitest coverage for logic in `lib/`, stores, provider config, and similar pure modules. Keep test files named `*.test.ts` under `tests/`. Use Playwright for user flows, page interactions, and regressions that span API + UI. For UI work, run `pnpm test:e2e` or at least the affected spec before review.

## Commit & Pull Request Guidelines
Commits follow Conventional Commits, e.g. `feat(media-popover): add LLM tab` or `fix(auth): refresh user data`. Open focused PRs against `main`, link an issue with `Closes #123` or `Fixes #123`, and explain both what changed and why. Include before/after screenshots for UI changes, keep the PR in draft until local verification is done, and ensure formatting, linting, type-checking, and relevant tests pass first.

## Security & Configuration Tips
Copy `.env.example` to `.env.local` for local setup and never commit secrets. At least one model provider key is required for full functionality. For security-sensitive changes, prefer private reporting via GitHub Security Advisories instead of public issues.
