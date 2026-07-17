use std::fs;

use inkfinite_crdt_proof::{
    repair_snapshot, synchronize, validate_snapshot, DocumentPath, ProofDocument,
};
use serde_json::{json, Value};

fn fixture() -> Value {
    serde_json::from_str(include_str!("../shared/nested-document.json"))
        .expect("shared proof fixture must be valid JSON")
}

#[test]
fn nested_maps_lists_and_text_round_trip() {
    let expected = fixture();
    let mut document = ProofDocument::from_snapshot(&expected, b"rust-a").unwrap();
    let saved = document.save();
    let mut loaded = ProofDocument::load(&saved, b"rust-b").unwrap();

    assert_eq!(loaded.snapshot().unwrap(), expected);
}

#[test]
fn ten_thousand_shape_v1_document_round_trips() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/v1/performance/board-10000.inkfinite.json"
    );
    let expected: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    let mut document = ProofDocument::from_snapshot(&expected, b"rust-perf").unwrap();
    let saved = document.save();
    let mut loaded = ProofDocument::load(&saved, b"rust-perf-load").unwrap();

    assert_eq!(loaded.snapshot().unwrap(), expected);
}

#[test]
fn offline_property_list_text_delete_and_reparent_edits_converge() {
    let mut base = ProofDocument::from_snapshot(&fixture(), b"base").unwrap();
    let mut left = base.fork(b"left");
    let mut right = base.fork(b"right");

    left.set_scalar(
        &DocumentPath::new(&["shapes", "shape:root", "x"]),
        &json!(100),
        "left property",
    )
    .unwrap();
    left.list_insert(
        &DocumentPath::new(&["layers", "layer:1", "children"]),
        1,
        &json!("shape:left"),
        "left list insertion",
    )
    .unwrap();
    left.text_splice(
        &DocumentPath::new(&["shapes", "shape:child", "content"]),
        0,
        0,
        "Left ",
        "left text",
    )
    .unwrap();
    left.delete_record(
        &DocumentPath::new(&["bindings", "binding:1"]),
        "left delete",
    )
    .unwrap();

    right
        .set_scalar(
            &DocumentPath::new(&["shapes", "shape:root", "y"]),
            &json!(200),
            "right property",
        )
        .unwrap();
    right
        .list_delete(
            &DocumentPath::new(&["shapes", "shape:root", "children"]),
            0,
            "right list deletion",
        )
        .unwrap();
    right
        .text_splice(
            &DocumentPath::new(&["shapes", "shape:child", "content"]),
            21,
            0,
            " Right",
            "right text",
        )
        .unwrap();
    right
        .set_scalar(
            &DocumentPath::new(&["shapes", "shape:child", "parentId"]),
            &json!("layer:1"),
            "right reparent",
        )
        .unwrap();

    let left_bytes = left.save();
    let right_bytes = right.save();
    let mut left_first = ProofDocument::load(&left_bytes, b"merge-left").unwrap();
    let mut right_for_left = ProofDocument::load(&right_bytes, b"merge-right-copy").unwrap();
    left_first.merge(&mut right_for_left).unwrap();
    let mut right_first = ProofDocument::load(&right_bytes, b"merge-right").unwrap();
    let mut left_for_right = ProofDocument::load(&left_bytes, b"merge-left-copy").unwrap();
    right_first.merge(&mut left_for_right).unwrap();

    assert_ne!(left_first.save(), right_first.save());
    assert_eq!(
        left_first.snapshot().unwrap(),
        right_first.snapshot().unwrap()
    );
}

