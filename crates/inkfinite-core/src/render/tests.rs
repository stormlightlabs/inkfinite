#![allow(clippy::float_cmp)]

use std::collections::{BTreeMap, BTreeSet};

use crate::{
    ActorId, AssetId, AssetRecord, AssetSource, BindingAnchor, BindingId, BindingKind, BindingRecord, ChangeHash,
    ContainerLayout, Document, DocumentId, DocumentSnapshot, FormatId, INKFINITE_FORMAT_ID, INKFINITE_FORMAT_VERSION,
    LayerId, LayerRecord, Opacity, Origin, PageId, PageRecord, Provenance, RecordVersion, SemanticMetadata, ShapeId,
    ShapeKind, ShapeParent, ShapeProperties, ShapeRecord, ShapeStyle, Timestamp, Transform, Vec2,
};

use super::*;

fn fixture_snapshot() -> DocumentSnapshot {
    DocumentSnapshot {
        format: FormatId::from(INKFINITE_FORMAT_ID),
        format_version: INKFINITE_FORMAT_VERSION,
        document_id: DocumentId::from("document:native-fixtures"),
        heads: vec![ChangeHash::from("render-fixture")],
        document: fixture_document(),
    }
}

fn fixture_document() -> Document {
    let fixtures_page = PageId::from("page:fixtures");
    let ordering_page = PageId::from("page:ordering");
    let fixtures_layer = LayerId::from("layer:page:fixtures:default");
    let ordering_layer = LayerId::from("layer:page:ordering:default");

    let group_card = ShapeId::from("group:card");
    let mut shapes = BTreeMap::new();
    add_shape(
        &mut shapes,
        shape(
            "shape:stencil-sticky",
            "rect",
            ShapeParent::Layer(fixtures_layer.clone()),
            560.0,
            40.0,
            0.0,
            props([
                ("w", serde_json::json!(200)),
                ("h", serde_json::json!(200)),
                ("fill", serde_json::json!("#fff740")),
                ("stroke", serde_json::json!("transparent")),
                ("radius", serde_json::json!(0)),
            ]),
            Vec::new(),
        ),
    );
    add_shape(
        &mut shapes,
        shape(
            "shape:stencil-process",
            "rect",
            ShapeParent::Layer(fixtures_layer.clone()),
            40.0,
            40.0,
            0.0,
            props([
                ("w", serde_json::json!(120)),
                ("h", serde_json::json!(80)),
                ("fill", serde_json::json!("#ffffff")),
                ("stroke", serde_json::json!("#000000")),
                ("radius", serde_json::json!(0)),
            ]),
            Vec::new(),
        ),
    );
    add_shape(
        &mut shapes,
        shape(
            "shape:stencil-decision",
            "rect",
            ShapeParent::Layer(fixtures_layer.clone()),
            220.0,
            40.0,
            std::f64::consts::FRAC_PI_4,
            props([
                ("w", serde_json::json!(80)),
                ("h", serde_json::json!(80)),
                ("fill", serde_json::json!("#ffffff")),
                ("stroke", serde_json::json!("#000000")),
                ("radius", serde_json::json!(0)),
            ]),
            Vec::new(),
        ),
    );
    add_shape(
        &mut shapes,
        shape(
            "shape:stencil-terminator",
            "rect",
            ShapeParent::Layer(fixtures_layer.clone()),
            380.0,
            40.0,
            0.0,
            props([
                ("w", serde_json::json!(120)),
                ("h", serde_json::json!(60)),
                ("fill", serde_json::json!("#ffffff")),
                ("stroke", serde_json::json!("#000000")),
                ("radius", serde_json::json!(30)),
            ]),
            Vec::new(),
        ),
    );
    add_shape(
        &mut shapes,
        shape(
            "shape:stencil-card",
            "rect",
            ShapeParent::Shape(group_card.clone()),
            40.0,
            220.0,
            0.0,
            props([
                ("w", serde_json::json!(300)),
                ("h", serde_json::json!(200)),
                ("fill", serde_json::json!("#ffffff")),
                ("stroke", serde_json::json!("#333333")),
                ("radius", serde_json::json!(8)),
            ]),
            Vec::new(),
        ),
    );
    add_shape(
        &mut shapes,
        shape(
            "shape:stencil-card-divider",
            "line",
            ShapeParent::Shape(group_card),
            40.0,
            270.0,
            0.0,
            props([
                ("a", serde_json::json!({ "x": 0, "y": 0 })),
                ("b", serde_json::json!({ "x": 300, "y": 0 })),
                ("stroke", serde_json::json!("#333333")),
                ("width", serde_json::json!(1)),
            ]),
            Vec::new(),
        ),
    );
    add_shape(
        &mut shapes,
        shape(
            "shape:ellipse",
            "ellipse",
            ShapeParent::Layer(fixtures_layer.clone()),
            400.0,
            280.0,
            0.0,
            props([
                ("w", serde_json::json!(150)),
                ("h", serde_json::json!(100)),
                ("fill", serde_json::json!("#dbeafe")),
                ("stroke", serde_json::json!("#1d4ed8")),
            ]),
            Vec::new(),
        ),
    );
    add_shape(
        &mut shapes,
        shape(
            "shape:line",
            "line",
            ShapeParent::Layer(fixtures_layer.clone()),
            400.0,
            430.0,
            0.0,
            props([
                ("a", serde_json::json!({ "x": 0, "y": 0 })),
                ("b", serde_json::json!({ "x": 180, "y": 60 })),
                ("stroke", serde_json::json!("#334155")),
                ("width", serde_json::json!(3)),
            ]),
            Vec::new(),
        ),
    );
    add_shape(
        &mut shapes,
        shape(
            "shape:arrow",
            "arrow",
            ShapeParent::Layer(fixtures_layer.clone()),
            0.0,
            0.0,
            0.0,
            props([
                (
                    "points",
                    serde_json::json!([
                        { "x": 160, "y": 80 },
                        { "x": 350, "y": 160 },
                        { "x": 475, "y": 330 }
                    ]),
                ),
                (
                    "style",
                    serde_json::json!({
                        "stroke": "#7c3aed",
                        "width": 2,
                        "headStart": true,
                        "headEnd": true,
                        "dash": [8, 4]
                    }),
                ),
                ("routing", serde_json::json!({ "kind": "orthogonal" })),
                (
                    "label",
                    serde_json::json!({ "text": "bound route", "align": "center", "offset": 12 }),
                ),
            ]),
            Vec::new(),
        ),
    );
    add_shape(
        &mut shapes,
        shape(
            "shape:text",
            "text",
            ShapeParent::Layer(fixtures_layer.clone()),
            620.0,
            300.0,
            0.0,
            props([
                ("text", serde_json::json!("Inkfinite native fixture")),
                ("fontSize", serde_json::json!(18)),
                ("fontFamily", serde_json::json!("Inter")),
                ("color", serde_json::json!("#111827")),
                ("w", serde_json::json!(180)),
            ]),
            Vec::new(),
        ),
    );
    add_shape(
        &mut shapes,
        shape_with_style(
            "shape:stroke",
            "stroke",
            ShapeParent::Layer(fixtures_layer.clone()),
            0.0,
            0.0,
            0.0,
            props([
                (
                    "points",
                    serde_json::json!([[620, 390, 0.2], [650, 410, 0.6], [690, 395, 0.9], [730, 430, 0.5]]),
                ),
                ("style", serde_json::json!({ "color": "#dc2626", "opacity": 0.75 })),
                (
                    "brush",
                    serde_json::json!({
                        "size": 12,
                        "thinning": 0.5,
                        "smoothing": 0.5,
                        "streamline": 0.5,
                        "simulatePressure": false
                    }),
                ),
            ]),
            Vec::new(),
            Some(0.75),
        ),
    );
    add_shape(
        &mut shapes,
        shape(
            "shape:markdown",
            "markdown",
            ShapeParent::Layer(fixtures_layer.clone()),
            40.0,
            500.0,
            0.0,
            props([
                (
                    "md",
                    serde_json::json!(
                        "# Native Markdown\n\n- **bold** item\n- `code` item\n\n```ts\nconst scale = 1;\n```"
                    ),
                ),
                ("w", serde_json::json!(360)),
                ("h", serde_json::json!(240)),
                ("fontSize", serde_json::json!(16)),
                ("fontFamily", serde_json::json!("Inter")),
                ("color", serde_json::json!("#0f172a")),
                ("bg", serde_json::json!("#f8fafc")),
                ("border", serde_json::json!("#94a3b8")),
            ]),
            Vec::new(),
        ),
    );
    add_shape(
        &mut shapes,
        shape(
            "shape:ordering-back",
            "rect",
            ShapeParent::Layer(ordering_layer.clone()),
            100.0,
            100.0,
            0.0,
            props([
                ("w", serde_json::json!(180)),
                ("h", serde_json::json!(180)),
                ("fill", serde_json::json!("#ef4444")),
                ("stroke", serde_json::json!("#7f1d1d")),
                ("radius", serde_json::json!(0)),
            ]),
            Vec::new(),
        ),
    );
    add_shape(
        &mut shapes,
        shape(
            "shape:ordering-middle",
            "ellipse",
            ShapeParent::Layer(ordering_layer.clone()),
            130.0,
            130.0,
            0.0,
            props([
                ("w", serde_json::json!(180)),
                ("h", serde_json::json!(180)),
                ("fill", serde_json::json!("#22c55e")),
                ("stroke", serde_json::json!("#14532d")),
            ]),
            Vec::new(),
        ),
    );
    add_shape(
        &mut shapes,
        shape(
            "shape:ordering-front",
            "rect",
            ShapeParent::Layer(ordering_layer.clone()),
            160.0,
            160.0,
            0.0,
            props([
                ("w", serde_json::json!(180)),
                ("h", serde_json::json!(180)),
                ("fill", serde_json::json!("#3b82f6")),
                ("stroke", serde_json::json!("#1e3a8a")),
                ("radius", serde_json::json!(16)),
            ]),
            Vec::new(),
        ),
    );
    add_shape(
        &mut shapes,
        shape(
            "group:card",
            "container",
            ShapeParent::Layer(fixtures_layer.clone()),
            0.0,
            0.0,
            0.0,
            ShapeProperties::new(),
            vec![
                ShapeId::from("shape:stencil-card"),
                ShapeId::from("shape:stencil-card-divider"),
            ],
        ),
    );

    Document {
        pages: BTreeMap::from([
            (
                fixtures_page.clone(),
                PageRecord {
                    id: fixtures_page.clone(),
                    name: "All features".into(),
                    layer_ids: vec![fixtures_layer.clone()],
                    version: RecordVersion(1),
                },
            ),
            (
                ordering_page.clone(),
                PageRecord {
                    id: ordering_page.clone(),
                    name: "Persisted ordering".into(),
                    layer_ids: vec![ordering_layer.clone()],
                    version: RecordVersion(1),
                },
            ),
        ]),
        page_ids: vec![ordering_page, fixtures_page],
        layers: BTreeMap::from([
            (
                fixtures_layer.clone(),
                LayerRecord {
                    id: fixtures_layer,
                    page_id: PageId::from("page:fixtures"),
                    name: "Default".into(),
                    shape_ids: vec![
                        ShapeId::from("shape:stencil-sticky"),
                        ShapeId::from("shape:stencil-process"),
                        ShapeId::from("shape:stencil-decision"),
                        ShapeId::from("shape:stencil-terminator"),
                        ShapeId::from("group:card"),
                        ShapeId::from("shape:ellipse"),
                        ShapeId::from("shape:line"),
                        ShapeId::from("shape:arrow"),
                        ShapeId::from("shape:text"),
                        ShapeId::from("shape:stroke"),
                        ShapeId::from("shape:markdown"),
                    ],
                    visible: true,
                    locked: false,
                    opacity: Opacity::OPAQUE,
                    version: RecordVersion(1),
                },
            ),
            (
                ordering_layer.clone(),
                LayerRecord {
                    id: ordering_layer,
                    page_id: PageId::from("page:ordering"),
                    name: "Default".into(),
                    shape_ids: vec![
                        ShapeId::from("shape:ordering-back"),
                        ShapeId::from("shape:ordering-middle"),
                        ShapeId::from("shape:ordering-front"),
                    ],
                    visible: true,
                    locked: false,
                    opacity: Opacity::OPAQUE,
                    version: RecordVersion(1),
                },
            ),
        ]),
        shapes,
        bindings: BTreeMap::from([
            (
                BindingId::from("binding:arrow-start"),
                BindingRecord {
                    id: BindingId::from("binding:arrow-start"),
                    kind: BindingKind::from("arrow-end"),
                    source_shape_id: ShapeId::from("shape:arrow"),
                    target_shape_id: ShapeId::from("shape:stencil-process"),
                    source_handle: "start".into(),
                    anchor: BindingAnchor::Edge { x: 1.0, y: 0.0 },
                    relation_type: None,
                    version: RecordVersion(1),
                },
            ),
            (
                BindingId::from("binding:arrow-end"),
                BindingRecord {
                    id: BindingId::from("binding:arrow-end"),
                    kind: BindingKind::from("arrow-end"),
                    source_shape_id: ShapeId::from("shape:arrow"),
                    target_shape_id: ShapeId::from("shape:ellipse"),
                    source_handle: "end".into(),
                    anchor: BindingAnchor::Center,
                    relation_type: None,
                    version: RecordVersion(1),
                },
            ),
        ]),
        assets: BTreeMap::new(),
    }
}

