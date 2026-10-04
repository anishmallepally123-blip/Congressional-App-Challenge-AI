#!/bin/bash
# Double-click this file to start Local AI Chat on a Mac.
#
# The first time, it gets the two things the app needs, then starts the app:
#   1. Python, to run the app's web server. If Python 3.9+ isn't installed, a private copy
#      is downloaded into the "runtime" folder next to the app (no admin password needed).
#   2. Ollama, the free engine that runs the AI model. If it isn't installed, it is
#      downloaded into the same "runtime" folder.
# The AI model itself is downloaded from the app's setup page with one click.
# This also works on Linux, except that Ollama must be installed from ollama.com first.

set -u
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME="$APP_DIR/runtime"
PORT=8000
OLLAMA_URL="http://127.0.0.1:11434"

say()  { echo "  $*"; }
step() { echo; echo "> $*"; }
fail() {
  echo
  echo "  Something went wrong: $*"
  echo "  If a download failed, check your internet connection and double-click the Start file again."
  echo
  read -r -p "  Press Return to close this window." _
  exit 1
}
responds() { curl -fsS -m 2 "$1" >/dev/null 2>&1; }

echo
echo "  Local AI Chat"
echo "  A private AI assistant that runs on this computer."

# Already running? Just open the page.
if responds "http://127.0.0.1:$PORT/api/status"; then
  say "The app is already running. Opening it in your browser."
  open "http://localhost:$PORT" 2>/dev/null || xdg-open "http://localhost:$PORT" 2>/dev/null
  exit 0
fi

# ---------- 1. Python ----------
step "Checking for Python"

python_ok() { "$1" -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >/dev/null 2>&1; }

find_python() {
  if [ -x "$RUNTIME/python/bin/python3" ]; then echo "$RUNTIME/python/bin/python3"; return; fi
  local p
  for p in python3 python; do
    p="$(command -v "$p" 2>/dev/null)" || continue
    # On a Mac without the developer tools, /usr/bin/python3 only pops up an install dialog.
    if [ "$p" = "/usr/bin/python3" ] && [ "$(uname)" = "Darwin" ] && ! xcode-select -p >/dev/null 2>&1; then
      continue
    fi
    if python_ok "$p"; then echo "$p"; return; fi
  done
}

install_python() {
  local arch os pattern url
  case "$(uname -m)" in
    arm64|aarch64) arch="aarch64" ;;
    *) arch="x86_64" ;;
  esac
  if [ "$(uname)" = "Darwin" ]; then os="apple-darwin"; else os="unknown-linux-gnu"; fi
  # A ready-to-run Python build (python-build-standalone, used by tools like uv).
  pattern="cpython-3\.12\.[0-9]*+[0-9]*-$arch-$os-install_only\.tar\.gz"
  url="$(curl -fsSL https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest \
        | grep -o "\"browser_download_url\": *\"[^\"]*/$pattern\"" | head -n 1 | sed 's/.*"\(https[^"]*\)"/\1/')"
  [ -n "$url" ] || fail "could not find a Python download."
  say "Downloading Python (about 20 MB)..."
  mkdir -p "$RUNTIME"
  curl -fL --progress-bar -o "$RUNTIME/python.tar.gz" "$url" || fail "Python could not be downloaded."
  tar -xzf "$RUNTIME/python.tar.gz" -C "$RUNTIME" || fail "Python could not be unpacked."
  rm -f "$RUNTIME/python.tar.gz"
}

PYTHON="$(find_python)"
if [ -z "$PYTHON" ]; then
  say "Python isn't installed, so the app will use its own copy."
  install_python
  PYTHON="$(find_python)"
  [ -n "$PYTHON" ] || fail "Python could not be set up."
fi
say "Python is ready."

# ---------- 2. Ollama ----------
step "Checking for the AI engine (Ollama)"
OLLAMA_PID=""

wait_for_ollama() {
  local i
  for i in $(seq 1 60); do
    responds "$OLLAMA_URL/api/version" && return 0
    sleep 1
  done
  return 1
}

if ! responds "$OLLAMA_URL/api/version"; then
  if [ "$(uname)" = "Darwin" ]; then
    if [ -d "/Applications/Ollama.app" ] || [ -d "$HOME/Applications/Ollama.app" ]; then
      say "Starting Ollama..."
      open -a Ollama
    else
      if [ ! -x "$RUNTIME/Ollama.app/Contents/Resources/ollama" ]; then
        say "Ollama isn't installed yet. Downloading it (a few hundred MB, this happens only once)..."
        mkdir -p "$RUNTIME"
        curl -fL --progress-bar -o "$RUNTIME/Ollama-darwin.zip" "https://ollama.com/download/Ollama-darwin.zip" \
          || fail "Ollama could not be downloaded."
        ditto -x -k "$RUNTIME/Ollama-darwin.zip" "$RUNTIME" || fail "Ollama could not be unpacked."
        rm -f "$RUNTIME/Ollama-darwin.zip"
      fi
      say "Starting Ollama..."
      "$RUNTIME/Ollama.app/Contents/Resources/ollama" serve >"$RUNTIME/ollama.log" 2>&1 &
      OLLAMA_PID=$!
    fi
  elif command -v ollama >/dev/null 2>&1; then
    say "Starting Ollama..."
    mkdir -p "$RUNTIME"
    ollama serve >"$RUNTIME/ollama.log" 2>&1 &
    OLLAMA_PID=$!
  else
    fail "Ollama isn't installed. On Linux, install it from https://ollama.com/download first."
  fi
  wait_for_ollama || fail "Ollama did not start."
fi
say "Ollama is running."

# Stop the Ollama copy we started when this window closes.
if [ -n "$OLLAMA_PID" ]; then
  trap 'kill "$OLLAMA_PID" 2>/dev/null' EXIT
fi

# ---------- 3. The app ----------
step "Starting Local AI Chat"
say "Your browser will open http://localhost:$PORT"
say "The first time, click the button on that page to download an AI model."
say "Keep this window open while you use the app. Close it to stop the app."
echo

cd "$APP_DIR/chatbot" || fail "the chatbot folder is missing."
"$PYTHON" server.py
