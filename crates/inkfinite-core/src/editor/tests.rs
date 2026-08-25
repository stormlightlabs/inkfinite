use std::collections::BTreeMap;

use super::*;
use crate::boolean::BooleanPathOperation;
use crate::engine::geometry::{Affine, world_transform};
use crate::path::PathTopologyOperation;
use crate::proto::{LayerPatch, Operation, TransactionId};
use crate::{
    ActorId, BindingAnchor, BindingId, BindingRecord, CONTAINER_KIND, ChangeHash, ContainerLayout, DocumentId,
    DocumentSnapshot, LayerId, LayerRecord, Opacity, Origin, Provenance, RecordVersion, SemanticMetadata, ShapeId,
    ShapeKind, ShapeParent, ShapeRecord, ShapeStyle, SiblingAnchor, Timestamp, Transform, Vec2, blank_document,
};
use serde_json::Value;

fn same_affine(left: Affine, right: Affine) -> bool {
    [
        (left.a, right.a),
        (left.b, right.b),
        (left.c, right.c),
        (left.d, right.d),
        (left.e, right.e),
        (left.f, right.f),
    ]
    .into_iter()
    .all(|(left, right)| (left - right).abs() <= 1e-9 * (1.0 + left.abs().max(right.abs())))
}

fn metadata() -> SemanticMetadata {
    SemanticMetadata {
        name: None,
        title: None,
        role: None,
        description: None,
        body: None,
        tags: Vec::new(),
        source: None,
        link: None,
        custom_metadata: BTreeMap::new(),
        locked: false,
        agent_editable: true,
        provenance: Provenance {
            actor_id: ActorId::from("actor:test"),
            origin: Origin::Human,
            timestamp: Timestamp(0),
            source: None,
        },
    }
}

fn style() -> ShapeStyle {
    ShapeStyle { opacity: Opacity::OPAQUE, fill_opacity: None, stroke_opacity: None }
}

fn nested_snapshot() -> DocumentSnapshot {
    let document_id = DocumentId::from("document:editor");
    let mut document = blank_document(&document_id, None);
    let page_id = document.page_ids[0].clone();
    let layer_id = document.pages[&page_id].layer_ids[0].clone();
    let root_id = ShapeId::from("shape:root");
    let group_id = ShapeId::from("shape:group");
    let child_id = ShapeId::from("shape:child");
    document.layers.get_mut(&layer_id).unwrap().shape_ids = vec![root_id.clone()];
    document.shapes.insert(
        root_id.clone(),
        ShapeRecord {
            id: root_id.clone(),
            kind: ShapeKind::from(CONTAINER_KIND),
            parent: ShapeParent::Layer(layer_id.clone()),
            transform: Transform { translation: Vec2 { x: 100.0, y: 50.0 }, rotation: 0.3, scale_x: 2.0, scale_y: 2.0 },
            child_ids: vec![group_id.clone()],
            layout: Some(ContainerLayout::Free),
            properties: BTreeMap::new(),
            metadata: metadata(),
            style: style(),
            version: RecordVersion(1),
        },
    );
    document.shapes.insert(
        group_id.clone(),
        ShapeRecord {
            id: group_id.clone(),
            kind: ShapeKind::from(CONTAINER_KIND),
            parent: ShapeParent::Shape(root_id),
            transform: Transform { translation: Vec2 { x: 10.0, y: 20.0 }, rotation: -0.2, scale_x: 1.0, scale_y: 1.0 },
            child_ids: vec![child_id.clone()],
            layout: Some(ContainerLayout::Free),
            properties: BTreeMap::new(),
            metadata: metadata(),
            style: style(),
            version: RecordVersion(1),
        },
    );
    document.shapes.insert(
        child_id.clone(),
        ShapeRecord {
            id: child_id,
            kind: ShapeKind::from("rect"),
            parent: ShapeParent::Shape(group_id),
            transform: Transform { translation: Vec2 { x: 4.0, y: 8.0 }, rotation: 0.1, scale_x: 1.0, scale_y: 1.0 },
            child_ids: Vec::new(),
            layout: None,
            properties: BTreeMap::from([
                ("width".into(), Value::from(20.0)),
                ("height".into(), Value::from(10.0)),
            ]),
            metadata: metadata(),
            style: style(),
            version: RecordVersion(1),
        },
    );
    DocumentSnapshot {
        format: crate::FormatId::from(crate::INKFINITE_FORMAT_ID),
        format_version: crate::INKFINITE_FORMAT_VERSION,
        document_id,
        heads: vec![ChangeHash::from("head:one")],
        document,
    }
}