fn props<const N: usize>(entries: [(&str, serde_json::Value); N]) -> ShapeProperties {
    entries.into_iter().map(|(key, value)| (key.into(), value)).collect()
}

fn add_shape(shapes: &mut BTreeMap<ShapeId, ShapeRecord>, shape: ShapeRecord) {
    shapes.insert(shape.id.clone(), shape);
}

#[allow(clippy::too_many_arguments)]
fn shape(
    id: &str, kind: &str, parent: ShapeParent, x: f64, y: f64, rotation: f64, properties: ShapeProperties,
    child_ids: Vec<ShapeId>,
) -> ShapeRecord {
    shape_with_style(id, kind, parent, x, y, rotation, properties, child_ids, None)
}

#[allow(clippy::too_many_arguments)]
fn shape_with_style(
    id: &str, kind: &str, parent: ShapeParent, x: f64, y: f64, rotation: f64, properties: ShapeProperties,
    child_ids: Vec<ShapeId>, stroke_opacity: Option<f32>,
) -> ShapeRecord {
    ShapeRecord {
        id: ShapeId::from(id),
        kind: ShapeKind::from(kind),
        parent,
        transform: Transform { translation: Vec2 { x, y }, rotation, scale_x: 1.0, scale_y: 1.0 },
        child_ids,
        layout: (kind == "container").then_some(ContainerLayout::Free),
        properties,
        metadata: metadata(),
        style: ShapeStyle {
            opacity: Opacity::OPAQUE,
            fill_opacity: None,
            stroke_opacity: stroke_opacity.map(|value| Opacity::new(value).expect("fixture opacity")),
        },
        version: RecordVersion(1),
    }
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
            actor_id: ActorId::from("actor:render-test"),
            origin: Origin::System,
            timestamp: Timestamp(1),
            source: None,
        },
    }
}

