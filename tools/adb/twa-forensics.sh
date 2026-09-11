#!/bin/bash
# TWA / Play Billing forensics snapshot for app.fivebudget (A18).
#
# Why this exists: logcat's main/system ring buffers roll over in MINUTES, so
# the launch-time TWA/DAL verdict is gone by the time anyone thinks to look.
# This clears and sizes the buffers first, then captures only what matters.
#
# Usage:  tools/adb/twa-forensics.sh start <tag>   # clears buffers, then
#         (fully close the app and relaunch it ON THE PHONE)
#         tools/adb/twa-forensics.sh stop  <tag>  # writes every artifact
#
# Artifacts land in $FORENSICS_OUT (default /tmp/twa-forensics/<tag>) — NOT in
# the repo, because `.smoke/` is wiped by `npm test`.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
ADB="$here/adb.sh"
MODE="${1:-start}"
TAG="${2:-run}"
DIR="${FORENSICS_OUT:-/tmp/twa-forensics}/$TAG"
PKG=app.fivebudget

case "$MODE" in
start)
  mkdir -p "$DIR"
  "$ADB" logcat -c -b all 2>/dev/null || "$ADB" logcat -c 2>/dev/null
  "$ADB" logcat -G 16M >/dev/null 2>&1 || true
  echo "buffers cleared; now FULLY CLOSE the app and relaunch it on the phone"
  ;;
stop)
  mkdir -p "$DIR"
  "$ADB" logcat -b all -d -v threadtime > "$DIR/logcat-all.txt" 2>/dev/null
  # package identity: installed cert, installer, version, and Android's OWN
  # pre-verified-links verdict (`Domain verification state`, 1024 = FAILURE)
  "$ADB" shell dumpsys package "$PKG" > "$DIR/dumpsys-package.txt" 2>/dev/null
  "$ADB" shell dumpsys activity activities > "$DIR/dumpsys-activity.txt" 2>/dev/null
  "$ADB" shell pm path "$PKG" > "$DIR/pm-path.txt" 2>/dev/null
  # The lines that actually name the fault. npm test wipes .smoke, so keep
  # the greps here rather than in a throwaway directory.
  grep -inE "TWAProviderPicker|TwaLauncher|TWALauncherActivity|cr_ChromeConnection|digital_asset_links|content_relationship_verification|AppStoreBilling|unsupported context|customtabs" \
    "$DIR/logcat-all.txt" > "$DIR/verdict.txt" 2>/dev/null
  grep -iE "versionName|versionCode|installerPackageName|firstInstallTime|lastUpdateTime|Signatures" \
    "$DIR/dumpsys-package.txt" > "$DIR/identity.txt" 2>/dev/null
  grep -A6 "Domain verification state" "$DIR/dumpsys-package.txt" > "$DIR/domain-verification.txt" 2>/dev/null
  echo "--- identity ---"; cat "$DIR/identity.txt"
  echo "--- domain verification (1024 = FAILURE) ---"; cat "$DIR/domain-verification.txt"
  echo "--- hosting activity ---"
  grep -E "ResumedActivity|topResumedActivity|CustomTabActivity|LauncherActivity|WebappActivity" \
    "$DIR/dumpsys-activity.txt" | head -6
  echo "--- verdict ---"; cat "$DIR/verdict.txt"
  echo "artifacts: $DIR"
  ;;
*)
  echo "usage: $0 {start|stop} <tag>" >&2
  exit 2
  ;;
esac
