#!/usr/bin/env bash
# JAWAFA ONE AI — owner-run deployment of the Firestore security rules.
# Runs the rules tests on the local emulator first and refuses to deploy if any test fails.
# Usage: scripts/deploy-jawafa-one.sh [firebase-project-id]   (default: ameraistore-1c81d)
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="${1:-ameraistore-1c81d}"
command -v firebase >/dev/null || { echo "Install the Firebase CLI first: npm i -g firebase-tools@13"; exit 1; }
command -v java >/dev/null || { echo "Java 11+ is required for the emulator tests."; exit 1; }

echo "1/3 Installing test dependencies (temporary folder)…"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"; rm -f tests/firestore/node_modules' EXIT
(cd "$TMP" && npm init -y >/dev/null && npm install --silent --no-audit --no-fund @firebase/rules-unit-testing@3 firebase@10.14.1)
ln -sfn "$TMP/node_modules" tests/firestore/node_modules

echo "2/3 Running rules tests on the emulator…"
firebase emulators:exec --project demo-jawafa-one --only firestore "node --test tests/firestore/tenancy.rules.test.mjs"

echo
echo "3/3 Ready to deploy firestore.rules to project: $PROJECT"
echo "    The Android store section of the rules is unchanged; companies/invites/profiles are added."
read -r -p "Type DEPLOY to continue: " ok
[ "$ok" = "DEPLOY" ] || { echo "Cancelled."; exit 1; }
firebase deploy --only firestore:rules --project "$PROJECT"
echo
echo "Done. Remaining manual steps are listed in docs/jawafa-one/DEPLOY.md."
