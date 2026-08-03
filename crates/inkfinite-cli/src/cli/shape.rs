use super::mutation::{StructuredMutationTarget, read_json_argument, select_unique_shape};
use super::{
    BTreeMap, BuiltinShapeKind, CliError, EXIT_INVALID, LayerId, Opacity, Operation, Origin, PlacementArg, Provenance,
    RecordVersion, Result, SemanticMetadata, Serialize, ShapeCommand, ShapeCreateArgs, ShapeDeleteArgs,
    ShapeDescribeArgs, ShapeId, ShapeKind, ShapeParent, ShapePatch, ShapePatchArgs, ShapeRecord, ShapeStyle,
    SiblingAnchor, Timestamp, Transform, Value, Vec2, Write, anyhow, builtin_shape_kinds,
};
use inkfinite_core::engine::geometry::{Affine, bottom, right, world_shape_bounds, world_transform};
use inkfinite_core::proto::Bounds;

#[derive(Serialize)]
struct ShapeKindDescription {
    kind: &'static str,
    allows_children: bool,
    common_properties: [ShapePropertyDescription; 2],
}

#[derive(Clone, Copy, Serialize)]
struct ShapePropertyDescription {
    name: &'static str,
    value_type: &'static str,
    required: bool,
    finite: bool,
    minimum: f64,
    default: f64,
}

pub fn run_shape_command(command: ShapeCommand, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    match command {
        ShapeCommand::Create(args) => create_shape(args, json_output, stdout),
        ShapeCommand::Patch(args) => patch_shape(&args, json_output, stdout),
        ShapeCommand::Delete(args) => delete_shape(&args, json_output, stdout),
        ShapeCommand::Kinds => list_shape_kinds(json_output, stdout),
        ShapeCommand::Describe(args) => describe_shape_kind(&args, json_output, stdout),
    }
}

fn list_shape_kinds(json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let descriptions: Vec<ShapeKindDescription> =
        BuiltinShapeKind::ALL.into_iter().map(shape_kind_description).collect();
    if json_output {
        return super::support::write_json(stdout, &descriptions);
    }
    for description in descriptions {
        writeln!(
            stdout,
            "{}\tchildren={}\tproperties=width,height",
            description.kind, description.allows_children
        )
        .map_err(super::support::map_output_error)?;
    }
    Ok(())
}

fn describe_shape_kind(args: &ShapeDescribeArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let kind = BuiltinShapeKind::parse(&args.kind).ok_or_else(|| {
        CliError::new(
            EXIT_INVALID,
            anyhow!(
                "unknown shape kind {}; expected one of {}",
                args.kind,
                builtin_shape_kinds().join(", ")
            ),
        )
    })?;
    let description = shape_kind_description(kind);
    if json_output {
        super::support::write_json(stdout, &description)
    } else {
        writeln!(stdout, "Kind: {}", description.kind).map_err(super::support::map_output_error)?;
        writeln!(stdout, "Allows children: {}", description.allows_children)
            .map_err(super::support::map_output_error)?;
        writeln!(
            stdout,
            "Properties: width, height (finite numbers, minimum 0, default 0)"
        )
        .map_err(super::support::map_output_error)
    }
}

fn shape_kind_description(kind: BuiltinShapeKind) -> ShapeKindDescription {
    const DIMENSION: ShapePropertyDescription = ShapePropertyDescription {
        name: "width",
        value_type: "number",
        required: false,
        finite: true,
        minimum: 0.0,
        default: 0.0,
    };
    ShapeKindDescription {
        kind: kind.as_str(),
        allows_children: kind == BuiltinShapeKind::Container,
        common_properties: [DIMENSION, ShapePropertyDescription { name: "height", ..DIMENSION }],
    }
}

