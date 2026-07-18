use super::mutation::{commit_mutation, select_layout_shapes, structured_transaction};
use super::support::open_document;
use super::{AlignmentArg, AxisArg, BTreeMap, CliError, LayoutAxis, LayoutCommand, Operation, ShapeAlignment, Write};

pub fn run_layout_command(command: LayoutCommand, json_output: bool, stdout: &mut dyn Write) -> Result<(), CliError> {
    match command {
        LayoutCommand::Align(args) => {
            let mut file = open_document(&args.path)?;
            let shape_ids = select_layout_shapes(&mut file, args.selection)?;
            let alignment = match args.alignment {
                AlignmentArg::Left => ShapeAlignment::Left,
                AlignmentArg::Center => ShapeAlignment::Center,
                AlignmentArg::Right => ShapeAlignment::Right,
                AlignmentArg::Top => ShapeAlignment::Top,
                AlignmentArg::Middle => ShapeAlignment::Middle,
                AlignmentArg::Bottom => ShapeAlignment::Bottom,
            };
            let transaction = structured_transaction(
                &mut file,
                args.mutation.transaction_id,
                "layout:align".into(),
                "align shapes".into(),
                vec![Operation::AlignShapes { shape_ids, alignment, expected_versions: BTreeMap::new() }],
            )?;
            commit_mutation(&mut file, transaction, args.mutation.dry_run, json_output, stdout)
        }
        LayoutCommand::Distribute(args) => {
            let mut file = open_document(&args.path)?;
            let shape_ids = select_layout_shapes(&mut file, args.selection)?;
            let axis = match args.axis {
                AxisArg::Horizontal => LayoutAxis::Horizontal,
                AxisArg::Vertical => LayoutAxis::Vertical,
            };
            let transaction = structured_transaction(
                &mut file,
                args.mutation.transaction_id,
                "layout:distribute".into(),
                "distribute shapes".into(),
                vec![Operation::DistributeShapes { shape_ids, axis, expected_versions: BTreeMap::new() }],
            )?;
            commit_mutation(&mut file, transaction, args.mutation.dry_run, json_output, stdout)
        }
    }
}
