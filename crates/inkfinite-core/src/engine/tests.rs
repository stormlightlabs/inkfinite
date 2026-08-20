#![allow(clippy::float_cmp)]

use std::collections::BTreeMap;

use crate::crdt::{AutomergeDocument, CrdtDocument};
use crate::proto::{Bounds, LayerPatch, Operation, Query, ShapeAlignment, ShapePatch, TransactionDraft, TransactionId};
use crate::{
    ActorId, BindingAnchor, BindingId, BindingKind, BindingRecord, Document, DocumentId, LayerId, LayerRecord, Opacity,
    Origin, PageId, PageRecord, Provenance, RecordVersion, SemanticMetadata, ShapeId, ShapeKind, ShapeParent,
    ShapeProperties, ShapeRecord, ShapeStyle, SiblingAnchor, Timestamp, Transform, Vec2,
};
use proptest::prelude::*;
use serde_json::json;

use super::{EngineError, TransactionEngine};

fn metadata(actor: &str, name: &str) -> SemanticMetadata {
    SemanticMetadata {
        name: Some(name.into()),
        role: Some("diagram.process".into()),
        description: None,
        tags: vec!["important".into()],
        locked: false,
        agent_editable: true,
        provenance: Provenance {
            actor_id: ActorId::from(actor),
            origin: Origin::Human,
            timestamp: Timestamp(0),
            source: None,
        },
    }
}

fn shape(id: &str, x: f64) -> ShapeRecord {
    ShapeRecord {
        id: ShapeId::from(id),
        kind: ShapeKind::from("rect"),
        parent: ShapeParent::Layer(LayerId::from("layer:one")),
        transform: Transform { translation: Vec2 { x, y: 20.0 }, rotation: 0.0, scale_x: 1.0, scale_y: 1.0 },
        child_ids: Vec::new(),
        layout: None,
        properties: ShapeProperties::from([
            ("width".into(), json!(10.0)),
            ("height".into(), json!(5.0)),
            ("content".into(), json!(format!("text for {id}"))),
        ]),
        metadata: metadata("actor:seed", id),
        style: ShapeStyle { opacity: Opacity::OPAQUE, fill_opacity: None, stroke_opacity: None },
        version: RecordVersion(1),
    }
}

pub fn document() -> Document {
    let page_id = PageId::from("page:one");
    let layer_id = LayerId::from("layer:one");
    let shape_a = shape("shape:a", 0.0);
    let shape_b = shape("shape:b", 30.0);
    let shape_c = shape("shape:c", 80.0);
    Document {
        pages: BTreeMap::from([(
            page_id.clone(),
            PageRecord {
                id: page_id.clone(),
                name: "Page".into(),
                layer_ids: vec![layer_id.clone()],
                version: RecordVersion(1),
            },
        )]),
        page_ids: vec![page_id.clone()],
        layers: BTreeMap::from([(
            layer_id.clone(),
            LayerRecord {
                id: layer_id,
                page_id,
                name: "Layer".into(),
                shape_ids: vec![shape_a.id.clone(), shape_b.id.clone(), shape_c.id.clone()],
                visible: true,
                locked: false,
                opacity: Opacity::OPAQUE,
                version: RecordVersion(1),
            },
        )]),
        shapes: BTreeMap::from([
            (shape_a.id.clone(), shape_a),
            (shape_b.id.clone(), shape_b),
            (shape_c.id.clone(), shape_c),
        ]),
        bindings: BTreeMap::new(),
        assets: BTreeMap::new(),
    }
}

fn engine() -> TransactionEngine {
    TransactionEngine::create(
        DocumentId::from("document:test"),
        ActorId::from("actor:local"),
        document(),
    )
    .unwrap()
}

fn transaction(engine: &mut TransactionEngine, actor: &str, id: &str, operations: Vec<Operation>) -> TransactionDraft {
    TransactionDraft {
        id: TransactionId(id.into()),
        actor_id: ActorId::from(actor),
        origin: Origin::Human,
        base_heads: engine.snapshot().unwrap().heads,
        description: id.into(),
        operations,
        timestamp: Timestamp(1),
    }
}