#[test]
fn patches_heads_actor_undo_sync_save_load_and_compaction_are_exposed() {
    let mut document = ProofDocument::from_snapshot(&fixture(), b"local-actor").unwrap();
    let initial_heads = document.heads();
    let (summary, undo) = document
        .set_scalar_with_undo(
            &DocumentPath::new(&["shapes", "shape:root", "x"]),
            &json!(55),
            "move shape",
        )
        .unwrap();
    assert!(summary.patch_count > 0);
    assert_ne!(summary.heads, initial_heads);
    assert_eq!(document.actor_id(), "6c6f63616c2d6163746f72");

    let mut remote = document.fork(b"remote-actor");
    remote
        .set_scalar(
            &DocumentPath::new(&["shapes", "shape:root", "y"]),
            &json!(77),
            "remote move",
        )
        .unwrap();
    document.merge(&mut remote).unwrap();
    document
        .undo(&undo)
        .unwrap()
        .expect("local value is unchanged");
    let snapshot = document.snapshot().unwrap();
    assert_eq!(snapshot["shapes"]["shape:root"]["x"], json!(8));
    assert_eq!(snapshot["shapes"]["shape:root"]["y"], json!(77));

    let (_, superseded_undo) = document
        .set_scalar_with_undo(
            &DocumentPath::new(&["shapes", "shape:root", "x"]),
            &json!(55),
            "second local move",
        )
        .unwrap();
    let mut intervening_remote = document.fork(b"intervening-remote");
    intervening_remote
        .set_scalar(
            &DocumentPath::new(&["shapes", "shape:root", "x"]),
            &json!(88),
            "intervening remote move",
        )
        .unwrap();
    document.merge(&mut intervening_remote).unwrap();
    assert!(document.undo(&superseded_undo).unwrap().is_none());
    assert_eq!(
        document.snapshot().unwrap()["shapes"]["shape:root"]["x"],
        json!(88)
    );

    let compact = document.save();
    let mut loaded = ProofDocument::load(&compact, b"loaded-actor").unwrap();
    assert_eq!(loaded.snapshot().unwrap(), document.snapshot().unwrap());

    let mut peer = document.fork(b"sync-peer");
    document
        .set_scalar(
            &DocumentPath::new(&["shapes", "shape:root", "y"]),
            &json!(78),
            "change sent through sync",
        )
        .unwrap();
    synchronize(&mut document, &mut peer).unwrap();
    assert_eq!(document.snapshot().unwrap(), peer.snapshot().unwrap());

    let mut journal_bytes = 0;
    let mut heads = loaded.heads();
    let _initial_increment = loaded.save_incremental();
    for index in 0..40 {
        loaded
            .set_scalar(
                &DocumentPath::new(&["shapes", "shape:root", "x"]),
                &json!(index),
                "storage growth",
            )
            .unwrap();
        journal_bytes += loaded.save_incremental().len();
        heads = loaded.heads();
    }
    let compacted = loaded.save();
    assert!(!heads.is_empty());
    assert!(compacted.len() < journal_bytes);
}

#[test]
fn fork_is_repaired_and_validated_before_adoption() {
    let mut base = ProofDocument::from_snapshot(&fixture(), b"repair-base").unwrap();
    let mut left = base.fork(b"repair-left");
    let mut right = base.fork(b"repair-right");

    left.replace_snapshot(
        &json!({
            "bindings": {"dangling": {"fromShapeId": "shape:root", "toShapeId": "missing"}},
            "pages": {"page:1": {"layers": []}},
            "layers": {},
            "shapes": {
                "shape:child": {"children": [], "content": "text", "parentId": "missing", "x": 1, "y": 2},
                "shape:root": {"children": ["shape:child", "shape:child"], "parentId": "missing", "x": 3, "y": 4}
            }
        }),
        "left invalid hierarchy",
    )
    .unwrap();
    right
        .set_scalar(
            &DocumentPath::new(&["shapes", "shape:child", "parentId"]),
            &json!("missing-remote-parent"),
            "right invalid reparent",
        )
        .unwrap();

    let left_bytes = left.save();
    let right_bytes = right.save();
    let before = base.snapshot().unwrap();
    let mut left_candidate = ProofDocument::load(&left_bytes, b"repair-left-first").unwrap();
    let mut right_for_left = ProofDocument::load(&right_bytes, b"repair-right-copy").unwrap();
    left_candidate.merge(&mut right_for_left).unwrap();
    let mut right_candidate = ProofDocument::load(&right_bytes, b"repair-right-first").unwrap();
    let mut left_for_right = ProofDocument::load(&left_bytes, b"repair-left-copy").unwrap();
    right_candidate.merge(&mut left_for_right).unwrap();
    assert!(validate_snapshot(&left_candidate.snapshot().unwrap()).is_err());
    assert_eq!(
        base.snapshot().unwrap(),
        before,
        "live state changed before adoption"
    );

    let repaired_left = repair_snapshot(&left_candidate.snapshot().unwrap()).unwrap();
    let repaired_right = repair_snapshot(&right_candidate.snapshot().unwrap()).unwrap();
    assert_eq!(
        repaired_left, repaired_right,
        "repair depends on merge order"
    );
    left_candidate
        .replace_snapshot(&repaired_left, "deterministic merge repair")
        .unwrap();
    right_candidate
        .replace_snapshot(&repaired_right, "deterministic merge repair")
        .unwrap();
    assert_eq!(
        left_candidate.snapshot().unwrap(),
        right_candidate.snapshot().unwrap()
    );
    validate_snapshot(&left_candidate.snapshot().unwrap()).unwrap();
    base = left_candidate;

    let adopted = base.snapshot().unwrap();
    assert_eq!(
        adopted["pages"]["page:1"]["layers"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(adopted["bindings"].as_object().unwrap().is_empty());
    assert_eq!(adopted["shapes"]["shape:root"]["children"], json!([]));
    assert_eq!(
        adopted["layers"]["layer:recovered:page:1"]["children"],
        json!(["shape:child", "shape:root"])
    );
}
