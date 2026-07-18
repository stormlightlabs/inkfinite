use super::support::{map_file_error, map_output_error, open_document, portable_path, write_json};
use super::{
    BTreeSet, CliError, EXIT_CONFLICT, EXIT_INPUT, EXIT_INVALID, LayerId, PageId, Path, RenderArgs, ShapeId,
    SvgRenderOptions, Write, anyhow, fs, io, json, render_svg,
};

pub fn render_document(args: RenderArgs, json_output: bool, stdout: &mut dyn Write) -> Result<(), CliError> {
    if args.output.exists() {
        let input = fs::canonicalize(&args.path).map_err(|error| {
            CliError::new(EXIT_INPUT, error).context(format!("could not resolve {}", portable_path(&args.path)))
        })?;
        let output = fs::canonicalize(&args.output).map_err(|error| {
            CliError::new(EXIT_INPUT, error).context(format!("could not resolve {}", portable_path(&args.output)))
        })?;
        if input == output {
            return Err(CliError::new(
                EXIT_CONFLICT,
                anyhow!("refusing to render over the canonical document"),
            ));
        }
    }
    let mut file = open_document(&args.path)?;
    let snapshot = file.snapshot().map_err(map_file_error)?;
    let mut selection: BTreeSet<ShapeId> = args.shapes.into_iter().map(ShapeId::from).collect();
    if let Some(role) = args.role {
        selection.extend(
            snapshot
                .document
                .shapes
                .values()
                .filter(|shape| shape.metadata.role.as_deref() == Some(role.as_str()))
                .map(|shape| shape.id.clone()),
        );
    }
    let options = SvgRenderOptions {
        page_id: args.page.map(PageId::from),
        layer_ids: args.layers.into_iter().map(LayerId::from).collect(),
        selection,
        region: args.region,
        ..SvgRenderOptions::default()
    };
    let rendered = render_svg(&snapshot, &options)
        .map_err(|error| CliError::new(EXIT_INVALID, error).context("could not render SVG"))?;
    let parent = args.output.parent().unwrap_or_else(|| Path::new("."));
    let file_name = args
        .output
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("output.svg");
    let temporary = parent.join(format!(".{file_name}.tmp-{}", std::process::id()));
    let write_result = (|| -> io::Result<()> {
        let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        output.write_all(rendered.svg.as_bytes())?;
        output.flush()?;
        output.sync_all()?;
        drop(output);
        #[cfg(not(windows))]
        {
            fs::rename(&temporary, &args.output)
        }
        #[cfg(windows)]
        {
            if !args.output.exists() {
                return fs::rename(&temporary, &args.output);
            }
            let backup = parent.join(format!(".{file_name}.backup-{}", std::process::id()));
            fs::rename(&args.output, &backup)?;
            match fs::rename(&temporary, &args.output) {
                Ok(()) => {
                    let _ = fs::remove_file(backup);
                    Ok(())
                }
                Err(error) => {
                    let _ = fs::rename(&backup, &args.output);
                    Err(error)
                }
            }
        }
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(
            CliError::new(EXIT_INPUT, error).context(format!("could not write SVG {}", portable_path(&args.output)))
        );
    }
    let warnings: Vec<String> = rendered.warnings.iter().map(ToString::to_string).collect();
    if json_output {
        write_json(
            stdout,
            &json!({
                "heads": snapshot.heads,
                "output": portable_path(&args.output),
                "warnings": warnings,
            }),
        )
    } else {
        writeln!(stdout, "Rendered {}", portable_path(&args.output)).map_err(map_output_error)?;
        for warning in warnings {
            writeln!(stdout, "Warning: {warning}").map_err(map_output_error)?;
        }
        Ok(())
    }
}
