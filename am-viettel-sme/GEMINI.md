# Viettel AM Automation Platform — Workspace Instructions

@../plugins/superpowers/skills/using-superpowers/SKILL.md
@../plugins/superpowers/skills/using-superpowers/references/antigravity-tools.md
@../plugins/superpowers/skills/using-superpowers/references/gemini-tools.md

## Project Context
- **Name:** Viettel AM SME Automation Platform (`am-viettel-sme`)
- **Authority:** Master Plan 138-page PDF (`../docs/master-plan/Code tool AM_compressed_1.pdf`) and Design Specs (`../docs/specs/`).
- **Active Plans:** Implementation plans are maintained under `../docs/superpowers/plans/` (active: `../docs/superpowers/plans/2026-11-04-viettel-am-system.md`).

## Superpowers Disciplines Enforced
1. **Gate Rule (`using-superpowers`):**
   - Before taking action or answering design/architecture questions, invoke the appropriate skill.
   - For creative design / new feature -> `superpowers:brainstorming`.
   - For multi-step tasks -> `superpowers:writing-plans`.
   - For executing plans -> `superpowers:executing-plans` or `superpowers:subagent-driven-development`.
   - For any code changes -> `superpowers:test-driven-development` (Strict RED-GREEN-REFACTOR: NO production code without a failing test first).
   - For bug fixes -> `superpowers:systematic-debugging`.
   - Before claiming any task is complete -> `superpowers:verification-before-completion` (Must run actual test command and verify output before asserting success).

2. **Project Ironclad Constraints (Master Plan & Data Protection):**
   - **Data Minimization & PII:** NEVER store CCCD/CMND numbers, raw birth dates, or raw excel rows. Use `normalizeTaxCode`, `maskPhone`, and hash sensitive inputs.
   - **Fail-Closed Contactability:** `evaluateContactTaskEligibility` must be checked before sending any message. Block suppressed or opt-out leads across all channels.
   - **Playwright Persistent Contexts:** Browser profiles MUST be isolated per account at `storage/browser_profiles/<account_id>`. Never use shared cookies or proxy bypassing. AM logs in via real QR code.
   - **Queue & Worker Safety:** Every BullMQ job requires `idempotencyKey` and distributed Redis `JobLock`. Max retries capped with dead-letter queue.
   - **Kill Switch & Circuit Breakers:** System-wide kill switch and per-account circuit breaker must halt workers immediately upon error spikes or administrative abort.

3. **Execution Environment:**
   - Package manager: `corepack pnpm` in `am-viettel-sme/`.
   - Test runner: `corepack pnpm test` (Vitest).
   - Node version: Node.js 22+.
