type Listener<Value> = (value: Value) => void;

/** Holds a current value and synchronously notifies subscribers when it changes. */
export class ReactiveValue<Value> {
	private current: Value;
	private readonly listeners = new Set<Listener<Value>>();

	constructor(initialValue: Value) {
		this.current = initialValue;
	}

	get value(): Value {
		return this.current;
	}

	set(value: Value): void {
		this.current = value;
		for (const listener of [...this.listeners]) {
			listener(value);
		}
	}

	subscribe(listener: Listener<Value>): () => void {
		this.listeners.add(listener);
		listener(this.current);
		return () => this.listeners.delete(listener);
	}
}