#[test]
fn geometry_is_normalized_and_bounded_at_the_commit_boundary() {
    let mut engine = engine();
    let path_id = ShapeId::from("shape:path");
    let stroke_id = ShapeId::from("shape:stroke");
    let mut path = shape(path_id.as_str(), 120.0);
    path.kind = ShapeKind::from(crate::PATH_KIND);
    path.properties = ShapeProperties::from([
        (
            "subpaths".into(),
            json!([{
                "segments": [
                    { "type": "move", "to": { "x": 0.0, "y": 0.0 } },
                    { "type": "cubic", "control_1": { "x": 0.0, "y": 30.0 }, "control_2": { "x": 30.0, "y": 30.0 }, "to": { "x": 30.0, "y": 0.0 } }
                ],
                "closed": true
            }]),
        ),
        ("fill_rule".into(), json!("evenodd")),
    ]);
    let mut stroke = shape(stroke_id.as_str(), 180.0);
    stroke.kind = ShapeKind::from(crate::STROKE_KIND);
    stroke.properties = ShapeProperties::from([
        ("points".into(), json!([[0.0, 0.0], [40.0, 20.0], [80.0, 0.0]])),
        ("style".into(), json!({ "color": "#000", "opacity": 1.0 })),
        (
            "brush".into(),
            json!({
                "size": 12.0,
                "thinning": 0.5,
                "smoothing": 0.5,
                "streamline": 0.5,
                "simulatePressure": true
            }),
        ),
    ]);
    let draft = transaction(
        &mut engine,
        "actor:local",
        "create geometry",
        vec![
            Operation::CreateShape { shape: path, anchor: SiblingAnchor::Last },
            Operation::CreateShape { shape: stroke, anchor: SiblingAnchor::Last },
        ],
    );
    let result = engine.commit(draft).expect("valid geometry should commit");
    assert!(result.affected_regions.iter().any(|region| region.bounds.width > 0.0));

    let snapshot = engine.snapshot().expect("snapshot after geometry commit");
    let committed_path = &snapshot.document.shapes[&path_id];
    assert_eq!(committed_path.properties["fill_rule"], json!("evenodd"));
    assert_eq!(
        committed_path.properties["subpaths"][0]["segments"][0]["type"],
        json!("move")
    );
    let committed_stroke = &snapshot.document.shapes[&stroke_id];
    assert_eq!(committed_stroke.properties["brush"]["simulatePressure"], json!(true));
}

#[test]
fn transaction_is_atomic_and_returns_inverse_patch_heads_and_regions() {
    let mut engine = engine();
    let initial = engine.snapshot().unwrap();
    let draft = transaction(
        &mut engine,
        "actor:local",
        "rename and move",
        vec![
            Operation::RenamePage {
                page_id: PageId::from("page:one"),
                name: "Architecture".into(),
                expected_version: Some(RecordVersion(1)),
            },
            Operation::PatchShape {
                shape_id: ShapeId::from("shape:a"),
                patch: ShapePatch {
                    transform: Some(Transform {
                        translation: Vec2 { x: 15.0, y: 20.0 },
                        rotation: 0.0,
                        scale_x: 1.0,
                        scale_y: 1.0,
                    }),
                    ..ShapePatch::default()
                },
                expected_version: Some(RecordVersion(1)),
            },
        ],
    );
    let result = engine.commit(draft).unwrap();
    assert_ne!(result.heads, initial.heads);
    assert_eq!(result.inverse.operations.len(), 2);
    assert_eq!(result.patch.changed.len(), 2);
    assert_eq!(result.affected_regions.len(), 1);

    let stale = TransactionDraft {
        id: TransactionId("stale".into()),
        actor_id: ActorId::from("actor:local"),
        origin: Origin::Human,
        base_heads: initial.heads,
        description: "stale rename".into(),
        operations: vec![Operation::RenamePage {
            page_id: PageId::from("page:one"),
            name: "Stale".into(),
            expected_version: None,
        }],
        timestamp: Timestamp(2),
    };
    assert!(matches!(engine.commit(stale), Err(EngineError::StaleHeads)));
    assert_eq!(
        engine.snapshot().unwrap().document.pages[&PageId::from("page:one")].name,
        "Architecture"
    );
}