fn request(patches: Vec<EditorPatch>) -> EditorReconciliationRequest {
    EditorReconciliationRequest {
        patches,
        actor_id: ActorId::from("actor:test"),
        origin: Origin::Human,
        transaction_id: TransactionId("transaction:editor".into()),
        description: "Editor change".into(),
        timestamp: Timestamp(1),
    }
}

#[test]
fn projection_composes_ancestor_transforms_and_flattens_containers() {
    let snapshot = nested_snapshot();
    let projection = project_editor(&snapshot);
    let child = &projection.shapes[&ShapeId::from("shape:child")];
    let expected = world_transform(
        &snapshot.document,
        &snapshot.document.shapes[&ShapeId::from("shape:child")],
    );
    let actual: Affine = child.transform.into();
    assert!(same_affine(actual, expected));
    assert_eq!(child.group_id, Some(ShapeId::from("shape:group")));
    assert_eq!(projection.shapes.len(), 3);
    assert_eq!(child.props["w"], Value::from(20.0));
    assert!(!child.props.contains_key("width"));
}

#[test]
fn projection_translates_native_property_names_for_editor_clients() {
    let mut snapshot = nested_snapshot();
    let child = snapshot
        .document
        .shapes
        .get_mut(&ShapeId::from("shape:child"))
        .expect("child fixture");
    child.properties.extend([
        ("markdown".into(), Value::from("# Notes")),
        ("background".into(), Value::from("#ffffff")),
        ("font_size".into(), Value::from(16.0)),
        ("font_family".into(), Value::from("sans-serif")),
        ("asset_id".into(), Value::from("asset:one")),
        ("reference_type".into(), Value::from("url")),
    ]);
    let native = child.properties.clone();

    let projection = project_editor(&snapshot);
    let props = &projection.shapes[&ShapeId::from("shape:child")].props;
    for editor_name in [
        "w",
        "h",
        "md",
        "bg",
        "fontSize",
        "fontFamily",
        "assetId",
        "referenceType",
    ] {
        assert!(props.contains_key(editor_name), "missing {editor_name}");
    }
    assert_eq!(native_properties(props), native);
}

#[test]
fn projection_preserves_semantic_metadata() {
    let mut snapshot = nested_snapshot();
    let child_id = ShapeId::from("shape:child");
    let child = snapshot.document.shapes.get_mut(&child_id).expect("child fixture");
    child.metadata.name = Some("Gateway".into());
    child.metadata.role = Some("architecture.service".into());
    child.metadata.description = Some("Routes requests".into());
    child.metadata.tags = vec!["api".into(), "critical".into()];
    child.metadata.source = Some("architecture.md".into());
    child
        .metadata
        .custom_metadata
        .insert("owner".into(), Value::from("platform"));
    child.metadata.provenance.source = Some("seed".into());

    let projected = project_editor(&snapshot).shapes[&child_id].metadata.clone();
    assert_eq!(projected.name.as_deref(), Some("Gateway"));
    assert_eq!(projected.role.as_deref(), Some("architecture.service"));
    assert_eq!(projected.description.as_deref(), Some("Routes requests"));
    assert_eq!(projected.tags, ["api", "critical"]);
    assert_eq!(projected.source.as_deref(), Some("architecture.md"));
    assert_eq!(projected.custom_metadata["owner"], Value::from("platform"));
    assert_eq!(projected.provenance.source.as_deref(), Some("seed"));
}

