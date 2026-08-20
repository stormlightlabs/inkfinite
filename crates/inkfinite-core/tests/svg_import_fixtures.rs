use inkfinite_core::svg_import::{SvgImportError, SvgImportNode, SvgUnsupportedFeature, parse_svg};
use inkfinite_core::{PathFillRule, path_geometry_from_properties};

const VALID_FIXTURES: &[(&str, &str, usize, usize)] = &[
    (
        "Bootstrap filetype SVG icon",
        include_str!("../../../fixtures/svg-import/icons/bootstrap-filetype-svg.svg"),
        0,
        1,
    ),
    (
        "Catppuccin Android icon",
        include_str!("../../../fixtures/svg-import/icons/catppuccin-android.svg"),
        0,
        1,
    ),
    (
        "Simple Icons GitHub logo",
        include_str!("../../../fixtures/svg-import/icons/simple-github.svg"),
        0,
        1,
    ),
    (
        "Skill Icons TypeScript logo",
        include_str!("../../../fixtures/svg-import/logos/skill-icons-typescript.svg"),
        1,
        2,
    ),
    (
        "Devicon Plain Kotlin logo",
        include_str!("../../../fixtures/svg-import/logos/devicon-plain-kotlin.svg"),
        0,
        1,
    ),
    (
        "nested Catppuccin Angular groups",
        include_str!("../../../fixtures/svg-import/nested-groups/catppuccin-angular.svg"),
        2,
        2,
    ),
    (
        "compound ring path",
        include_str!("../../../fixtures/svg-import/compound-paths/ring.svg"),
        0,
        1,
    ),
];

fn node_counts(group: &inkfinite_core::svg_import::SvgGroup) -> (usize, usize) {
    group.children.iter().fold((0, 0), |(groups, shapes), node| match node {
        SvgImportNode::Group(child) => {
            let (nested_groups, nested_shapes) = node_counts(child);
            (groups + 1 + nested_groups, shapes + nested_shapes)
        }
        SvgImportNode::Shape(_) => (groups, shapes + 1),
        SvgImportNode::Image(_) => panic!("fixture unexpectedly produced an image node"),
    })
}

fn path_shapes(group: &inkfinite_core::svg_import::SvgGroup) -> Vec<&inkfinite_core::svg_import::SvgShape> {
    let mut paths = Vec::new();
    for node in &group.children {
        match node {
            SvgImportNode::Group(child) => paths.extend(path_shapes(child)),
            SvgImportNode::Shape(shape) if shape.kind.as_str() == inkfinite_core::PATH_KIND => paths.push(shape),
            SvgImportNode::Shape(_) | SvgImportNode::Image(_) => {}
        }
    }
    paths
}

#[test]
fn icon_and_logo_fixtures_import_to_native_shapes() {
    for (name, source, expected_groups, expected_shapes) in VALID_FIXTURES {
        let import = parse_svg(source).unwrap_or_else(|error| panic!("{name} should import: {error}"));
        assert!(
            import.warnings.is_empty(),
            "{name} emitted warnings: {:?}",
            import.warnings
        );
        assert_eq!(
            import.source_asset.bytes,
            source.as_bytes(),
            "{name} source asset changed"
        );
        assert_eq!(
            node_counts(&import.root),
            (*expected_groups, *expected_shapes),
            "{name} node counts"
        );

        for shape in path_shapes(&import.root) {
            path_geometry_from_properties(&shape.properties)
                .unwrap_or_else(|error| panic!("{name} produced invalid native path: {error}"));
        }
    }
}

