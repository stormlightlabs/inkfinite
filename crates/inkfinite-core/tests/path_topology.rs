use inkfinite_core::PathGeometry;
use inkfinite_core::path::{PathTopologyOperation, apply_path_topology_operations};
use serde::Deserialize;

#[derive(Deserialize)]
struct TopologyFixture {
    cases: Vec<TopologyCase>,
}

#[derive(Deserialize)]
struct TopologyCase {
    name: String,
    geometry: PathGeometry,
    operations: Vec<PathTopologyOperation>,
    expected: PathGeometry,
}

#[test]
fn canonical_topology_operations_match_shared_fixtures() {
    let fixture: TopologyFixture = serde_json::from_str(include_str!("../../../fixtures/native/path-topology.json"))
        .expect("path topology fixture should decode");
    for case in fixture.cases {
        let mut actual = case.geometry;
        apply_path_topology_operations(&mut actual, &case.operations)
            .unwrap_or_else(|error| panic!("{}: {error}", case.name));
        assert_eq!(actual, case.expected, "{}", case.name);
    }
}
