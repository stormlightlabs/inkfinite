import { graphLayout } from '../layout';
import { shapeBounds } from '../geom';
import { EditorState } from '../reactivity';
import { EditorBindingRecord, EditorShapeRecord, type ArrowShape, type MarkdownProps, type ShapeMetadata } from '../editor-model';
import type { BoardExport } from '../persistence/document';
import type { InterchangeImport } from '../interchange';
import { addShape, blankSnapshot, inkId, WarningCollector } from './shared';

/** Supported source languages for editable diagram imports. */
export type DiagramFormat = 'mermaid' | 'd2';

type DiagramStyle = {
	fill?: string;
	stroke?: string;
	color?: string;
	width?: number;
	dash?: number[];
	opacity?: number;
};

type DiagramNode = {
	key: string;
	label: string;
	shape: string;
	groupPath: string[];
	style: DiagramStyle;
	classes: string[];
	link?: string;
};

type DiagramGroup = { key: string; label: string; parentPath: string[]; style: DiagramStyle };

type DiagramEdge = {
	source: string;
	target: string;
	label?: string;
	startArrow: boolean;
	endArrow: boolean;
	style: DiagramStyle;
};

type ParsedDiagram = {
	format: DiagramFormat;
	direction: 'top-to-bottom' | 'left-to-right';
	nodes: Map<string, DiagramNode>;
	groups: Map<string, DiagramGroup>;
	edges: DiagramEdge[];
	warnings: WarningCollector;
};

const DEFAULT_NODE_FILL = '#ffffff';
const DEFAULT_NODE_STROKE = '#64748b';
const DEFAULT_TEXT_COLOR = '#1e293b';
const DEFAULT_GROUP_FILL = '#f8fafc';
const DEFAULT_GROUP_STROKE = '#94a3b8';
const NODE_WIDTH = 180;
const NODE_HEIGHT = 72;
const GROUP_PADDING = 28;

/** Converts a Mermaid flowchart subset into editable Inkfinite cards and arrows. */
export function importMermaid(source: string, fileName: string): InterchangeImport {
	return materializeDiagram(parseMermaid(source), fileName);
}

/** Converts a D2 diagram subset into editable Inkfinite cards and arrows. */
export function importD2(source: string, fileName: string): InterchangeImport {
	return materializeDiagram(parseD2(source), fileName);
}

