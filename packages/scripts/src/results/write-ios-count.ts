/**
 * This script counts the failures of the iOS simulator job of the last days, and writes the count to the summary of
 * the workflow run. When the count holds a failure or a wrong record, the script opens one issue, so a person reads it.
 */
import { appendFileSync } from "node:fs";
import { countIosAttempts, IOS_JOB, needsIssue, readIosLog, renderIosCount, type IosAttempt } from "./ios-count.js";

const DAYS = 7;
const CI_WORKFLOW = "ci.yml";
const MAX_PAGES = 5;

const token = process.env["GITHUB_TOKEN"];
const repo = process.env["GITHUB_REPOSITORY"];
if (!token || !repo) throw new Error("The script needs GITHUB_TOKEN and GITHUB_REPOSITORY.");

const headers = { Authorization : `Bearer ${token}`, Accept : "application/vnd.github+json", "X-GitHub-Api-Version" : "2022-11-28" };

const api = async (path : string) : Promise<Response> => fetch(`https://api.github.com/repos/${repo}/${path}`, { headers });

const json = async <T>(path : string) : Promise<T> => {
    const response = await api(path);
    if (!response.ok) throw new Error(`GitHub gave ${response.status} for ${path}.`);
    return (await response.json()) as T;
};

type Run = { id : number; run_attempt : number };
type Job = { id : number; name : string; conclusion : string | null; html_url : string };

const since = new Date(Date.now() - DAYS * 86_400_000).toISOString().slice(0, 10);
const runs : Run[] = [];
for (let page = 1; page <= MAX_PAGES; page++) {
    const { workflow_runs : found } = await json<{ workflow_runs : Run[] }>(`actions/workflows/${CI_WORKFLOW}/runs?created=%3E%3D${since}&per_page=100&page=${page}`);
    runs.push(...found);
    if (found.length < 100) break;
}

const attempts : IosAttempt[] = [];
let unread = 0;
const seen = new Set<number>();
for (const run of runs) {
    for (let number = 1; number <= run.run_attempt; number++) {
        const { jobs } = await json<{ jobs : Job[] }>(`actions/runs/${run.id}/attempts/${number}/jobs?per_page=100`);
        for (const job of jobs) {
            if (job.name !== IOS_JOB || seen.has(job.id) || (job.conclusion !== "success" && job.conclusion !== "failure")) continue;
            seen.add(job.id);
            const response = await api(`actions/jobs/${job.id}/logs`);
            if (!response.ok) {
                unread++;
                continue;
            }
            attempts.push({ ...readIosLog(await response.text()), conclusion : job.conclusion, url : job.html_url });
        }
    }
}

const count = countIosAttempts(attempts, unread);
const text = renderIosCount(count, DAYS);
console.log(text);
const summary = process.env["GITHUB_STEP_SUMMARY"];
if (summary) appendFileSync(summary, `${text}\n`);

if (needsIssue(count)) {
    const title = `iOS simulator count: ${count.failedAttempts} failed, ${count.wrong.length} wrong records, in the week to ${new Date().toISOString().slice(0, 10)}`;
    const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method : "POST",
        headers,
        body : JSON.stringify({ title, body : text }),
    });
    if (!response.ok) throw new Error(`GitHub gave ${response.status} for the issue.`);
}
