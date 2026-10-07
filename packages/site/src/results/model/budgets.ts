import type { BudgetResult, RunReport } from "../../adapters/lag-report";

export type BudgetRow = BudgetResult & {
    /** `limit - value`: how much room is left. Negative if the budget fails. */
    margin : number;
};

/** The budgets, the failed ones first. */
export function budgetRows(run : RunReport) : BudgetRow[] {
    return run.budgets
        .map(budget => ({ ...budget, margin : budget.limit - budget.value }))
        .sort((a, b) => Number(a.pass) - Number(b.pass) || a.name.localeCompare(b.name));
}

export function budgetCounts(run : RunReport) : { pass : number; fail : number } {
    const pass = run.budgets.filter(budget => budget.pass).length;
    return { pass, fail : run.budgets.length - pass };
}