#[test]
fn actor_undo_and_redo_preserve_an_intervening_actor_edit() {
    let mut engine = engine();
    let first = transaction(
        &mut engine,
        "actor:a",
        "move a",
        vec![Operation::PatchShape {
            shape_id: ShapeId::from("shape:a"),
            patch: ShapePatch {
                transform: Some(Transform {
                    translation: Vec2 { x: 10.0, y: 20.0 },
                    rotation: 0.0,
                    scale_x: 1.0,
                    scale_y: 1.0,
                }),
                ..ShapePatch::default()
            },
            expected_version: Some(RecordVersion(1)),
        }],
    );
    engine.commit(first).unwrap();
    let remote = transaction(
        &mut engine,
        "actor:b",
        "move a vertically",
        vec![Operation::PatchShape {
            shape_id: ShapeId::from("shape:a"),
            patch: ShapePatch {
                transform: Some(Transform {
                    translation: Vec2 { x: 10.0, y: 45.0 },
                    rotation: 0.0,
                    scale_x: 1.0,
                    scale_y: 1.0,
                }),
                ..ShapePatch::default()
            },
            expected_version: Some(RecordVersion(2)),
        }],
    );
    engine.commit(remote).unwrap();

    engine.undo(&ActorId::from("actor:a")).unwrap();
    let undone = engine.snapshot().unwrap().document;
    assert_eq!(undone.shapes[&ShapeId::from("shape:a")].transform.translation.x, 0.0);
    assert_eq!(undone.shapes[&ShapeId::from("shape:a")].transform.translation.y, 45.0);

    engine.redo(&ActorId::from("actor:a")).unwrap();
    let redone = engine.snapshot().unwrap().document;
    assert_eq!(redone.shapes[&ShapeId::from("shape:a")].transform.translation.x, 10.0);
    assert_eq!(redone.shapes[&ShapeId::from("shape:a")].transform.translation.y, 45.0);
}

#[test]
fn actor_undo_rejects_an_intervening_edit_to_the_same_field() {
    let mut engine = engine();
    for (actor, x, version) in [("actor:a", 10.0, RecordVersion(1)), ("actor:b", 20.0, RecordVersion(2))] {
        let draft = transaction(
            &mut engine,
            actor,
            actor,
            vec![Operation::PatchShape {
                shape_id: ShapeId::from("shape:a"),
                patch: ShapePatch {
                    transform: Some(Transform {
                        translation: Vec2 { x, y: 20.0 },
                        rotation: 0.0,
                        scale_x: 1.0,
                        scale_y: 1.0,
                    }),
                    ..ShapePatch::default()
                },
                expected_version: Some(version),
            }],
        );
        engine.commit(draft).unwrap();
    }
    assert!(matches!(
        engine.undo(&ActorId::from("actor:a")),
        Err(EngineError::Precondition(_))
    ));
    assert_eq!(
        engine.snapshot().unwrap().document.shapes[&ShapeId::from("shape:a")]
            .transform
            .translation
            .x,
        20.0
    );
}

#[test]
fn delete_restore_and_redo_refresh_multi_record_preconditions() {
    let mut engine = engine();
    let delete = transaction(
        &mut engine,
        "actor:a",
        "delete shape",
        vec![Operation::DeleteShape { shape_id: ShapeId::from("shape:a"), expected_version: Some(RecordVersion(1)) }],
    );
    engine.commit(delete).unwrap();
    assert!(
        !engine
            .snapshot()
            .unwrap()
            .document
            .shapes
            .contains_key(&ShapeId::from("shape:a"))
    );
    engine.undo(&ActorId::from("actor:a")).unwrap();
    assert!(
        engine
            .snapshot()
            .unwrap()
            .document
            .shapes
            .contains_key(&ShapeId::from("shape:a"))
    );
    engine.redo(&ActorId::from("actor:a")).unwrap();
    assert!(
        !engine
            .snapshot()
            .unwrap()
            .document
            .shapes
            .contains_key(&ShapeId::from("shape:a"))
    );
}