function parseMermaid(source: string): ParsedDiagram {
	const warnings = new WarningCollector();
	const nodes = new Map<string, DiagramNode>();
	const groups = new Map<string, DiagramGroup>();
	const edges: DiagramEdge[] = [];
	const classDefs = new Map<string, DiagramStyle>();
	const nodeClasses = new Map<string, string[]>();
	const edgeStyles = new Map<number, DiagramStyle>();
	const groupStack: string[] = [];
	let direction: ParsedDiagram['direction'] = 'top-to-bottom';
	let headerSeen = false;

	const getNode = (key: string, groupPath = groupStack): DiagramNode => {
		const existing = nodes.get(key);
		if (existing) {
			if (groupPath.length > 0 && existing.groupPath.length === 0) existing.groupPath = [...groupPath];
			return existing;
		}
		const node: DiagramNode = { key, label: key, shape: 'rect', groupPath: [...groupPath], style: {}, classes: [] };
		nodes.set(key, node);
		return node;
	};

	const addGroup = (key: string, label: string, parentPath: string[]) => {
		if (!groups.has(key)) groups.set(key, { key, label, parentPath: [...parentPath], style: {} });
	};

	const lines = source.split(/\r?\n/);
	for (const [lineIndex, rawLine] of lines.entries()) {
		const lineNumber = lineIndex + 1;
		const line = rawLine.trim();
		if (!line) continue;
		if (line.startsWith('%%')) {
			if (line.startsWith('%%{'))
				warnings.add('mermaid-unsupported-construct', 'Mermaid init directives were ignored.');
			continue;
		}
		for (const statement of splitStatements(line)) {
			const value = statement.trim();
			if (!value) continue;
			if (!headerSeen) {
				const header = /^(?:flowchart|graph)(?:\s+([A-Za-z-]+))?$/i.exec(value);
				if (!header) throw diagramParseError('Mermaid input must start with flowchart or graph.', lineNumber);
				headerSeen = true;
				const requested = (header[1] ?? 'TB').toUpperCase();
				switch (requested) {
					case 'LR':
						direction = 'left-to-right';
						break;
					case 'TB':
					case 'TD':
						direction = 'top-to-bottom';
						break;
					case 'BT':
					case 'RL':
						direction = requested === 'BT' ? 'top-to-bottom' : 'left-to-right';
						warnings.add(
							'mermaid-direction',
							`Mermaid ${requested} direction was laid out in the nearest supported direction.`
						);
						break;
					default:
						throw diagramParseError(`Unsupported Mermaid flow direction ${requested}.`, lineNumber);
				}
				continue;
			}

			if (/^end$/i.test(value)) {
				if (groupStack.length === 0)
					throw diagramParseError('Mermaid end has no matching subgraph.', lineNumber);
				groupStack.pop();
				continue;
			}
			const subgraph = /^subgraph\s+(.+)$/i.exec(value);
			if (subgraph) {
				const parsed = parseMermaidSubgraph(subgraph[1]!);
				const key = groupStack.length > 0 ? `${groupStack.join('.')}::${parsed.key}` : parsed.key;
				addGroup(key, parsed.label, groupStack);
				groupStack.push(key);
				continue;
			}
			if (
				/^(?:direction|classDef|class|style|linkStyle|click|callback|call|bind|accTitle|accDescr)\b/i.test(
					value
				)
			) {
				parseMermaidDirective(value, lineNumber, warnings, getNode, classDefs, nodeClasses, edgeStyles);
				continue;
			}
			if (parseMermaidEdges(value, lineNumber, warnings, getNode, edges)) continue;
			const node = parseMermaidNode(value, groupStack, warnings, getNode);
			if (!node) throw diagramParseError(`Unsupported Mermaid statement: ${value}`, lineNumber);
		}
	}
	if (!headerSeen) throw diagramParseError('Mermaid input is empty.', 1);
	if (groupStack.length > 0) throw diagramParseError('Mermaid subgraph is missing end.', lines.length);

	for (const [key, classes] of nodeClasses) {
		const node = getNode(key);
		node.classes = [...new Set([...node.classes, ...classes])];
		for (const className of classes) Object.assign(node.style, classDefs.get(className));
	}
	for (const [index, style] of edgeStyles) {
		if (edges[index]) Object.assign(edges[index]!.style, style);
	}
	for (const node of nodes.values()) {
		for (const className of node.classes) Object.assign(node.style, classDefs.get(className));
	}
	return { format: 'mermaid', direction, nodes, groups, edges, warnings };
}

function parseMermaidDirective(
	value: string,
	lineNumber: number,
	warnings: WarningCollector,
	getNode: (key: string) => DiagramNode,
	classDefs: Map<string, DiagramStyle>,
	nodeClasses: Map<string, string[]>,
	edgeStyles: Map<number, DiagramStyle>
) {
	let match = /^direction\s+(.+)$/i.exec(value);
	if (match) {
		warnings.add('mermaid-subgraph-direction', `Mermaid direction ${match[1]} inside a statement was ignored.`);
		return;
	}
	match = /^classDef\s+([\w-]+)\s+(.+)$/i.exec(value);
	if (match) {
		classDefs.set(match[1]!, parseStyleDeclarations(match[2]!, warnings, 'mermaid-style'));
		return;
	}
	match = /^class\s+([\w,.-]+)\s+([\w-]+)$/i.exec(value);
	if (match) {
		for (const key of match[1]!.split(',')) {
			const classes = nodeClasses.get(key) ?? [];
			classes.push(match[2]!);
			nodeClasses.set(key, classes);
			getNode(key);
		}
		return;
	}
	match = /^style\s+([\w.-]+)\s+(.+)$/i.exec(value);
	if (match) {
		Object.assign(getNode(match[1]!).style, parseStyleDeclarations(match[2]!, warnings, 'mermaid-style'));
		return;
	}
	match = /^linkStyle\s+(default|\d+)\s+(.+)$/i.exec(value);
	if (match) {
		if (match[1] === 'default') warnings.add('mermaid-style', 'Mermaid default edge styling was ignored.');
		else edgeStyles.set(Number(match[1]), parseStyleDeclarations(match[2]!, warnings, 'mermaid-style'));
		return;
	}
	match = /^click\s+([\w.-]+)\s+(?:href\s+)?["']?([^"'\s]+)["']?/i.exec(value);
	if (match) {
		getNode(match[1]!).link = match[2];
		return;
	}
	if (/^(?:callback|call|bind)\b/i.test(value)) {
		warnings.add('mermaid-unsupported-construct', 'Mermaid callbacks and bindings were ignored.');
		return;
	}
	warnings.add('mermaid-unsupported-construct', `Unsupported Mermaid directive on line ${lineNumber} was ignored.`);
}