#[test]
fn reconciliation_emits_one_relative_patch_for_a_world_move() {
    let snapshot = nested_snapshot();
    let projection = project_editor(&snapshot);
    let child_id = ShapeId::from("shape:child");
    let mut moved: Affine = projection.shapes[&child_id].transform.into();
    moved.e += 5.0;
    let transaction = reconcile_editor_patches(
        &snapshot,
        request(vec![EditorPatch::Shape {
            shape_id: child_id.clone(),
            transform: Some(moved.into()),
            properties: None,
            metadata: None,
            style: None,
            parent: None,
            anchor: None,
        }]),
    )
    .expect("world move should reconcile");
    assert_eq!(transaction.base_heads, snapshot.heads);
    assert_eq!(transaction.operations.len(), 1);
    let Operation::PatchShape { shape_id, patch, expected_version } = &transaction.operations[0] else {
        panic!("expected a shape patch")
    };
    assert_eq!(shape_id, &child_id);
    assert_eq!(expected_version, &Some(RecordVersion(1)));
    let local = patch.transform.expect("transform patch");
    let parent = world_transform(
        &snapshot.document,
        &snapshot.document.shapes[&ShapeId::from("shape:group")],
    );
    let expected = parent
        .inverse()
        .expect("parent is invertible")
        .point(Vec2 { x: moved.e, y: moved.f });
    assert!((local.translation.x - expected.x).abs() < 1e-9);
    assert!((local.translation.y - expected.y).abs() < 1e-9);
}

#[test]
fn reconciliation_routes_path_topology_through_canonical_geometry() {
    let mut snapshot = nested_snapshot();
    let path_id = ShapeId::from("shape:child");
    let path = snapshot.document.shapes.get_mut(&path_id).unwrap();
    path.kind = ShapeKind::from(crate::PATH_KIND);
    path.properties = BTreeMap::from([
        (
            "subpaths".into(),
            serde_json::json!([{
                "segments": [
                    { "type": "move", "to": { "x": 0.0, "y": 0.0 } },
                    { "type": "line", "to": { "x": 40.0, "y": 0.0 } },
                    { "type": "line", "to": { "x": 40.0, "y": 40.0 } }
                ],
                "closed": false
            }]),
        ),
        ("fill_rule".into(), serde_json::json!("nonzero")),
    ]);

    let transaction = reconcile_editor_patches(
        &snapshot,
        request(vec![EditorPatch::PathTopology {
            shape_id: path_id.clone(),
            operations: vec![PathTopologyOperation::AddAnchor { subpath_index: 0, segment_index: 1, t: 0.5 }],
        }]),
    )
    .expect("path topology should reconcile");

    assert_eq!(transaction.operations.len(), 1);
    let Operation::PatchShape { shape_id, patch, .. } = &transaction.operations[0] else {
        panic!("expected a path property patch")
    };
    assert_eq!(shape_id, &path_id);
    let properties = patch.properties.as_ref().expect("topology should replace properties");
    let segments = properties["subpaths"][0]["segments"].as_array().expect("segments");
    assert_eq!(segments.len(), 4);
    assert_eq!(segments[1]["to"], serde_json::json!({ "x": 20.0, "y": 0.0 }));
}

#[test]
fn reconciliation_combines_transformed_paths_and_deletes_the_other_inputs() {
    let mut snapshot = nested_snapshot();
    let path_id = ShapeId::from("shape:child");
    let parent_id = ShapeId::from("shape:group");
    let path_properties = BTreeMap::from([
        (
            "subpaths".into(),
            serde_json::json!([{
                "segments": [
                    { "type": "move", "to": { "x": 0.0, "y": 0.0 } },
                    { "type": "line", "to": { "x": 30.0, "y": 0.0 } },
                    { "type": "line", "to": { "x": 30.0, "y": 30.0 } },
                    { "type": "line", "to": { "x": 0.0, "y": 30.0 } }
                ],
                "closed": true
            }]),
        ),
        ("fill_rule".into(), serde_json::json!("evenodd")),
    ]);
    snapshot.document.shapes.get_mut(&path_id).unwrap().kind = ShapeKind::from(crate::PATH_KIND);
    snapshot.document.shapes.get_mut(&path_id).unwrap().properties = path_properties;
    let second_id = ShapeId::from("shape:second-path");
    let mut second = snapshot.document.shapes[&path_id].clone();
    second.id = second_id.clone();
    second.parent = ShapeParent::Shape(parent_id.clone());
    second.transform.translation.x += 12.0;
    second.version = RecordVersion(1);
    snapshot.document.shapes.insert(second_id.clone(), second);
    snapshot
        .document
        .shapes
        .get_mut(&parent_id)
        .unwrap()
        .child_ids
        .push(second_id.clone());
    let transaction = reconcile_editor_patches(
        &snapshot,
        request(vec![EditorPatch::BooleanPaths {
            shape_ids: vec![path_id, second_id],
            operation: BooleanPathOperation::Union,
        }]),
    )
    .expect("boolean paths should reconcile");

    assert_eq!(transaction.operations.len(), 2);
    assert!(matches!(transaction.operations[0], Operation::PatchShape { .. }));
    assert!(matches!(transaction.operations[1], Operation::DeleteShape { .. }));
}