#[test]
fn layer_visual_changes_return_regions_and_deletes_honor_locked_descendants() {
    let mut engine = engine();
    let hide = transaction(
        &mut engine,
        "actor:a",
        "hide layer",
        vec![Operation::PatchLayer {
            layer_id: LayerId::from("layer:one"),
            patch: LayerPatch { visible: Some(false), ..LayerPatch::default() },
            expected_version: Some(RecordVersion(1)),
        }],
    );
    assert_eq!(engine.commit(hide).unwrap().affected_regions.len(), 1);
    assert!(
        engine
            .query(&Query { shape_kind: Some("rect".into()), ..Query::default() })
            .unwrap()
            .records
            .is_empty(),
        "agent-facing queries must not expose shapes in hidden layers"
    );
    let mut hidden_agent_edit = transaction(
        &mut engine,
        "actor:agent",
        "edit hidden shape",
        vec![Operation::PatchShape {
            shape_id: ShapeId::from("shape:a"),
            patch: ShapePatch {
                transform: Some(Transform {
                    translation: Vec2 { x: 5.0, y: 20.0 },
                    rotation: 0.0,
                    scale_x: 1.0,
                    scale_y: 1.0,
                }),
                ..ShapePatch::default()
            },
            expected_version: Some(RecordVersion(1)),
        }],
    );
    hidden_agent_edit.origin = Origin::Agent;
    assert!(matches!(
        engine.commit(hidden_agent_edit),
        Err(EngineError::Permission(_))
    ));

    let mut locked_document = document();
    locked_document
        .shapes
        .get_mut(&ShapeId::from("shape:b"))
        .unwrap()
        .metadata
        .locked = true;
    let mut locked_engine = TransactionEngine::create(
        DocumentId::from("document:locked"),
        ActorId::from("actor:a"),
        locked_document,
    )
    .unwrap();
    let delete_layer = transaction(
        &mut locked_engine,
        "actor:a",
        "delete locked content",
        vec![Operation::DeleteLayer {
            layer_id: LayerId::from("layer:one"),
            contents: crate::proto::LayerContentsDisposition::Delete,
            expected_version: Some(RecordVersion(1)),
        }],
    );
    assert!(matches!(
        locked_engine.commit(delete_layer),
        Err(EngineError::Permission(_))
    ));
}

#[test]
fn a_locked_layer_can_be_unlocked_but_not_changed_in_the_same_operation() {
    let mut document = document();
    document.layers.get_mut(&LayerId::from("layer:one")).unwrap().locked = true;
    let mut engine = TransactionEngine::create(
        DocumentId::from("document:locked-layer"),
        ActorId::from("actor:a"),
        document,
    )
    .unwrap();
    let unlock = transaction(
        &mut engine,
        "actor:a",
        "unlock layer",
        vec![Operation::PatchLayer {
            layer_id: LayerId::from("layer:one"),
            patch: LayerPatch { locked: Some(false), ..LayerPatch::default() },
            expected_version: Some(RecordVersion(1)),
        }],
    );
    engine.commit(unlock).unwrap();
    assert!(!engine.snapshot().unwrap().document.layers[&LayerId::from("layer:one")].locked);
}

#[test]
fn permissions_preconditions_and_final_invariants_reject_without_mutation() {
    let mut engine = engine();
    let before = engine.snapshot().unwrap();
    let bad_version = transaction(
        &mut engine,
        "actor:a",
        "bad version",
        vec![Operation::PatchLayer {
            layer_id: LayerId::from("layer:one"),
            patch: LayerPatch { name: Some("Changed".into()), ..LayerPatch::default() },
            expected_version: Some(RecordVersion(99)),
        }],
    );
    assert!(matches!(engine.commit(bad_version), Err(EngineError::Precondition(_))));
    assert_eq!(engine.snapshot().unwrap(), before);

    let delete_only_page = transaction(
        &mut engine,
        "actor:a",
        "delete only page",
        vec![Operation::DeletePage { page_id: PageId::from("page:one"), expected_version: Some(RecordVersion(1)) }],
    );
    assert!(matches!(
        engine.commit(delete_only_page),
        Err(EngineError::Invariant(_))
    ));
    assert_eq!(engine.snapshot().unwrap(), before);
}