function parseMermaidSubgraph(value: string): { key: string; label: string } {
	const bracket = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(value);
	if (bracket) {
		const key = unquote(bracket[1]!.trim());
		return { key: key || slug(bracket[2]!), label: unquote(bracket[2]!.trim()) };
	}
	const label = unquote(value.trim());
	return { key: slug(label), label };
}

function parseMermaidNode(
	value: string,
	groupPath: string[],
	warnings: WarningCollector,
	getNode: (key: string, groupPath?: string[]) => DiagramNode
): DiagramNode | null {
	const parsed = parseMermaidNodeExpression(value);
	if (!parsed) return null;
	const node = getNode(parsed.key, groupPath);
	node.label = parsed.label;
	node.shape = parsed.shape;
	if (parsed.shape !== 'rect' && parsed.shape !== 'ellipse') {
		warnings.add('mermaid-unsupported-shape', `Mermaid ${parsed.shape} nodes use editable rectangular cards.`);
	}
	if (parsed.classNames.length > 0) node.classes = parsed.classNames;
	return node;
}

function parseMermaidNodeExpression(
	value: string
): { key: string; label: string; shape: string; classNames: string[] } | null {
	let input = value.trim();
	const classNames: string[] = [];
	const classMatch = /:::([\w-]+(?:\s+:[\w-]+)*)$/.exec(input);
	if (classMatch) {
		classNames.push(...classMatch[1]!.split(/\s+:/).map((item) => item.trim()));
		input = input.slice(0, classMatch.index).trim();
	}
	const keyMatch = /^([A-Za-z_][\w:.-]*)(.*)$/s.exec(input);
	if (!keyMatch) return null;
	const key = keyMatch[1]!;
	const rest = keyMatch[2]!.trim();
	if (!rest) return { key, label: key, shape: 'rect', classNames };
	const forms: Array<[string, string]> = [
		['((', '))'],
		['(("', '"))'],
		['([', '])'],
		['[[', ']]'],
		['[(', ')]'],
		['{{', '}}'],
		['[', ']'],
		['(', ')'],
		['{', '}'],
		['>', ']']
	];
	for (const [open, close] of forms) {
		if (!rest.startsWith(open) || !rest.endsWith(close)) continue;
		const label = unquote(rest.slice(open.length, rest.length - close.length).trim()) || key;
		const shape =
			open === '(('
				? 'ellipse'
				: open === '['
					? 'rect'
					: open === '('
						? 'rounded'
						: open === '{'
							? 'diamond'
							: open === '[('
								? 'cylinder'
								: open === '[[ '
									? 'subroutine'
									: 'special';
		return { key, label, shape, classNames };
	}
	const expanded = /^@\{\s*shape\s*:\s*([\w-]+)\s*\}\s*$/i.exec(rest);
	if (expanded) return { key, label: key, shape: expanded[1]!, classNames };
	return null;
}

function parseMermaidEdges(
	value: string,
	lineNumber: number,
	warnings: WarningCollector,
	getNode: (key: string, groupPath?: string[]) => DiagramNode,
	edges: DiagramEdge[]
): boolean {
	const first = findMermaidOperator(value, 0);
	if (!first) return false;
	let left = value.slice(0, first.index).trim();
	let rest = value.slice(first.index + first.operator.length).trim();
	let operator = first.operator;
	while (true) {
		let label: string | undefined;
		const labelMatch = /^\|([^|]*)\|\s*/s.exec(rest);
		if (labelMatch) {
			label = unquote(labelMatch[1]!.trim());
			rest = rest.slice(labelMatch[0].length);
		}
		const next = findMermaidOperator(rest, 0);
		if (operator === '--' && next && next.operator === '-->') {
			label = unquote(rest.slice(0, next.index).trim());
			operator = '-->';
			rest = rest.slice(next.index + next.operator.length).trim();
		}
		const targetText =
			next && !(operator === '--' && next.operator === '-->') ? rest.slice(0, next.index).trim() : rest;
		if (!targetText) throw diagramParseError('Mermaid edge is missing its target node.', lineNumber);
		const sources = splitEndpointList(left);
		const targets = splitEndpointList(targetText);
		for (const sourceText of sources) {
			const source = parseMermaidNodeExpression(sourceText);
			if (!source) throw diagramParseError(`Invalid Mermaid source node ${sourceText}.`, lineNumber);
			const sourceNode = getNode(source.key);
			if (source.label !== source.key || source.shape !== 'rect')
				Object.assign(sourceNode, { label: source.label, shape: source.shape });
			if (source.classNames.length > 0) sourceNode.classes = source.classNames;
			if (source.shape !== 'rect' && source.shape !== 'ellipse')
				warnings.add(
					'mermaid-unsupported-shape',
					`Mermaid ${source.shape} nodes use editable rectangular cards.`
				);
			for (const targetTextPart of targets) {
				const target = parseMermaidNodeExpression(targetTextPart);
				if (!target) throw diagramParseError(`Invalid Mermaid target node ${targetTextPart}.`, lineNumber);
				const targetNode = getNode(target.key);
				if (target.label !== target.key || target.shape !== 'rect')
					Object.assign(targetNode, { label: target.label, shape: target.shape });
				if (target.classNames.length > 0) targetNode.classes = target.classNames;
				if (target.shape !== 'rect' && target.shape !== 'ellipse')
					warnings.add(
						'mermaid-unsupported-shape',
						`Mermaid ${target.shape} nodes use editable rectangular cards.`
					);
				edges.push({
					source: source.key,
					target: target.key,
					...(label ? { label } : {}),
					startArrow: operator.startsWith('<'),
					endArrow: operator.includes('>'),
					style: operator.includes('.') ? { dash: [8, 6] } : operator.includes('=') ? { width: 3 } : {}
				});
			}
		}
		if (!next || (operator === '--' && next.operator === '-->')) return true;
		left = targetText;
		rest = rest.slice(next.index + next.operator.length).trim();
		operator = next.operator;
	}
}

