//! Editor-facing projection data types.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::connector::ResolvedArrowGeometry;
use crate::engine::geometry::Affine;
use crate::{
    BindingAnchor, ContainerLayout, LayerId, Opacity, PageId, SemanticMetadata, ShapeId, ShapeKind, ShapeProperties,
    ShapeStyle,
};

/// Full affine transform used by the editor projection.
///
/// Unlike the canonical [`Transform`], this representation can retain the
/// result of composing ancestor transforms even when the composition includes
/// non-uniform scale and rotation.
#[derive(Clone, Copy, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct EditorTransform {
    /// Horizontal scale and rotation component.
    pub a: f64,
    /// Vertical shear and rotation component.
    pub b: f64,
    /// Horizontal shear and rotation component.
    pub c: f64,
    /// Vertical scale and rotation component.
    pub d: f64,
    /// Horizontal translation.
    pub e: f64,
    /// Vertical translation.
    pub f: f64,
}

impl From<Affine> for EditorTransform {
    fn from(value: Affine) -> Self {
        Self { a: value.a, b: value.b, c: value.c, d: value.d, e: value.e, f: value.f }
    }
}

impl From<EditorTransform> for Affine {
    fn from(value: EditorTransform) -> Self {
        Self { a: value.a, b: value.b, c: value.c, d: value.d, e: value.e, f: value.f }
    }
}

/// One shape projected into the editor's flat depth-first shape collection.
///
/// Containers are included so the editor can select them as one object and
/// enter their child scope. They have no direct drawing primitive; their
/// descendants remain in the same depth-first order.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct EditorShape {
    /// Stable shape identifier.
    pub id: ShapeId,
    /// Editor registry key.
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub kind: ShapeKind,
    /// Page containing the shape.
    pub page_id: PageId,
    /// Complete native-to-world transform.
    pub transform: EditorTransform,
    /// Legacy translation fields used by the current editor interaction model.
    pub x: f64,
    /// Legacy translation field used by the current editor interaction model.
    pub y: f64,
    /// Legacy rotation field used by the current editor interaction model.
    pub rot: f64,
    /// Immediate container parent, when the shape is inside a container.
    pub group_id: Option<ShapeId>,
    /// Owning editor layer.
    pub layer_id: LayerId,
    /// Complete-shape opacity.
    pub opacity: Opacity,
    /// Optional fill opacity.
    pub fill_opacity: Option<Opacity>,
    /// Optional stroke opacity.
    pub stroke_opacity: Option<Opacity>,
    /// Whether this shape and its descendants can be edited.
    pub locked: bool,
    /// Agent editability retained for editor policy surfaces.
    pub agent_editable: bool,
    /// Semantic fields exposed to card and inspector controls.
    pub metadata: SemanticMetadata,
    /// Kind-specific properties using editor property names.
    #[ts(type = "ShapeProperties")]
    pub props: ShapeProperties,
    /// Rust-resolved arrow geometry for interactive consumers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_geometry: Option<ResolvedArrowGeometry>,
}

/// A new shape supplied by an editor patch.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct EditorShapeDraft {
    /// Stable shape identifier.
    pub id: ShapeId,
    /// Native registry key.
    pub kind: ShapeKind,
    /// Kind-specific properties using editor property names.
    #[ts(type = "ShapeProperties")]
    pub properties: ShapeProperties,
    /// Optional semantic metadata. Missing metadata receives editor defaults.
    pub metadata: Option<SemanticMetadata>,
    /// Common visual style.
    pub style: ShapeStyle,
    /// Optional container layout.
    pub layout: Option<ContainerLayout>,
}

/// Page represented in the flat editor document.
#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct EditorPage {
    /// Stable page identifier.
    pub id: PageId,
    /// User-visible page name.
    pub name: String,
    /// Shape IDs in depth-first draw order, including containers.
    pub shape_ids: Vec<ShapeId>,
    /// Layer IDs in back-to-front order.
    pub layer_ids: Vec<LayerId>,
}

/// Layer represented in the flat editor document.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct EditorLayer {
    /// Stable layer identifier.
    pub id: LayerId,
    /// Owning page identifier.
    pub page_id: PageId,
    /// User-visible layer name.
    pub name: String,
    /// Shape IDs in depth-first draw order, including containers.
    pub shape_ids: Vec<ShapeId>,
    /// Whether the layer participates in rendering.
    pub visible: bool,
    /// Whether the layer can be selected or changed.
    pub locked: bool,
    /// Inherited layer opacity.
    pub opacity: Opacity,
}

/// Binding represented in the editor's binding collection.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct EditorBinding {
    /// Stable binding identifier.
    pub id: crate::BindingId,
    /// Editor binding kind.
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub kind: crate::BindingKind,
    /// Source arrow or connector.
    pub from_shape_id: ShapeId,
    /// Target shape.
    pub to_shape_id: ShapeId,
    /// Source handle.
    pub handle: String,
    /// Target anchor.
    pub anchor: BindingAnchor,
    /// Optional semantic relationship type.
    pub relation_type: Option<String>,
}

/// Ordering information accompanying an editor projection.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct EditorOrder {
    /// Page IDs in document order.
    pub page_ids: Vec<PageId>,
    /// Flattened depth-first shape order by page.
    pub shape_order: BTreeMap<PageId, Vec<ShapeId>>,
    /// Layer records in their projected form.
    pub layers: BTreeMap<LayerId, EditorLayer>,
}

/// Native document projected into the editor's flat document shape.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct EditorProjection {
    /// Projected pages.
    pub pages: BTreeMap<PageId, EditorPage>,
    /// Projected layers.
    pub layers: BTreeMap<LayerId, EditorLayer>,
    /// Shapes with composed world transforms, including containers.
    pub shapes: BTreeMap<ShapeId, EditorShape>,
    /// Projected bindings.
    pub bindings: BTreeMap<crate::BindingId, EditorBinding>,
    /// Stable ordering metadata.
    pub order: EditorOrder,
}