#[test]
fn queries_bounds_alignment_and_distribution_share_the_transaction_engine() {
    let mut engine = engine();
    let query = Query {
        role: Some("diagram.process".into()),
        tag: Some("important".into()),
        shape_kind: Some("rect".into()),
        page_id: Some(PageId::from("page:one")),
        layer_id: Some(LayerId::from("layer:one")),
        bounds: Some(Bounds { x: -1.0, y: 0.0, width: 20.0, height: 30.0 }),
        ..Query::default()
    };
    let result = engine.query(&query).unwrap();
    assert_eq!(
        result.records,
        vec![crate::proto::RecordId::Shape(ShapeId::from("shape:a"))]
    );

    let detailed = engine
        .query(&Query { include_records: true, limit: Some(1), ..Query::default() })
        .unwrap();
    assert!(detailed.total > 1);
    assert!(detailed.truncated);
    assert_eq!(detailed.records.len(), 1);
    assert_eq!(detailed.details.len(), 1);

    let align = transaction(
        &mut engine,
        "actor:a",
        "align",
        vec![Operation::AlignShapes {
            shape_ids: vec![ShapeId::from("shape:a"), ShapeId::from("shape:b")],
            alignment: ShapeAlignment::Left,
            expected_versions: BTreeMap::new(),
        }],
    );
    engine.commit(align).unwrap();
    let snapshot = engine.snapshot().unwrap();
    assert_eq!(
        snapshot.document.shapes[&ShapeId::from("shape:a")]
            .transform
            .translation
            .x,
        snapshot.document.shapes[&ShapeId::from("shape:b")]
            .transform
            .translation
            .x
    );
}

#[test]
fn remote_changes_are_repaired_on_a_fork_before_adoption() {
    let mut engine = engine();
    let base_heads = engine.snapshot().unwrap().heads;
    let bytes = engine.save().unwrap();
    let mut remote = AutomergeDocument::load(&bytes, ActorId::from("actor:remote")).unwrap();
    let mut invalid = remote.snapshot().unwrap().document;
    invalid
        .pages
        .get_mut(&PageId::from("page:one"))
        .unwrap()
        .layer_ids
        .clear();
    invalid.layers.clear();
    invalid.shapes.get_mut(&ShapeId::from("shape:a")).unwrap().parent =
        ShapeParent::Layer(LayerId::from("layer:missing"));
    invalid.bindings.insert(
        BindingId::from("binding:dangling"),
        BindingRecord {
            id: BindingId::from("binding:dangling"),
            kind: BindingKind::from("arrow"),
            source_shape_id: ShapeId::from("shape:a"),
            target_shape_id: ShapeId::from("shape:missing"),
            source_handle: "end".into(),
            anchor: BindingAnchor::Center,
            version: RecordVersion(1),
        },
    );
    remote.commit_document(&invalid, "invalid remote hierarchy").unwrap();
    let changes = remote.changes_since(&base_heads).unwrap();
    let warnings = engine.merge_changes(&changes).unwrap();
    assert!(!warnings.is_empty());
    let repaired = engine.snapshot().unwrap().document;
    assert_eq!(repaired.pages[&PageId::from("page:one")].layer_ids.len(), 1);
    assert!(repaired.bindings.is_empty());
    assert!(super::validate_document(&repaired).is_ok());
}

