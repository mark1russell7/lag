/**
 * This module makes the data stamp of the results page. The stamp names the run that measured the data,
 * the date of that run and the version of the engine. The freshness gate of the Pages workflow reads the stamp.
 * The module does no I/O, so the unit tests can use every function.
 */

/** The parts of the index of the results that the stamp reads. */
export interface StampIndex {
    readonly runs? : readonly { readonly id : string; readonly createdAt : string }[];
}

/** The content of the file `data-stamps.json`, in the format `data-stamp/1`. */
export interface DataStamps {
    readonly schema : "data-stamp/1";
    readonly pages : readonly {
        readonly page : string;
        readonly runs : readonly {
            readonly id : string;
            readonly url : string;
            readonly date : string;
            readonly engines : Readonly<Record<string, string>>;
        }[];
    }[];
}

/** The page that shows the runs. */
export const RESULTS_PAGE = "results/index.html";

/** The package that the runs measure. */
export const ENGINE = "@mark1russell7/lag";

/** This function gives the link of a run of GitHub Actions from the environment of that run. */
export function actionsRunUrl(env : Readonly<Record<string, string | undefined>>) : string {
    const { GITHUB_SERVER_URL : server, GITHUB_REPOSITORY : repository, GITHUB_RUN_ID : run } = env;
    if (!server || !repository || !run) {
        throw new Error("The data stamp names a run of GitHub Actions, and this environment has none.");
    }
    return `${server}/${repository}/actions/runs/${run}`;
}

/**
 * This function makes the stamp from the newest run of the index. An empty index is an error: a stamp with no
 * run tells nothing, so the build stops.
 */
export function resultsStamps(index : StampIndex, version : string, url : string) : DataStamps {
    const newest = [...(index.runs ?? [])].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).at(-1);
    if (newest === undefined) {
        throw new Error("The index of the results has no run, so the data stamp has no run to name.");
    }
    return {
        schema : "data-stamp/1",
        pages : [{
            page : RESULTS_PAGE,
            runs : [{ id : newest.id, url, date : newest.createdAt, engines : { [ENGINE] : version } }],
        }],
    };
}
