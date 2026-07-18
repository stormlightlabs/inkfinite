//! Migration from the frozen v1 desktop/web JSON envelope to the v2 model.

use std::collections::{BTreeMap, BTreeSet};

use crate::engine::{TransactionEngine, validate_document};
use crate::{
    ActorId, BindingAnchor, BindingId, BindingKind, BindingRecord, Document, DocumentId, LayerId,
    LayerRecord, Opacity, Origin, PageId, PageRecord, Provenance, RecordVersion, SemanticMetadata,
    ShapeId, ShapeKind, ShapeParent, ShapeProperties, ShapeRecord, ShapeStyle, Timestamp,
    Transform, Vec2, builtin_shape_kinds, validate_shape_properties,
};
use serde::Deserialize;
use serde_json::{Map, Value};

use super::FileError;

/// A normalized v2 document produced by importing a v1 JSON file.
#[derive(Clone, Debug)]
pub struct ImportedV1 {
    /// The v1 board ID used as the v2 document ID.
    pub document_id: DocumentId,
    /// Board name retained for callers that display migration information.
    pub board_name: String,
    /// Original v1 creation timestamp.
    pub created_at: Timestamp,
    /// Original v1 update timestamp.
    pub updated_at: Timestamp,
    /// Normalized v2 records.
    pub document: Document,
}

impl ImportedV1 {
    /// Consumes the import result and returns its normalized document.
    #[must_use]
    pub fn into_document(self) -> Document {
        self.document
    }

    /// Creates a Rust-owned transaction engine from the imported document.
    ///
    /// # Errors
    ///
    /// Returns an error when the actor ID is empty or the normalized document
    /// cannot be encoded by the CRDT adapter.
    pub fn into_engine(self, actor_id: ActorId) -> Result<TransactionEngine, FileError> {
        if actor_id.as_str().trim().is_empty() {
            return Err(invalid_v1("import actor ID must not be empty"));
        }
        Ok(TransactionEngine::create(
            self.document_id,
            actor_id,
            self.document,
        )?)
    }
}

/// Parses and migrates a frozen v1 JSON envelope.
///
/// The importer does not repair malformed input. It validates ownership and
/// ordering, creates one stable default layer per page, and returns a typed
/// error before any destination file can be touched.
///
/// # Errors
///
/// Returns [`FileError::Json`] for malformed JSON, [`FileError::UnsupportedFormat`]
/// for a recognized newer envelope, or [`FileError::InvalidV1`] for invalid v1
/// records and references.
#[allow(clippy::needless_pass_by_value)]
pub fn import_v1_json(input: &str, actor_id: ActorId) -> Result<ImportedV1, FileError> {
    if actor_id.as_str().trim().is_empty() {
        return Err(invalid_v1("import actor ID must not be empty"));
    }
    let value: Value = serde_json::from_str(input)?;
    reject_newer_format(&value)?;
    let envelope: LegacyEnvelope = serde_json::from_value(value)
        .map_err(|error| invalid_v1(format!("invalid envelope: {error}")))?;
    migrate(envelope, &actor_id)
}

