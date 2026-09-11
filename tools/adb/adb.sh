#!/bin/bash
# Thin adb wrapper for the budget repo.
#
# Two environment traps, both of which abort adb outright:
#   1. The DSH file sandbox blocks $HOME, so `adb` aborts with
#      `Cannot mkdir '/Users/<user>/.android': Operation not permitted`.
#   2. `ANDROID_USER_HOME` alone is NOT enough — adb 37.0.1 still reads $HOME
#      for its own dir. BOTH must point at a writable path.
#
# Note: do not keep this in `.smoke/` — that directory is the vite test build's
# outDir (`npm test`) and is wiped on every run.
export HOME=/tmp/adbhome
export ANDROID_USER_HOME=/tmp/adbhome
mkdir -p /tmp/adbhome
exec /tmp/pt/platform-tools/adb "$@"
