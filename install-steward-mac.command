#!/bin/bash
# Steward installer for Mac.
# Double-click this file in Finder. It opens a Terminal window and
# talks you through everything in plain sentences.

cd "$(dirname "$0")" || exit 1
REPO="$PWD"

say() { printf '%s\n' "$*"; }
wait_close() { printf '\nPress Return to close this window.\n'; read -r _ || true; }

# ask_yes "Question" -> returns 0 for yes (the default), 1 for no.
ask_yes() {
  local ans=""
  printf '%s Press Enter for Yes, or type N for No: ' "$1"
  read -r ans || ans=""
  case "$ans" in
    n|N|no|No|NO) return 1 ;;
    *) return 0 ;;
  esac
}

# node_major -> prints the major version of Node.js, or nothing.
node_major() {
  command -v node >/dev/null 2>&1 || return 0
  local v
  v="$(node --version 2>/dev/null)" || return 0
  v="${v#v}"
  printf '%s' "${v%%.*}"
}

say ""
say "============================================================"
say "  Welcome to the Steward installer"
say "============================================================"
say ""
say "This will set Steward up on this Mac. It takes a few"
say "minutes, and you do not need to know anything technical."
say "Just read each message and follow along."
say ""
say "If you have run this installer before, that is fine - it"
say "simply freshens everything up and keeps all of your"
say "information exactly as it was."
say ""

# ---------------------------------------------------------------
# Step 1 of 5: Steward runs on a free program called Node.js,
# version 22 or newer. Check whether it is already here.
# ---------------------------------------------------------------
say "Step 1 of 5: Checking that this Mac has what Steward needs..."

MAJOR="$(node_major)"
case "$MAJOR" in ''|*[!0-9]*) MAJOR=0 ;; esac

if [ "$MAJOR" -lt 22 ]; then
  say ""
  say "Steward needs a free program called Node.js, version 22 or"
  say "newer, and this Mac does not have it yet."
  say ""
  if command -v brew >/dev/null 2>&1; then
    say "The good news: this Mac has Homebrew, a helper that can"
    say "install it for you. This can take a few minutes."
    say ""
    if brew install node@22 || brew install node; then
      # Node 22 from Homebrew is "keg-only": link it so the
      # plain "node" command works from now on.
      brew link --overwrite --force node@22 >/dev/null 2>&1 || true
      BREW_NODE="$(brew --prefix node@22 2>/dev/null || true)"
      if [ -n "$BREW_NODE" ] && [ -x "$BREW_NODE/bin/node" ]; then
        PATH="$BREW_NODE/bin:$PATH"
        export PATH
      fi
      MAJOR="$(node_major)"
      case "$MAJOR" in ''|*[!0-9]*) MAJOR=0 ;; esac
    fi
    if [ "$MAJOR" -lt 22 ]; then
      say ""
      say "Something did not quite work while installing Node.js."
      say "Nothing has been changed on your Mac. You can close this"
      say "window, check your internet connection, and double-click"
      say "this installer again. If it keeps failing, install"
      say "Node.js from https://nodejs.org and then run this"
      say "installer again - it will pick up where it left off."
      wait_close
      exit 1
    fi
  else
    say "Node.js needs to be installed by hand. It only takes a"
    say "few clicks:"
    say "  1. Go to https://nodejs.org in your web browser."
    say "  2. Download the version marked LTS and run the"
    say "     download, accepting the usual choices."
    say "  3. When it finishes, double-click this installer again."
    say "Nothing you have done so far will be lost."
    wait_close
    exit 0
  fi
fi
say "Node.js is ready."
say ""

# ---------------------------------------------------------------
# Step 2 of 5: install Steward's parts from the list in this folder.
# ---------------------------------------------------------------
say "Step 2 of 5: Installing Steward's parts. This can take a"
say "few minutes - it is safe to leave it running."
if ! npm install; then
  say ""
  say "Something went wrong while installing Steward's parts."
  say "Your information has not been touched. The usual cause is"
  say "a lost internet connection - check it and double-click this"
  say "installer again. It will pick up where it left off."
  wait_close
  exit 1
fi
say "Done."
say ""

