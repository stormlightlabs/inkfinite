#![allow(clippy::float_cmp)]

use std::collections::BTreeSet;

use crate::file::import_v1_json;
use crate::{ActorId, ChangeHash, DocumentSnapshot, FormatId, INKFINITE_FORMAT_ID, INKFINITE_FORMAT_VERSION};

use super::*;

fn fixture_snapshot() -> DocumentSnapshot {
    let imported = import_v1_json(
        include_str!("../../../../fixtures/v1/desktop/all-features.inkfinite.json"),
        ActorId::from("actor:render-test"),
    )
    .expect("render fixture imports");
    DocumentSnapshot {
        format: FormatId::from(INKFINITE_FORMAT_ID),
        format_version: INKFINITE_FORMAT_VERSION,
        document_id: imported.document_id,
        heads: vec![ChangeHash::from("render-fixture")],
        document: imported.document,
    }
}

#[test]
fn render_is_deterministic_and_covers_every_visual_builtin() {
    let snapshot = fixture_snapshot();
    let options = SvgRenderOptions { page_id: Some(PageId::from("page:fixtures")), ..SvgRenderOptions::default() };
    let first = render_svg(&snapshot, &options).expect("fixture renders");
    let second = render_svg(&snapshot, &options).expect("fixture renders again");
    assert_eq!(
        first.svg,
        include_str!("../../../../fixtures/v2/rendering/all-builtins.svg")
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
