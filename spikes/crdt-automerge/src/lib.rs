#![forbid(unsafe_code)]

//! Disposable Automerge boundary proof for Inkfinite V2-02.

use std::error::Error;

use automerge::sync::{State as SyncState, SyncDoc};
use automerge::transaction::{CommitOptions, Transactable};
use automerge::{ActorId, AutoCommit, AutoSerde, ObjId, ObjType, ReadDoc, ScalarValue, ROOT};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Error returned by the proof boundary.
pub type ProofError = Box<dyn Error + Send + Sync + 'static>;

/// A path to a scalar, list, text, or record inside an Inkfinite document.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DocumentPath(pub Vec<String>);

impl DocumentPath {
    /// Build a path from its segments.
    #[must_use]
    pub fn new(segments: &[&str]) -> Self {
        Self(
            segments
                .iter()
                .map(|segment| (*segment).to_owned())
                .collect(),
        )
    }
}

/// Metadata needed to apply a compensating, actor-scoped change.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct UndoRecord {
    path: DocumentPath,
    before: Value,
    after: Value,
}

/// Incremental output from one Inkfinite-owned change.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ChangeSummary {
    /// Automerge heads after the change.
    pub heads: Vec<String>,
    /// Number of incremental patches produced by the change.
    pub patch_count: usize,
}

/// The project-owned boundary used by the disposable Automerge proof.
pub struct ProofDocument {
    document: AutoCommit,
}

impl ProofDocument {
    /// Create an Automerge document from a materialized JSON snapshot.
    ///
    /// # Errors
    ///
    /// Returns an error if the root is not a JSON map or Automerge rejects a value.
    pub fn from_snapshot(snapshot: &Value, actor: &[u8]) -> Result<Self, ProofError> {
        let mut document = AutoCommit::new().with_actor(ActorId::from(actor.to_vec()));
        insert_root(&mut document, snapshot)?;
        document.commit_with(CommitOptions::default().with_message("import snapshot"));
        document.update_diff_cursor();
        Ok(Self { document })
    }

    /// Load the compact Automerge representation using a new local actor.
    ///
    /// # Errors
    ///
    /// Returns an error if `bytes` is not a valid Automerge document.
    pub fn load(bytes: &[u8], actor: &[u8]) -> Result<Self, ProofError> {
        let mut document = AutoCommit::load(bytes)?.with_actor(ActorId::from(actor.to_vec()));
        document.update_diff_cursor();
        Ok(Self { document })
    }

    /// Return a deterministic JSON projection of the current state.
    ///
    /// # Errors
    ///
    /// Returns an error if the Automerge projection cannot be serialized as JSON.
    pub fn snapshot(&mut self) -> Result<Value, ProofError> {
        self.document.commit();
        Ok(serde_json::to_value(AutoSerde::from(&self.document))?)
    }

    /// Return the current causal heads as display strings.
    pub fn heads(&mut self) -> Vec<String> {
        self.document
            .get_heads()
            .iter()
            .map(ToString::to_string)
            .collect()
    }

    /// Return the current actor ID.
    #[must_use]
    pub fn actor_id(&self) -> String {
        self.document.get_actor().to_string()
    }

    /// Save a compact Automerge document.
    pub fn save(&mut self) -> Vec<u8> {
        self.document.save()
    }

    /// Save only changes not emitted by earlier incremental saves.
    pub fn save_incremental(&mut self) -> Vec<u8> {
        self.document.save_incremental()
    }

    /// Fork at the current heads and assign an explicit actor to the replica.
    #[must_use]
    pub fn fork(&mut self, actor: &[u8]) -> Self {
        self.document.commit();
        let mut document = self.document.fork();
        document.set_actor(ActorId::from(actor.to_vec()));
        document.update_diff_cursor();
        Self { document }
    }

    /// Merge another replica and return incremental patch and head metadata.
    ///
    /// # Errors
    ///
    /// Returns an error if Automerge rejects a change from the other replica.
    pub fn merge(&mut self, other: &mut Self) -> Result<ChangeSummary, ProofError> {
        self.document.merge(&mut other.document)?;
        Ok(self.change_summary())
    }