#[test]
fn renders_image_masks_captions_and_reference_cards() {
    let mut snapshot = fixture_snapshot();
    let page_id = PageId::from("page:ordering");
    let layer_id = LayerId::from("layer:page:ordering:default");
    let image_id = ShapeId::from("shape:image-rich");
    let reference_id = ShapeId::from("shape:reference");
    snapshot
        .document
        .layers
        .get_mut(&layer_id)
        .unwrap()
        .shape_ids
        .extend([image_id.clone(), reference_id.clone()]);
    snapshot.document.shapes.insert(
        image_id,
        shape(
            "shape:image-rich",
            "image",
            ShapeParent::Layer(layer_id.clone()),
            320.0,
            40.0,
            0.0,
            props([
                ("w", serde_json::json!(160)),
                ("h", serde_json::json!(100)),
                ("assetId", serde_json::json!("asset:image")),
                ("caption", serde_json::json!("A caption")),
                ("mask", serde_json::json!({ "kind": "ellipse" })),
            ]),
            Vec::new(),
        ),
    );
    snapshot.document.shapes.insert(
        reference_id,
        shape(
            "shape:reference",
            "reference",
            ShapeParent::Layer(layer_id),
            520.0,
            40.0,
            0.0,
            props([
                ("w", serde_json::json!(240)),
                ("h", serde_json::json!(72)),
                ("referenceType", serde_json::json!("url")),
                ("value", serde_json::json!("https://example.com")),
                ("label", serde_json::json!("Example")),
            ]),
            Vec::new(),
        ),
    );
    snapshot.document.assets.insert(
        AssetId::from("asset:image"),
        AssetRecord {
            id: AssetId::from("asset:image"),
            name: "image.png".into(),
            media_type: "image/png".into(),
            digest: "sha256:image".into(),
            source: AssetSource::Embedded { bytes: vec![137, 80, 78, 71] },
            provenance: metadata().provenance,
            version: RecordVersion(1),
        },
    );
    let rendered = render_svg(
        &snapshot,
        &SvgRenderOptions { page_id: Some(page_id), ..Default::default() },
    )
    .unwrap();
    assert!(rendered.svg.contains("inkfinite-image-mask-shape-image-rich"));
    assert!(rendered.svg.contains("A caption"));
    assert!(rendered.svg.contains("https://example.com"));
}

