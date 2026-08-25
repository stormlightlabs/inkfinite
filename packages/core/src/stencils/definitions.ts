import type { Vec2 } from '../math';
import { createCardShapes } from '../cards';
import { EditorShapeRecord, type EditorShapeRecord as Shape } from '../editor-model';

import { registry } from './registry';
import type { Stencil, StencilCategory } from './types';

const PLACEHOLDER_PAGE_ID = 'placeholder_page';

type StencilDefinition = Omit<Stencil, 'spawn'> & { spawn: (at: Vec2) => Shape[] };

function rect(at: Vec2, width: number, height: number, radius = 0, fill = '#ffffff', stroke = '#1f2937') {
	return EditorShapeRecord.createRect(PLACEHOLDER_PAGE_ID, at.x, at.y, { w: width, h: height, fill, stroke, radius });
}

function ellipse(at: Vec2, width: number, height: number, fill = '#ffffff', stroke = '#1f2937') {
	return EditorShapeRecord.createEllipse(PLACEHOLDER_PAGE_ID, at.x, at.y, { w: width, h: height, fill, stroke });
}

function line(at: Vec2, x: number, y: number, width: number, height: number, stroke = '#1f2937') {
	return EditorShapeRecord.createLine(PLACEHOLDER_PAGE_ID, at.x + x, at.y + y, {
		a: { x: 0, y: 0 },
		b: { x: width, y: height },
		stroke,
		width: 2
	});
}

function text(at: Vec2, x: number, y: number, value: string, width: number, fontSize = 16) {
	return EditorShapeRecord.createText(PLACEHOLDER_PAGE_ID, at.x + x, at.y + y, {
		text: value,
		fontSize,
		fontFamily: 'sans-serif',
		color: '#111827',
		w: width
	});
}

function reference(at: Vec2, referenceType: 'url' | 'file' | 'page', value: string, label: string) {
	return EditorShapeRecord.createReference(PLACEHOLDER_PAGE_ID, at.x, at.y, { w: 280, h: 72, referenceType, value, label });
}

function stencil(
	id: string,
	name: string,
	category: StencilCategory,
	tags: string[],
	preview: string,
	spawn: (at: Vec2) => Shape[]
): StencilDefinition {
	return { id, name, category, tags, preview: { kind: 'svg', data: preview }, spawn };
}

