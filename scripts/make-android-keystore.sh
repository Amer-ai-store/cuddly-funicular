#!/usr/bin/env bash
# Creates the permanent signing key for the JAWAFA ONE AI Android app. Run ONCE on your own computer
# (needs Java's keytool). Keep the .jks file and passwords safe: losing them means you can never
# update the app under the same identity. Never commit the .jks file.
set -euo pipefail
OUT="${1:-jawafa-one-release.jks}"
ALIAS="${2:-jawafa-one}"
[ -e "$OUT" ] && { echo "$OUT already exists — refusing to overwrite."; exit 1; }
read -r -s -p "Keystore password (min 6 chars): " PASS; echo
keytool -genkeypair -v -keystore "$OUT" -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" -dname "CN=JAWAFA ONE AI, O=Amer AI Store, C=JO"
FP=$(keytool -list -v -keystore "$OUT" -alias "$ALIAS" -storepass "$PASS" | awk '/SHA256:/{print $2; exit}')
echo
echo "Add these GitHub repository secrets (Settings › Secrets and variables › Actions):"
echo "  JAWAFA_ANDROID_KEYSTORE_BASE64  = contents of $OUT.b64 (created now)"
echo "  JAWAFA_ANDROID_KEYSTORE_PASSWORD = the password you typed"
echo "  JAWAFA_ANDROID_KEY_ALIAS         = $ALIAS"
echo "  JAWAFA_ANDROID_KEY_PASSWORD      = the password you typed"
base64 < "$OUT" | tr -d '\n' > "$OUT.b64"
echo
echo "SHA-256 fingerprint for assetlinks.json: $FP"
sed "s/__SHA256_FINGERPRINT__/$FP/" "$(dirname "$0")/../apps/android/well-known/assetlinks.template.json" > assetlinks.json
echo "Wrote assetlinks.json — upload it as /.well-known/assetlinks.json on https://amer-ai-store.github.io"
echo "(that is the repository Amer-ai-store/amer-ai-store.github.io). Delete $OUT.b64 after adding the secret."
