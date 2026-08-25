import { describe, expect, it } from 'vitest';
import { EditorLayerRecord } from '@inkfinite/core';
import { clampFloatingPosition, moveFloatingPosition } from './floating-position';
import { nearestWritableDestination } from './layer-policy';
import { getExportMenuItems, getImportMenuItems } from './toolbar-menu';

describe('editor component models', () => {
	it('clamps and moves floating controls through one positioning rule', () => {
		expect(
			clampFloatingPosition(-20, 1000, {
				width: 100,
				height: 80,
				availableWidth: 400,
				availableHeight: 300
			})
		).toEqual({ left: 8, top: 212 });
		expect(
			moveFloatingPosition(
				{ left: 10, top: 10 },
				{ x: 40, y: 20 },
				{ width: 100, height: 80, availableWidth: 400, availableHeight: 300 }
			)
		).toEqual({ left: 50, top: 30 });
	});

	it('keeps layer rehome policy out of LayerPanel', () => {
		const back = EditorLayerRecord.create('page:test', 'Back', 'layer:back');
		const locked = {
			...EditorLayerRecord.create('page:test', 'Locked', 'layer:locked'),
			locked: true
		};
		const front = EditorLayerRecord.create('page:test', 'Front', 'layer:front');
		expect(nearestWritableDestination([back, locked, front], locked.id)?.id).toBe(back.id);
	});

	it('derives import and export menus without component event handlers', () => {
		expect(
			getImportMenuItems({
				canImportEditable: true,
				canImportSvg: false,
				canCreateFromSvg: true,
				canImportSvgMarkup: false
			}).map((item) => (item.type === 'separator' ? 'separator' : item.id))
		).toEqual(['import-document', 'separator', 'create-from-svg']);
		const exports = getExportMenuItems({
			selectionCount: 0,
			canCopySvg: true,
			canCopyPng: false
		});
		const selectionExport = exports.find(
			(item): item is Extract<(typeof exports)[number], { id: string }> =>
				item.type !== 'separator' && item.id === 'copy-svg-selection'
		);
		expect(selectionExport?.disabled).toBe(true);
	});
});
