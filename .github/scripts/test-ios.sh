#!/usr/bin/env bash
# Operates the browser tests in Safari on iOS (pnpm run test:ios) in the
# current folder, and operates them a second time in one case only.
#
# Safari in the iOS Simulator sometimes closes its WebDriver session in the
# middle of a test file. Then Vitest stops the run with "Browser connection
# was closed while running tests" and "invalid session id", and the files
# after it do not operate. No test can see this. Thus, if the run failed, its
# output has one of these messages, and no test failed, the script operates
# the tests one more time with a new safaridriver and a new Safari. It shows a
# warning with the reason. All other failures fail the step at once, and the
# second run gets no third run.
set -uo pipefail

SESSION_LOSS='Browser connection was closed while running tests|invalid session id'
# A failed test in the summary of Vitest, or in the list of failed tests
FAILED_TEST='^ *FAIL |^ *Tests +[0-9]+ failed'

log=$(mktemp)
pnpm run test:ios 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -eq 0 ]; then
  exit 0
fi

# The output of Vitest has colors
plain=$(perl -pe 's/\e\[[0-9;]*m//g' "$log")
if ! grep -qE "$SESSION_LOSS" <<<"$plain"; then
  exit "$status"
fi
if grep -qE "$FAILED_TEST" <<<"$plain"; then
  echo "::error title=iOS tests::Safari closed its WebDriver session, but a test also failed. Thus the tests do not operate a second time."
  exit "$status"
fi

found=$(grep -oE "$SESSION_LOSS" <<<"$plain" | sort -u | paste -sd ';' -)
reason="Safari in the iOS Simulator closed its WebDriver session ($found), and no test failed. Thus the tests operate a second time, with a new safaridriver and a new Safari."
echo "::warning title=iOS tests: second run::$reason"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '### iOS tests: second run\n\n%s\n' "$reason" >> "$GITHUB_STEP_SUMMARY"
fi

# The safaridriver of the first run continues after Vitest stops, and it can keep the session of the simulator
pkill -x safaridriver || true
xcrun simctl terminate "${LAG_IOS_UDID:-booted}" com.apple.mobilesafari || true
sleep 5

echo "========== Second run of the iOS tests: $reason"
pnpm run test:ios
status=$?
echo "========== The second run of the iOS tests ended with exit code $status"
exit "$status"