#[test]
fn reconciliation_reparents_without_changing_a_world_transform() {
    let snapshot = nested_snapshot();
    let child_id = ShapeId::from("shape:child");
    let root_id = ShapeId::from("shape:root");
    let before = world_transform(&snapshot.document, &snapshot.document.shapes[&child_id]);
    let transaction = reconcile_editor_patches(
        &snapshot,
        request(vec![EditorPatch::Shape {
            shape_id: child_id,
            transform: None,
            properties: None,
            metadata: None,
            style: None,
            parent: Some(ShapeParent::Shape(root_id.clone())),
            anchor: Some(SiblingAnchor::Last),
        }]),
    )
    .expect("reparent should reconcile");

    assert_eq!(transaction.operations.len(), 1);
    assert!(matches!(transaction.operations[0], Operation::ReparentShape { .. }));
    let Operation::ReparentShape { parent, .. } = &transaction.operations[0] else {
        panic!("expected reparent operation")
    };
    assert_eq!(parent, &ShapeParent::Shape(root_id.clone()));
    let local = crate::engine::geometry::local_transform_from_world(&snapshot.document, parent, before)
        .expect("target parent should represent the world transform");
    let target_world = world_transform(&snapshot.document, &snapshot.document.shapes[&root_id]);
    assert!(same_affine(
        target_world.then(crate::engine::geometry::Affine::from_transform(local)),
        before
    ));
}

#[test]
fn reconciliation_omits_no_op_changes() {
    let snapshot = nested_snapshot();
    let projection = project_editor(&snapshot);
    let child = &projection.shapes[&ShapeId::from("shape:child")];
    let transaction = reconcile_editor_patches(
        &snapshot,
        request(vec![EditorPatch::Shape {
            shape_id: child.id.clone(),
            transform: Some(child.transform),
            properties: Some(child.props.clone()),
            metadata: None,
            style: Some(style()),
            parent: None,
            anchor: None,
        }]),
    )
    .expect("no-op should reconcile");
    assert!(transaction.operations.is_empty());
}

#[test]
fn reconciliation_accepts_shapes_in_new_layers() {
    let snapshot = nested_snapshot();
    let page_id = snapshot.document.page_ids[0].clone();
    let layer_id = LayerId::from("layer:new");
    let shape_id = ShapeId::from("shape:new");
    let layer = LayerRecord {
        id: layer_id.clone(),
        page_id,
        name: "New layer".into(),
        shape_ids: Vec::new(),
        visible: true,
        locked: false,
        opacity: Opacity::OPAQUE,
        version: RecordVersion(1),
    };
    let transaction = reconcile_editor_patches(
        &snapshot,
        request(vec![
            EditorPatch::CreateLayer { layer, anchor: SiblingAnchor::Last },
            EditorPatch::CreateShape {
                shape: EditorShapeDraft {
                    id: shape_id,
                    kind: ShapeKind::from("rect"),
                    properties: BTreeMap::from([
                        ("width".into(), Value::from(20.0)),
                        ("height".into(), Value::from(10.0)),
                    ]),
                    metadata: None,
                    style: style(),
                    layout: None,
                },
                parent: ShapeParent::Layer(layer_id),
                transform: EditorTransform { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 25.0, f: 30.0 },
                anchor: SiblingAnchor::Last,
            },
        ]),
    )
    .expect("a new layer can receive a shape in the same editor change");

    assert_eq!(transaction.operations.len(), 2);
    assert!(matches!(transaction.operations[0], Operation::CreateLayer { .. }));
    assert!(matches!(transaction.operations[1], Operation::CreateShape { .. }));
}