#[test]
fn renders_object_metadata_attributes() {
    let mut snapshot = fixture_snapshot();
    let shape = snapshot
        .document
        .shapes
        .get_mut(&ShapeId::from("shape:stencil-process"))
        .expect("process fixture");
    shape.metadata.name = Some("Gateway".into());
    shape.metadata.role = Some("architecture.service".into());
    shape.metadata.description = Some("Routes requests".into());
    shape.metadata.tags = vec!["api".into(), "critical".into()];
    shape.metadata.source = Some("architecture.md".into());
    shape
        .metadata
        .custom_metadata
        .insert("owner".into(), serde_json::json!("platform"));

    let rendered = render_svg(
        &snapshot,
        &SvgRenderOptions { page_id: Some(PageId::from("page:fixtures")), ..Default::default() },
    )
    .expect("fixture renders");
    assert!(rendered.svg.contains("data-name=\"Gateway\""));
    assert!(rendered.svg.contains("data-role=\"architecture.service\""));
    assert!(rendered.svg.contains("data-description=\"Routes requests\""));
    assert!(rendered.svg.contains("data-tags=\"api,critical\""));
    assert!(rendered.svg.contains("data-source=\"architecture.md\""));
    assert!(
        rendered
            .svg
            .contains("data-metadata=\"{&quot;owner&quot;:&quot;platform&quot;}\"")
    );
}

