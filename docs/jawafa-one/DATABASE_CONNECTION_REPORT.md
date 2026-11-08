# DATABASE_CONNECTION_REPORT

**Status: BLOCKED. No database connection exists in JAWAFA ONE AI, and none is displayed as LIVE.**

## Why

- No secure backend for this multi-company app exists yet, and no read-only database credentials were provided.
- The browser, the PWA, the desktop app and the APK must never hold SQL credentials or connect to SQL Server directly.

## Required design (not implemented)

```
App (browser/EXE/APK) ──Firebase ID token──▶ Backend gateway (e.g. Cloudflare Worker / Cloud Run)
                                              ├─ verifies token + company membership + role
                                              ├─ per-company connector config (secret store, never Firestore)
                                              └─▶ SQL Server via least-privilege READ-ONLY login
                                                   (SELECT on named views only; no sa; no write grants)
```

## Acceptance tests to run once unblocked

Authorised connection · read one real record and compare with the source · latency · outage handling · attempted INSERT/UPDATE/DELETE rejected by the database login · company A's token cannot read company B's connector.

## Needed from the owner

Network path to Jawafa_DB, a dedicated read-only login limited to agreed views/columns, and approval of the gateway host. Jawafa_DB and financial records were not touched in this work.