    /// Set a scalar property as one named Automerge change.
    ///
    /// # Errors
    ///
    /// Returns an error if the path is missing, the value is not scalar, or the change fails.
    pub fn set_scalar(
        &mut self,
        path: &DocumentPath,
        value: &Value,
        message: &str,
    ) -> Result<ChangeSummary, ProofError> {
        let (object, property) = self.parent_and_property(path)?;
        self.document.put(&object, property, scalar(value)?)?;
        self.finish_change(message)
    }

    /// Set a scalar and capture the data required for a safe compensating undo.
    ///
    /// # Errors
    ///
    /// Returns an error if the current value cannot be read or the change fails.
    pub fn set_scalar_with_undo(
        &mut self,
        path: &DocumentPath,
        value: &Value,
        message: &str,
    ) -> Result<(ChangeSummary, UndoRecord), ProofError> {
        let before = self.value_at(path)?;
        let summary = self.set_scalar(path, value, message)?;
        Ok((
            summary,
            UndoRecord {
                path: path.clone(),
                before,
                after: value.clone(),
            },
        ))
    }

    /// Apply a local compensating change unless concurrent work replaced the value.
    ///
    /// # Errors
    ///
    /// Returns an error if the path cannot be read or the compensating change fails.
    pub fn undo(&mut self, record: &UndoRecord) -> Result<Option<ChangeSummary>, ProofError> {
        if self.value_at(&record.path)? != record.after {
            return Ok(None);
        }
        self.set_scalar(&record.path, &record.before, "actor-scoped undo")
            .map(Some)
    }

    /// Insert a scalar into an ordered list.
    ///
    /// # Errors
    ///
    /// Returns an error if the list path, index, or scalar value is invalid.
    pub fn list_insert(
        &mut self,
        path: &DocumentPath,
        index: usize,
        value: &Value,
        message: &str,
    ) -> Result<ChangeSummary, ProofError> {
        let object = self.object_at(path)?;
        self.document.insert(&object, index, scalar(value)?)?;
        self.finish_change(message)
    }

    /// Delete an item from an ordered list.
    ///
    /// # Errors
    ///
    /// Returns an error if the list path or index is invalid.
    pub fn list_delete(
        &mut self,
        path: &DocumentPath,
        index: usize,
        message: &str,
    ) -> Result<ChangeSummary, ProofError> {
        let object = self.object_at(path)?;
        self.document.delete(&object, index)?;
        self.finish_change(message)
    }

    /// Splice collaborative text at Unicode scalar offsets.
    ///
    /// # Errors
    ///
    /// Returns an error if the text path or splice range is invalid.
    pub fn text_splice(
        &mut self,
        path: &DocumentPath,
        index: usize,
        delete: isize,
        text: &str,
        message: &str,
    ) -> Result<ChangeSummary, ProofError> {
        let object = self.object_at(path)?;
        self.document.splice_text(&object, index, delete, text)?;
        self.finish_change(message)
    }

    /// Delete a map record.
    ///
    /// # Errors
    ///
    /// Returns an error if the record path is invalid or the delete fails.
    pub fn delete_record(
        &mut self,
        path: &DocumentPath,
        message: &str,
    ) -> Result<ChangeSummary, ProofError> {
        let (object, property) = self.parent_and_property(path)?;
        self.document.delete(&object, property)?;
        self.finish_change(message)
    }

    /// Replace the materialized root as one causally-later repair change.
    ///
    /// # Errors
    ///
    /// Returns an error if the replacement is invalid or Automerge rejects the change.
    pub fn replace_snapshot(
        &mut self,
        snapshot: &Value,
        message: &str,
    ) -> Result<ChangeSummary, ProofError> {
        let keys: Vec<String> = self.document.keys(ROOT).collect();
        for key in keys {
            self.document.delete(ROOT, key)?;
        }
        insert_root(&mut self.document, snapshot)?;
        self.finish_change(message)
    }

    fn finish_change(&mut self, message: &str) -> Result<ChangeSummary, ProofError> {
        let hash = self
            .document
            .commit_with(CommitOptions::default().with_message(message));
        if hash.is_none() {
            return Err(format!("change '{message}' contained no operations").into());
        }
        Ok(self.change_summary())
    }

