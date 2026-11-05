import { describe, expect, it } from "vitest";
import { actionsRunUrl, resultsStamps } from "./stamp.js";

const URL_OF_RUN = "https://github.com/acme/lag/actions/runs/7";

describe("the data stamp of the results page", () => {
    it("names the newest run, its date, its link and the version of the engine", () => {
        const stamps = resultsStamps({
            runs : [
                { id : "new", createdAt : "2026-11-05T01:20:16.294Z" },
                { id : "old", createdAt : "2026-10-01T00:00:00.000Z" },
            ],
        }, "0.3.0", URL_OF_RUN);
        expect(stamps).toEqual({
            schema : "data-stamp/1",
            pages : [{
                page : "results/index.html",
                runs : [{
                    id : "new",
                    url : URL_OF_RUN,
                    date : "2026-11-05T01:20:16.294Z",
                    engines : { "@mark1russell7/lag" : "0.3.0" },
                }],
            }],
        });
    });

    it("stops the build when the index has no run", () => {
        expect(() => resultsStamps({ runs : [] }, "0.3.0", URL_OF_RUN)).toThrow("no run");
        expect(() => resultsStamps({}, "0.3.0", URL_OF_RUN)).toThrow("no run");
    });
});

describe("the link of a run", () => {
    it("comes from the environment of the run", () => {
        expect(actionsRunUrl({
            GITHUB_SERVER_URL : "https://github.com",
            GITHUB_REPOSITORY : "acme/lag",
            GITHUB_RUN_ID : "7",
        })).toBe(URL_OF_RUN);
    });

    it("stops the build outside a run", () => {
        expect(() => actionsRunUrl({})).toThrow("has none");
    });
});
