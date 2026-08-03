use super::support::{map_file_error, map_output_error, open_document, portable_path, write_json};
use super::{
    BTreeSet, CliError, EXIT_CONFLICT, EXIT_INPUT, EXIT_INVALID, LayerId, PageId, Path, RenderArgs, ShapeId,
    SvgRenderOptions, Write, anyhow, fs, io, json, render_svg,
};

const MAX_PNG_DIMENSION: u32 = 16_384;
const MAX_PNG_PIXELS: u64 = 100_000_000;

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
    let rendered_bytes = render_output_bytes(&args.output, &rendered.svg)?;
    let write_result = (|| -> io::Result<()> {
        let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        output.write_all(&rendered_bytes)?;
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
            CliError::new(EXIT_INPUT, error).context(format!("could not write {}", portable_path(&args.output)))
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

/// Converts deterministic SVG into the bytes implied by the output extension.
pub(crate) fn render_output_bytes(path: &Path, svg: &str) -> Result<Vec<u8>, CliError> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("svg") => Ok(svg.as_bytes().to_vec()),
        Some("png") => rasterize_png(svg),
        _ => Err(
            CliError::new(EXIT_INPUT, anyhow!("render output must use a .svg or .png extension"))
                .with_code("render_output_format"),
        ),
    }
}

fn rasterize_png(svg: &str) -> Result<Vec<u8>, CliError> {
    let mut options = resvg::usvg::Options::default();
    options.fontdb_mut().load_system_fonts();
    let tree = resvg::usvg::Tree::from_str(svg, &options).map_err(|error| {
        CliError::new(EXIT_INVALID, error)
            .with_code("render_raster_error")
            .context("could not parse rendered SVG for PNG output")
    })?;
    let size = tree.size().to_int_size();
    let pixels = u64::from(size.width()) * u64::from(size.height());
    if size.width() > MAX_PNG_DIMENSION || size.height() > MAX_PNG_DIMENSION || pixels > MAX_PNG_PIXELS {
        return Err(CliError::new(
            EXIT_INVALID,
            anyhow!(
                "PNG dimensions {}x{} exceed the {}px or {}-pixel rendering limit",
                size.width(),
                size.height(),
                MAX_PNG_DIMENSION,
                MAX_PNG_PIXELS
            ),
        )
        .with_code("render_raster_too_large"));
    }
    let mut pixmap = resvg::tiny_skia::Pixmap::new(size.width(), size.height()).ok_or_else(|| {
        CliError::new(EXIT_INVALID, anyhow!("could not allocate the PNG surface")).with_code("render_raster_error")
    })?;
    resvg::render(&tree, resvg::tiny_skia::Transform::default(), &mut pixmap.as_mut());
    pixmap.encode_png().map_err(|error| {
        CliError::new(EXIT_INVALID, error)
            .with_code("render_raster_error")
            .context("could not encode PNG output")
    })
}
