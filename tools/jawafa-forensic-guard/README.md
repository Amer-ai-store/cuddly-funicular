# Jawafa Forensic Guard

Standalone **read-only** Windows auditing companion for Jawafa. This is independent code, not a replacement for the licensed TrustSoft ERP.

Compile `Program.cs` with Windows .NET Framework `csc.exe` and `System.Web.Extensions.dll`. Execute `self-test`, `health`, or `inventory` (see the built-in `--help`).

It reads historical CSV exports and a local health endpoint, reports authentication/credential risks, and produces a SHA-256 of its analysis. It never updates accounting records. Keep input exports and generated reports inside a restricted local folder. Do not publish originals in this repository.

Limits: accurate database change history needs an approved source audit mechanism; snapshot differences cannot reconstruct missing previous values. All integration with TrustSoft must be independently tested before deployment.