#[test]
fn two_offline_replicas_converge_independent_of_change_order() {
    let mut origin = engine();
    let bytes = origin.save().unwrap();
    let base = origin.snapshot().unwrap().heads;
    let mut left = TransactionEngine::load(&bytes, ActorId::from("actor:left")).unwrap();
    let mut right = TransactionEngine::load(&bytes, ActorId::from("actor:right")).unwrap();
    let left_tx = transaction(
        &mut left,
        "actor:left",
        "left edit",
        vec![Operation::RenamePage {
            page_id: PageId::from("page:one"),
            name: "Renamed".into(),
            expected_version: Some(RecordVersion(1)),
        }],
    );
    left.commit(left_tx).unwrap();
    let right_tx = transaction(
        &mut right,
        "actor:right",
        "right edit",
        vec![Operation::PatchShape {
            shape_id: ShapeId::from("shape:c"),
            patch: ShapePatch { metadata: Some(metadata("actor:right", "Changed")), ..ShapePatch::default() },
            expected_version: Some(RecordVersion(1)),
        }],
    );
    right.commit(right_tx).unwrap();
    let left_changes = left.changes_since(&base).unwrap();
    let right_changes = right.changes_since(&base).unwrap();
    left.merge_changes(&right_changes).unwrap();
    right.merge_changes(&left_changes).unwrap();
    assert_eq!(left.snapshot().unwrap().document, right.snapshot().unwrap().document);
}

