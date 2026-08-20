use inkfinite_wasm::import_svg_json;
use serde_json::Value;

const FIXTURES: &[(&str, &str)] = &[
    (
        "Bootstrap filetype SVG",
        include_str!("../../../fixtures/svg-import/icons/bootstrap-filetype-svg.svg"),
    ),
    (
        "Catppuccin Angular",
        include_str!("../../../fixtures/svg-import/nested-groups/catppuccin-angular.svg"),
    ),
    (
        "compound path",
        include_str!("../../../fixtures/svg-import/compound-paths/ring.svg"),
    ),
    (
        "unsupported features",
        include_str!("../../../fixtures/svg-import/unsupported/feature-matrix.svg"),
    ),
];

#[test]
fn wasm_response_exercises_the_shared_fixture_corpus() {
    for (name, source) in FIXTURES {
        let response: Value = serde_json::from_str(&import_svg_json(source.as_bytes()))
            .unwrap_or_else(|error| panic!("{name} response should be JSON: {error}"));
        assert_eq!(response["status"], "success", "{name} should import");
        assert_eq!(
            response["import"]["source_asset"]["bytes"].as_array().map(Vec::len),
            Some(source.len())
        );
        assert!(
            response["import"]["root"]["children"].as_array().is_some(),
            "{name} should have a root tree"
        );
    }
}

#[test]
fn wasm_response_preserves_malformed_fixture_failures() {
    let fixtures = [
        include_bytes!("../../../fixtures/svg-import/malformed/invalid-number.svg").as_slice(),
        include_bytes!("../../../fixtures/svg-import/malformed/invalid-path.svg").as_slice(),
        include_bytes!("../../../fixtures/svg-import/malformed/invalid-transform.svg").as_slice(),
        include_bytes!("../../../fixtures/svg-import/malformed/invalid-xml.svg").as_slice(),
    ];
    for source in fixtures {
        let response: Value = serde_json::from_str(&import_svg_json(source)).expect("error response should be JSON");
        assert_eq!(response["status"], "error");
        assert!(response["error"]["code"].as_str().is_some_and(|code| !code.is_empty()));
        assert!(
            response["error"]["message"]
                .as_str()
                .is_some_and(|message| !message.is_empty())
        );
    }
}
