#!/bin/bash
# Steward installer for Linux.
# Run it from a terminal - or double-click it if your file
# manager offers to run it - and it talks you through everything
# in plain sentences.

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
say "This will set Steward up on this computer. It takes a few"
say "minutes, and you do not need to know anything technical."
say "Just read each message and follow along."
say ""
say "If you have run this installer before, that is fine - it"
say "simply freshens everything up and keeps all of your"
say "information exactly as it was."
say ""

# ---------------------------------------------------------------
# Step 1 of 5: Steward runs on a free program called Node.js,
# version 22 or newer. Unlike Windows and Mac there is no single
# safe automatic way to add it on every kind of Linux, so if it
# is missing we explain exactly where to get it and stop.
# ---------------------------------------------------------------
say "Step 1 of 5: Checking that this computer has what Steward needs..."

MAJOR="$(node_major)"
case "$MAJOR" in ''|*[!0-9]*) MAJOR=0 ;; esac

if [ "$MAJOR" -lt 22 ]; then
  say ""
  say "Steward needs a free program called Node.js, version 22 or"
  say "newer, and this computer does not have it yet."
  say ""
  say "On Linux there is no single safe way for this installer to"
  say "add it for you, so it needs to be installed by hand. It"
  say "only takes a few minutes:"
  say "  1. Go to https://nodejs.org in your web browser."
  say "  2. Download the Linux version marked LTS and follow the"
  say "     instructions that come with it - or ask whoever helps"
  say "     you with this computer to install Node.js 22 or newer."
  say "  3. When it is installed, run this installer again."
  say "Nothing you have done so far will be lost."
  wait_close
  exit 0
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
  say "a lost internet connection - check it and run this"
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

# Node.js can live in a few places; look in all of them, because
# an automatic start at login begins with a very short list.
for d in /usr/local/bin "$HOME/.nvm/versions/node"/*/bin "$HOME/.volta/bin" "$HOME/.local/bin"; do
  if [ -d "$d" ]; then
    PATH="$d:$PATH"
  fi
done
export PATH

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Steward needs a free program called Node.js, and it seems"
  echo "to be missing. Please run the Steward installer in this"
  echo "folder - it will sort this out for you."
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

if [ -z "$STEWARD_NO_BROWSER" ] && command -v xdg-open >/dev/null 2>&1; then
  ( sleep 4; xdg-open "http://localhost:4173" >/dev/null 2>&1 || true ) &
fi

npm run console

echo ""
echo "Steward has stopped. You can close this window now."
EOS
chmod +x start-steward.sh
say "Done."
say ""

# ---------------------------------------------------------------
# Step 4 of 5: a launcher on the desktop, where a desktop
# folder exists, so Steward is one double-click away.
# ---------------------------------------------------------------
say "Step 4 of 5: Putting a Steward launcher on your desktop..."

DESKTOP=""
if command -v xdg-user-dir >/dev/null 2>&1; then
  DESKTOP="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
fi
if [ -z "$DESKTOP" ] || [ ! -d "$DESKTOP" ]; then
  DESKTOP="$HOME/Desktop"
fi

write_desktop_file() {
  # $1 = full path of the .desktop file to write
  cat > "$1" <<EOF
[Desktop Entry]
Type=Application
Name=Steward
Comment=Start Steward
Exec="$REPO/start-steward.sh"
Terminal=true
X-GNOME-Autostart-enabled=true
EOF
  chmod +x "$1"
}

if [ -d "$DESKTOP" ]; then
  write_desktop_file "$DESKTOP/Steward.desktop"
  say "Done - look for \"Steward\" on your desktop."
else
  say "There is no desktop folder to put it in, but that is not a"
  say "problem: you can always start Steward by running"
  say "start-steward.sh in this folder."
fi
say ""

# ---------------------------------------------------------------
# Step 5 of 5: one choice - should Steward start by itself
# each time this computer is logged on to? Prefer a proper
# systemd user service; fall back to an autostart entry.
# ---------------------------------------------------------------
say "Step 5 of 5: One last choice."
say ""
if ask_yes "Should Steward start by itself each time you log on to this computer?"; then
  AUTO_OK=""
  if command -v systemctl >/dev/null 2>&1; then
    SVC_DIR="$HOME/.config/systemd/user"
    mkdir -p "$SVC_DIR"
    cat > "$SVC_DIR/steward.service" <<EOF
[Unit]
Description=Steward personal agent console
After=network.target

[Service]
Type=simple
WorkingDirectory=$REPO
ExecStart=/bin/bash "$REPO/start-steward.sh"
Environment=STEWARD_NO_BROWSER=1
Restart=on-failure

[Install]
WantedBy=default.target
EOF
    if systemctl --user daemon-reload >/dev/null 2>&1 && systemctl --user enable steward.service >/dev/null 2>&1; then
      AUTO_OK="systemd"
    else
      rm -f "$SVC_DIR/steward.service"
      systemctl --user daemon-reload >/dev/null 2>&1 || true
    fi
  fi
  if [ -z "$AUTO_OK" ]; then
    mkdir -p "$HOME/.config/autostart"
    write_desktop_file "$HOME/.config/autostart/steward.desktop"
    AUTO_OK="autostart"
  fi
  if [ "$AUTO_OK" = "systemd" ]; then
    say "Done. Steward will now start by itself when you log on,"
    say "beginning with your next login. To change your mind later,"
    say "the setting lives in a file called steward.service in the"
    say ".config/systemd/user folder in your home folder - removing"
    say "it never touches your information."
  else
    say "Done. Steward will now start by itself when you log on,"
    say "beginning with your next login. To change your mind later,"
    say "delete the file steward.desktop from the .config/autostart"
    say "folder in your home folder - that never touches your"
    say "information."
  fi
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
