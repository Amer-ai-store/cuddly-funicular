# AAS development workspace

- The UI is Arabic and RTL. Keep visible labels readable on desktop and mobile.
- AAS-CC coordinates tasks, approvals, and activity. AAS-AW groups agents, tasks,
  and notes by workspace.
- The current release uses a private Sites Worker and D1 for shared records.
  server/state.mjs owns validation; dist/api-store.js synchronizes browser state.
- GitHub observations come from live REST or the public Atom feed during limits.
  Source audits download pinned archives; workflow gates distinguish owner reports
  from server analysis and dedicated runner receipts. Never imply an unconfigured
  executor has changed code or run tests.
- App snapshots
  establish receipt of app-reported records; they do not prove payment or delivery.
- Never claim a real AI run, installed app connection, or external action without
  verifying it. Missing providers must return errors rather than simulated output.
- Keep browser modules under dist/. Escape user content before inserting HTML.
- Do not store service credentials in frontend code, localStorage, or Git.
- Run npm run check and npm test after logic changes. Verify the changed user
  workflow in a browser when browser tooling is available.
- Production architecture and next steps are documented under docs/.