fn create_shape(args: ShapeCreateArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    if !args.x.is_finite()
        || !args.y.is_finite()
        || !args.rotation.is_finite()
        || !args.gap.is_finite()
        || args.gap < 0.0
    {
        return Err(CliError::new(
            EXIT_INVALID,
            anyhow!("shape transform values must be finite"),
        ));
    }
    if !builtin_shape_kinds().contains(&args.kind.as_str()) {
        return Err(CliError::new(
            EXIT_INVALID,
            anyhow!(
                "unknown shape kind {}; expected one of {}",
                args.kind,
                builtin_shape_kinds().join(", ")
            ),
        ));
    }
    let mut properties: BTreeMap<String, Value> = serde_json::from_str(&args.properties)
        .map_err(|error| CliError::new(EXIT_INVALID, error).context("could not parse --properties JSON object"))?;
    properties.entry("width".into()).or_insert_with(|| Value::from(0.0));
    properties.entry("height".into()).or_insert_with(|| Value::from(0.0));
    let mut target = StructuredMutationTarget::open(args.path.as_deref(), &args.mutation)?;
    let snapshot = target.snapshot()?;
    let relative_id = if args.relative_id.is_some() || args.relative_name.is_some() || args.relative_role.is_some() {
        Some(select_unique_shape(
            &snapshot.document,
            args.relative_id.as_deref(),
            args.relative_name.as_deref(),
            args.relative_role.as_deref(),
        )?)
    } else {
        None
    };
    if relative_id.is_some() != args.placement.is_some() {
        return Err(CliError::new(
            EXIT_INVALID,
            anyhow!("semantic placement requires both a relative target and --placement"),
        ));
    }
    let explicit_parent = match (args.layer, args.parent_shape) {
        (Some(layer), None) => Some(ShapeParent::Layer(LayerId::from(layer))),
        (None, Some(shape)) => Some(ShapeParent::Shape(ShapeId::from(shape))),
        (None, None) => None,
        _ => return Err(CliError::new(EXIT_INVALID, anyhow!("select at most one shape parent"))),
    };
    let parent = match (explicit_parent, relative_id.as_ref(), args.placement) {
        (Some(parent), _, _) => parent,
        (None, Some(target_id), Some(PlacementArg::Inside)) => ShapeParent::Shape(target_id.clone()),
        (None, Some(target_id), Some(_)) => snapshot.document.shapes[target_id].parent.clone(),
        (None, None, None) => {
            return Err(CliError::new(
                EXIT_INVALID,
                anyhow!("select a shape parent or semantic placement target"),
            ));
        }
        _ => return Err(CliError::new(EXIT_INVALID, anyhow!("invalid semantic placement"))),
    };
    if let (Some(target_id), Some(PlacementArg::Inside)) = (relative_id.as_ref(), args.placement)
        && parent != ShapeParent::Shape(target_id.clone())
    {
        return Err(CliError::new(
            EXIT_INVALID,
            anyhow!("inside placement must use the target container as its parent"),
        ));
    }
    let provenance_actor = match &target {
        StructuredMutationTarget::File(file) => file.actor_id().clone(),
        StructuredMutationTarget::App { status, .. } => status.actor_id.clone(),
    };
    let shape_id = match args.shape_id {
        Some(shape_id) => ShapeId::from(shape_id),
        None => {
            let mut suffix = 1_u64;
            loop {
                let candidate = ShapeId::from(format!("shape:{}:{suffix}", args.kind));
                if !snapshot.document.shapes.contains_key(&candidate) {
                    break candidate;
                }
                suffix = suffix.saturating_add(1);
            }
        }
    };
    let mut transform =
        Transform { translation: Vec2 { x: args.x, y: args.y }, rotation: args.rotation, scale_x: 1.0, scale_y: 1.0 };
    if let (Some(target_id), Some(placement)) = (relative_id.as_ref(), args.placement) {
        transform.translation = resolve_placement(
            &snapshot.document,
            &parent,
            target_id,
            placement,
            args.gap,
            &properties,
            transform,
        )?;
    }
    let shape = ShapeRecord {
        id: shape_id.clone(),
        kind: ShapeKind::from(args.kind),
        parent,
        transform,
        child_ids: Vec::new(),
        layout: None,
        properties,
        metadata: SemanticMetadata {
            name: args.name,
            role: args.role,
            description: None,
            tags: args.tags,
            locked: args.locked,
            agent_editable: args.agent_editable,
            provenance: Provenance {
                actor_id: provenance_actor,
                origin: Origin::Agent,
                timestamp: Timestamp(0),
                source: None,
            },
        },
        style: ShapeStyle { opacity: Opacity::OPAQUE, fill_opacity: None, stroke_opacity: None },
        version: RecordVersion(1),
    };
    let transaction = target.transaction(
        args.mutation.transaction_id.clone(),
        format!("shape:create:{}", shape_id.as_str()),
        format!("create shape {shape_id}"),
        vec![Operation::CreateShape { shape, anchor: SiblingAnchor::Last }],
    )?;
    target.finish(transaction, &args.mutation, json_output, stdout)
}

