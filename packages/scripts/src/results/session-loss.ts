/**
 * Safari in the iOS Simulator sometimes closes its WebDriver session in the
 * middle of a test file. Then Vitest stops the run, and the files after it do
 * not operate. No test can see this. The CI job of the iOS tests
 * (`.github/scripts/test-ios.sh`) and the results collector operate the tests
 * a second time in this case only. These rules are the same in both.
 */

/** The messages of a lost session in the output of Vitest. */
const SESSION_LOSS : RegExp = /Browser connection was closed while running tests|invalid session id/g;

/** A failed test in the summary of Vitest, or in the list of failed tests. */
const FAILED_TEST = /^ *FAIL |^ *Tests +\d+ failed/m;

/** The output of Vitest has colors. */
function plainText(output : string) : string {
    return output.replace(/\u001b\[[0-9;]*m/g, "");
}

/**
 * The decision for a failed run of the tests: a second run only when the
 * output has a lost session and no failed test. `reason` tells why, for the
 * log of the run.
 */
export function sessionLossRetry(output : string) : { retry : boolean; reason : string } {
    const plain = plainText(output);
    const found = [...new Set(plain.match(SESSION_LOSS) ?? [])].sort();
    if (found.length === 0) return { retry : false, reason : "The run failed, and the session of the browser was not lost." };
    if (FAILED_TEST.test(plain)) {
        return { retry : false, reason : "Safari closed its WebDriver session, but a test also failed. Thus the tests do not operate a second time." };
    }
    return {
        retry : true,
        reason : `Safari in the iOS Simulator closed its WebDriver session (${found.join(";")}), and no test failed. Thus the tests operate a second time.`,
    };
}