function findMermaidOperator(value: string, from: number): { index: number; operator: string } | null {
	const operators = ['<-.->', '<-->', '<->', '<---', '<--', '-->', '-.->', '==>', '===', '---', '--'];
	let square = 0;
	let round = 0;
	let curly = 0;
	let quote = '';
	for (let index = from; index < value.length; index += 1) {
		const character = value[index]!;
		if (quote) {
			if (character === quote && value[index - 1] !== '\\') quote = '';
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}
		if (character === '[') square += 1;
		else if (character === ']') square -= 1;
		else if (character === '(') round += 1;
		else if (character === ')') round -= 1;
		else if (character === '{') curly += 1;
		else if (character === '}') curly -= 1;
		if (square || round || curly) continue;
		for (const operator of operators) {
			if (value.startsWith(operator, index)) return { index, operator };
		}
	}
	return null;
}

function parseD2(source: string): ParsedDiagram {
	const warnings = new WarningCollector();
	const nodes = new Map<string, DiagramNode>();
	const groups = new Map<string, DiagramGroup>();
	const edges: DiagramEdge[] = [];
	const contexts: D2Context[] = [];
	let direction: ParsedDiagram['direction'] = 'top-to-bottom';

	const currentGroupPath = () => {
		const group = [...contexts].reverse().find((context) => context.kind === 'group' || context.kind === 'block');
		return group?.path ? group.path.split('.') : [];
	};
	const getNode = (key: string, groupPath = currentGroupPath()): DiagramNode => {
		const path = qualifyD2Key(key, groupPath);
		const existing = nodes.get(path);
		if (existing) return existing;
		const node: DiagramNode = {
			key: path,
			label: lastPathPart(path),
			shape: 'rect',
			groupPath: [...groupPath],
			style: {},
			classes: []
		};
		nodes.set(path, node);
		ensureD2Groups(path.split('.').slice(0, -1), groups);
		return node;
	};

	for (const [lineIndex, rawLine] of source.split(/\r?\n/).entries()) {
		const lineNumber = lineIndex + 1;
		const trimmed = rawLine.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const indent = rawLine.search(/\S|$/);
		if (trimmed === '}') {
			while (contexts.length > 0 && contexts.at(-1)!.indent >= indent) contexts.pop();
			continue;
		}
		while (contexts.length > 0 && contexts.at(-1)!.indent >= indent && contexts.at(-1)!.kind !== 'style')
			contexts.pop();
		for (const statement of splitStatements(trimmed)) {
			if (!statement) continue;
			if (statement.endsWith('{')) {
				const key = statement.slice(0, -1).trim().replace(/:$/, '').trim();
				if (!key) throw diagramParseError('D2 block is missing a key.', lineNumber);
				const styleOwner = [...contexts]
					.reverse()
					.find((context) => context.kind === 'node' || context.kind === 'block');
				if (key === 'style' && styleOwner) {
					if (styleOwner.kind === 'block') {
						getNode(styleOwner.path, styleOwner.path.split('.').slice(0, -1));
						groups.delete(styleOwner.path);
						styleOwner.kind = 'node';
					}
					contexts.push({ kind: 'style', indent, path: styleOwner.path });
					continue;
				}
				const path = qualifyD2Key(key, currentGroupPath());
				ensureD2Groups(path.split('.'), groups);
				const group = groups.get(path)!;
				if (!group.label) group.label = lastPathPart(path);
				contexts.push({ kind: 'block', indent, path });
				continue;
			}
			const edge = findD2Operator(statement);
			if (edge) {
				const labelSplit = splitD2Label(edge.rest);
				const sourceNode = getNode(edge.source);
				const targetNode = getNode(labelSplit.target);
				edges.push({
					source: sourceNode.key,
					target: targetNode.key,
					...(labelSplit.label ? { label: labelSplit.label } : {}),
					startArrow: edge.operator === '<-' || edge.operator === '<->',
					endArrow: edge.operator === '->' || edge.operator === '<->',
					style: {}
				});
				continue;
			}
			const colon = findUnquotedColon(statement);
			if (colon < 0) {
				warnings.add('d2-unsupported-construct', `D2 statement on line ${lineNumber} was ignored.`);
				continue;
			}
			const rawKey = statement.slice(0, colon).trim();
			const rawValue = unquote(statement.slice(colon + 1).trim());
			const nodeContext = [...contexts].reverse().find((context) => context.kind === 'node');
			const blockContext = [...contexts].reverse().find((context) => context.kind === 'block');
			const styleContext = [...contexts].reverse().find((context) => context.kind === 'style');
			if (styleContext) {
				applyD2Style(getNode(styleContext.path), rawKey, rawValue, warnings);
				continue;
			}
			if (blockContext && isD2NodeProperty(rawKey)) {
				const node = getNode(blockContext.path, blockContext.path.split('.').slice(0, -1));
				applyD2NodeProperty(node, rawKey, rawValue, warnings);
				groups.delete(blockContext.path);
				const context = contexts.find((candidate) => candidate === blockContext);
				if (context) context.kind = 'node';
				continue;
			}
			if (nodeContext && isD2NodeProperty(rawKey)) {
				applyD2NodeProperty(getNode(nodeContext.path), rawKey, rawValue, warnings);
				continue;
			}
			if (!nodeContext && rawKey === 'direction') {
				const requested = rawValue.toLowerCase();
				if (requested === 'right' || requested === 'left') direction = 'left-to-right';
				else if (requested === 'down' || requested === 'up') direction = 'top-to-bottom';
				else warnings.add('d2-direction', `D2 direction ${rawValue} was replaced by top-to-bottom layout.`);
				if (requested === 'left' || requested === 'up')
					warnings.add(
						'd2-direction',
						`D2 reverse direction ${rawValue} was laid out in the nearest supported direction.`
					);
				continue;
			}
			if (!nodeContext && /^(?:vars|classes|layers|scenarios|steps|near|constraint|grid)$/i.test(rawKey)) {
				warnings.add(
					'd2-unsupported-construct',
					`D2 ${rawKey} was ignored; its objects remain editable where possible.`
				);
				continue;
			}
			const dottedStyle = /^(.*)\.style\.(.+)$/.exec(rawKey);
			if (dottedStyle) {
				applyD2Style(getNode(dottedStyle[1]!), dottedStyle[2]!, rawValue, warnings);
				continue;
			}
			const dottedProperty = /^(.*)\.(shape|label|width|height|link)$/.exec(rawKey);
			if (dottedProperty) {
				applyD2NodeProperty(getNode(dottedProperty[1]!), dottedProperty[2]!, rawValue, warnings);
				continue;
			}
			const node = getNode(rawKey);
			node.label = rawValue || node.label;
			contexts.push({ kind: 'node', indent, path: node.key });
		}
	}
	return { format: 'd2', direction, nodes, groups, edges, warnings };
}

