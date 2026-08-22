use super::mutation::{StructuredMutationTarget, select_layout_shapes};
use super::{AlignmentArg, AxisArg, BTreeMap, CliError, LayoutAxis, LayoutCommand, Operation, ShapeAlignment, Write};

pub fn run_layout_command(command: LayoutCommand, json_output: bool, stdout: &mut dyn Write) -> Result<(), CliError> {
    match command {
        LayoutCommand::Align(args) => {
            let mut target = StructuredMutationTarget::open(args.path.as_deref(), &args.mutation)?;
            let snapshot = target.snapshot()?;
            let shape_ids = select_layout_shapes(&snapshot.document, args.selection)?;
            let alignment = match args.alignment {
                AlignmentArg::Left => ShapeAlignment::Left,
                AlignmentArg::Center => ShapeAlignment::Center,
                AlignmentArg::Right => ShapeAlignment::Right,
                AlignmentArg::Top => ShapeAlignment::Top,
                AlignmentArg::Middle => ShapeAlignment::Middle,
                AlignmentArg::Bottom => ShapeAlignment::Bottom,
            };
            let transaction = target.transaction(
                args.mutation.transaction_id.clone(),
                "layout:align".into(),
                "align shapes".into(),
                vec![Operation::AlignShapes { shape_ids, alignment, expected_versions: BTreeMap::new() }],
            )?;
            target.finish(transaction, &args.mutation, json_output, stdout)
        }
        LayoutCommand::Distribute(args) => {
            let mut target = StructuredMutationTarget::open(args.path.as_deref(), &args.mutation)?;
            let snapshot = target.snapshot()?;
            let shape_ids = select_layout_shapes(&snapshot.document, args.selection)?;
            let axis = match args.axis {
                AxisArg::Horizontal => LayoutAxis::Horizontal,
                AxisArg::Vertical => LayoutAxis::Vertical,
            };
            let transaction = target.transaction(
                args.mutation.transaction_id.clone(),
                "layout:distribute".into(),
                "distribute shapes".into(),
                vec![Operation::DistributeShapes { shape_ids, axis, expected_versions: BTreeMap::new() }],
            )?;
            target.finish(transaction, &args.mutation, json_output, stdout)
        }
        LayoutCommand::Stack(args) => {
            let mut target = StructuredMutationTarget::open(args.path.as_deref(), &args.mutation)?;
            let snapshot = target.snapshot()?;
            let shape_ids = select_layout_shapes(&snapshot.document, args.selection)?;
            let axis = match args.axis {
                AxisArg::Horizontal => LayoutAxis::Horizontal,
                AxisArg::Vertical => LayoutAxis::Vertical,
            };
            let transaction = target.transaction(
                args.mutation.transaction_id.clone(),
                "layout:stack".into(),
                "stack shapes".into(),
                vec![Operation::StackShapes { shape_ids, axis, gap: args.gap, expected_versions: BTreeMap::new() }],
            )?;
            target.finish(transaction, &args.mutation, json_output, stdout)
        }
        LayoutCommand::Grid(args) => {
            let mut target = StructuredMutationTarget::open(args.path.as_deref(), &args.mutation)?;
            let snapshot = target.snapshot()?;
            let shape_ids = select_layout_shapes(&snapshot.document, args.selection)?;
            let transaction = target.transaction(
                args.mutation.transaction_id.clone(),
                "layout:grid".into(),
                "arrange shapes in a grid".into(),
                vec![Operation::GridShapes {
                    shape_ids,
                    columns: args.columns,
                    column_gap: args.column_gap,
                    row_gap: args.row_gap,
                    expected_versions: BTreeMap::new(),
                }],
            )?;
            target.finish(transaction, &args.mutation, json_output, stdout)
        }
        LayoutCommand::Tidy(args) => {
            let mut target = StructuredMutationTarget::open(args.path.as_deref(), &args.mutation)?;
            let snapshot = target.snapshot()?;
            let shape_ids = select_layout_shapes(&snapshot.document, args.selection)?;
            let transaction = target.transaction(
                args.mutation.transaction_id.clone(),
                "layout:tidy".into(),
                "tidy shapes".into(),
                vec![Operation::TidyShapes { shape_ids, gap: args.gap, expected_versions: BTreeMap::new() }],
            )?;
            target.finish(transaction, &args.mutation, json_output, stdout)
        }
    }
}
