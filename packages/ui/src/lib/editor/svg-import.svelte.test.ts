import { projectSvgImport, type SvgImportResult } from '@inkfinite/core';
import { describe, expect, it } from 'vitest';

const style = { opacity: 1, fill_opacity: 1, stroke_opacity: 1 };

function svgImport(): SvgImportResult {
	return {
		view_box: { x: 0, y: 0, width: 100, height: 80 },
		root: {
			source_id: null,
			transform: { translation: { x: 0, y: 0 }, rotation: 0, scale_x: 1, scale_y: 1 },
			style,
			properties: { width: 100, height: 80 },
			children: [
				{
					kind: 'group',
					value: {
						source_id: 'translated',
						transform: {
							translation: { x: 10, y: 20 },
							rotation: 0,
							scale_x: 1,
							scale_y: 1
						},
						style,
						properties: { width: 24, height: 35 },
						children: [
							{
								kind: 'shape',
								value: {
									source_id: 'box',
									kind: 'rect',
									transform: {
										translation: { x: 4, y: 5 },
										rotation: 0,
										scale_x: 1,
										scale_y: 1
									},
									properties: {
										width: 20,
										height: 30,
										radius: 0,
										fill: '#123456',
										stroke: 'none'
									},
									style
								}
							}
						]
					}
				}
			]
		},
		source_asset: {
			id: 'asset:source',
			name: 'source-icon.svg',
			media_type: 'image/svg+xml',
			digest: 'sha256:test',
			bytes: [60, 115, 118, 103]
		},
		assets: [],
		warnings: [],
		omitted_image_count: 0
	};
}

describe('browser SVG projection', () => {
	it('maps the shared normalized tree while retaining group identity and source assets', () => {
		const imported = projectSvgImport(svgImport(), 'icon.svg');
		const shape = Object.values(imported.snapshot.doc.shapes)[0];

		expect(shape).toMatchObject({
			type: 'rect',
			x: 14,
			y: 25,
			groupId: 'svg:group:translated',
			props: { w: 20, h: 30, fill: '#123456' }
		});
		expect(imported.snapshot.doc.assets?.['asset:source']).toMatchObject({
			mediaType: 'image/svg+xml',
			bytes: [60, 115, 118, 103]
		});
		expect(imported.snapshot.doc.svgGroups?.['svg:group:translated']).toMatchObject({
			parentId: 'svg:group:root',
			transform: { translation: { x: 10, y: 20 } }
		});
		expect(imported.warnings).toEqual([]);
	});
});