type D2Context = { kind: 'group' | 'block' | 'node' | 'style'; indent: number; path: string };

function findD2Operator(value: string): { source: string; operator: '<-' | '->' | '--' | '<->'; rest: string } | null {
	for (const operator of ['<->', '->', '<-', '--'] as const) {
		const index = value.indexOf(operator);
		if (index > 0) {
			return {
				source: value.slice(0, index).trim(),
				operator,
				rest: value.slice(index + operator.length).trim()
			};
		}
	}
	return null;
}

function splitD2Label(value: string): { target: string; label?: string } {
	const colon = findUnquotedColon(value);
	if (colon < 0) return { target: value.trim() };
	return { target: value.slice(0, colon).trim(), label: unquote(value.slice(colon + 1).trim()) || undefined };
}

function isD2NodeProperty(key: string): boolean {
	return /^(?:label|shape|width|height|link|tooltip|icon|img|style(?:\..+)?)$/i.test(key);
}

function applyD2NodeProperty(node: DiagramNode, key: string, value: string, warnings: WarningCollector) {
	switch (key.toLowerCase()) {
		case 'label':
			node.label = value || node.label;
			break;
		case 'shape':
			node.shape = value.toLowerCase();
			if (!['rectangle', 'rect', 'square', 'circle', 'oval', 'ellipse'].includes(node.shape))
				warnings.add('d2-unsupported-shape', `D2 ${value} shapes use editable rectangular cards.`);
			break;
		case 'link':
			node.link = value;
			break;
		case 'width':
		case 'height':
			warnings.add('d2-style', `D2 ${key} is recorded by the diagram importer but uses the standard card size.`);
			break;
		case 'icon':
		case 'img':
			warnings.add('d2-unsupported-construct', `D2 ${key} content was omitted from the editable card.`);
			break;
		case 'tooltip':
			warnings.add('d2-unsupported-construct', 'D2 tooltips were omitted from editable cards.');
			break;
		default:
			if (key.toLowerCase().startsWith('style.')) applyD2Style(node, key.slice(6), value, warnings);
			else warnings.add('d2-unsupported-construct', `D2 ${key} was ignored.`);
	}
}