#[test]
fn reconciliation_accepts_children_created_with_their_container() {
    let snapshot = nested_snapshot();
    let page_id = snapshot.document.page_ids[0].clone();
    let layer_id = snapshot.document.pages[&page_id].layer_ids[0].clone();
    let container_id = ShapeId::from("shape:card");
    let child_id = ShapeId::from("shape:card-title");
    let transaction = reconcile_editor_patches(
        &snapshot,
        request(vec![
            EditorPatch::CreateShape {
                shape: EditorShapeDraft {
                    id: container_id.clone(),
                    kind: ShapeKind::from(CONTAINER_KIND),
                    properties: BTreeMap::from([("w".into(), Value::from(320.0)), ("h".into(), Value::from(220.0))]),
                    metadata: Some(metadata()),
                    style: style(),
                    layout: Some(ContainerLayout::Free),
                },
                parent: ShapeParent::Layer(layer_id),
                transform: EditorTransform { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 10.0, f: 20.0 },
                anchor: SiblingAnchor::Last,
            },
            EditorPatch::CreateShape {
                shape: EditorShapeDraft {
                    id: child_id,
                    kind: ShapeKind::from("text"),
                    properties: BTreeMap::from([
                        ("text".into(), Value::from("Card")),
                        ("fontSize".into(), Value::from(18.0)),
                        ("fontFamily".into(), Value::from("sans-serif")),
                        ("color".into(), Value::from("#111827")),
                        ("w".into(), Value::from(288.0)),
                    ]),
                    metadata: None,
                    style: style(),
                    layout: None,
                },
                parent: ShapeParent::Shape(container_id),
                transform: EditorTransform { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 26.0, f: 36.0 },
                anchor: SiblingAnchor::Last,
            },
        ]),
    )
    .expect("a card child can be created with its new container");

    assert_eq!(transaction.operations.len(), 2);
    assert!(matches!(transaction.operations[0], Operation::CreateShape { .. }));
    assert!(matches!(transaction.operations[1], Operation::CreateShape { .. }));
}

#[test]
fn reconciliation_allows_layer_patch_and_reorder_in_one_change() {
    let mut snapshot = nested_snapshot();
    let page_id = snapshot.document.page_ids[0].clone();
    let layer_id = LayerId::from("layer:second");
    snapshot
        .document
        .pages
        .get_mut(&page_id)
        .unwrap()
        .layer_ids
        .push(layer_id.clone());
    snapshot.document.layers.insert(
        layer_id.clone(),
        LayerRecord {
            id: layer_id.clone(),
            page_id: page_id.clone(),
            name: "Second".into(),
            shape_ids: Vec::new(),
            visible: true,
            locked: false,
            opacity: Opacity::OPAQUE,
            version: RecordVersion(1),
        },
    );

    let transaction = reconcile_editor_patches(
        &snapshot,
        request(vec![
            EditorPatch::PatchLayer {
                layer_id: layer_id.clone(),
                patch: LayerPatch { name: Some("Renamed".into()), visible: None, locked: None, opacity: None },
            },
            EditorPatch::ReorderLayer { layer_id: layer_id.clone(), anchor: SiblingAnchor::First },
            EditorPatch::RenamePage { page_id, name: "Renamed page".into() },
        ]),
    )
    .expect("layer fields and order should reconcile together");

    assert_eq!(transaction.operations.len(), 3);
    let Operation::PatchLayer { expected_version, .. } = &transaction.operations[0] else {
        panic!("expected a layer patch")
    };
    assert_eq!(*expected_version, Some(RecordVersion(1)));
    let Operation::ReorderLayer { layer_id: reordered, expected_version, .. } = &transaction.operations[1] else {
        panic!("expected a layer reorder")
    };
    assert_eq!(reordered, &layer_id);
    assert_eq!(*expected_version, None);
    let Operation::RenamePage { expected_version, .. } = &transaction.operations[2] else {
        panic!("expected a page rename")
    };
    assert_eq!(*expected_version, None);
}

#[test]
fn projection_preserves_bindings_and_order() {
    let mut snapshot = nested_snapshot();
    let binding = BindingRecord {
        id: BindingId::from("binding:one"),
        kind: crate::BindingKind::from("arrow-end"),
        source_shape_id: ShapeId::from("shape:child"),
        target_shape_id: ShapeId::from("shape:child"),
        source_handle: "end".into(),
        anchor: BindingAnchor::Center,
        relation_type: Some("depends_on".into()),
        version: RecordVersion(1),
    };
    snapshot.document.bindings.insert(binding.id.clone(), binding);
    let projection = project_editor(&snapshot);
    assert_eq!(projection.order.page_ids, snapshot.document.page_ids);
    assert_eq!(projection.bindings[&BindingId::from("binding:one")].handle, "end");
    assert_eq!(
        projection.bindings[&BindingId::from("binding:one")]
            .relation_type
            .as_deref(),
        Some("depends_on")
    );
}
