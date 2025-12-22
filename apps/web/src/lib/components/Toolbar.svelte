<script lang="ts">
	import type { ToolId } from 'inkfinite-core';

	type Props = { currentTool: ToolId; onToolChange: (toolId: ToolId) => void };

	let { currentTool, onToolChange }: Props = $props();

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
</div>

<style>
	.toolbar {
		display: flex;
		gap: 8px;
		padding: 12px;
		background: #f5f5f5;
		border-bottom: 1px solid #e0e0e0;
	}

	.tool-button {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 8px 12px;
		border: 1px solid #d0d0d0;
		border-radius: 4px;
		background: white;
		cursor: pointer;
		transition: all 0.2s;
		min-width: 60px;
	}

	.tool-button:hover {
		background: #f0f0f0;
		border-color: #b0b0b0;
	}

	.tool-button:focus {
		outline: 2px solid #4a90e2;
		outline-offset: 2px;
	}

	.tool-button.active {
		background: #4a90e2;
		color: white;
		border-color: #357abd;
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
</style>