#[test]
fn render_is_deterministic_and_covers_every_visual_builtin() {
    let snapshot = fixture_snapshot();
    let options = SvgRenderOptions { page_id: Some(PageId::from("page:fixtures")), ..SvgRenderOptions::default() };
    let first = render_svg(&snapshot, &options).expect("fixture renders");
    let second = render_svg(&snapshot, &options).expect("fixture renders again");
    assert_eq!(
        first.svg,
        include_str!("../../../../fixtures/native/rendering/all-builtins.svg")
    );

    assert_eq!(first, second);
    for element in ["<rect", "<ellipse", "<line", "<path", "<text"] {
        assert!(first.svg.contains(element), "missing {element} in SVG");
    }
    for shape_id in [
        "shape:stencil-process",
        "shape:ellipse",
        "shape:line",
        "shape:arrow",
        "shape:text",
        "shape:stroke",
        "shape:markdown",
        "group:card",
    ] {
        assert!(
            first.svg.contains(&format!("data-shape-id=\"{shape_id}\"")),
            "missing {shape_id}"
        );
    }
    assert!(first.svg.contains("stroke-dasharray=\"8 4\""));
    assert!(first.svg.contains("bound route"));
    assert_eq!(
        first.warnings,
        vec![
            SvgRenderWarning::MissingFont {
                shape_id: ShapeId::from("shape:markdown"),
                requested: "Inter".into(),
                fallback: FALLBACK_FONT.into(),
            },
            SvgRenderWarning::MissingFont {
                shape_id: ShapeId::from("shape:text"),
                requested: "Inter".into(),
                fallback: FALLBACK_FONT.into(),
            },
        ]
    );
}