#[test]
fn offline_list_text_delete_and_reparent_edits_converge() {
    let mut base_document = document();
    base_document.shapes.get_mut(&ShapeId::from("shape:a")).unwrap().kind = ShapeKind::from("container");
    base_document.bindings.insert(
        BindingId::from("binding:one"),
        BindingRecord {
            id: BindingId::from("binding:one"),
            kind: BindingKind::from("arrow"),
            source_shape_id: ShapeId::from("shape:a"),
            target_shape_id: ShapeId::from("shape:b"),
            source_handle: "end".into(),
            anchor: BindingAnchor::Center,
            version: RecordVersion(1),
        },
    );
    let mut origin = TransactionEngine::create(
        DocumentId::from("document:offline"),
        ActorId::from("actor:origin"),
        base_document,
    )
    .unwrap();
    let bytes = origin.save().unwrap();
    let base = origin.snapshot().unwrap().heads;
    let mut left = TransactionEngine::load(&bytes, ActorId::from("actor:left")).unwrap();
    let mut right = TransactionEngine::load(&bytes, ActorId::from("actor:right")).unwrap();

    let mut text_properties = left.snapshot().unwrap().document.shapes[&ShapeId::from("shape:a")]
        .properties
        .clone();
    text_properties.insert("content".into(), json!("offline text edit"));
    let left_tx = transaction(
        &mut left,
        "actor:left",
        "left nested list text and delete",
        vec![
            Operation::PatchShape {
                shape_id: ShapeId::from("shape:a"),
                patch: ShapePatch { properties: Some(text_properties), ..ShapePatch::default() },
                expected_version: Some(RecordVersion(1)),
            },
            Operation::CreateShape { shape: shape("shape:d", 120.0), anchor: SiblingAnchor::Last },
            Operation::DeleteBinding {
                binding_id: BindingId::from("binding:one"),
                expected_version: Some(RecordVersion(1)),
            },
        ],
    );
    left.commit(left_tx).unwrap();

    let right_tx = transaction(
        &mut right,
        "actor:right",
        "right reparent and property",
        vec![
            Operation::ReparentShape {
                shape_id: ShapeId::from("shape:b"),
                parent: ShapeParent::Shape(ShapeId::from("shape:a")),
                anchor: SiblingAnchor::Last,
                expected_version: Some(RecordVersion(1)),
            },
            Operation::PatchShape {
                shape_id: ShapeId::from("shape:c"),
                patch: ShapePatch {
                    transform: Some(Transform {
                        translation: Vec2 { x: 80.0, y: 50.0 },
                        rotation: 0.0,
                        scale_x: 1.0,
                        scale_y: 1.0,
                    }),
                    ..ShapePatch::default()
                },
                expected_version: Some(RecordVersion(1)),
            },
        ],
    );
    right.commit(right_tx).unwrap();

    let left_changes = left.changes_since(&base).unwrap();
    let right_changes = right.changes_since(&base).unwrap();
    left.merge_changes(&right_changes).unwrap();
    right.merge_changes(&left_changes).unwrap();
    let left_document = left.snapshot().unwrap().document;
    let right_document = right.snapshot().unwrap().document;
    assert_eq!(left_document, right_document);
    assert!(left_document.bindings.is_empty());
    assert!(left_document.shapes.contains_key(&ShapeId::from("shape:d")));
    assert_eq!(
        left_document.shapes[&ShapeId::from("shape:b")].parent,
        ShapeParent::Shape(ShapeId::from("shape:a"))
    );
    assert_eq!(
        left_document.shapes[&ShapeId::from("shape:a")].properties["content"],
        json!("offline text edit")
    );
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(16))]

    #[test]
    fn apply_then_inverse_restores_the_renamed_value(name in "[A-Za-z][A-Za-z0-9 ]{0,24}") {
        let mut engine = engine();
        let draft = transaction(
            &mut engine,
            "actor:property",
            "property rename",
            vec![Operation::RenamePage {
                page_id: PageId::from("page:one"),
                name,
                expected_version: Some(RecordVersion(1)),
            }],
        );
        engine.commit(draft).unwrap();
        engine.undo(&ActorId::from("actor:property")).unwrap();
        prop_assert_eq!(
            &engine.snapshot().unwrap().document.pages[&PageId::from("page:one")].name,
            "Page"
        );
    }

    #[test]
    fn deterministic_repair_is_idempotent(x in -10_000.0f64..10_000.0) {
        let mut invalid = document();
        invalid.shapes.get_mut(&ShapeId::from("shape:a")).unwrap().transform.translation.x = x;
        invalid.pages.get_mut(&PageId::from("page:one")).unwrap().layer_ids.clear();
        invalid.layers.clear();
        invalid.shapes.get_mut(&ShapeId::from("shape:a")).unwrap().parent =
            ShapeParent::Layer(LayerId::from("layer:missing"));
        let mut first = invalid.clone();
        let mut second = invalid;
        super::repair_document(&mut first).unwrap();
        super::repair_document(&mut second).unwrap();
        prop_assert_eq!(&first, &second);
        let before_second_repair = first.clone();
        super::repair_document(&mut first).unwrap();
        prop_assert_eq!(first, before_second_repair);
    }

    #[test]
    fn concurrent_property_edits_converge_for_any_finite_coordinates(
        left_x in -10_000.0f64..10_000.0,
        right_y in -10_000.0f64..10_000.0,
    ) {
        let mut origin = engine();
        let bytes = origin.save().unwrap();
        let base = origin.snapshot().unwrap().heads;
        let mut left = TransactionEngine::load(&bytes, ActorId::from("actor:left")).unwrap();
        let mut right = TransactionEngine::load(&bytes, ActorId::from("actor:right")).unwrap();
        let left_tx = transaction(&mut left, "actor:left", "left coordinate", vec![Operation::PatchShape {
            shape_id: ShapeId::from("shape:a"),
            patch: ShapePatch {
                transform: Some(Transform {
                    translation: Vec2 { x: left_x, y: 20.0 },
                    rotation: 0.0,
                    scale_x: 1.0,
                    scale_y: 1.0,
                }),
                ..ShapePatch::default()
            },
            expected_version: Some(RecordVersion(1)),
        }]);
        left.commit(left_tx).unwrap();
        let right_tx = transaction(&mut right, "actor:right", "right coordinate", vec![Operation::PatchShape {
            shape_id: ShapeId::from("shape:a"),
            patch: ShapePatch {
                transform: Some(Transform {
                    translation: Vec2 { x: 0.0, y: right_y },
                    rotation: 0.0,
                    scale_x: 1.0,
                    scale_y: 1.0,
                }),
                ..ShapePatch::default()
            },
            expected_version: Some(RecordVersion(1)),
        }]);
        right.commit(right_tx).unwrap();
        let left_changes = left.changes_since(&base).unwrap();
        let right_changes = right.changes_since(&base).unwrap();
        left.merge_changes(&right_changes).unwrap();
        right.merge_changes(&left_changes).unwrap();
        let left_document = left.snapshot().unwrap().document;
        let right_document = right.snapshot().unwrap().document;
        prop_assert_eq!(&left_document, &right_document);
        prop_assert_eq!(left_document.shapes[&ShapeId::from("shape:a")].transform.translation.x, left_x);
        prop_assert_eq!(left_document.shapes[&ShapeId::from("shape:a")].transform.translation.y, right_y);
    }
}
