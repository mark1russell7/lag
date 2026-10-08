/**
 * The only module of the site that uses `@lag/report`, the data contract of
 * the test reports. The results viewer imports these names from here.
 */
export { SCHEMA_VERSION, countStatuses, summarizeRun } from "@lag/report";
export type {
    BudgetResult,
    CoverageCounts,
    CoverageReport,
    Environment,
    FileCoverage,
    GitInfo,
    Measurement,
    MutantStatus,
    MutationFile,
    MutationReport,
    RunIndex,
    RunReport,
    RunSummary,
    StatusCounts,
    SuiteKind,
    SuiteResult,
    TestCaseResult,
    TestFileResult,
    TestStatus,
} from "@lag/report";