#[test]
fn renders_imported_snake_case_text_properties() {
    let mut snapshot = fixture_snapshot();
    let shape = snapshot
        .document
        .shapes
        .get_mut(&ShapeId::from("shape:text"))
        .expect("text fixture");
    shape.properties.remove("fontSize");
    shape.properties.remove("fontFamily");
    shape.properties.insert("font_size".into(), serde_json::json!(18));
    shape
        .properties
        .insert("font_family".into(), serde_json::json!("Inter"));

    let output = render_svg(
        &snapshot,
        &SvgRenderOptions { page_id: Some(PageId::from("page:fixtures")), ..SvgRenderOptions::default() },
    )
    .expect("imported text renders");

    assert!(output.svg.contains("data-shape-id=\"shape:text\""));
}

#[test]
fn frame_child_order_controls_svg_presentation_order() {
    let mut snapshot = fixture_snapshot();
    let frame_id = ShapeId::from("group:card");
    snapshot
        .document
        .shapes
        .get_mut(&frame_id)
        .expect("fixture frame")
        .child_ids
        .reverse();
    let output = render_svg(
        &snapshot,
        &SvgRenderOptions { page_id: Some(PageId::from("page:fixtures")), ..SvgRenderOptions::default() },
    )
    .expect("frame renders");
    let divider = output
        .svg
        .find("data-shape-id=\"shape:stencil-card-divider\"")
        .expect("divider exported");
    let card = output
        .svg
        .find("data-shape-id=\"shape:stencil-card\"")
        .expect("card exported");
    assert!(divider < card, "export follows the persisted child order");
}

#[test]
fn renders_native_path_geometry_with_curves_and_fill_rule() {
    let mut snapshot = fixture_snapshot();
    let layer_id = LayerId::from("layer:page:fixtures:default");
    let path_id = ShapeId::from("shape:path");
    add_shape(
        &mut snapshot.document.shapes,
        shape(
            "shape:path",
            "path",
            ShapeParent::Shape(ShapeId::from("group:path")),
            10.0,
            20.0,
            0.0,
            props([
                (
                    "subpaths",
                    serde_json::json!([{
                        "segments": [
                            { "type": "move", "to": { "x": 0, "y": 0 } },
                            { "type": "line", "to": { "x": 40, "y": 0 } },
                            { "type": "quadratic", "control": { "x": 50, "y": 10 }, "to": { "x": 40, "y": 20 } },
                            { "type": "cubic", "control_1": { "x": 40, "y": 30 }, "control_2": { "x": 0, "y": 30 }, "to": { "x": 0, "y": 20 } }
                        ],
                        "closed": true
                    }]),
                ),
                ("fill_rule", serde_json::json!("evenodd")),
                ("fill", serde_json::json!("#fef08a")),
                ("stroke", serde_json::json!("#854d0e")),
                ("stroke_width", serde_json::json!(3)),
            ]),
            Vec::new(),
        ),
    );
    add_shape(
        &mut snapshot.document.shapes,
        shape(
            "group:path",
            "container",
            ShapeParent::Layer(layer_id.clone()),
            5.0,
            6.0,
            0.0,
            props([("w", serde_json::json!(100)), ("h", serde_json::json!(100))]),
            vec![path_id],
        ),
    );
    snapshot
        .document
        .layers
        .get_mut(&layer_id)
        .expect("fixture layer")
        .shape_ids
        .push(ShapeId::from("group:path"));

    let output = render_svg(
        &snapshot,
        &SvgRenderOptions {
            page_id: Some(PageId::from("page:fixtures")),
            selection: BTreeSet::from([ShapeId::from("shape:path")]),
            region: Some(Bounds { x: 0.0, y: 0.0, width: 100.0, height: 100.0 }),
            ..SvgRenderOptions::default()
        },
    )
    .expect("path renders");

    assert_eq!(
        output.svg,
        include_str!("../../../../fixtures/native/rendering/path.svg")
    );
}

