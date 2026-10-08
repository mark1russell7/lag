/** A fixed-size buffer that keeps the newest items. A push to a full buffer drops the oldest item. */
export class RingBuffer<T> {
    private readonly items : Array<T | undefined>;
    private start = 0;
    private count = 0;

    constructor(readonly capacity : number) {
        if (!Number.isInteger(capacity) || capacity < 1) {
            throw new RangeError("The capacity must be a positive integer.");
        }
        this.items = new Array<T | undefined>(capacity);
    }

    get size() : number {
        return this.count;
    }

    push(item : T) : void {
        const index = (this.start + this.count) % this.capacity;
        this.items[index] = item;
        if (this.count < this.capacity) {
            this.count++;
        } else {
            this.start = (this.start + 1) % this.capacity;
        }
    }

    /** The items from the oldest to the newest. */
    toArray() : T[] {
        const result : T[] = [];
        for (let offset = 0; offset < this.count; offset++) {
            result.push(this.items[(this.start + offset) % this.capacity] as T);
        }
        return result;
    }

    /** The newest items for which `keep` is true, from the oldest to the newest. It stops at the first item that fails. */
    newest(keep : (item : T) => boolean) : T[] {
        const result : T[] = [];
        for (let offset = this.count - 1; offset >= 0; offset--) {
            const item = this.items[(this.start + offset) % this.capacity] as T;
            if (!keep(item)) break;
            result.push(item);
        }
        return result.reverse();
    }

    latest() : T | undefined {
        return this.count === 0 ? undefined : this.items[(this.start + this.count - 1) % this.capacity];
    }

    clear() : void {
        this.items.fill(undefined);
        this.start = 0;
        this.count = 0;
    }
}