#[test]
fn current_color_from_icon_sets_resolves_to_the_inherited_svg_color() {
    for (name, source) in [
        (
            "Simple Icons GitHub",
            include_str!("../../../fixtures/svg-import/icons/simple-github.svg"),
        ),
        (
            "Devicon Plain Kotlin",
            include_str!("../../../fixtures/svg-import/logos/devicon-plain-kotlin.svg"),
        ),
    ] {
        let import = parse_svg(source).unwrap_or_else(|error| panic!("{name} should import: {error}"));
        let shape = match &import.root.children[0] {
            SvgImportNode::Shape(shape) => shape,
            _ => panic!("{name} should contain a native shape"),
        };
        assert_eq!(shape.properties["fill"], "#000000", "{name} currentColor mapping");
    }

    let import =
        parse_svg(r##"<svg color="#ed8796"><path fill="currentColor" stroke="currentColor" d="M0 0L1 1"/></svg>"##)
            .expect("computed SVG color should import");
    let SvgImportNode::Shape(shape) = &import.root.children[0] else {
        panic!("computed color shape missing")
    };
    assert_eq!(shape.properties["fill"], "#ed8796");
    assert_eq!(shape.properties["stroke"], "#ed8796");
}

#[test]
fn bootstrap_filetype_svg_preserves_browser_regression_semantics() {
    let import = parse_svg(include_str!(
        "../../../fixtures/svg-import/icons/bootstrap-filetype-svg.svg"
    ))
    .expect("Bootstrap fixture should import");
    let SvgImportNode::Shape(shape) = &import.root.children[0] else {
        panic!("Bootstrap path missing")
    };
    let geometry = path_geometry_from_properties(&shape.properties).expect("Bootstrap path should validate");
    assert_eq!(shape.properties["fill"], "#000000");
    assert_eq!(geometry.fill_rule, PathFillRule::EvenOdd);
    assert!(geometry.subpaths.len() >= 2);
    assert!(
        geometry
            .subpaths
            .iter()
            .flat_map(|subpath| &subpath.segments)
            .any(|segment| { matches!(segment, inkfinite_core::PathSegment::Quadratic { .. }) })
    );
}

#[test]
fn nested_and_compound_fixtures_preserve_geometry_semantics() {
    let nested = parse_svg(include_str!(
        "../../../fixtures/svg-import/nested-groups/catppuccin-angular.svg"
    ))
    .expect("nested fixture should import");
    let SvgImportNode::Group(outer) = &nested.root.children[0] else { panic!("outer group missing") };
    let SvgImportNode::Group(inner) = &outer.children[0] else { panic!("inner group missing") };
    assert_eq!(outer.source_id.as_deref(), Some("outer"));
    assert_eq!(inner.source_id.as_deref(), Some("inner"));
    assert_eq!(outer.transform.translation.x, 1.0);
    assert_eq!(outer.transform.translation.y, 1.0);
    assert_eq!(inner.transform.scale_x, 0.75);
    assert_eq!(inner.transform.scale_y, 0.75);
    assert_eq!(outer.style.opacity.get(), 0.8);
    assert_eq!(inner.style.opacity.get(), 1.0);

    let compound = parse_svg(include_str!("../../../fixtures/svg-import/compound-paths/ring.svg"))
        .expect("compound fixture should import");
    let paths = path_shapes(&compound.root);
    assert_eq!(paths.len(), 1);
    let geometry = path_geometry_from_properties(&paths[0].properties).expect("compound geometry should validate");
    assert_eq!(geometry.fill_rule, PathFillRule::EvenOdd);
    assert_eq!(geometry.subpaths.len(), 2);
    assert!(geometry.subpaths.iter().all(|subpath| subpath.closed));
    assert!(geometry.subpaths.iter().any(|subpath| {
        subpath
            .segments
            .iter()
            .any(|segment| matches!(segment, inkfinite_core::PathSegment::Cubic { .. }))
    }));
}

#[test]
fn unsupported_fixture_reports_features_without_importing_active_content() {
    let import = parse_svg(include_str!(
        "../../../fixtures/svg-import/unsupported/feature-matrix.svg"
    ))
    .expect("unsupported fixture should parse");
    let features = import
        .warnings
        .iter()
        .filter_map(|warning| match warning {
            inkfinite_core::svg_import::SvgImportWarning::UnsupportedFeature { feature, .. } => Some(*feature),
            _ => None,
        })
        .collect::<Vec<_>>();
    for feature in [
        SvgUnsupportedFeature::Gradient,
        SvgUnsupportedFeature::Pattern,
        SvgUnsupportedFeature::ClipPath,
        SvgUnsupportedFeature::Mask,
        SvgUnsupportedFeature::Filter,
        SvgUnsupportedFeature::Script,
        SvgUnsupportedFeature::Animation,
        SvgUnsupportedFeature::ExternalResource,
        SvgUnsupportedFeature::Stylesheet,
    ] {
        assert!(features.contains(&feature), "missing warning for {feature}");
    }
    assert!(import.warnings.iter().any(|warning| {
        matches!(
            warning,
            inkfinite_core::svg_import::SvgImportWarning::UnsupportedPaint { .. }
        )
    }));
    assert!(import.warnings.iter().any(|warning| {
        matches!(warning, inkfinite_core::svg_import::SvgImportWarning::UnsupportedElement { element, .. } if element == "foreignObject")
    }));
    assert_eq!(import.root.children.len(), 1, "only the supported path should remain");
}

#[test]
fn malformed_fixtures_fail_before_returning_a_partial_tree() {
    let fixtures = [
        (
            "invalid path",
            include_str!("../../../fixtures/svg-import/malformed/invalid-path.svg"),
        ),
        (
            "invalid transform",
            include_str!("../../../fixtures/svg-import/malformed/invalid-transform.svg"),
        ),
        (
            "invalid XML",
            include_str!("../../../fixtures/svg-import/malformed/invalid-xml.svg"),
        ),
        (
            "invalid number",
            include_str!("../../../fixtures/svg-import/malformed/invalid-number.svg"),
        ),
    ];
    for (name, source) in fixtures {
        let error = parse_svg(source).expect_err("malformed fixture should fail");
        let expected = match name {
            "invalid path" => matches!(&error, SvgImportError::InvalidPath { .. }),
            "invalid transform" => matches!(&error, SvgImportError::UnsupportedTransform { .. }),
            "invalid XML" => matches!(&error, SvgImportError::Xml(_)),
            "invalid number" => matches!(&error, SvgImportError::InvalidAttribute { .. }),
            _ => false,
        };
        assert!(expected, "{name} returned the wrong error: {error}");
    }
}