function applyD2Style(node: DiagramNode, key: string, value: string, warnings: WarningCollector) {
	const normalized = key.toLowerCase().replaceAll('_', '-');
	switch (normalized) {
		case 'fill':
			node.style.fill = value;
			break;
		case 'stroke':
			node.style.stroke = value;
			break;
		case 'font-color':
		case 'color':
			node.style.color = value;
			break;
		case 'stroke-width': {
			const width = Number.parseFloat(value);
			if (Number.isFinite(width)) node.style.width = width;
			else warnings.add('d2-style', `D2 stroke width ${value} was ignored.`);
			break;
		}
		case 'opacity': {
			const opacity = Number.parseFloat(value);
			if (Number.isFinite(opacity)) node.style.opacity = Math.max(0, Math.min(1, opacity));
			else warnings.add('d2-style', `D2 opacity ${value} was ignored.`);
			break;
		}
		case 'stroke-dash':
			node.style.dash = [8, 6];
			break;
		default:
			warnings.add('d2-style', `D2 style.${key} was ignored.`);
	}
}

function materializeDiagram(parsed: ParsedDiagram, fileName: string): InterchangeImport {
	const { snapshot, pageId, layerId } = blankSnapshot(fileName);
	const shapeIds = new Map<string, string>();
	const groupIds = new Map<string, string>();
	const allGroups = new Map(parsed.groups);
	for (const node of parsed.nodes.values()) {
		for (let index = 1; index <= node.groupPath.length; index += 1) {
			const path = node.groupPath.slice(0, index).join('.');
			if (!allGroups.has(path))
				allGroups.set(path, {
					key: path,
					label: lastPathPart(path),
					parentPath: node.groupPath.slice(0, index - 1),
					style: {}
				});
		}
	}
	const groupsInOrder = [...allGroups.values()].sort(
		(left, right) => left.key.split('.').length - right.key.split('.').length || left.key.localeCompare(right.key)
	);
	for (const group of groupsInOrder) {
		const id = inkId(`${parsed.format}-group`, group.key);
		groupIds.set(group.key, id);
		const shape = EditorShapeRecord.createContainer(
			pageId,
			0,
			0,
			{
				w: NODE_WIDTH + GROUP_PADDING * 2,
				h: NODE_HEIGHT + GROUP_PADDING * 2,
				title: group.label,
				fill: group.style.fill ?? DEFAULT_GROUP_FILL,
				stroke: group.style.stroke ?? DEFAULT_GROUP_STROKE,
				radius: 12
			},
			id
		);
		shape.layerId = layerId;
		shape.metadata = diagramMetadata(parsed.format, group.key, group.label, 'diagram.group');
		const parent = group.parentPath.join('.');
		if (parent) shape.groupId = groupIds.get(parent);
		addShape(snapshot.doc, pageId, layerId, shape);
	}
	for (const node of parsed.nodes.values()) {
		const id = inkId(`${parsed.format}-node`, node.key);
		shapeIds.set(node.key, id);
		const props: MarkdownProps = {
			md: node.label,
			w: NODE_WIDTH,
			h: NODE_HEIGHT,
			fontSize: 16,
			fontFamily: 'Arial',
			color: node.style.color ?? DEFAULT_TEXT_COLOR,
			bg: node.style.fill ?? DEFAULT_NODE_FILL,
			border: node.style.stroke ?? DEFAULT_NODE_STROKE
		};
		const shape = EditorShapeRecord.createMarkdown(pageId, 0, 0, props, id);
		shape.layerId = layerId;
		const groupId = node.groupPath.length > 0 ? groupIds.get(node.groupPath.join('.')) : undefined;
		if (groupId) shape.groupId = groupId;
		shape.opacity = node.style.opacity;
		shape.metadata = diagramMetadata(parsed.format, node.key, node.label, 'diagram.node', node.link, {
			diagram_shape: node.shape,
			classes: node.classes
		});
		addShape(snapshot.doc, pageId, layerId, shape);
	}
	for (const edge of parsed.edges) {
		const sourceId = shapeIds.get(edge.source);
		const targetId = shapeIds.get(edge.target);
		if (!sourceId || !targetId) {
			parsed.warnings.add(
				`${parsed.format}-dangling-edge`,
				`${parsed.format.toUpperCase()} edges to missing nodes were omitted.`
			);
			continue;
		}
		const edgeId = inkId(
			`${parsed.format}-edge`,
			`${Object.keys(snapshot.doc.shapes).length + edgesForDocument(snapshot.doc).length}`
		);
		const startBinding = EditorBindingRecord.create(edgeId, sourceId, 'start', { kind: 'center' }, `${edgeId}:start`);
		const endBinding = EditorBindingRecord.create(edgeId, targetId, 'end', { kind: 'center' }, `${edgeId}:end`);
		const arrow = EditorShapeRecord.createArrow(
			pageId,
			0,
			0,
			{
				points: [
					{ x: 0, y: 0 },
					{ x: NODE_WIDTH, y: 0 }
				],
				start: { kind: 'bound', bindingId: startBinding.id },
				end: { kind: 'bound', bindingId: endBinding.id },
				style: {
					stroke: edge.style.stroke ?? DEFAULT_NODE_STROKE,
					width: edge.style.width ?? 2,
					headStart: edge.startArrow,
					headEnd: edge.endArrow,
					...(edge.style.dash ? { dash: edge.style.dash } : {})
				},
				routing: { kind: 'straight' },
				...(edge.label ? { label: { text: edge.label, align: 'center', offset: 0 } } : {})
			},
			edgeId
		);
		arrow.layerId = layerId;
		addShape(snapshot.doc, pageId, layerId, arrow);
		snapshot.doc.bindings[startBinding.id] = startBinding;
		snapshot.doc.bindings[endBinding.id] = endBinding;
	}

	const state = EditorState.create();
	state.doc = snapshot.doc;
	state.ui.currentPageId = pageId;
	const nodeShapeIds = [...shapeIds.values()];
	const laidOut = graphLayout(state, nodeShapeIds, 'flow', parsed.direction, 64, 96);
	snapshot.doc = laidOut.doc;
	resizeDiagramGroups(snapshot.doc, [...groupIds.values()]);
	snapshot.order.shapeOrder![pageId] = [...snapshot.doc.pages[pageId]!.shapeIds];
	snapshot.order.layers = snapshot.doc.layers;
	return { format: parsed.format, snapshot, warnings: parsed.warnings.values() };
}