    fn change_summary(&mut self) -> ChangeSummary {
        let patch_count = self.document.diff_incremental().len();
        ChangeSummary {
            heads: self.heads(),
            patch_count,
        }
    }

    fn value_at(&self, path: &DocumentPath) -> Result<Value, ProofError> {
        let (object, property) = self.parent_and_property(path)?;
        let Some((value, _object_id)) = self.document.get(&object, property)? else {
            return Err(format!("document path does not exist: {}", path.0.join("/")).into());
        };
        if value.is_object() {
            return Err("expected scalar at document path".into());
        }
        let value = value.into_scalar().map_err(|_| "expected scalar")?;
        scalar_to_json(&value)
    }

    fn object_at(&self, path: &DocumentPath) -> Result<ObjId, ProofError> {
        let mut object = ROOT;
        for segment in &path.0 {
            let Some((value, child)) = self.document.get(&object, segment.as_str())? else {
                return Err(format!("document path does not exist: {}", path.0.join("/")).into());
            };
            if !value.is_object() {
                return Err(format!("document path is not an object: {}", path.0.join("/")).into());
            }
            object = child;
        }
        Ok(object)
    }

    fn parent_and_property(&self, path: &DocumentPath) -> Result<(ObjId, String), ProofError> {
        let (property, parents) = path
            .0
            .split_last()
            .ok_or("document path must contain at least one segment")?;
        Ok((
            self.object_at(&DocumentPath(parents.to_vec()))?,
            property.clone(),
        ))
    }
}

/// Exchange transport-independent sync messages until both peers are quiescent.
///
/// # Errors
///
/// Returns an error if a sync message is invalid or the peers do not quiesce.
pub fn synchronize(left: &mut ProofDocument, right: &mut ProofDocument) -> Result<(), ProofError> {
    let mut left_state = SyncState::new();
    let mut right_state = SyncState::new();
    for _ in 0..100 {
        let left_message = left.document.sync().generate_sync_message(&mut left_state);
        let right_message = right
            .document
            .sync()
            .generate_sync_message(&mut right_state);
        let done = left_message.is_none() && right_message.is_none();
        if let Some(message) = left_message {
            right
                .document
                .sync()
                .receive_sync_message(&mut right_state, message)?;
        }
        if let Some(message) = right_message {
            left.document
                .sync()
                .receive_sync_message(&mut left_state, message)?;
        }
        if done {
            return Ok(());
        }
    }
    Err("sync did not quiesce within 100 rounds".into())
}

