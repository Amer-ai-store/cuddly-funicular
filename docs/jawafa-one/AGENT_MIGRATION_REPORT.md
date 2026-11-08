# AGENT_MIGRATION_REPORT

Rule: NO AGENT DELIVERY EVIDENCE = NO SUCCESSFUL AGENT MIGRATION. **No agent has been migrated.**

## Discovery (repository search, 2026-11-06)

- `dashboard/aas/official-agent-roster.mjs` — 19 official agent *definitions* (name, role, group, description), sourced from `Amer-AI-Store-/…/AgentModels.kt`. They state `model: "غير متصل"`: no runtime, no tools, no credentials.
- `aas-cc/command-center` — AAS team of 9 agent *profiles* stored in D1; Gemini proxy; Runner for GitHub Actions executions.
- **Not found anywhere in the repository:** the central supervisor **999**, management & agents **777**, agents **666**, **task dispatcher 1**, **task dispatcher 2**. Searched for `999`, `777`, `666`, `موزع`, `المشرف` in JS/MJS/JSON sources.

## What was built

- Agent Registry in `dashboard/one` listing all 19 official definitions plus 999/777/666/D1/D2 as **BLOCKED** placeholders with the reason.
- Agent Message Router (`core.js createRouter` + Firestore `companies/{id}/agentMessages`): unique ids (dedupe), many-to-many recipients (≤20), states QUEUED → DELIVERED → READ → ACKNOWLEDGED or → FAILED, forward-only, body immutable, never deleted. A state beyond QUEUED needs a receipt from a listed recipient.
- Tests: CORE-03 (router logic), MSG-01 (server rules), E2E-10 (a real message from 999 to 777+666 persisted as QUEUED and **not** advanced, because no delivery channel exists).

## Per-agent status

| Agent | Definition | Channel | Delivery test | Status |
|---|---|---|---|---|
| 999 المشرف العام | missing | none | — | BLOCKED |
| 777 الإدارة والوكلاء | missing | none | — | BLOCKED |
| 666 الوكلاء | missing | none | — | BLOCKED |
| موزع المهام 1 / 2 | missing | none | — | BLOCKED |
| 19 official roster agents | present | none | — | definition only |

## To unblock

For each agent: a written definition (purpose, permissions, tools), and an authorised endpoint (e.g. a backend function calling the OpenAI/Gemini API with that agent's instructions) that writes a receipt back to `agentMessages` with its own service identity. ChatGPT conversation links cannot receive or acknowledge messages.
