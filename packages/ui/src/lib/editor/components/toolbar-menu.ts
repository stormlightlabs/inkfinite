import type { ContextMenuEntry } from '../../index';

export type ExportMenuOptions = {
	selectionCount: number;
	canCopySvg: boolean;
	canCopyPng: boolean;
};

/** Derives export actions independently from Toolbar event dispatch. */
export function getExportMenuItems(options: ExportMenuOptions): ContextMenuEntry[] {
	const selectionDisabled = options.selectionCount === 0;
	return [
		{
			id: 'excalidraw',
			label: 'Excalidraw',
			accessibleLabel: 'Export as Excalidraw editable document'
		},
		{
			id: 'json-canvas',
			label: 'Obsidian Canvas',
			accessibleLabel: 'Export as Obsidian Canvas editable document'
		},
		{ type: 'separator' },
		{ id: 'png', label: 'PNG (Viewport)', accessibleLabel: 'Export current view as PNG' },
		{ id: 'svg-all', label: 'SVG (All)', accessibleLabel: 'Export all shapes as SVG' },
		{
			id: 'svg-selection',
			label: 'SVG (Selection)',
			accessibleLabel: 'Export selected shapes as SVG'
		},
		...(options.canCopySvg || options.canCopyPng
			? [
					{ type: 'separator' as const },
					...(options.canCopySvg
						? [
								{
									id: 'copy-svg-all',
									label: 'Copy as SVG (All)',
									accessibleLabel: 'Copy all shapes as SVG'
								},
								{
									id: 'copy-svg-selection',
									label: 'Copy as SVG (Selection)',
									accessibleLabel: 'Copy selected shapes as SVG',
									disabled: selectionDisabled
								}
							]
						: []),
					...(options.canCopyPng
						? [
								{
									id: 'copy-png-all',
									label: 'Copy as PNG (All)',
									accessibleLabel: 'Copy all shapes as PNG'
								},
								{
									id: 'copy-png-selection',
									label: 'Copy as PNG (Selection)',
									accessibleLabel: 'Copy selected shapes as PNG',
									disabled: selectionDisabled
								},
								{
									id: 'copy-png-all-transparent',
									label: 'Copy as PNG (All, Transparent)',
									accessibleLabel: 'Copy all shapes as transparent PNG'
								},
								{
									id: 'copy-png-selection-transparent',
									label: 'Copy as PNG (Selection, Transparent)',
									accessibleLabel: 'Copy selected shapes as transparent PNG',
									disabled: selectionDisabled
								}
							]
						: [])
				]
			: [])
	];
}

export type ImportMenuOptions = {
	canImportEditable: boolean;
	canImportSvg: boolean;
	canCreateFromSvg: boolean;
	canImportSvgMarkup: boolean;
};

/** Derives import actions independently from Toolbar event dispatch. */
export function getImportMenuItems(options: ImportMenuOptions): ContextMenuEntry[] {
	const items: ContextMenuEntry[] = [];
	if (options.canImportEditable)
		items.push({ id: 'import-document', label: 'Editable document', icon: 'layers' });
	if (options.canImportSvg || options.canCreateFromSvg || options.canImportSvgMarkup) {
		if (items.length > 0) items.push({ type: 'separator' });
	}
	if (options.canImportSvg)
		items.push({
			id: 'import-svg-file',
			label: 'Add SVG to current document',
			icon: 'folder'
		});
	if (options.canCreateFromSvg)
		items.push({ id: 'create-from-svg', label: 'New document from SVG', icon: 'svg' });
	if (options.canImportSvgMarkup)
		items.push({ id: 'import-svg-markup', label: 'Add SVG code / markup', icon: 'svg' });
	return items;
}