/// Repair hierarchy and referential invariants using deterministic IDs and ordering.
///
/// # Errors
///
/// Returns an error if the snapshot lacks the maps and fields required for repair.
pub fn repair_snapshot(snapshot: &Value) -> Result<Value, ProofError> {
    let mut repaired = snapshot.clone();
    let root = repaired
        .as_object_mut()
        .ok_or("snapshot root must be a map")?;

    let page_ids: Vec<String> = map(root, "pages")?.keys().cloned().collect();
    if page_ids.is_empty() {
        return Err("snapshot must contain at least one page".into());
    }

    for page_id in &page_ids {
        let page = map_mut(root, "pages")?
            .get_mut(page_id)
            .and_then(Value::as_object_mut)
            .ok_or("page must be a map")?;
        let layers = page
            .get_mut("layers")
            .and_then(Value::as_array_mut)
            .ok_or("page layers must be a list")?;
        layers.sort_by_key(|value| value.as_str().unwrap_or_default().to_owned());
        layers.dedup();
        if layers.is_empty() {
            let layer_id = format!("layer:recovered:{page_id}");
            layers.push(Value::String(layer_id.clone()));
            map_mut(root, "layers")?.insert(
                layer_id,
                serde_json::json!({ "children": [], "pageId": page_id }),
            );
        }
    }

    let valid_parents: Vec<String> = map(root, "layers")?
        .keys()
        .chain(map(root, "shapes")?.keys())
        .cloned()
        .collect();
    let fallback_parent = map(root, "pages")?
        .values()
        .filter_map(|page| page.get("layers"))
        .filter_map(Value::as_array)
        .flatten()
        .filter_map(Value::as_str)
        .min()
        .ok_or("no layer available after repair")?
        .to_owned();

    for shape in map_mut(root, "shapes")?.values_mut() {
        let shape = shape.as_object_mut().ok_or("shape must be a map")?;
        let parent = shape.get("parentId").and_then(Value::as_str);
        if parent.is_none_or(|parent| !valid_parents.iter().any(|valid| valid == parent)) {
            shape.insert(
                "parentId".to_owned(),
                Value::String(fallback_parent.clone()),
            );
        }
        shape.insert("children".to_owned(), Value::Array(Vec::new()));
    }
    for layer in map_mut(root, "layers")?.values_mut() {
        layer
            .as_object_mut()
            .ok_or("layer must be a map")?
            .insert("children".to_owned(), Value::Array(Vec::new()));
    }

    let parent_pairs: Vec<(String, String)> = map(root, "shapes")?
        .iter()
        .map(|(shape_id, shape)| {
            let parent = shape
                .get("parentId")
                .and_then(Value::as_str)
                .ok_or("shape parentId must be a string")?;
            Ok((parent.to_owned(), shape_id.clone()))
        })
        .collect::<Result<_, ProofError>>()?;
    for (parent_id, shape_id) in parent_pairs {
        let parent = if map(root, "layers")?.contains_key(&parent_id) {
            map_mut(root, "layers")?.get_mut(&parent_id)
        } else {
            map_mut(root, "shapes")?.get_mut(&parent_id)
        }
        .and_then(Value::as_object_mut)
        .ok_or("repaired parent must exist")?;
        parent
            .get_mut("children")
            .and_then(Value::as_array_mut)
            .ok_or("parent children must be a list")?
            .push(Value::String(shape_id));
    }
    for collection in ["layers", "shapes"] {
        for record in map_mut(root, collection)?.values_mut() {
            if let Some(children) = record.get_mut("children").and_then(Value::as_array_mut) {
                children.sort_by_key(|value| value.as_str().unwrap_or_default().to_owned());
            }
        }
    }

    repair_bindings(root)?;
    validate_snapshot(&repaired)?;
    Ok(repaired)
}

/// Validate the invariants exercised at the merge-adoption boundary.
///
/// # Errors
///
/// Returns an error describing the first invalid hierarchy or reference found.
pub fn validate_snapshot(snapshot: &Value) -> Result<(), ProofError> {
    let root = snapshot.as_object().ok_or("snapshot root must be a map")?;
    let pages = map(root, "pages")?;
    let layers = map(root, "layers")?;
    let shapes = map(root, "shapes")?;
    for (page_id, page) in pages {
        let page_layers = page
            .get("layers")
            .and_then(Value::as_array)
            .ok_or("page layers must be a list")?;
        if page_layers.is_empty() {
            return Err(format!("page {page_id} has no layer").into());
        }
        for layer_id in page_layers.iter().filter_map(Value::as_str) {
            if !layers.contains_key(layer_id) {
                return Err(format!("page {page_id} refers to missing layer {layer_id}").into());
            }
        }
    }

    let mut seen = std::collections::BTreeSet::new();
    for (parent_id, parent) in layers.iter().chain(shapes.iter()) {
        for child in parent
            .get("children")
            .and_then(Value::as_array)
            .ok_or("parent children must be a list")?
            .iter()
            .filter_map(Value::as_str)
        {
            if !seen.insert(child) {
                return Err(format!("duplicate child {child}").into());
            }
            let actual_parent = shapes
                .get(child)
                .and_then(|shape| shape.get("parentId"))
                .and_then(Value::as_str);
            if actual_parent != Some(parent_id) {
                return Err(format!("child {child} has inconsistent parent").into());
            }
        }
    }
    if seen.len() != shapes.len() {
        return Err("one or more shapes have no parent listing".into());
    }
    for (binding_id, binding) in map(root, "bindings")? {
        for key in ["fromShapeId", "toShapeId"] {
            let shape_id = binding
                .get(key)
                .and_then(Value::as_str)
                .ok_or("binding endpoint missing")?;
            if !shapes.contains_key(shape_id) {
                return Err(format!("binding {binding_id} dangles at {shape_id}").into());
            }
        }
    }
    Ok(())
}

