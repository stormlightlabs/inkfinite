<script lang="ts">
	import type { ToolId } from 'inkfinite-core';

	type Props = { currentTool: ToolId; onToolChange: (toolId: ToolId) => void; onHistoryClick?: () => void };

	let { currentTool, onToolChange, onHistoryClick }: Props = $props();

	const tools: Array<{ id: ToolId; label: string; icon: string }> = [
		{ id: 'select', label: 'Select', icon: '⌖' },
		{ id: 'rect', label: 'Rectangle', icon: '▭' },
		{ id: 'ellipse', label: 'Ellipse', icon: '○' },
		{ id: 'line', label: 'Line', icon: '╱' },
		{ id: 'arrow', label: 'Arrow', icon: '→' },
		{ id: 'text', label: 'Text', icon: 'T' }
	];

	function handleToolClick(toolId: ToolId) {
		onToolChange(toolId);
	}
</script>

<div class="toolbar" role="toolbar" aria-label="Drawing tools">
	{#each tools as tool}
		<button
			class="tool-button"
			class:active={currentTool === tool.id}
			onclick={() => handleToolClick(tool.id)}
			aria-label={tool.label}
			aria-pressed={currentTool === tool.id}
			data-tool-id={tool.id}>
			<span class="tool-icon">{tool.icon}</span>
			<span class="tool-label">{tool.label}</span>
		</button>
	{/each}

	{#if onHistoryClick}
		<div class="toolbar-divider"></div>
		<button class="tool-button history-button" onclick={onHistoryClick} aria-label="History">
			<span class="tool-icon">⏱</span>
			<span class="tool-label">History</span>
		</button>
	{/if}
</div>

<style>
	.toolbar {
		display: flex;
		gap: 8px;
		padding: 12px;
		background: var(--surface-elevated);
		border-bottom: 1px solid var(--border);
	}

	.tool-button {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 8px 12px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
		transition: all 0.2s;
		min-width: 60px;
	}

	.tool-button:hover {
		background: var(--surface-elevated);
		border-color: var(--text-muted);
	}

	.tool-button:focus {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.tool-button.active {
		background: var(--accent);
		color: var(--surface);
		border-color: var(--accent-hover);
	}

	.tool-icon {
		font-size: 20px;
		line-height: 1;
	}

	.tool-label {
		font-size: 11px;
		line-height: 1;
		white-space: nowrap;
	}

	.toolbar-divider {
		width: 1px;
		background-color: var(--border);
		margin: 0 8px;
	}

	.history-button {
		margin-left: auto;
	}
</style>