function resizeDiagramGroups(document: BoardExport['doc'], groupIds: string[]) {
	const ordered = groupIds.slice().sort((left, right) => groupDepth(document, right) - groupDepth(document, left));
	for (const id of ordered) {
		const group = document.shapes[id];
		if (!group || group.type !== 'container') continue;
		const children = Object.values(document.shapes).filter((shape) => shape.groupId === id);
		if (children.length === 0) continue;
		const bounds = children.map(shapeBounds);
		const minX = Math.min(...bounds.map((bound) => bound.min.x)) - GROUP_PADDING;
		const minY = Math.min(...bounds.map((bound) => bound.min.y)) - GROUP_PADDING;
		const maxX = Math.max(...bounds.map((bound) => bound.max.x)) + GROUP_PADDING;
		const maxY = Math.max(...bounds.map((bound) => bound.max.y)) + GROUP_PADDING;
		group.x = minX;
		group.y = minY;
		group.props = { ...group.props, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
	}
}

function groupDepth(document: BoardExport['doc'], id: string): number {
	let depth = 0;
	let groupId = document.shapes[id]?.groupId;
	while (groupId) {
		depth += 1;
		groupId = document.shapes[groupId]?.groupId;
	}
	return depth;
}

function diagramMetadata(
	format: DiagramFormat,
	key: string,
	label: string,
	role: string,
	link?: string,
	customMetadata: Record<string, unknown> = {}
): ShapeMetadata {
	return {
		name: key,
		title: label,
		role,
		description: null,
		body: null,
		tags: [`diagram:${format}`],
		source: `${format}:${key}`,
		link: link ?? null,
		customMetadata,
		locked: false,
		agentEditable: true
	};
}

function edgesForDocument(document: BoardExport['doc']): ArrowShape[] {
	return Object.values(document.shapes).filter((shape): shape is ArrowShape => shape.type === 'arrow');
}

function ensureD2Groups(path: string[], groups: Map<string, DiagramGroup>) {
	for (let index = 1; index <= path.length; index += 1) {
		const key = path.slice(0, index).join('.');
		if (!groups.has(key))
			groups.set(key, { key, label: lastPathPart(key), parentPath: path.slice(0, index - 1), style: {} });
	}
}

function qualifyD2Key(key: string, groupPath: string[]): string {
	const clean = unquote(key.trim());
	if (!groupPath.length || clean.includes('.')) return clean;
	return [...groupPath, clean].join('.');
}

function lastPathPart(value: string): string {
	return value.split('.').at(-1) || value;
}

function splitEndpointList(value: string): string[] {
	return value
		.split('&')
		.map((item) => item.trim())
		.filter(Boolean);
}

function splitStatements(value: string): string[] {
	const result: string[] = [];
	let start = 0;
	let square = 0;
	let round = 0;
	let curly = 0;
	let quote = '';
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index]!;
		if (quote) {
			if (character === quote && value[index - 1] !== '\\') quote = '';
			continue;
		}
		if (character === '"' || character === "'") quote = character;
		else if (character === '[') square += 1;
		else if (character === ']') square -= 1;
		else if (character === '(') round += 1;
		else if (character === ')') round -= 1;
		else if (character === '{') curly += 1;
		else if (character === '}') curly -= 1;
		else if (character === ';' && square === 0 && round === 0 && curly === 0) {
			result.push(value.slice(start, index).trim());
			start = index + 1;
		}
	}
	result.push(value.slice(start).trim());
	return result;
}