fn repair_bindings(root: &mut Map<String, Value>) -> Result<(), ProofError> {
    let shape_ids: Vec<String> = map(root, "shapes")?.keys().cloned().collect();
    map_mut(root, "bindings")?.retain(|_, binding| {
        ["fromShapeId", "toShapeId"].iter().all(|key| {
            binding
                .get(key)
                .and_then(Value::as_str)
                .is_some_and(|id| shape_ids.iter().any(|shape_id| shape_id == id))
        })
    });
    Ok(())
}

fn insert_root(document: &mut AutoCommit, snapshot: &Value) -> Result<(), ProofError> {
    let object = snapshot.as_object().ok_or("snapshot root must be a map")?;
    for (key, value) in object {
        insert_map_value(document, &ROOT, key, value)?;
    }
    Ok(())
}

fn insert_map_value<T: Transactable>(
    document: &mut T,
    parent: &ObjId,
    key: &str,
    value: &Value,
) -> Result<(), ProofError> {
    match value {
        Value::Object(values) => {
            let child = document.put_object(parent, key, ObjType::Map)?;
            for (child_key, child_value) in values {
                insert_map_value(document, &child, child_key, child_value)?;
            }
        }
        Value::Array(values) => {
            let child = document.put_object(parent, key, ObjType::List)?;
            for (index, child_value) in values.iter().enumerate() {
                insert_list_value(document, &child, index, child_value)?;
            }
        }
        Value::String(text) if key == "content" => {
            let child = document.put_object(parent, key, ObjType::Text)?;
            document.splice_text(&child, 0, 0, text)?;
        }
        scalar_value => document.put(parent, key, scalar(scalar_value)?)?,
    }
    Ok(())
}

fn insert_list_value<T: Transactable>(
    document: &mut T,
    parent: &ObjId,
    index: usize,
    value: &Value,
) -> Result<(), ProofError> {
    match value {
        Value::Object(values) => {
            let child = document.insert_object(parent, index, ObjType::Map)?;
            for (key, child_value) in values {
                insert_map_value(document, &child, key, child_value)?;
            }
        }
        Value::Array(values) => {
            let child = document.insert_object(parent, index, ObjType::List)?;
            for (child_index, child_value) in values.iter().enumerate() {
                insert_list_value(document, &child, child_index, child_value)?;
            }
        }
        scalar_value => document.insert(parent, index, scalar(scalar_value)?)?,
    }
    Ok(())
}

fn scalar(value: &Value) -> Result<ScalarValue, ProofError> {
    match value {
        Value::Null => Ok(ScalarValue::Null),
        Value::Bool(value) => Ok(ScalarValue::Boolean(*value)),
        Value::Number(value) => value
            .as_i64()
            .map(ScalarValue::Int)
            .or_else(|| value.as_u64().map(ScalarValue::Uint))
            .or_else(|| value.as_f64().map(ScalarValue::F64))
            .ok_or_else(|| "JSON number is outside Automerge's scalar range".into()),
        Value::String(value) => Ok(ScalarValue::Str(value.clone().into())),
        Value::Array(_) | Value::Object(_) => Err("expected a JSON scalar".into()),
    }
}

fn scalar_to_json(value: &ScalarValue) -> Result<Value, ProofError> {
    match value {
        ScalarValue::Null => Ok(Value::Null),
        ScalarValue::Boolean(value) => Ok(Value::Bool(*value)),
        ScalarValue::Int(value) => Ok(Value::from(*value)),
        ScalarValue::Uint(value) => Ok(Value::from(*value)),
        ScalarValue::F64(value) => Ok(Value::from(*value)),
        ScalarValue::Str(value) => Ok(Value::String(value.to_string())),
        ScalarValue::Bytes(_)
        | ScalarValue::Counter(_)
        | ScalarValue::Timestamp(_)
        | ScalarValue::Unknown { .. } => Err("proof snapshot contains a non-JSON scalar".into()),
    }
}

fn map<'a>(root: &'a Map<String, Value>, key: &str) -> Result<&'a Map<String, Value>, ProofError> {
    root.get(key)
        .and_then(Value::as_object)
        .ok_or_else(|| format!("{key} must be a map").into())
}

fn map_mut<'a>(
    root: &'a mut Map<String, Value>,
    key: &str,
) -> Result<&'a mut Map<String, Value>, ProofError> {
    root.get_mut(key)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| format!("{key} must be a map").into())
}
