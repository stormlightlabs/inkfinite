import {
	EditorState,
	EditorPageRecord,
	EditorShapeRecord,
	Store,
	contentObjectToCard,
	type EditorShapeRecord as Shape
} from '@inkfinite/core';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import SelectionControls from '../SelectionControls.svelte';

function createSelectionStore(shapes: Shape[], selectionIds = shapes.map((shape) => shape.id)) {
	const state = EditorState.create();
	const page = EditorPageRecord.create('Test page', 'page:test');
	state.doc.pages[page.id] = { ...page, shapeIds: shapes.map((shape) => shape.id) };
	for (const shape of shapes) state.doc.shapes[shape.id] = shape;
	state.ui.currentPageId = page.id;
	state.ui.selectionIds = selectionIds;
	return new Store(state);
}

describe('SelectionControls', () => {
	it('exposes boolean path controls for a closed path selection', async () => {
		const page = EditorPageRecord.create('Test page', 'page:test');
		const pathProps = {
			subpaths: [
				{
					segments: [
						{ type: 'move' as const, to: { x: 0, y: 0 } },
						{ type: 'line' as const, to: { x: 40, y: 0 } },
						{ type: 'line' as const, to: { x: 40, y: 40 } },
						{ type: 'line' as const, to: { x: 0, y: 40 } }
					],
					closed: true
				}
			],
			fill_rule: 'evenodd' as const,
			fill: '#ffffff'
		};
		const first = EditorShapeRecord.createPath(page.id, 0, 0, pathProps, 'first');
		const second = EditorShapeRecord.createPath(page.id, 20, 0, pathProps, 'second');
		const store = createSelectionStore([first, second]);
		const screen = render(SelectionControls, {
			currentTool: 'select',
			orientation: 'vertical',
			store
		});

		await expect
			.element(screen.getByRole('heading', { name: 'Boolean paths' }))
			.toBeInTheDocument();
		await screen.getByRole('button', { name: 'Union' }).click();
		expect(store.getState().ui.selectionIds).toEqual(['first']);
		expect(store.getState().doc.shapes.second).toBeUndefined();
	});

	it('shows appearance and object metadata controls for a selected rectangle', async () => {
		const page = EditorPageRecord.create('Test page', 'page:test');
		const rect = EditorShapeRecord.createRect(
			page.id,
			0,
			0,
			{ w: 80, h: 50, fill: '#ffffff', stroke: '#111111', radius: 4 },
			'rect'
		);
		const screen = render(SelectionControls, {
			currentTool: 'select',
			orientation: 'vertical',
			store: createSelectionStore([rect])
		});

		await expect
			.element(screen.getByRole('heading', { name: 'Appearance' }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('heading', { name: 'Typography' }))
			.not.toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: 'Arrow settings' }))
			.not.toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: 'Align' }))
			.not.toBeInTheDocument();
	});

	it('keeps contextual sections on one horizontal viewport with scroll controls', async () => {
		const page = EditorPageRecord.create('Test page', 'page:test');
		const rect = EditorShapeRecord.createRect(
			page.id,
			0,
			0,
			{ w: 80, h: 50, fill: '#ffffff', stroke: '#111111', radius: 4 },
			'rect'
		);
		const screen = render(SelectionControls, {
			currentTool: 'select',
			orientation: 'vertical',
			store: createSelectionStore([rect])
		});
		const toolbar = screen.getByRole('toolbar', { name: 'Selection controls' }).element();
		const sections = toolbar.querySelector('.selection-controls__sections');
		if (!sections) throw new Error('Expected the contextual sections viewport');

		expect(getComputedStyle(toolbar).display).toBe('flex');
		expect(getComputedStyle(sections).flexWrap).toBe('nowrap');
		expect(getComputedStyle(sections).overflowX).toBe('auto');
		await expect
			.element(screen.getByRole('button', { name: 'Show previous contextual controls' }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: 'Show more contextual controls' }))
			.toBeInTheDocument();
	});

	it('collapses contextual actions and restores them', async () => {
		const page = EditorPageRecord.create('Test page', 'page:test');
		const rect = EditorShapeRecord.createRect(
			page.id,
			0,
			0,
			{ w: 80, h: 50, fill: '#ffffff', stroke: '#111111', radius: 4 },
			'rect'
		);
		const screen = render(SelectionControls, {
			currentTool: 'select',
			orientation: 'vertical',
			store: createSelectionStore([rect])
		});

		const toolbar = screen.getByRole('toolbar', { name: 'Selection controls' }).element();
		expect(getComputedStyle(toolbar).transitionProperty).toContain('width');
		await screen.getByRole('button', { name: 'Collapse contextual actions' }).click();
		await new Promise((resolve) => setTimeout(resolve, 250));
		expect(getComputedStyle(toolbar).width).toBe('208px');
		await expect
			.element(screen.getByRole('heading', { name: 'Appearance' }))
			.not.toBeInTheDocument();
		await screen.getByRole('button', { name: 'Expand contextual actions' }).click();
		await expect
			.element(screen.getByRole('heading', { name: 'Appearance' }))
			.toBeInTheDocument();
	});

	it('projects and edits semantic metadata for ordinary objects', async () => {
		const page = EditorPageRecord.create('Test page', 'page:test');
		const rect = EditorShapeRecord.createRect(
			page.id,
			0,
			0,
			{ w: 80, h: 50, fill: '#ffffff', stroke: '#111111', radius: 4 },
			'rect'
		);
		rect.metadata = {
			name: 'Service',
			title: null,
			role: 'architecture.service',
			description: 'Handles requests',
			body: null,
			tags: ['api', 'critical'],
			source: 'architecture.md',
			link: 'https://example.com/service',
			customMetadata: { owner: 'platform' },
			locked: false,
			agentEditable: true,
			provenance: { actorId: 'actor:test', origin: 'human', timestamp: 42, source: 'seed' }
		};
		const store = createSelectionStore([rect]);
		const screen = render(SelectionControls, {
			currentTool: 'select',
			orientation: 'vertical',
			store
		});

		await expect.element(screen.getByText('Service')).toBeInTheDocument();
		await expect
			.element(screen.getByRole('textbox', { name: 'Object name' }))
			.not.toBeInTheDocument();
		await screen.getByRole('button', { name: 'Edit metadata' }).click();
		await expect
			.element(screen.getByRole('dialog', { name: 'Object metadata' }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('textbox', { name: 'Object name' }))
			.toHaveValue('Service');
		await expect
			.element(screen.getByRole('textbox', { name: 'Object role' }))
			.toHaveValue('architecture.service');
		await expect
			.element(screen.getByRole('textbox', { name: 'Object tags' }))
			.toHaveValue('api, critical');
		await expect.element(screen.getByText('actor:test')).toBeInTheDocument();

		await screen.getByRole('textbox', { name: 'Object name' }).fill('Gateway');
		screen
			.getByRole('textbox', { name: 'Object name' })
			.element()
			.dispatchEvent(new Event('change', { bubbles: true }));
		await screen
			.getByRole('textbox', { name: 'Object structured metadata' })
			.fill('{"owner":"edge","priority":1}');
		screen
			.getByRole('textbox', { name: 'Object structured metadata' })
			.element()
			.dispatchEvent(new Event('change', { bubbles: true }));

		const updated = store.getState().doc.shapes.rect;
		expect(updated.metadata?.name).toBe('Gateway');
		expect(updated.metadata?.customMetadata).toEqual({ owner: 'edge', priority: 1 });
	});

	it('shows focused typography controls for text and Markdown selections', async () => {
		const page = EditorPageRecord.create('Test page', 'page:test');
		const text = EditorShapeRecord.createText(
			page.id,
			0,
			0,
			{ text: 'Title', fontSize: 24, fontFamily: 'Inter', color: '#111111' },
			'text'
		);
		const markdown = EditorShapeRecord.createMarkdown(
			page.id,
			0,
			50,
			{ md: '**Body**', w: 200, fontSize: 16, fontFamily: 'Inter', color: '#222222' },
			'markdown'
		);
		const store = createSelectionStore([text, markdown]);
		const screen = render(SelectionControls, {
			currentTool: 'select',
			orientation: 'vertical',
			store
		});

		await expect
			.element(screen.getByRole('heading', { name: 'Typography' }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('combobox', { name: 'Font family' }))
			.toHaveValue('Inter');
		await expect
			.element(screen.getByRole('spinbutton', { name: 'Font size' }))
			.toHaveAttribute('placeholder', 'Mixed');

		const size = screen
			.getByRole('spinbutton', { name: 'Font size' })
			.element() as HTMLInputElement;
		size.value = '18';
		size.dispatchEvent(new Event('change', { bubbles: true }));
		const updatedText = store.getState().doc.shapes.text;
		const updatedMarkdown = store.getState().doc.shapes.markdown;
		if (updatedText.type !== 'text' || updatedMarkdown.type !== 'markdown') {
			throw new Error('Expected text and Markdown selections');
		}
		expect(updatedText.props.fontSize).toBe(18);
		expect(updatedMarkdown.props.fontSize).toBe(18);
	});

	it('shows mixed values and multi-selection layout actions', async () => {
		const page = EditorPageRecord.create('Test page', 'page:test');
		const first = EditorShapeRecord.createRect(
			page.id,
			0,
			0,
			{ w: 40, h: 40, fill: '#ffffff', stroke: '#111111', radius: 0 },
			'first'
		);
		const second = EditorShapeRecord.createRect(
			page.id,
			60,
			0,
			{ w: 40, h: 40, fill: '#000000', stroke: '#111111', radius: 0 },
			'second'
		);
		const screen = render(SelectionControls, {
			currentTool: 'select',
			orientation: 'vertical',
			store: createSelectionStore([first, second])
		});

		await expect
			.element(screen.getByRole('button', { name: 'Fill color, mixed values' }))
			.toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: 'Align' })).toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: 'Arrange' })).toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: 'Group selected objects' }))
			.toBeInTheDocument();

		await screen.getByRole('button', { name: 'Align' }).click();
		await expect
			.element(screen.getByRole('menu', { name: 'Alignment commands' }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('menuitem', { name: 'Align Left' }))
			.toBeInTheDocument();
		await screen.getByRole('menuitem', { name: 'Align Left' }).click();
		expect(document.activeElement).toBe(
			screen.getByRole('button', { name: 'Align' }).element()
		);
	});

	it('edits card fields and exposes frame navigation', async () => {
		const page = EditorPageRecord.create('Test page', 'page:test');
		const cardShapes = contentObjectToCard(
			'page:test',
			{ x: 0, y: 0 },
			{ title: 'Title', body: 'Body', role: 'note', tags: ['draft'] }
		);
		const store = createSelectionStore(cardShapes, [cardShapes[0].id]);
		let enteredFrame: string | undefined;
		let fitted = false;
		const screen = render(SelectionControls, {
			currentTool: 'select',
			orientation: 'vertical',
			store,
			onEnterFrame: (id) => (enteredFrame = id),
			onFitSelection: () => (fitted = true)
		});

		await expect.element(screen.getByRole('heading', { name: 'Card' })).toBeInTheDocument();
		await expect
			.element(screen.getByRole('heading', { name: 'Typography' }))
			.toBeInTheDocument();
		await screen
			.getByRole('combobox', { name: 'Font family' })
			.selectOptions('Newsreader Variable');
		for (const child of cardShapes.slice(1)) {
			const updatedChild = store.getState().doc.shapes[child.id];
			if (updatedChild.type !== 'text' && updatedChild.type !== 'markdown') {
				throw new Error('Expected card typography child');
			}
			expect(updatedChild.props.fontFamily).toBe('Newsreader Variable');
		}
		await screen.getByRole('button', { name: 'Edit card' }).click();
		await expect
			.element(screen.getByRole('dialog', { name: 'Card details' }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('textbox', { name: 'Card title' }))
			.toHaveValue('Title');
		await screen.getByRole('textbox', { name: 'Card title' }).fill('Updated title');
		await screen
			.getByRole('textbox', { name: 'Card title' })
			.element()
			.dispatchEvent(new Event('change', { bubbles: true }));
		const updated = store.getState().doc.shapes[cardShapes[0].id];
		if (updated.type !== 'container') throw new Error('Expected a card container');
		expect(updated.metadata?.title).toBe('Updated title');
		const updatedTitleShape = store.getState().doc.shapes[cardShapes[1].id];
		expect(updatedTitleShape?.type === 'text' ? updatedTitleShape.props.text : undefined).toBe(
			'Updated title'
		);
		await screen.getByRole('button', { name: 'Done' }).click();

		await screen.getByRole('button', { name: 'Enter selected frame' }).click();
		await screen.getByRole('button', { name: 'Fit selected frame' }).click();
		expect(enteredFrame).toBe(cardShapes[0].id);
		expect(fitted).toBe(true);
	});

	it('edits image content, reuses assets, and exposes references', async () => {
		const page = EditorPageRecord.create('Test page', 'page:test');
		const image = EditorShapeRecord.createImage(
			page.id,
			0,
			0,
			{ w: 160, h: 100, assetId: 'asset:image', caption: 'Original' },
			'image'
		);
		const reference = EditorShapeRecord.createReference(
			page.id,
			200,
			0,
			{
				w: 280,
				h: 72,
				referenceType: 'url',
				value: 'https://example.com',
				label: 'Example'
			},
			'reference'
		);
		const store = createSelectionStore([image]);
		store.getState().doc.assets = {
			'asset:image': {
				id: 'asset:image',
				name: 'Image',
				mediaType: 'image/png',
				digest: 'sha256:image',
				bytes: [0]
			},
			'asset:other': {
				id: 'asset:other',
				name: 'Other',
				mediaType: 'image/png',
				digest: 'sha256:other',
				bytes: [1]
			}
		};
		const screen = render(SelectionControls, {
			currentTool: 'select',
			orientation: 'vertical',
			store
		});

		await expect.element(screen.getByRole('heading', { name: 'Image' })).toBeInTheDocument();
		await screen.getByRole('textbox', { name: 'Image caption' }).fill('Updated');
		await screen
			.getByRole('textbox', { name: 'Image caption' })
			.element()
			.dispatchEvent(new Event('change', { bubbles: true }));
		await screen.getByRole('combobox', { name: 'Image asset' }).selectOptions('asset:other');
		const updatedImage = store.getState().doc.shapes.image;
		if (updatedImage.type !== 'image') throw new Error('Expected image selection');
		expect(updatedImage.props.caption).toBe('Updated');
		expect(updatedImage.props.assetId).toBe('asset:other');

		store.setState((state) => ({
			...state,
			ui: { ...state.ui, selectionIds: [reference.id] },
			doc: { ...state.doc, shapes: { ...state.doc.shapes, [reference.id]: reference } }
		}));
		await expect
			.element(screen.getByRole('heading', { name: 'Reference' }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('textbox', { name: 'Reference target' }))
			.toHaveValue('https://example.com');
	});

	it('keeps agent controls opt-in for desktop callers', async () => {
		const page = EditorPageRecord.create('Test page', 'page:test');
		const rect = EditorShapeRecord.createRect(
			page.id,
			0,
			0,
			{ w: 20, h: 20, fill: '#fff', stroke: '#000', radius: 0 },
			'rect'
		);
		const store = createSelectionStore([rect]);
		const screen = render(SelectionControls, {
			currentTool: 'select',
			orientation: 'vertical',
			store,
			showAgentControl: true
		});

		await expect
			.element(screen.getByRole('checkbox', { name: 'Agent editable' }))
			.toBeChecked();
		await screen.getByRole('checkbox', { name: 'Agent editable' }).click();
		expect(store.getState().doc.shapes.rect.agentEditable).toBe(false);
	});
});
