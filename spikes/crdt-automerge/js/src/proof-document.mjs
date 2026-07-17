import * as Automerge from "@automerge/automerge";
import { createHash } from "node:crypto";

/**
 * Project-owned JavaScript boundary used only by the V2-02 Automerge proof.
 */
export class ProofDocument {
  #document;

  constructor(document) {
    this.#document = document;
  }

  /** Create a CRDT document without exposing Automerge types to callers. */
  static fromSnapshot(snapshot, actor) {
    return new ProofDocument(Automerge.from(snapshot, actorId(actor)));
  }

  /** Load a compact Automerge document and assign a local actor. */
  static load(bytes, actor) {
    return new ProofDocument(Automerge.load(bytes, actorId(actor)));
  }

  /** Return the stable JSON projection consumed by Inkfinite. */
  snapshot() {
    return JSON.parse(JSON.stringify(this.#document));
  }

  /** Return causal heads without exposing the mutable document. */
  heads() {
    return [...Automerge.getHeads(this.#document)].sort();
  }

  /** Return the actor ID used for subsequent local changes. */
  actorId() {
    return Automerge.getActorId(this.#document);
  }

  /** Save the compact binary representation. */
  save() {
    return Automerge.save(this.#document);
  }

  /** Save changes not emitted by previous incremental saves. */
  saveIncremental() {
    return Automerge.saveIncremental(this.#document);
  }

  /** Fork the current state for an independently identified replica. */
  fork(actor) {
    return new ProofDocument(Automerge.clone(this.#document, actorId(actor)));
  }

  /** Apply changes from another replica and collect incremental patches. */
  merge(other) {
    const patches = [];
    const changes = Automerge.getChanges(this.#document, other.#document);
    [this.#document] = Automerge.applyChanges(this.#document, changes, {
      patchCallback: (nextPatches) => patches.push(...nextPatches),
    });
    return this.#summary(patches);
  }

  /** Set one scalar property as one named change. */
  setScalar(path, value, message) {
    return this.#change(message, (draft) => {
      const [parent, property] = parentAt(draft, path);
      parent[property] = value;
    });
  }

  /** Set a scalar and retain the inverse data for actor-scoped undo. */
  setScalarWithUndo(path, value, message) {
    const before = valueAt(this.#document, path);
    const summary = this.setScalar(path, value, message);
    return { summary, undo: { path: [...path], before, after: value } };
  }

  /** Apply a compensating local change if concurrent work did not replace it. */
  undo(record) {
    if (!deepEqual(valueAt(this.#document, record.path), record.after)) return null;
    return this.setScalar(record.path, record.before, "actor-scoped undo");
  }

  /** Insert a scalar into an ordered child list. */
  listInsert(path, index, value, message) {
    return this.#change(message, (draft) => valueAt(draft, path).splice(index, 0, value));
  }

  /** Remove an item from an ordered child list. */
  listDelete(path, index, message) {
    return this.#change(message, (draft) => valueAt(draft, path).splice(index, 1));
  }

  /** Splice collaborative text. */
  textSplice(path, index, remove, text, message) {
    return this.#change(message, (draft) => Automerge.splice(draft, path, index, remove, text));
  }

  /** Delete a map record. */
  deleteRecord(path, message) {
    return this.#change(message, (draft) => {
      const [parent, property] = parentAt(draft, path);
      delete parent[property];
    });
  }

  #change(message, callback) {
    const patches = [];
    this.#document = Automerge.change(this.#document, {
      message,
      patchCallback: (nextPatches) => patches.push(...nextPatches),
    }, callback);
    return this.#summary(patches);
  }

  #summary(patches) {
    return { heads: this.heads(), patchCount: patches.length };
  }

  /** @internal Replace the wrapped document after a sync receive. */
  static _replace(proof, document) {
    proof.#document = document;
  }

  /** @internal Read the wrapped document for transport-independent sync calls. */
  static _read(proof) {
    return proof.#document;
  }
}

/** Exchange sync messages until neither replica has more to send. */
export function synchronize(left, right) {
  let leftState = Automerge.initSyncState();
  let rightState = Automerge.initSyncState();
  for (let round = 0; round < 100; round += 1) {
    const [nextLeftState, leftMessage] = Automerge.generateSyncMessage(ProofDocument._read(left), leftState);
    const [nextRightState, rightMessage] = Automerge.generateSyncMessage(ProofDocument._read(right), rightState);
    leftState = nextLeftState;
    rightState = nextRightState;
    if (leftMessage) {
      const [document, state] = receive(right, rightState, leftMessage);
      ProofDocument._replace(right, document);
      rightState = state;
    }
    if (rightMessage) {
      const [document, state] = receive(left, leftState, rightMessage);
      ProofDocument._replace(left, document);
      leftState = state;
    }
    if (!leftMessage && !rightMessage) return;
  }
  throw new Error("sync did not quiesce within 100 rounds");
}

function receive(proof, state, message) {
  return Automerge.receiveSyncMessage(ProofDocument._read(proof), state, message);
}

function parentAt(document, path) {
  if (path.length === 0) throw new Error("document path must not be empty");
  return [valueAt(document, path.slice(0, -1)), path.at(-1)];
}

function valueAt(document, path) {
  return path.reduce((value, segment) => {
    if (value === undefined || value === null) {
      throw new Error(`document path does not exist: ${path.join("/")}`);
    }
    return value[segment];
  }, document);
}

function actorId(actor) {
  return createHash("sha256").update(actor).digest("hex").slice(0, 32);
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