#[test]
fn nested_renderer_composes_parent_transforms_for_selection_and_bounds() {
    let mut snapshot = fixture_snapshot();
    let group_id = ShapeId::from("group:card");
    let child_id = ShapeId::from("shape:stencil-card");
    snapshot.document.shapes.get_mut(&group_id).unwrap().transform =
        Transform { translation: Vec2 { x: 100.0, y: 120.0 }, rotation: 0.35, scale_x: 2.0, scale_y: 0.75 };
    snapshot.document.shapes.get_mut(&child_id).unwrap().transform =
        Transform { translation: Vec2 { x: 20.0, y: 30.0 }, rotation: -0.2, scale_x: 1.25, scale_y: 0.8 };
    let expected = world_transform(&snapshot.document, &snapshot.document.shapes[&child_id]);
    let output = render_svg(
        &snapshot,
        &SvgRenderOptions {
            page_id: Some(PageId::from("page:fixtures")),
            selection: BTreeSet::from([child_id.clone()]),
            ..SvgRenderOptions::default()
        },
    )
    .expect("nested selection renders");

    assert!(output.svg.contains(&format!("data-shape-id=\"{child_id}\"")));
    assert!(output.svg.contains(&format!("transform=\"{}\"", affine_svg(expected))));
    assert!(output.svg.contains("viewBox=\""));
}

#[test]
fn filters_page_layer_selection_and_region_without_changing_order() {
    let mut snapshot = fixture_snapshot();
    let page_id = PageId::from("page:ordering");
    let layer_id = snapshot.document.pages[&page_id].layer_ids[0].clone();
    let options = SvgRenderOptions { page_id: Some(page_id), ..SvgRenderOptions::default() };
    let page = render_svg(&snapshot, &options).expect("page renders");
    let back = page.svg.find("shape:ordering-back").expect("back shape");
    let middle = page.svg.find("shape:ordering-middle").expect("middle shape");
    let front = page.svg.find("shape:ordering-front").expect("front shape");
    assert!(back < middle && middle < front);

    let selected = render_svg(
        &snapshot,
        &SvgRenderOptions {
            page_id: options.page_id.clone(),
            selection: BTreeSet::from([ShapeId::from("shape:ordering-middle")]),
            ..SvgRenderOptions::default()
        },
    )
    .expect("selection renders");
    assert!(!selected.svg.contains("shape:ordering-back"));
    assert!(selected.svg.contains("shape:ordering-middle"));
    assert!(!selected.svg.contains("shape:ordering-front"));

    let region = render_svg(
        &snapshot,
        &SvgRenderOptions {
            page_id: options.page_id.clone(),
            region: Some(Bounds { x: 125.0, y: 125.0, width: 10.0, height: 10.0 }),
            ..SvgRenderOptions::default()
        },
    )
    .expect("region renders");
    assert!(region.svg.contains("viewBox=\"125 125 10 10\""));
    assert!(region.svg.contains("clip-path=\"url(#inkfinite-region)\""));
    assert!(region.svg.contains("shape:ordering-back"));
    assert!(region.svg.contains("shape:ordering-middle"));
    assert!(!region.svg.contains("shape:ordering-front"));

    snapshot.document.layers.get_mut(&layer_id).expect("layer").locked = true;
    let locked = render_svg(
        &snapshot,
        &SvgRenderOptions { layer_ids: BTreeSet::from([layer_id.clone()]), ..options.clone() },
    )
    .expect("locked layer remains visible");
    assert!(locked.svg.contains("shape:ordering-back"));

    snapshot.document.layers.get_mut(&layer_id).expect("layer").visible = false;
    let hidden = render_svg(
        &snapshot,
        &SvgRenderOptions { layer_ids: BTreeSet::from([layer_id]), ..options },
    )
    .expect("hidden layer renders empty");
    assert!(!hidden.svg.contains("data-shape-id"));
}

