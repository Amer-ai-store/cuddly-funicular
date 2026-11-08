#!/usr/bin/env bash
# Installs the release APK on a running Android emulator, opens key screens via deep
# links, and asserts (1) the app process stays alive, (2) no FATAL EXCEPTION / native
# crash for com.luqta.store in logcat, (3) expected Arabic text is on screen (uiautomator).
# Prints LUQTA_SHOT device-<name> <base64 png> lines and writes evidence to $OUT.
# Usage: tools/device-smoke.sh <apk> <outDir>
set -uo pipefail
APK="$1"; OUT="${2:-device-evidence}"; PKG=com.luqta.store
mkdir -p "$OUT"
fail=0; results=()
adb logcat -c || true
adb install -r -g "$APK" | tee "$OUT/install.txt"
grep -q Success "$OUT/install.txt" || { echo "::error::APK install failed"; exit 1; }
adb shell getprop ro.product.cpu.abilist | tee "$OUT/abilist.txt"

shot() { # name
  adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null || true
  if [ -s "$OUT/$1.png" ]; then
    if command -v convert >/dev/null; then convert "$OUT/$1.png" -resize 360x -quality 55 "$OUT/$1.jpg" && echo "LUQTA_SHOT device-$1 $(base64 -w0 "$OUT/$1.jpg")";
    else echo "LUQTA_SHOT device-$1 $(base64 -w0 "$OUT/$1.png")"; fi
  fi
}
screen_text() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml 2>/dev/null; }
wait_for_text() { # needle seconds
  local end=$((SECONDS + $2))
  while [ $SECONDS -lt $end ]; do screen_text > "$OUT/ui.xml"; grep -q "$1" "$OUT/ui.xml" && return 0; sleep 3; done
  return 1
}
step() { # name url needle wait
  local name="$1" url="$2" needle="$3" wait="${4:-45}"
  if [ "$url" = launch ]; then adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  else adb shell am start -W -a android.intent.action.VIEW -d "$url" "$PKG" >/dev/null 2>&1; fi
  if wait_for_text "$needle" "$wait"; then status=PASS; else status=FAIL; fail=1; fi
  cp "$OUT/ui.xml" "$OUT/$name.xml" 2>/dev/null || true
  adb shell pidof "$PKG" >/dev/null || { status="FAIL(process died)"; fail=1; }
  shot "$name"
  results+=("$status $name ($url) expects '$needle'")
  echo "$status $name"
}
# Cold start can take long under ARM translation; the first wait is generous.
step 01-launch launch "شو بدك" 150
step 02-explore "luqta:///explore" "اكتشف عالمك" 60
step 03-product "luqta:///product/headphones" "أضف إلى السلة" 60
step 04-cart "luqta:///cart" "سلة المشتريات" 60
step 05-smart "luqta:///smart-tools" "أدوات لُقطة الذكية" 60
step 06-game "luqta:///game" "العب واربح" 60
step 07-character "luqta:///character" "تخصيص شخصيتي" 60

adb logcat -d > "$OUT/logcat.txt" 2>/dev/null || true
if grep -qE "AndroidRuntime: Process: $PKG|Fatal signal.*\($PKG|$PKG.*Fatal signal" "$OUT/logcat.txt"; then
  echo "::error::crash found in logcat"; grep -E -A8 "FATAL EXCEPTION|Fatal signal" "$OUT/logcat.txt" | head -60; fail=1
fi
grep -E "ReactNativeJS" "$OUT/logcat.txt" | tail -40 > "$OUT/js-log.txt" || true
printf '%s\n' "${results[@]}" | tee "$OUT/device-report.txt"
exit $fail
