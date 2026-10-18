#!/bin/sh
# loom installer. Plain-English, safe to re-run, installs nothing system-wide.
#
#   sh install.sh                 from a loom folder
#   curl -fsSL https://raw.githubusercontent.com/evidence-codes/loom/main/install.sh | sh
#
# Options: --repo URL   where to get loom (default: this folder if it is a loom
#                       checkout, otherwise https://github.com/evidence-codes/loom)
#          --yes        don't ask before adding loom to your coding agents
#          --no-plugin  skip the Claude Code plugin
#          --no-agents  skip Cursor, Codex and Antigravity
#          --no-impeccable  don't offer to install impeccable
set -eu

REPO=""
YES=0
PLUGIN=1
AGENTS=1
IMPECCABLE=1
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    --no-plugin) PLUGIN=0; shift ;;
    --no-agents) AGENTS=0; shift ;;
    --no-impeccable) IMPECCABLE=0; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

say() { printf '%s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
problem() { printf '  ✗ %s\n' "$*"; }
good() { printf '  ✓ %s\n' "$*"; }

step "Checking your computer"
MISSING=0
NEED_NODE=0
NEED_CHROME=0

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
  if [ "$NODE_MAJOR" -ge 22 ]; then good "Node.js $(node -v)"
  else problem "Node.js $(node -v) is too old. loom needs version 22 or newer."; MISSING=1; NEED_NODE=1; fi
else
  problem "Node.js isn't installed. loom needs it to run."; MISSING=1; NEED_NODE=1
fi

CHROME=""
for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "/Applications/Chromium.app/Contents/MacOS/Chromium" /usr/bin/google-chrome /usr/bin/chromium /usr/bin/chromium-browser; do
  [ -x "$c" ] && CHROME="$c" && break
done
if [ -n "$CHROME" ]; then good "Chrome found"
else problem "Google Chrome isn't installed. loom uses it to look at your site the way visitors do."; MISSING=1; NEED_CHROME=1; fi

if [ "$MISSING" -eq 1 ]; then
  step "Before loom can work"
  if [ "$(uname)" = "Darwin" ]; then
    [ "$NEED_NODE" -eq 1 ] && say "  • Node.js: download the LTS installer from https://nodejs.org (or, with Homebrew: brew install node)"
    [ "$NEED_CHROME" -eq 1 ] && say "  • Chrome: download from https://www.google.com/chrome"
  else
    [ "$NEED_NODE" -eq 1 ] && say "  • Node.js 22+: https://nodejs.org/en/download (or your package manager)"
    [ "$NEED_CHROME" -eq 1 ] && say "  • Chrome or Chromium: your package manager, or https://www.google.com/chrome"
  fi
  say ""
  say "  Install what's missing, then run this installer again. Nothing has been changed."
  exit 1
fi

step "Getting loom"
HERE=$(cd "$(dirname "$0")" 2>/dev/null && pwd || echo "")
if [ -z "$REPO" ] && [ -n "$HERE" ] && [ -f "$HERE/bin/loom.mjs" ]; then
  ROOT="$HERE"
  good "using the loom folder at $ROOT"
else
  [ -z "$REPO" ] && REPO="https://github.com/evidence-codes/loom.git"
  command -v git >/dev/null 2>&1 || { problem "git isn't installed, so loom can't be downloaded."; exit 1; }
  ROOT="$HOME/.loom/app"
  if [ -d "$ROOT/.git" ]; then
    git -C "$ROOT" pull --ff-only --quiet && good "updated loom in $ROOT"
  else
    mkdir -p "$HOME/.loom"
    git clone --quiet --depth 1 "$REPO" "$ROOT" && good "downloaded loom to $ROOT"
  fi
fi

step "Adding the loom command"
BIN="$HOME/.local/bin"
TARGET="$BIN/loom"
mkdir -p "$BIN"
chmod +x "$ROOT/bin/loom.mjs" "$ROOT/bin/loom"
if [ -e "$TARGET" ] && ! [ -L "$TARGET" ]; then
  problem "$TARGET already exists and isn't loom's; leaving it alone."; exit 1
fi
ln -sfn "$ROOT/bin/loom.mjs" "$TARGET"
good "loom is at $TARGET"
case ":$PATH:" in
  *":$BIN:"*) ;;
  *)
    SHELL_RC="$HOME/.zshrc"; [ -n "${BASH_VERSION:-}" ] && SHELL_RC="$HOME/.bashrc"
    say "  ! $BIN isn't on your PATH yet. Add this line to $SHELL_RC, then open a new terminal:"
    say "      export PATH=\"\$HOME/.local/bin:\$PATH\""
    ;;
esac

"$TARGET" learn seed >/dev/null && "$TARGET" learn rules >/dev/null && good "house rules ready"

if [ "$PLUGIN" -eq 1 ] && command -v claude >/dev/null 2>&1; then
  step "Claude Code"
  ANSWER=y
  if [ "$YES" -eq 0 ] && [ -t 0 ]; then
    printf '  Add loom to Claude Code so you can just ask Claude to use it? [Y/n] '
    read -r ANSWER || ANSWER=y
  fi
  case "$ANSWER" in
    n|N|no|No) say "  skipped; you can add it later with: claude plugin install loom --marketplace $ROOT" ;;
    *)
      claude plugin marketplace add "$ROOT" --scope user >/dev/null 2>&1 || true
      if claude plugin install loom@loom --scope user >/dev/null 2>&1 || claude plugin update loom@loom >/dev/null 2>&1; then
        good "added. In Claude Code, try: \"use loom to check my site\""
      else
        problem "couldn't add the plugin automatically; run: claude plugin install loom --marketplace $ROOT"
      fi
      ;;
  esac
fi

OTHERS=""
[ "$AGENTS" -eq 1 ] && OTHERS=$("$TARGET" agents --found)
if [ -n "$OTHERS" ]; then
  step "Other coding agents"
  ANSWER=y
  if [ "$YES" -eq 0 ] && [ -t 0 ]; then
    printf '  Add loom to %s too? [Y/n] ' "$OTHERS"
    read -r ANSWER || ANSWER=y
  fi
  case "$ANSWER" in
    n|N|no|No) say "  skipped; you can add it later with: loom agents install" ;;
    *) "$TARGET" agents install || problem "couldn't add loom's skills; run: loom agents install" ;;
  esac
fi

if [ "$IMPECCABLE" -eq 1 ] && { command -v claude >/dev/null 2>&1 || [ -n "$OTHERS" ]; }; then
  step "impeccable (the design engine loom builds on)"
  SETUP="setup"
  [ -z "$OTHERS" ] && SETUP="setup --agents claude"
  [ "$YES" -eq 1 ] && SETUP="$SETUP --yes"
  "$TARGET" $SETUP || true
fi

step "Done"
"$TARGET" doctor || true
say ""
say "  Start with:  loom        (a guided menu)"
say "  Or ask your coding agent:  \"use loom to preview and review my site\""