#[test]
fn missing_assets_warn_in_stable_order() {
    let mut snapshot = fixture_snapshot();
    let shape = snapshot
        .document
        .shapes
        .get_mut(&ShapeId::from("shape:stencil-process"))
        .expect("shape");
    shape
        .properties
        .insert("asset_id".into(), serde_json::json!("asset:missing"));
    let output = render_svg(
        &snapshot,
        &SvgRenderOptions { page_id: Some(PageId::from("page:fixtures")), ..SvgRenderOptions::default() },
    )
    .expect("fallback renders");
    assert!(output.warnings.contains(&SvgRenderWarning::MissingAsset {
        shape_id: ShapeId::from("shape:stencil-process"),
        asset_id: AssetId::from("asset:missing"),
    }));
}

#[test]
fn renders_gradient_paints_with_stop_opacity_transform_and_spread() {
    let mut snapshot = fixture_snapshot();
    let shape = snapshot
        .document
        .shapes
        .get_mut(&ShapeId::from("shape:stencil-process"))
        .expect("shape");
    shape.properties.insert(
        "fill".into(),
        serde_json::json!({
            "kind": "linear_gradient",
            "x1": 0,
            "y1": 0,
            "x2": 1,
            "y2": 0,
            "units": "object_bounding_box",
            "transform": { "a": 1, "b": 0, "c": 0, "d": 1, "e": 4, "f": 5 },
            "spread": "reflect",
            "stops": [
                { "offset": 0, "color": "#111111", "opacity": 1 },
                { "offset": 1, "color": "#ffffff", "opacity": 0.4 }
            ]
        }),
    );
    let output = render_svg(
        &snapshot,
        &SvgRenderOptions { page_id: Some(PageId::from("page:fixtures")), ..SvgRenderOptions::default() },
    )
    .expect("gradient renders");
    assert!(output.svg.contains("<linearGradient"));
    assert!(output.svg.contains("gradientTransform=\"matrix(1 0 0 1 4 5)\""));
    assert!(output.svg.contains("spreadMethod=\"reflect\""));
    assert!(output.svg.contains("stop-opacity=\"0.4\""));
    assert!(
        output
            .svg
            .contains("fill=\"url(#inkfinite-gradient-shape-stencil-process-fill)\"")
    );
}

#[test]
fn invalid_page_and_region_are_typed_errors() {
    let snapshot = fixture_snapshot();
    assert_eq!(
        render_svg(
            &snapshot,
            &SvgRenderOptions { page_id: Some(PageId::from("page:missing")), ..SvgRenderOptions::default() }
        ),
        Err(SvgRenderError::PageNotFound { page_id: PageId::from("page:missing") })
    );
    assert_eq!(
        render_svg(
            &snapshot,
            &SvgRenderOptions {
                region: Some(Bounds { x: 0.0, y: 0.0, width: -1.0, height: 1.0 }),
                ..SvgRenderOptions::default()
            }
        ),
        Err(SvgRenderError::InvalidRegion)
    );
}

#[test]
fn wrapped_text_preserves_explicit_and_blank_lines() {
    assert_eq!(
        wrap_text("Overview\n\nIncidents", 200.0, 16.0),
        ["Overview", "", "Incidents"]
    );
}
