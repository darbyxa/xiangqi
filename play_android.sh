#!/data/data/com.termux/files/usr/bin/bash
# ============================================================================
#  Host a Xiangqi game from an Android phone (inside the Termux app).
#  Installs what's missing (Node.js, ngrok), builds the game, starts the server
#  and the ngrok tunnel, then prints the link to share and opens it in your browser.
#
#    bash play_android.sh        host over the internet (ngrok)
#    bash play_android.sh lan    same Wi-Fi only, no ngrok needed
#
#  Games are saved: stop it any time and run it again to carry on.
#  Full walkthrough: README-ANDROID.md
# ============================================================================
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

step() { printf '\n\033[1;33m[%s] %s\033[0m\n' "$1" "$2"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n\n' "$1" >&2; exit 1; }

[[ "${PREFIX:-}" == *com.termux* ]] || die "Run this inside the Termux app (see README-ANDROID.md)."
case "$(pwd -P)" in
  /storage/* | /sdcard/*)
    die "This folder is on shared storage, where npm can't install. Clone it into Termux's home instead:
   cd ~ && git clone https://github.com/darbyxa/xiangqi.git && cd xiangqi && bash play_android.sh" ;;
esac

# ---------------------------------------------------------------- packages
step 1/4 "Termux packages"
need=()
command -v node >/dev/null || need+=(nodejs-lts)
command -v curl >/dev/null || need+=(curl)
command -v tar >/dev/null || need+=(tar)
command -v termux-chroot >/dev/null || need+=(proot)
[ -f "$PREFIX/etc/resolv.conf" ] || need+=(resolv-conf)
[ -f "$PREFIX/etc/tls/cert.pem" ] || need+=(ca-certificates)
if ((${#need[@]})); then
  echo "Installing: ${need[*]}"
  pkg update -y
  pkg install -y "${need[@]}"
fi
# The project needs Node 22.12 or newer
if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)"; then
  echo "Node.js $(node -v) is too old - upgrading..."
  pkg update -y
  if dpkg -s nodejs >/dev/null 2>&1; then pkg install -y nodejs; else pkg install -y nodejs-lts; fi
  node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)" ||
    die "Node.js 22.12+ is needed. Try: pkg uninstall nodejs-lts && pkg install nodejs"
fi
echo "Node.js $(node -v)"

# ------------------------------------------------------------------- ngrok
step 2/4 "ngrok"
NGROK_CFG="$HOME/.config/ngrok/ngrok.yml"
if [ "${1:-}" = "lan" ]; then
  echo "Skipped - same Wi-Fi mode."
  export TUNNEL=none
else
  if ! command -v ngrok >/dev/null; then
    case "$(uname -m)" in
      aarch64 | arm64) arch=arm64 ;;
      armv7l | armv8l | arm*) arch=arm ;;
      x86_64) arch=amd64 ;;
      i686 | i386) arch=386 ;;
      *) die "Unknown CPU $(uname -m) - download ngrok for Linux yourself from https://ngrok.com/download" ;;
    esac
    echo "Downloading ngrok ($arch)..."
    curl -fL --progress-bar -o "$TMPDIR/ngrok.tgz" "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-$arch.tgz"
    tar -xzf "$TMPDIR/ngrok.tgz" -C "$PREFIX/bin"
    chmod +x "$PREFIX/bin/ngrok"
    rm -f "$TMPDIR/ngrok.tgz"
  fi
  # ngrok refuses to start without an account token (one-time setup)
  if ! grep -qs authtoken "$NGROK_CFG"; then
    echo
    echo "ngrok needs your free account's authtoken once."
    echo "Sign up / log in, then copy it from https://dashboard.ngrok.com/get-started/your-authtoken"
    read -r -p "Paste it here and press Enter: " token
    [ -n "$token" ] || die "No authtoken - ngrok can't start without one. Run this again when you have it."
    ngrok config add-authtoken "$token" --config "$NGROK_CFG"
  fi
  # ngrok is a prebuilt Linux program: on Android it can't find DNS or the certificate store by itself.
  # termux-chroot gives it a normal-looking /etc (resolv.conf), SSL_CERT_FILE points it at the certificates.
  export NGROK_WRAPPER=termux-chroot NGROK_CONFIG="$NGROK_CFG" SSL_CERT_FILE="$PREFIX/etc/tls/cert.pem"
  echo "ngrok is ready"
fi

# ------------------------------------------------------------- build & run
step 3/4 "Installing and building the game (the first run takes a few minutes)"
npm install --no-audit --no-fund
npm run build

step 4/4 "Starting"
# Keep the CPU awake while the game is hosted, so Android doesn't freeze the server when the screen is off.
command -v termux-wake-lock >/dev/null && termux-wake-lock
trap 'command -v termux-wake-unlock >/dev/null && termux-wake-unlock' EXIT
node scripts/host.mjs