function parseStyleDeclarations(value: string, warnings: WarningCollector, code: string): DiagramStyle {
	const style: DiagramStyle = {};
	for (const declaration of value.split(/[,;]/)) {
		const separator = declaration.indexOf(':');
		if (separator < 0) {
			warnings.add(code, `Style declaration ${declaration.trim()} was ignored.`);
			continue;
		}
		const key = declaration.slice(0, separator).trim().toLowerCase().replaceAll('_', '-');
		const raw = unquote(declaration.slice(separator + 1).trim());
		switch (key) {
			case 'fill':
				style.fill = raw;
				break;
			case 'stroke':
				style.stroke = raw;
				break;
			case 'color':
			case 'font-color':
				style.color = raw;
				break;
			case 'stroke-width': {
				const width = Number.parseFloat(raw);
				if (Number.isFinite(width)) style.width = width;
				else warnings.add(code, `Stroke width ${raw} was ignored.`);
				break;
			}
			case 'opacity': {
				const opacity = Number.parseFloat(raw);
				if (Number.isFinite(opacity)) style.opacity = Math.max(0, Math.min(1, opacity));
				else warnings.add(code, `Opacity ${raw} was ignored.`);
				break;
			}
			case 'stroke-dasharray':
			case 'stroke-dash':
				style.dash = [8, 6];
				break;
			default:
				warnings.add(code, `Style property ${key} was ignored.`);
		}
	}
	return style;
}

function findUnquotedColon(value: string): number {
	let quote = '';
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index]!;
		if (quote) {
			if (character === quote && value[index - 1] !== '\\') quote = '';
		} else if (character === '"' || character === "'") quote = character;
		else if (character === ':') return index;
	}
	return -1;
}

function unquote(value: string): string {
	if (
		value.length >= 2 &&
		((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
	)
		return value.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\'", "'");
	return value.replaceAll('<br/>', '\n').replaceAll('<br>', '\n').trim();
}

function slug(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9_.-]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'group'
	);
}

function diagramParseError(message: string, line: number): Error {
	return new Error(`${message} (line ${line})`);
}