const BUILTIN_STENCILS: readonly StencilDefinition[] = [
	stencil(
		'flowchart:process',
		'Process',
		'Flowchart',
		['rect', 'box', 'action'],
		'<svg viewBox="0 0 100 60"><rect x="2" y="2" width="96" height="56" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
		(at) => [rect(at, 120, 80)]
	),
	stencil(
		'flowchart:decision',
		'Decision',
		'Flowchart',
		['diamond', 'if', 'branch'],
		'<svg viewBox="0 0 100 60"><path d="M50 2 98 30 50 58 2 30Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
		(at) => {
			const shape = rect(at, 80, 80);
			shape.rot = Math.PI / 4;
			return [shape];
		}
	),
	stencil(
		'flowchart:terminator',
		'Terminator',
		'Flowchart',
		['start', 'end', 'pill'],
		'<svg viewBox="0 0 100 60"><rect x="2" y="2" width="96" height="56" rx="28" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
		(at) => [rect(at, 120, 60, 30)]
	),
	stencil(
		'flowchart:input-output',
		'Input / Output',
		'Flowchart',
		['data', 'parallelogram', 'input', 'output'],
		'<svg viewBox="0 0 100 60"><path d="M18 2h80L82 58H2Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
		(at) => [
			line(at, 16, 0, 104, 0),
			line(at, 120, 0, -16, 72),
			line(at, 104, 72, -104, 0),
			line(at, 0, 72, 16, -72)
		]
	),
	stencil(
		'flowchart:document',
		'Document',
		'Flowchart',
		['paper', 'report', 'file'],
		'<svg viewBox="0 0 100 70"><path d="M2 2h96v55c-24 18-48-14-72 0-9 5-17 6-24 3Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
		(at) => [
			rect(at, 120, 76),
			line(at, 0, 62, 30, 8),
			line(at, 30, 70, 30, -8),
			line(at, 60, 62, 30, 8),
			line(at, 90, 70, 30, -8)
		]
	),
	stencil(
		'flowchart:database',
		'Database',
		'Flowchart',
		['storage', 'cylinder', 'data'],
		'<svg viewBox="0 0 80 80"><ellipse cx="40" cy="10" rx="38" ry="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2 10v60c0 10 76 10 76 0V10" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
		(at) => [
			rect({ x: at.x, y: at.y + 10 }, 100, 90, 0),
			ellipse(at, 100, 20),
			ellipse({ x: at.x, y: at.y + 80 }, 100, 20)
		]
	),
	stencil(
		'flowchart:connector',
		'Connector',
		'Flowchart',
		['link', 'continuation', 'circle'],
		'<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="27" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
		(at) => [ellipse(at, 56, 56)]
	),
	stencil(
		'content:url-reference',
		'URL Reference',
		'Content',
		['url', 'link', 'reference'],
		'<svg viewBox="0 0 120 32"><rect x="2" y="2" width="116" height="28" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><text x="10" y="21" fill="currentColor" font-size="11">URL reference</text></svg>',
		(at) => [reference(at, 'url', 'https://example.com', 'Open URL')]
	),
	stencil(
		'content:file-reference',
		'File Reference',
		'Content',
		['file', 'path', 'reference'],
		'<svg viewBox="0 0 120 32"><rect x="2" y="2" width="116" height="28" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><text x="10" y="21" fill="currentColor" font-size="11">File reference</text></svg>',
		(at) => [reference(at, 'file', 'path/to/file', 'Open file')]
	),
	stencil(
		'ui:card',
		'Card',
		'UI',
		['container', 'panel'],
		'<svg viewBox="0 0 100 80"><rect x="2" y="2" width="96" height="76" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><line x1="2" y1="20" x2="98" y2="20" stroke="currentColor"/></svg>',
		(at) =>
			createCardShapes(PLACEHOLDER_PAGE_ID, at.x, at.y, {
				title: 'Card title',
				body: 'Add context, notes, or a link.'
			})
	),
	stencil(
		'ui:button',
		'Button',
		'UI',
		['control', 'cta', 'action'],
		'<svg viewBox="0 0 100 44"><rect x="2" y="2" width="96" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="2"/><text x="50" y="28" text-anchor="middle" fill="currentColor" font-size="14">Button</text></svg>',
		(at) => [rect(at, 140, 44, 6, '#2563eb', '#1d4ed8'), text(at, 38, 12, 'Button', 80, 16)]
	),
	stencil(
		'ui:text-input',
		'Text Input',
		'UI',
		['field', 'form', 'textbox'],
		'<svg viewBox="0 0 120 44"><rect x="2" y="2" width="116" height="40" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><text x="10" y="28" fill="currentColor" font-size="13">Placeholder</text></svg>',
		(at) => [rect(at, 240, 44, 4), text(at, 12, 12, 'Placeholder', 210, 15)]
	),
	stencil(
		'ui:browser-window',
		'Browser Window',
		'UI',
		['web', 'frame', 'chrome'],
		'<svg viewBox="0 0 120 80"><rect x="2" y="2" width="116" height="76" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><line x1="2" y1="18" x2="118" y2="18" stroke="currentColor"/><circle cx="10" cy="10" r="2"/><circle cx="18" cy="10" r="2"/></svg>',
		(at) => [
			rect(at, 360, 240, 6),
			line(at, 0, 36, 360, 0),
			ellipse({ x: at.x + 12, y: at.y + 13 }, 10, 10, '#ef4444'),
			ellipse({ x: at.x + 30, y: at.y + 13 }, 10, 10, '#f59e0b')
		]
	),
	stencil(
		'ui:mobile-frame',
		'Mobile Frame',
		'UI',
		['phone', 'screen', 'device'],
		'<svg viewBox="0 0 55 100"><rect x="2" y="2" width="51" height="96" rx="8" fill="none" stroke="currentColor" stroke-width="2"/><line x1="20" y1="9" x2="35" y2="9" stroke="currentColor"/></svg>',
		(at) => [rect(at, 180, 360, 18), line(at, 65, 18, 50, 0)]
	),
	stencil(
		'ui:modal',
		'Modal Dialog',
		'UI',
		['dialog', 'overlay', 'popup'],
		'<svg viewBox="0 0 110 75"><rect x="2" y="2" width="106" height="71" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><line x1="2" y1="20" x2="108" y2="20" stroke="currentColor"/></svg>',
		(at) => [rect(at, 320, 200, 8), line(at, 0, 48, 320, 0), text(at, 18, 15, 'Dialog title', 220, 18)]
	),
	stencil(
		'diagrams:service',
		'Service',
		'Diagrams',
		['developer', 'architecture', 'microservice'],
		'<svg viewBox="0 0 100 70"><rect x="2" y="2" width="96" height="66" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><text x="50" y="40" text-anchor="middle" fill="currentColor" font-size="14">Service</text></svg>',
		(at) => [rect(at, 180, 100, 8, '#eff6ff', '#2563eb'), text(at, 48, 38, 'Service', 100, 17)]
	),
	stencil(
		'diagrams:database',
		'Data Store',
		'Diagrams',
		['developer', 'database', 'storage'],
		'<svg viewBox="0 0 80 80"><ellipse cx="40" cy="10" rx="38" ry="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2 10v60c0 10 76 10 76 0V10" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
		(at) => [
			rect({ x: at.x, y: at.y + 10 }, 110, 90, 0, '#f0fdf4', '#16a34a'),
			ellipse(at, 110, 20, '#f0fdf4', '#16a34a'),
			ellipse({ x: at.x, y: at.y + 80 }, 110, 20, '#f0fdf4', '#16a34a')
		]
	),
	stencil(
		'diagrams:queue',
		'Message Queue',
		'Diagrams',
		['developer', 'broker', 'events'],
		'<svg viewBox="0 0 100 60"><rect x="2" y="2" width="96" height="56" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 17h68M16 30h68M16 43h68" stroke="currentColor"/></svg>',
		(at) => [
			rect(at, 180, 100, 6, '#fff7ed', '#ea580c'),
			line(at, 18, 28, 144, 0, '#ea580c'),
			line(at, 18, 50, 144, 0, '#ea580c'),
			line(at, 18, 72, 144, 0, '#ea580c')
		]
	),
	stencil(
		'diagrams:api-endpoint',
		'API Endpoint',
		'Diagrams',
		['developer', 'http', 'route', 'api'],
		'<svg viewBox="0 0 120 46"><rect x="2" y="2" width="116" height="42" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><text x="10" y="28" fill="currentColor" font-size="13">GET /resource</text></svg>',
		(at) => [rect(at, 240, 52, 6, '#f8fafc', '#475569'), text(at, 14, 16, 'GET /resource', 210, 15)]
	),
	stencil(
		'diagrams:component',
		'Component',
		'Diagrams',
		['developer', 'module', 'package'],
		'<svg viewBox="0 0 100 70"><rect x="12" y="2" width="86" height="66" fill="none" stroke="currentColor" stroke-width="2"/><rect x="2" y="14" width="20" height="12" fill="none" stroke="currentColor"/><rect x="2" y="40" width="20" height="12" fill="none" stroke="currentColor"/></svg>',
		(at) => [
			rect({ x: at.x + 18, y: at.y }, 162, 110, 4),
			rect({ x: at.x, y: at.y + 22 }, 38, 22, 2),
			rect({ x: at.x, y: at.y + 66 }, 38, 22, 2),
			text(at, 56, 44, 'Component', 105, 16)
		]
	),
	stencil(
		'etc:stickynote',
		'Sticky Note',
		'Etc',
		['note', 'memo', 'yellow'],
		'<svg viewBox="0 0 100 100"><rect x="2" y="2" width="96" height="96" fill="#fff740"/></svg>',
		(at) => [rect(at, 200, 200, 0, '#fff740', 'transparent')]
	)
];

/** Stable IDs for the curated stencil library, grouped by category in declaration order. */
export const BUILTIN_STENCIL_IDS = BUILTIN_STENCILS.map(({ id }) => id) as readonly string[];

/** Registers the curated built-in stencil library once per registry instance. */
export function registerBuiltinStencils(): void {
	for (const definition of BUILTIN_STENCILS) {
		if (!registry.get(definition.id)) registry.register(definition);
	}
}
