#!/usr/bin/env bash
# Boots the newest available iPhone simulator, waits until it is ready, and
# writes its UDID to $GITHUB_ENV as LAG_IOS_UDID. The iOS project of the
# browser tests (LAG_IOS=1) connects to that simulator through safaridriver.
set -euo pipefail
UDID=$(xcrun simctl list devices available -j | python3 -c "
import json, sys
devices = json.load(sys.stdin)['devices']
phones = [(runtime, d['name'], d['udid']) for runtime, items in devices.items() if 'iOS' in runtime for d in items if d['name'].startswith('iPhone')]
print(sorted(phones)[-1][2])")
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b
xcrun simctl list devices booted
# The first launch of Safari in a new simulator is slow. safaridriver then can time out
# while it waits for Safari. Thus launch Safari one time before the tests.
xcrun simctl launch "$UDID" com.apple.mobilesafari || true
sleep 20
xcrun simctl terminate "$UDID" com.apple.mobilesafari || true
echo "LAG_IOS_UDID=$UDID" >> "$GITHUB_ENV"
