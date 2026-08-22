use super::geometry::{union, world_shape_bounds};
use super::hierarchy::{containing_layer, descendant_ids_for_layer, descendant_ids_for_shape};
use super::query::record_id_order;
use super::{AffectedRegion, BTreeMap, BTreeSet, Bounds, Document, DocumentPatch, PageId, RecordId, ShapeId};

pub fn diff_documents(before: &Document, after: &Document) -> (DocumentPatch, Vec<RecordId>) {
    let mut created = Vec::new();
    let mut changed = Vec::new();
    let mut deleted = Vec::new();
    diff_map(
        &before.pages,
        &after.pages,
        RecordId::Page,
        &mut created,
        &mut changed,
        &mut deleted,
    );
    diff_map(
        &before.layers,
        &after.layers,
        RecordId::Layer,
        &mut created,
        &mut changed,
        &mut deleted,
    );
    diff_map(
        &before.shapes,
        &after.shapes,
        RecordId::Shape,
        &mut created,
        &mut changed,
        &mut deleted,
    );
    diff_map(
        &before.bindings,
        &after.bindings,
        RecordId::Binding,
        &mut created,
        &mut changed,
        &mut deleted,
    );
    diff_map(
        &before.assets,
        &after.assets,
        RecordId::Asset,
        &mut created,
        &mut changed,
        &mut deleted,
    );
    let mut affected = created
        .iter()
        .chain(&changed)
        .chain(&deleted)
        .cloned()
        .collect::<Vec<_>>();
    affected.sort_by(record_id_order);
    (DocumentPatch { created, changed, deleted }, affected)
}

pub fn diff_map<K, V, F>(
    before: &BTreeMap<K, V>, after: &BTreeMap<K, V>, wrap: F, created: &mut Vec<RecordId>, changed: &mut Vec<RecordId>,
    deleted: &mut Vec<RecordId>,
) where
    K: Ord + Clone,
    V: PartialEq,
    F: Fn(K) -> RecordId,
{
    for (id, value) in after {
        match before.get(id) {
            None => created.push(wrap(id.clone())),
            Some(old) if old != value => changed.push(wrap(id.clone())),
            Some(_) => {}
        }
    }
    for id in before.keys() {
        if !after.contains_key(id) {
            deleted.push(wrap(id.clone()));
        }
    }
}

pub fn affected_regions(before: &Document, after: &Document, ids: &[RecordId]) -> Vec<AffectedRegion> {
    let mut regions: BTreeMap<PageId, Bounds> = BTreeMap::new();
    for id in ids {
        let mut shape_ids = visual_shape_ids(before, id);
        shape_ids.extend(visual_shape_ids(after, id));
        for shape_id in shape_ids {
            for document in [before, after] {
                let Some(shape) = document.shapes.get(&shape_id) else {
                    continue;
                };
                let Some(page_id) = containing_layer(document, shape).map(|layer| layer.page_id.clone()) else {
                    continue;
                };
                let bounds = world_shape_bounds(document, &shape_id);
                regions
                    .entry(page_id)
                    .and_modify(|current| *current = union(*current, bounds))
                    .or_insert(bounds);
            }
        }
    }
    regions
        .into_iter()
        .map(|(page_id, bounds)| AffectedRegion { page_id, bounds })
        .collect()
}

pub fn visual_shape_ids(document: &Document, id: &RecordId) -> BTreeSet<ShapeId> {
    match id {
        RecordId::Shape(shape_id) => document
            .shapes
            .contains_key(shape_id)
            .then(|| std::iter::once(shape_id.clone()).chain(descendant_ids_for_shape(document, shape_id)))
            .into_iter()
            .flatten()
            .collect(),
        RecordId::Layer(layer_id) => descendant_ids_for_layer(document, layer_id).collect(),
        RecordId::Page(page_id) => document
            .pages
            .get(page_id)
            .into_iter()
            .flat_map(|page| &page.layer_ids)
            .flat_map(|layer_id| descendant_ids_for_layer(document, layer_id))
            .collect(),
        RecordId::Binding(binding_id) => document
            .bindings
            .get(binding_id)
            .into_iter()
            .flat_map(|binding| [binding.source_shape_id.clone(), binding.target_shape_id.clone()])
            .collect(),
        RecordId::Asset(_) => BTreeSet::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_rename_is_reported_as_one_changed_record() {
        let before = crate::engine::tests::document();
        let mut after = before.clone();
        after.pages.get_mut(&PageId::from("page:one")).unwrap().name = "Renamed".into();
        let (patch, affected) = diff_documents(&before, &after);
        assert_eq!(affected, vec![RecordId::Page(PageId::from("page:one"))]);
        assert_eq!(patch.changed, affected);
    }
}
