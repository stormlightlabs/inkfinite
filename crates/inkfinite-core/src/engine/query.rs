use super::geometry::{intersects, world_shape_bounds};
use super::hierarchy::containing_layer;
use super::{BTreeMap, BTreeSet, DocumentSnapshot, Ordering, Query, QueryRecord, QueryResult, RecordId, ShapeParent};

#[allow(clippy::too_many_lines)]
pub fn query_document(snapshot: &DocumentSnapshot, query: &Query) -> QueryResult {
    let document = &snapshot.document;
    let mut records = Vec::new();
    let mut bounds = BTreeMap::new();
    for page in document.pages.values() {
        if matches_common(query, page.id.as_str(), Some(&page.name))
            && query.role.is_none()
            && query.tag.is_none()
            && query.shape_kind.is_none()
            && query.layer_id.is_none()
            && query.parent_id.is_none()
            && query.bounds.is_none()
        {
            records.push(RecordId::Page(page.id.clone()));
        }
    }
    for layer in document.layers.values() {
        if matches_common(query, layer.id.as_str(), Some(&layer.name))
            && query.role.is_none()
            && query.tag.is_none()
            && query.shape_kind.is_none()
            && query.page_id.as_ref().is_none_or(|id| id == &layer.page_id)
            && query.layer_id.as_ref().is_none_or(|id| id == &layer.id)
            && query.parent_id.is_none()
            && query.bounds.is_none()
        {
            records.push(RecordId::Layer(layer.id.clone()));
        }
    }
    for shape in document.shapes.values() {
        let containing_layer = containing_layer(document, shape);
        if containing_layer.is_some_and(|layer| !layer.visible) {
            continue;
        }
        let shape_bounds = world_shape_bounds(document, &shape.id);
        let layer = containing_layer.map(|layer| layer.id.clone());
        let page = layer
            .as_ref()
            .and_then(|id| document.layers.get(id))
            .map(|layer| layer.page_id.clone());
        let parent = match &shape.parent {
            ShapeParent::Layer(id) => id.as_str(),
            ShapeParent::Shape(id) => id.as_str(),
        };
        let matches = matches_common(query, shape.id.as_str(), shape.metadata.name.as_ref())
            && query
                .role
                .as_ref()
                .is_none_or(|role| shape.metadata.role.as_ref() == Some(role))
            && query.tag.as_ref().is_none_or(|tag| shape.metadata.tags.contains(tag))
            && query.shape_kind.as_ref().is_none_or(|kind| shape.kind.as_str() == kind)
            && query.page_id.as_ref().is_none_or(|id| page.as_ref() == Some(id))
            && query.layer_id.as_ref().is_none_or(|id| layer.as_ref() == Some(id))
            && query.parent_id.as_ref().is_none_or(|id| parent == id)
            && query
                .bounds
                .as_ref()
                .is_none_or(|filter| intersects(&shape_bounds, filter));
        if matches {
            records.push(RecordId::Shape(shape.id.clone()));
            bounds.insert(shape.id.clone(), shape_bounds);
        }
    }
    for binding in document.bindings.values() {
        if matches_common(query, binding.id.as_str(), None)
            && query.role.is_none()
            && query.tag.is_none()
            && query.shape_kind.is_none()
            && query.page_id.is_none()
            && query.layer_id.is_none()
            && query.parent_id.is_none()
            && query.bounds.is_none()
        {
            records.push(RecordId::Binding(binding.id.clone()));
        }
    }
    for asset in document.assets.values() {
        if matches_common(query, asset.id.as_str(), Some(&asset.name))
            && query.role.is_none()
            && query.tag.is_none()
            && query.shape_kind.is_none()
            && query.page_id.is_none()
            && query.layer_id.is_none()
            && query.parent_id.is_none()
            && query.bounds.is_none()
        {
            records.push(RecordId::Asset(asset.id.clone()));
        }
    }
    records.sort_by(record_id_order);
    let total = records.len();
    if let Some(limit) = query.limit {
        records.truncate(limit as usize);
    }
    let returned_shapes: BTreeSet<_> = records
        .iter()
        .filter_map(|record| match record {
            RecordId::Shape(shape_id) => Some(shape_id.clone()),
            _ => None,
        })
        .collect();
    bounds.retain(|shape_id, _| returned_shapes.contains(shape_id));
    let details = if query.include_records {
        records
            .iter()
            .filter_map(|record| match record {
                RecordId::Page(id) => document.pages.get(id).cloned().map(Box::new).map(QueryRecord::Page),
                RecordId::Layer(id) => document.layers.get(id).cloned().map(Box::new).map(QueryRecord::Layer),
                RecordId::Shape(id) => document.shapes.get(id).cloned().map(Box::new).map(QueryRecord::Shape),
                RecordId::Binding(id) => document
                    .bindings
                    .get(id)
                    .cloned()
                    .map(Box::new)
                    .map(QueryRecord::Binding),
                RecordId::Asset(id) => document.assets.get(id).cloned().map(Box::new).map(QueryRecord::Asset),
            })
            .collect()
    } else {
        Vec::new()
    };
    let truncated = total > records.len();
    QueryResult { heads: snapshot.heads.clone(), records, bounds, details, total, truncated }
}

pub fn matches_common(query: &Query, id: &str, name: Option<&String>) -> bool {
    query.id.as_ref().is_none_or(|expected| expected == id)
        && query
            .name
            .as_ref()
            .is_none_or(|expected| name.is_some_and(|name| name == expected))
}

pub fn record_id_order(left: &RecordId, right: &RecordId) -> Ordering {
    record_sort_key(left).cmp(&record_sort_key(right))
}

pub fn record_sort_key(record: &RecordId) -> (u8, &str) {
    match record {
        RecordId::Page(id) => (0, id.as_str()),
        RecordId::Layer(id) => (1, id.as_str()),
        RecordId::Shape(id) => (2, id.as_str()),
        RecordId::Binding(id) => (3, id.as_str()),
        RecordId::Asset(id) => (4, id.as_str()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PageId, ShapeId};

    #[test]
    fn record_order_is_stable_across_record_kinds() {
        let mut records = [
            RecordId::Shape(ShapeId::from("shape")),
            RecordId::Page(PageId::from("page")),
        ];
        records.sort_by(record_id_order);
        assert!(matches!(records[0], RecordId::Page(_)));
    }
}