fn resolve_placement(
    document: &inkfinite_core::Document, parent: &ShapeParent, target_id: &ShapeId, placement: PlacementArg, gap: f64,
    properties: &BTreeMap<String, Value>, transform: Transform,
) -> Result<Vec2> {
    let target = document
        .shapes
        .get(target_id)
        .ok_or_else(|| CliError::new(EXIT_INVALID, anyhow!("shape {target_id} does not exist")))?;
    if placement == PlacementArg::Inside && target.kind.as_str() != "container" {
        return Err(CliError::new(
            EXIT_INVALID,
            anyhow!("inside placement requires a container target"),
        ));
    }
    let width = properties.get("width").and_then(Value::as_f64).unwrap_or(0.0).abs();
    let height = properties.get("height").and_then(Value::as_f64).unwrap_or(0.0).abs();
    if placement == PlacementArg::Inside {
        let local = Affine::from_transform(Transform { translation: Vec2 { x: 0.0, y: 0.0 }, ..transform })
            .transform_bounds(Bounds { x: 0.0, y: 0.0, width, height });
        return Ok(Vec2 { x: gap - local.x, y: gap - local.y });
    }
    let parent_world = match parent {
        ShapeParent::Layer(_) => Affine::IDENTITY,
        ShapeParent::Shape(parent_id) => {
            let parent_shape = document
                .shapes
                .get(parent_id)
                .ok_or_else(|| CliError::new(EXIT_INVALID, anyhow!("parent shape {parent_id} does not exist")))?;
            world_transform(document, parent_shape)
        }
    };
    let base_world = parent_world
        .then(Affine::from_transform(Transform {
            translation: Vec2 { x: 0.0, y: 0.0 },
            ..transform
        }))
        .transform_bounds(Bounds { x: 0.0, y: 0.0, width, height });
    let target_bounds = world_shape_bounds(document, target_id);
    let desired = match placement {
        PlacementArg::Below => Vec2 { x: target_bounds.x, y: bottom(&target_bounds) + gap },
        PlacementArg::RightOf => Vec2 { x: right(&target_bounds) + gap, y: target_bounds.y },
        PlacementArg::AlignLeft | PlacementArg::AlignTop => Vec2 { x: target_bounds.x, y: target_bounds.y },
        PlacementArg::AlignCenter => {
            Vec2 { x: target_bounds.x + (target_bounds.width - base_world.width) / 2.0, y: target_bounds.y }
        }
        PlacementArg::AlignRight => Vec2 { x: right(&target_bounds) - base_world.width, y: target_bounds.y },
        PlacementArg::AlignMiddle => {
            Vec2 { x: target_bounds.x, y: target_bounds.y + (target_bounds.height - base_world.height) / 2.0 }
        }
        PlacementArg::AlignBottom => Vec2 { x: target_bounds.x, y: bottom(&target_bounds) - base_world.height },
        PlacementArg::Inside => unreachable!(),
    };
    let inverse = parent_world
        .inverse()
        .ok_or_else(|| CliError::new(EXIT_INVALID, anyhow!("semantic placement parent transform is singular")))?;
    let origin = inverse.point(Vec2 { x: 0.0, y: 0.0 });
    let delta = inverse.point(Vec2 { x: desired.x - base_world.x, y: desired.y - base_world.y });
    Ok(Vec2 { x: delta.x - origin.x, y: delta.y - origin.y })
}

fn patch_shape(args: &ShapePatchArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let patch_json = read_json_argument(&args.patch, "shape patch")?;
    let patch: ShapePatch = serde_json::from_str(&patch_json)
        .map_err(|error| CliError::new(EXIT_INVALID, error).context("could not parse ShapePatch JSON"))?;
    let mut target = StructuredMutationTarget::open(args.path.as_deref(), &args.mutation)?;
    let snapshot = target.snapshot()?;
    let shape_id = select_unique_shape(
        &snapshot.document,
        args.shape_id.as_deref(),
        args.name.as_deref(),
        args.role.as_deref(),
    )?;
    let transaction = target.transaction(
        args.mutation.transaction_id.clone(),
        format!("shape:patch:{}", shape_id.as_str()),
        format!("patch shape {shape_id}"),
        vec![Operation::PatchShape { shape_id, patch, expected_version: args.expected_version.map(RecordVersion) }],
    )?;
    target.finish(transaction, &args.mutation, json_output, stdout)
}

fn delete_shape(args: &ShapeDeleteArgs, json_output: bool, stdout: &mut dyn Write) -> Result<()> {
    let mut target = StructuredMutationTarget::open(args.path.as_deref(), &args.mutation)?;
    let snapshot = target.snapshot()?;
    let shape_id = select_unique_shape(
        &snapshot.document,
        args.shape_id.as_deref(),
        args.name.as_deref(),
        args.role.as_deref(),
    )?;
    let transaction = target.transaction(
        args.mutation.transaction_id.clone(),
        format!("shape:delete:{}", shape_id.as_str()),
        format!("delete shape {shape_id}"),
        vec![Operation::DeleteShape { shape_id, expected_version: args.expected_version.map(RecordVersion) }],
    )?;
    target.finish(transaction, &args.mutation, json_output, stdout)
}
