/**
 * The order of the setups in each round. The load of the machine can change
 * during a run. Thus each round has a different order: the first rounds
 * rotate the list (A B C D, B C D A, ...), and the next rounds rotate the
 * list in the opposite direction (D C B A, ...).
 */
export function roundOrder<T>(items : readonly T[], round : number) : T[] {
    const n = items.length;
    if (n === 0) return [];
    const shift = round % n;
    const rotated = [...items.slice(shift), ...items.slice(0, shift)];
    return Math.floor(round / n) % 2 === 1 ? rotated.reverse() : rotated;
}
