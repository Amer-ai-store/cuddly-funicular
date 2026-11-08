#!/usr/bin/env bash
# Creates a Claude Code token from your Claude subscription, checks that it works, and saves it as this
# repository's CLAUDE_CODE_OAUTH_TOKEN Actions secret, so the long token never has to be copied by hand.
# It then removes the ANTHROPIC_API_KEY secret, which the workflows would otherwise use instead of the token.
# Meant for a GitHub Codespace opened from a phone's browser; see docs/code-review-setup.md.
# The token is never printed by this script's own status messages; Claude setup-token may echo it in the private terminal.
# Never share terminal screenshots or logs. The transcript is deleted on exit.
set -euo pipefail

REPO="Amer-ai-store/Mohammad-Ahmed-Ghannam"
SECRET="CLAUDE_CODE_OAUTH_TOKEN"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# Refuse to store a credential from a checkout of the old/wrong repository.
# Never trust a pasted or inherited GitHub repo name as a secret destination.
origin="$(git remote get-url origin 2>/dev/null || true)"
if [[ "$origin" != *"Amer-ai-store/Mohammad-Ahmed-Ghannam"* ]]; then
  echo "Wrong Codespace/repository: open the Amer-ai-store/Mohammad-Ahmed-Ghannam project first."
  exit 1
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required for safe secret upload."
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  say "Installing Claude Code..."
  curl -fsSL https://claude.ai/install.sh | bash >/dev/null
  export PATH="$HOME/.local/bin:$PATH"
fi

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

say "1/3  Sign in to Claude: open the link that appears, approve, then paste the code you get back here."
# script(1) keeps the terminal interactive while recording what setup-token prints, so the token is read
# from the recording instead of being copied off a small screen.
script -q -e -c "claude setup-token" "$log"

if ! token="$(python3 - "$log" <<'PY'
import re
import sys

# newline="" keeps the recorded "\r" characters, which the clean-up below relies on.
text = open(sys.argv[1], encoding="utf-8", errors="replace", newline="").read()
# Drop terminal control sequences (colours, cursor moves, titles). A terminal ends recorded lines with
# "\r\r\n"; collapse those, and turn the remaining lone "\r" (redraws) into line breaks.
text = re.sub(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[()][0-9A-Za-z]|\x1b[@-_]", "", text)
lines = re.sub(r"\r*\n", "\n", text).replace("\r", "\n").split("\n")

TOKEN_CHARS = re.compile(r"[A-Za-z0-9_-]+")
BORDER = " \t'\"`│┃║|╭╮╰╯─━═"
VALID = re.compile(r"sk-ant-oat\d+-[A-Za-z0-9_-]{60,}")

found = []
for i, line in enumerate(lines):
    start = line.find("sk-ant-oat")
    while start >= 0:
        head = TOKEN_CHARS.match(line, start).group(0)
        parts = [head]
        # The token is longer than a phone-sized terminal is wide, so it is wrapped; join the pieces.
        if not line[start + len(head):].strip(BORDER):
            for nxt in lines[i + 1:]:
                piece = nxt.strip(BORDER)
                if not TOKEN_CHARS.fullmatch(piece):
                    break
                parts.append(piece)
        found.append("".join(parts))
        start = line.find("sk-ant-oat", start + 1)

valid = [t for t in found if VALID.fullmatch(t)]
if not valid:
    sys.exit(1)
print(max(valid, key=len))
PY
)"; then
  echo "No token was found in what setup-token printed, so nothing was saved. Run this script again."
  exit 1
fi

say "2/3  Checking the token with Claude..."
# Other credentials are unset so the check proves this token works, not an API key the Codespace may hold.
if ! env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN="$token" \
  claude -p "Reply with the single word OK." >/dev/null 2>&1; then
  echo "Claude rejected the token, so it was not saved. Run this script again."
  exit 1
fi
echo "The token works."

say "3/3  Saving it as the $SECRET secret of $REPO..."
if ! gh secret list -R "$REPO" >/dev/null 2>&1; then
  # A Codespace's built-in GitHub token cannot manage secrets: sign in to GitHub once with your own account.
  unset GITHUB_TOKEN GH_TOKEN
  gh auth login -h github.com -p https -w
fi
printf '%s' "$token" | gh secret set "$SECRET" -R "$REPO"

# The workflows use ANTHROPIC_API_KEY instead of this token whenever both secrets exist, so remove the API key
# to make the reviews run on the Claude subscription. The key itself stays valid in the Anthropic Console.
if ! names="$(gh secret list -R "$REPO" | cut -f1)"; then
  echo "$SECRET is saved, but the secrets could not be listed to remove ANTHROPIC_API_KEY."
  echo "Remove it by hand at https://github.com/$REPO/settings/secrets/actions"
  exit 1
fi
if grep -qx 'ANTHROPIC_API_KEY' <<<"$names"; then
  gh secret delete ANTHROPIC_API_KEY -R "$REPO"
  echo "Removed the ANTHROPIC_API_KEY secret, so the reviews now use this subscription token."
fi

say "Done: $SECRET is saved and was checked against Claude."