# ---------------------------------------------------------------
# Step 3 of 5: the "data" folder holds everything Steward
# remembers, and start-steward.sh is the button that runs Steward.
# ---------------------------------------------------------------
say "Step 3 of 5: Setting up Steward's home in this folder..."
mkdir -p data

cat > start-steward.sh <<'EOS'
#!/bin/bash
# Starts Steward. Keep this window open while you use Steward;
# close the window to stop Steward.
cd "$(dirname "$0")" || exit 1

# Node.js can live in a few places on a Mac; look in all of them,
# because a fresh login window starts with a very short list.
for d in /opt/homebrew/bin /usr/local/bin "$HOME/.nvm/versions/node"/*/bin; do
  if [ -d "$d" ]; then
    PATH="$d:$PATH"
  fi
done
export PATH

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Steward needs a free program called Node.js, and it seems"
  echo "to be missing. Please double-click the Steward installer"
  echo "in this folder - it will sort this out for you."
  echo ""
  exit 1
fi

mkdir -p data
export STEWARD_DB="$PWD/data/steward.db"

echo ""
echo "Steward is starting. Your web browser will open at the"
echo "Steward page in a few seconds. If it does not, type this"
echo "into your browser: http://localhost:4173"
echo ""
echo "Please keep this window open while you use Steward."
echo "To stop Steward, close this window."
echo ""

if [ -z "$STEWARD_NO_BROWSER" ]; then
  ( sleep 4; open "http://localhost:4173" ) &
fi

npm run console

echo ""
echo "Steward has stopped. You can close this window now."
EOS
chmod +x start-steward.sh
say "Done."
say ""

# ---------------------------------------------------------------
# Step 4 of 5: a launcher on the desktop, so Steward is one
# double-click away from now on.
# ---------------------------------------------------------------
say "Step 4 of 5: Putting a Steward launcher on your desktop..."
DESKTOP="$HOME/Desktop"
if [ -d "$DESKTOP" ]; then
  cat > "$DESKTOP/Steward.command" <<EOF
#!/bin/bash
# Starts Steward. Installed by the Steward installer.
exec "$REPO/start-steward.sh"
EOF
  chmod +x "$DESKTOP/Steward.command"
  say "Done - look for \"Steward\" on your desktop."
else
  say "There is no desktop folder to put it in, but that is not a"
  say "problem: you can always start Steward by double-clicking"
  say "start-steward.sh in this folder."
fi
say ""

# ---------------------------------------------------------------
# Step 5 of 5: one choice - should Steward start by itself
# each time this Mac is logged on to?
# ---------------------------------------------------------------
say "Step 5 of 5: One last choice."
say ""
if ask_yes "Should Steward start by itself each time you log on to this Mac?"; then
  mkdir -p "$HOME/Library/LaunchAgents" data
  REPO_XML="$(printf '%s' "$REPO" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')"
  cat > "$HOME/Library/LaunchAgents/com.steward.console.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.steward.console</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO_XML/start-steward.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>STEWARD_NO_BROWSER</key>
    <string>1</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$REPO_XML/data/steward-autostart.log</string>
  <key>StandardErrorPath</key>
  <string>$REPO_XML/data/steward-autostart.log</string>
</dict>
</plist>
EOF
  say "Done. Steward will now start by itself each time you log"
  say "on, beginning with your next login. If you change your"
  say "mind, delete the file com.steward.console.plist from the"
  say "Library/LaunchAgents folder in your home folder - your"
  say "information is never touched by that."
else
  say "No problem. Steward will only run when you open it from"
  say "the desktop launcher."
fi
say ""

# ---------------------------------------------------------------
# All finished. Offer to start Steward right away.
# ---------------------------------------------------------------
say "============================================================"
say "  Steward is installed."
say "============================================================"
say ""
say "From now on, start Steward with the Steward launcher on"
say "your desktop. Everything Steward remembers lives in the"
say "\"data\" folder next to this installer, it stays on this"
say "computer, and it belongs to you."
say ""
if ask_yes "Would you like to start Steward now?"; then
  say "Steward is starting - look for it in your web browser."
  say "When you are finished, close Steward's window to stop it."
  ./start-steward.sh
else
  say "Whenever you are ready, double-click the Steward launcher"
  say "on your desktop."
fi

wait_close
exit 0
