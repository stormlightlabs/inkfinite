import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const corpusPath = resolve(import.meta.dirname, '../fixtures/native/performance/corpus.json');

/** Shared fixture description consumed by the renderer and native harnesses. */
export const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));

const profileById = new Map(corpus.profiles.map((profile) => [profile.id, profile]));

export function getProfile(profileId) {
	const profile = profileById.get(profileId);
	if (!profile) throw new Error(`Unknown performance corpus profile: ${profileId}`);
	return profile;
}

export function createEditorState(profileId, shapeCount) {
	const profile = getProfile(profileId);
	const pageId = `page:performance:${profile.id}:${shapeCount}`;
	const layerId = `layer:performance:${profile.id}:${shapeCount}`;
	const shapes = {};
	const shapeIds = [];
	const bindings = {};
	const ids = (index) => `shape:performance:${profile.id}:${shapeCount}:${index.toString().padStart(5, '0')}`;
	const cellSize = 80;

	for (let index = 0; index < shapeCount; index += 1) {
		const id = ids(index);
		const column = index % 100;
		const row = Math.floor(index / 100);
		const groupId =
			profile.id === 'deeply-nested'
				? index < profile.nestingDepth && index > 0
					? ids(index - 1)
					: index >= profile.nestingDepth
						? ids(profile.nestingDepth - 1)
						: undefined
				: undefined;
		const depth = groupId ? Math.min(index, profile.nestingDepth - 1) : 0;
		const base = {
			id,
			pageId,
			x: column * cellSize,
			y: row * cellSize,
			rot: 0,
			...(groupId ? { groupId } : {}),
			...(groupId
				? {
						editorTransform: {
							a: 1,
							b: 0,
							c: 0,
							d: 1,
							e: column * cellSize + depth * 3,
							f: row * cellSize + depth * 3
						}
					}
				: {}),
			layerId,
			opacity: 1
		};
		const metadata = profile.metadata
			? {
					name: `Service ${index}`,
					title: `Corpus item ${index}`,
					role: index % 2 === 0 ? 'architecture.service' : 'architecture.worker',
					description: `Deterministic performance fixture item ${index}`,
					body: 'Generated semantic content for query and projection measurements.',
					tags: ['performance', index % 2 === 0 ? 'service' : 'worker', `bucket-${index % 8}`],
					source: 'fixtures/native/performance/corpus.json',
					link: `https://example.test/performance/${index}`,
					customMetadata: { seed: corpus.seed, index, profile: profile.id },
					locked: false,
					agentEditable: true,
					provenance: {
						actorId: 'actor:performance',
						origin: 'system',
						timestamp: index,
						source: 'performance-corpus'
					}
				}
			: undefined;
		const shapeBase = metadata ? { ...base, metadata } : base;
		const fill = index % 2 === 0 ? '#dbeafe' : '#fef3c7';

		if (profile.kind === 'arrow' && index % 2 === 1) {
			const startTarget = ids(index - 1);
			const endTarget = ids(index + 1 < shapeCount ? index + 1 : 0);
			const startBindingId = `binding:performance:${profile.id}:${shapeCount}:${index}:start`;
			const endBindingId = `binding:performance:${profile.id}:${shapeCount}:${index}:end`;
			bindings[startBindingId] = {
				id: startBindingId,
				type: 'arrow-end',
				fromShapeId: id,
				toShapeId: startTarget,
				handle: 'start',
				anchor: { kind: 'center' }
			};
			bindings[endBindingId] = {
				id: endBindingId,
				type: 'arrow-end',
				fromShapeId: id,
				toShapeId: endTarget,
				handle: 'end',
				anchor: { kind: 'center' }
			};
			shapes[id] = {
				...shapeBase,
				type: 'arrow',
				props: {
					points: [
						{ x: 0, y: 0 },
						{ x: cellSize, y: 0 }
					],
					start: { kind: 'bound', bindingId: startBindingId },
					end: { kind: 'bound', bindingId: endBindingId },
					style: { stroke: '#475569', width: 2, headEnd: true },
					routing: { kind: 'straight' }
				}
			};
		} else if (profile.kind === 'path') {
			shapes[id] = { ...shapeBase, type: 'path', props: createPathProps(profile.segments, fill) };
		} else if (profile.id === 'deeply-nested' && index < profile.nestingDepth) {
			shapes[id] = {
				...shapeBase,
				type: 'container',
				props: {
					w: 72 + depth * 2,
					h: 56 + depth * 2,
					title: `Group ${index}`,
					fill: '#f8fafc',
					stroke: '#94a3b8',
					radius: 8
				}
			};
		} else {
			shapes[id] = {
				...shapeBase,
				type: 'rect',
				props: {
					w: 56 + ((index * 17 + corpus.seed) % 17),
					h: 40 + ((index * 29 + corpus.seed) % 25),
					fill,
					stroke: '#334155',
					radius: index % 5
				}
			};
		}
		shapeIds.push(id);
	}

	if (profile.id === 'semantic-binding-heavy') {
		for (let index = 1; index < shapeCount; index += 1) {
			const id = `binding:performance:${profile.id}:${shapeCount}:${index}`;
			bindings[id] = {
				id,
				type: 'relation',
				fromShapeId: ids(index - 1),
				toShapeId: ids(index),
				handle: 'end',
				anchor: { kind: 'center' },
				relationType: index % 2 === 0 ? 'depends_on' : 'contains'
			};
		}
	}

	return {
		doc: {
			pages: { [pageId]: { id: pageId, name: `Performance ${profile.id}`, shapeIds, layerIds: [layerId] } },
			layers: {
				[layerId]: { id: layerId, pageId, name: 'Default', shapeIds, visible: true, locked: false, opacity: 1 }
			},
			shapes,
			bindings
		},
		ui: { currentPageId: pageId, activeLayerId: layerId, selectionIds: [], toolId: 'select' },
		camera: { ...corpus.camera }
	};
}

function createPathProps(segmentCount, fill) {
	const segments = [{ type: 'move', to: { x: 0, y: 0 } }];
	let current = { x: 0, y: 0 };
	for (let index = 1; index < segmentCount; index += 1) {
		const next = { x: 24 + index * 7, y: 18 + ((index * 13) % 42) };
		if (index % 3 === 0) {
			segments.push({
				type: 'cubic',
				control_1: { x: current.x + 8, y: current.y - 12 },
				control_2: { x: next.x - 8, y: next.y + 12 },
				to: next
			});
		} else if (index % 3 === 1) {
			segments.push({ type: 'line', to: next });
		} else {
			segments.push({ type: 'quadratic', control: { x: (current.x + next.x) / 2, y: next.y - 18 }, to: next });
		}
		current = next;
	}
	return { subpaths: [{ segments, closed: true }], fill_rule: 'nonzero', fill, stroke: '#334155', stroke_width: 2 };
}
