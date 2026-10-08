import { ScrollTable } from "../../components/ScrollTable/ScrollTable";
import { StatusIcon } from "../../components/StatusIcon/StatusIcon";
import { formatNumber } from "../../lib/format";
import { EmptySection } from "../components/States";
import { budgetCounts, budgetRows } from "../model/budgets";
import { useRunContext } from "./run-context";
import styles from "./Results.module.css";

function withUnit(value : number, unit : string) : string {
    return unit === "%" ? `${formatNumber(value, 2)}%` : `${formatNumber(value, 2)} ${unit}`;
}

/** The performance budgets of a run, the failed ones first. */
export function BudgetsView() {
    const { run } = useRunContext();
    if (run.budgets.length === 0) return <EmptySection text="This run has no budgets." />;

    const rows = budgetRows(run);
    const { pass, fail } = budgetCounts(run);
    return (
        <section className={styles.block} aria-labelledby="budgets-heading">
            <h2 id="budgets-heading">Budgets</h2>
            <p className={styles.lead}>
                {fail === 0
                    ? `All ${rows.length} budgets pass.`
                    : `${pass} of ${rows.length} budgets pass. ${fail} ${fail === 1 ? "budget fails" : "budgets fail"}.`}
                {" "}A budget passes if its value is at or below its limit.
            </p>
            <ScrollTable label="Budgets">
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th scope="col">Result</th>
                            <th scope="col">Budget</th>
                            <th scope="col" data-align="right">Value</th>
                            <th scope="col" data-align="right">Limit</th>
                            <th scope="col" data-align="right">Room left</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(row => (
                            <tr key={row.name} data-status={row.pass ? "pass" : "fail"}>
                                <td><StatusIcon kind={row.pass ? "pass" : "fail"} /></td>
                                <th scope="row">{row.name}</th>
                                <td data-align="right">{withUnit(row.value, row.unit)}</td>
                                <td data-align="right">{withUnit(row.limit, row.unit)}</td>
                                <td data-align="right">{withUnit(row.margin, row.unit)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </ScrollTable>
        </section>
    );
}