/// Alias for [`import_v1_json`] for callers that prefer parser terminology.
///
/// # Errors
///
/// Returns the same typed import, format, and JSON errors as
/// [`import_v1_json`].
pub fn parse_v1_json(input: &str, actor_id: ActorId) -> Result<ImportedV1, FileError> {
    import_v1_json(input, actor_id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyEnvelope {
    board: LegacyBoard,
    doc: LegacyDocument,
    order: LegacyOrder,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyBoard {
    id: String,
    name: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Deserialize)]
struct LegacyDocument {
    pages: BTreeMap<String, LegacyPage>,
    shapes: BTreeMap<String, LegacyShape>,
    bindings: BTreeMap<String, LegacyBinding>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyPage {
    id: String,
    name: String,
    shape_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyShape {
    id: String,
    #[serde(rename = "type")]
    shape_type: String,
    page_id: String,
    x: f64,
    y: f64,
    rot: f64,
    #[serde(default)]
    group_id: Option<String>,
    props: Map<String, Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyBinding {
    id: String,
    #[serde(rename = "type")]
    binding_type: String,
    from_shape_id: String,
    to_shape_id: String,
    handle: String,
    anchor: LegacyAnchor,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase", tag = "kind")]
enum LegacyAnchor {
    Center,
    Edge { nx: f64, ny: f64 },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyOrder {
    page_ids: Vec<String>,
    #[serde(default)]
    shape_order: Option<BTreeMap<String, Vec<String>>>,
}

#[derive(Clone)]
struct GroupInfo {
    page_id: PageId,
    shape_ids: Vec<ShapeId>,
    positions: Vec<usize>,
}

#[allow(clippy::too_many_lines)]
fn migrate(envelope: LegacyEnvelope, actor_id: &ActorId) -> Result<ImportedV1, FileError> {
    let LegacyEnvelope { board, doc, order } = envelope;
    if board.id.trim().is_empty() {
        return Err(invalid_v1("board.id must not be empty"));
    }
    if doc.pages.is_empty() {
        return Err(invalid_v1("doc.pages must contain at least one page"));
    }

    let document_id = DocumentId::from(board.id.clone());
    let page_ids = validate_page_order(&doc.pages, &order)?;
    let ordered_shapes = validate_shape_order(&doc, &order, &page_ids)?;
    validate_shape_keys(&doc.shapes)?;
    validate_binding_keys(&doc.bindings)?;

    let timestamp = Timestamp(board.updated_at);
    let mut groups = BTreeMap::<String, GroupInfo>::new();
    let mut seen_shapes = BTreeSet::new();
    for page_id in &page_ids {
        let shape_ids = ordered_shapes
            .get(page_id)
            .ok_or_else(|| invalid_v1(format!("missing order for page {page_id}")))?;
        for (position, shape_id) in shape_ids.iter().enumerate() {
            if !seen_shapes.insert(shape_id.clone()) {
                return Err(invalid_v1(format!(
                    "shape {shape_id} appears more than once in persisted order"
                )));
            }
            let legacy_shape = doc.shapes.get(shape_id).ok_or_else(|| {
                invalid_v1(format!("page {page_id} refers to missing shape {shape_id}"))
            })?;
            if legacy_shape.page_id != page_id.as_str() {
                return Err(invalid_v1(format!(
                    "shape {shape_id} belongs to page {}, not {page_id}",
                    legacy_shape.page_id
                )));
            }
            if let Some(group_id) = legacy_shape.group_id.as_deref() {
                if group_id.trim().is_empty() {
                    return Err(invalid_v1(format!("shape {shape_id} has an empty groupId")));
                }
                let group = groups
                    .entry(group_id.to_owned())
                    .or_insert_with(|| GroupInfo {
                        page_id: page_id.clone(),
                        shape_ids: Vec::new(),
                        positions: Vec::new(),
                    });
                if group.page_id != *page_id {
                    return Err(invalid_v1(format!("group {group_id} spans multiple pages")));
                }
                group.shape_ids.push(ShapeId::from(shape_id.as_str()));
                group.positions.push(position);
            }
        }
    }
    if seen_shapes.len() != doc.shapes.len() {
        let missing = doc
            .shapes
            .keys()
            .find(|shape_id| !seen_shapes.contains(*shape_id))
            .cloned()
            .unwrap_or_else(|| "<unknown>".into());
        return Err(invalid_v1(format!(
            "shape {missing} is not present in any persisted page order"
        )));
    }
    for group_id in groups.keys() {
        if doc.shapes.contains_key(group_id) {
            return Err(invalid_v1(format!(
                "group ID {group_id} collides with a shape ID"
            )));
        }
    }

    let container_groups: BTreeSet<String> = groups
        .iter()
        .filter(|(_, group)| group.shape_ids.len() > 1 && is_contiguous(&group.positions))
        .map(|(group_id, _)| group_id.clone())
        .collect();

    let mut pages = BTreeMap::new();
    let mut layers = BTreeMap::new();
    for page_id in &page_ids {
        let legacy_page = doc
            .pages
            .get(page_id.as_str())
            .ok_or_else(|| invalid_v1(format!("page order refers to missing page {page_id}")))?;
        let layer_id = default_layer_id(page_id);
        let shape_ids = ordered_shapes
            .get(page_id)
            .ok_or_else(|| invalid_v1(format!("missing order for page {page_id}")))?;
        let mut layer_shape_ids = Vec::new();
        let mut added_groups = BTreeSet::new();
        for shape_id in shape_ids {
            let group_id = doc
                .shapes
                .get(shape_id)
                .and_then(|shape| shape.group_id.as_deref());
            if let Some(group_id) = group_id
                && container_groups.contains(group_id)
            {
                if added_groups.insert(group_id.to_owned()) {
                    layer_shape_ids.push(ShapeId::from(group_id));
                }
            } else {
                layer_shape_ids.push(ShapeId::from(shape_id.as_str()));
            }
        }
        pages.insert(
            page_id.clone(),
            PageRecord {
                id: page_id.clone(),
                name: checked_name(&legacy_page.name, "page", page_id.as_str())?,
                layer_ids: vec![layer_id.clone()],
                version: RecordVersion(1),
            },
        );
        layers.insert(
            layer_id.clone(),
            LayerRecord {
                id: layer_id,
                page_id: page_id.clone(),
                name: "Default".into(),
                shape_ids: layer_shape_ids,
                visible: true,
                locked: false,
                opacity: Opacity::OPAQUE,
                version: RecordVersion(1),
            },
        );
    }

    let mut shapes = BTreeMap::new();
    for page_id in &page_ids {
        let layer_id = default_layer_id(page_id);
        for shape_id in ordered_shapes
            .get(page_id)
            .ok_or_else(|| invalid_v1(format!("missing order for page {page_id}")))?
        {
            let legacy_shape = doc.shapes.get(shape_id).ok_or_else(|| {
                invalid_v1(format!("page {page_id} refers to missing shape {shape_id}"))
            })?;
            let kind = checked_shape_kind(legacy_shape)?;
            let group_parent = legacy_shape
                .group_id
                .as_deref()
                .filter(|group_id| container_groups.contains(*group_id))
                .map_or_else(
                    || ShapeParent::Layer(layer_id.clone()),
                    |group_id| ShapeParent::Shape(ShapeId::from(group_id)),
                );
            let mut properties = migrate_properties(&kind, &legacy_shape.props)?;
            if let Some(group_id) = legacy_shape
                .group_id
                .as_deref()
                .filter(|group_id| !container_groups.contains(*group_id))
            {
                properties.insert("legacy_group_id".into(), Value::String(group_id.into()));
            }
            let style = migrate_style(&kind, &legacy_shape.props, shape_id)?;
            let shape = ShapeRecord {
                id: ShapeId::from(shape_id.as_str()),
                kind: ShapeKind::from(kind),
                parent: group_parent,
                transform: Transform {
                    translation: Vec2 {
                        x: legacy_shape.x,
                        y: legacy_shape.y,
                    },
                    rotation: legacy_shape.rot,
                    scale_x: 1.0,
                    scale_y: 1.0,
                },
                child_ids: Vec::new(),
                layout: None,
                properties,
                metadata: imported_metadata(actor_id, timestamp, None),
                style,
                version: RecordVersion(1),
            };
            shapes.insert(ShapeId::from(shape_id.as_str()), shape);
        }
    }

    for (group_id, group) in &groups {
        if !container_groups.contains(group_id) {
            continue;
        }
        let layer_id = default_layer_id(&group.page_id);
        let container_id = ShapeId::from(group_id.as_str());
        shapes.insert(
            container_id.clone(),
            ShapeRecord {
                id: container_id,
                kind: ShapeKind::from("container"),
                parent: ShapeParent::Layer(layer_id),
                transform: identity_transform(),
                child_ids: group.shape_ids.clone(),
                layout: Some(crate::ContainerLayout::Free),
                properties: ShapeProperties::new(),
                metadata: imported_metadata(actor_id, timestamp, Some(group_id.clone())),
                style: ShapeStyle {
                    opacity: Opacity::OPAQUE,
                    fill_opacity: None,
                    stroke_opacity: None,
                },
                version: RecordVersion(1),
            },
        );
    }

    let mut bindings = BTreeMap::new();
    for (binding_key, legacy_binding) in &doc.bindings {
        if legacy_binding.id != *binding_key {
            return Err(invalid_v1(format!(
                "binding map key {binding_key} does not match id {}",
                legacy_binding.id
            )));
        }
        if legacy_binding.id.trim().is_empty()
            || legacy_binding.binding_type.trim().is_empty()
            || legacy_binding.from_shape_id.trim().is_empty()
            || legacy_binding.to_shape_id.trim().is_empty()
            || legacy_binding.handle.trim().is_empty()
        {
            return Err(invalid_v1(format!(
                "binding {binding_key} has an empty field"
            )));
        }
        let anchor = match &legacy_binding.anchor {
            LegacyAnchor::Center => BindingAnchor::Center,
            LegacyAnchor::Edge { nx, ny } => {
                if !nx.is_finite()
                    || !ny.is_finite()
                    || !(-1.0..=1.0).contains(nx)
                    || !(-1.0..=1.0).contains(ny)
                {
                    return Err(invalid_v1(format!(
                        "binding {binding_key} has an invalid edge anchor"
                    )));
                }
                BindingAnchor::Edge { x: *nx, y: *ny }
            }
        };
        let source_shape_id = ShapeId::from(legacy_binding.from_shape_id.as_str());
        let target_shape_id = ShapeId::from(legacy_binding.to_shape_id.as_str());
        if !shapes.contains_key(&source_shape_id) {
            return Err(invalid_v1(format!(
                "binding {binding_key} refers to missing source shape {}",
                legacy_binding.from_shape_id
            )));
        }
        if shapes[&source_shape_id].kind.as_str() != crate::ARROW_KIND {
            return Err(invalid_v1(format!(
                "binding {binding_key} source shape {} is not an arrow",
                legacy_binding.from_shape_id
            )));
        }
        if !shapes.contains_key(&target_shape_id) {
            return Err(invalid_v1(format!(
                "binding {binding_key} refers to missing target shape {}",
                legacy_binding.to_shape_id
            )));
        }
        bindings.insert(
            BindingId::from(binding_key.as_str()),
            BindingRecord {
                id: BindingId::from(binding_key.as_str()),
                kind: BindingKind::from(legacy_binding.binding_type.clone()),
                source_shape_id,
                target_shape_id,
                source_handle: legacy_binding.handle.clone(),
                anchor,
                version: RecordVersion(1),
            },
        );
    }

    let document = Document {
        pages,
        page_ids,
        layers,
        shapes,
        bindings,
        assets: BTreeMap::new(),
    };
    validate_document(&document)?;
    Ok(ImportedV1 {
        document_id,
        board_name: board.name,
        created_at: Timestamp(board.created_at),
        updated_at: timestamp,
        document,
    })
}

fn validate_page_order(
    pages: &BTreeMap<String, LegacyPage>,
    order: &LegacyOrder,
) -> Result<Vec<PageId>, FileError> {
    let page_ids: Vec<PageId> = order
        .page_ids
        .iter()
        .map(|id| PageId::from(id.clone()))
        .collect();
    ensure_unique(&page_ids, "page")?;
    if page_ids.len() != pages.len()
        || page_ids
            .iter()
            .any(|page_id| !pages.contains_key(page_id.as_str()))
    {
        return Err(invalid_v1(
            "order.pageIds must contain every page exactly once",
        ));
    }
    for (key, page) in pages {
        if key != &page.id {
            return Err(invalid_v1(format!(
                "page map key {key} does not match id {}",
                page.id
            )));
        }
        if page.id.trim().is_empty() {
            return Err(invalid_v1("page IDs must not be empty"));
        }
    }
    if let Some(shape_order) = &order.shape_order {
        for page_id in shape_order.keys() {
            if !pages.contains_key(page_id) {
                return Err(invalid_v1(format!(
                    "shapeOrder contains unknown page {page_id}"
                )));
            }
        }
    }
    Ok(page_ids)
}

fn validate_shape_order(
    document: &LegacyDocument,
    order: &LegacyOrder,
    page_ids: &[PageId],
) -> Result<BTreeMap<PageId, Vec<String>>, FileError> {
    let mut result = BTreeMap::new();
    for page_id in page_ids {
        let page = document
            .pages
            .get(page_id.as_str())
            .ok_or_else(|| invalid_v1(format!("page order refers to missing page {page_id}")))?;
        let page_shape_ids = page.shape_ids.clone();
        ensure_unique_strings(&page_shape_ids, "shape")?;
        let shape_ids = order
            .shape_order
            .as_ref()
            .and_then(|shape_order| shape_order.get(page_id.as_str()))
            .cloned()
            .unwrap_or(page_shape_ids.clone());
        ensure_unique_strings(&shape_ids, "shape")?;
        let expected: BTreeSet<_> = page_shape_ids.iter().collect();
        let actual: BTreeSet<_> = shape_ids.iter().collect();
        if expected != actual {
            return Err(invalid_v1(format!(
                "shape order for page {page_id} does not match page.shapeIds"
            )));
        }
        result.insert(page_id.clone(), shape_ids);
    }
    Ok(result)
}

fn validate_shape_keys(shapes: &BTreeMap<String, LegacyShape>) -> Result<(), FileError> {
    for (key, shape) in shapes {
        if key != &shape.id {
            return Err(invalid_v1(format!(
                "shape map key {key} does not match id {}",
                shape.id
            )));
        }
        if shape.id.trim().is_empty() || shape.page_id.trim().is_empty() {
            return Err(invalid_v1(format!("shape {key} has an empty ID or pageId")));
        }
        if !shape.x.is_finite() || !shape.y.is_finite() || !shape.rot.is_finite() {
            return Err(invalid_v1(format!(
                "shape {key} has a non-finite transform"
            )));
        }
    }
    Ok(())
}

fn validate_binding_keys(bindings: &BTreeMap<String, LegacyBinding>) -> Result<(), FileError> {
    for (key, binding) in bindings {
        if key != &binding.id {
            return Err(invalid_v1(format!(
                "binding map key {key} does not match id {}",
                binding.id
            )));
        }
    }
    Ok(())
}

fn checked_shape_kind(shape: &LegacyShape) -> Result<String, FileError> {
    if !builtin_shape_kinds().contains(&shape.shape_type.as_str()) {
        return Err(FileError::UnsupportedShapeKind {
            kind: shape.shape_type.clone(),
            shape_id: shape.id.clone(),
        });
    }
    Ok(shape.shape_type.clone())
}

fn migrate_properties(
    kind: &str,
    properties: &Map<String, Value>,
) -> Result<ShapeProperties, FileError> {
    let mut result: ShapeProperties = properties.clone().into_iter().collect();
    for (legacy_name, v2_name) in [("w", "width"), ("h", "height")] {
        if let Some(value) = result.remove(legacy_name) {
            if result.contains_key(v2_name) {
                return Err(invalid_v1(format!(
                    "shape properties contain both {legacy_name} and {v2_name}"
                )));
            }
            result.insert(v2_name.into(), value);
        }
    }
    validate_shape_properties(kind, &result)
        .map_err(|error| invalid_v1(format!("shape kind {kind} properties: {error}")))?;
    Ok(result)
}

fn migrate_style(
    kind: &str,
    properties: &Map<String, Value>,
    shape_id: &str,
) -> Result<ShapeStyle, FileError> {
    let mut style = ShapeStyle {
        opacity: Opacity::OPAQUE,
        fill_opacity: None,
        stroke_opacity: None,
    };
    if kind == "stroke"
        && let Some(opacity) = properties
            .get("style")
            .and_then(Value::as_object)
            .and_then(|style| style.get("opacity"))
    {
        let value = opacity.as_f64().ok_or_else(|| {
            invalid_v1(format!("stroke {shape_id} style.opacity must be a number"))
        })?;
        let value = value
            .to_string()
            .parse::<f32>()
            .map_err(|_| invalid_v1(format!("stroke {shape_id} style.opacity is out of range")))?;
        style.stroke_opacity =
            Some(Opacity::new(value).map_err(|error| {
                invalid_v1(format!("stroke {shape_id} style.opacity: {error}"))
            })?);
    }
    Ok(style)
}

fn imported_metadata(
    actor_id: &ActorId,
    timestamp: Timestamp,
    name: Option<String>,
) -> SemanticMetadata {
    SemanticMetadata {
        name,
        role: None,
        description: None,
        tags: Vec::new(),
        locked: false,
        agent_editable: true,
        provenance: Provenance {
            actor_id: actor_id.clone(),
            origin: Origin::Import,
            timestamp,
            source: Some("v1-import".into()),
        },
    }
}

fn identity_transform() -> Transform {
    Transform {
        translation: Vec2 { x: 0.0, y: 0.0 },
        rotation: 0.0,
        scale_x: 1.0,
        scale_y: 1.0,
    }
}

fn default_layer_id(page_id: &PageId) -> LayerId {
    LayerId::new(format!("layer:{}:default", page_id.as_str()))
}

fn is_contiguous(positions: &[usize]) -> bool {
    positions
        .first()
        .zip(positions.last())
        .is_some_and(|(first, last)| last - first + 1 == positions.len())
}

fn checked_name(name: &str, kind: &str, id: &str) -> Result<String, FileError> {
    if name.trim().is_empty() {
        return Err(invalid_v1(format!("{kind} {id} has an empty name")));
    }
    Ok(name.to_owned())
}

fn ensure_unique<T>(values: &[T], kind: &str) -> Result<(), FileError>
where
    T: Ord + std::fmt::Display,
{
    let mut seen = BTreeSet::new();
    for value in values {
        if !seen.insert(value) {
            return Err(invalid_v1(format!("{kind} {value} appears more than once")));
        }
    }
    Ok(())
}

fn ensure_unique_strings(values: &[String], kind: &str) -> Result<(), FileError> {
    let mut seen = BTreeSet::new();
    for value in values {
        if !seen.insert(value) {
            return Err(invalid_v1(format!("{kind} {value} appears more than once")));
        }
    }
    Ok(())
}

fn reject_newer_format(value: &Value) -> Result<(), FileError> {
    let Some(object) = value.as_object() else {
        return Err(invalid_v1("v1 envelope must be a JSON object"));
    };
    let Some(format) = object.get("format") else {
        return Ok(());
    };
    let format = format
        .as_str()
        .ok_or_else(|| invalid_v1("format must be a string"))?;
    let version_value = object
        .get("format_version")
        .or_else(|| object.get("formatVersion"))
        .or_else(|| object.get("version"));
    let version = version_value
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(0);
    Err(FileError::UnsupportedFormat {
        format: format.to_owned(),
        version,
    })
}

fn invalid_v1(message: impl Into<String>) -> FileError {
    FileError::InvalidV1(message.into())
}
