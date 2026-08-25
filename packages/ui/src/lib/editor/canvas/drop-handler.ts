import { Camera, type EditorState, type Viewport, type stencils } from '@inkfinite/core';

export type CanvasDropHandlers = {
	canvas: HTMLCanvasElement | null;
	getState: () => EditorState;
	getViewport: () => Viewport;
	getDraggedStencil: () => stencils.Stencil | null;
	findStencil: (id: string) => stencils.Stencil | null;
	clearStencilDrag: () => void;
	importSvgFile: (file: File) => void;
	importImageFile: (file: File, world: { x: number; y: number }) => void;
	importDroppedFile: (file: File) => void;
	insertStencil: (stencil: stencils.Stencil, world: { x: number; y: number }) => void;
};

/** Handles file and stencil drops without coupling Canvas to import policy. */
export function handleCanvasDrop(event: DragEvent, handlers: CanvasDropHandlers): void {
	event.preventDefault();
	const file = event.dataTransfer?.files?.[0];
	if (!handlers.getDraggedStencil() && file) {
		const rect = handlers.canvas?.getBoundingClientRect();
		const screen = rect
			? { x: event.clientX - rect.left, y: event.clientY - rect.top }
			: { x: 0, y: 0 };
		const world = Camera.screenToWorld(
			handlers.getState().camera,
			screen,
			handlers.getViewport()
		);
		const name = file.name.toLowerCase();
		if (name.endsWith('.svg') || file.type === 'image/svg+xml')
			return void handlers.importSvgFile(file);
		if (file.type.startsWith('image/') || /\.(?:png|jpe?g|gif|webp|bmp|avif)$/i.test(name))
			return void handlers.importImageFile(file, world);
		if (
			name.endsWith('.excalidraw') ||
			name.endsWith('.canvas') ||
			name.endsWith('.inkfinite')
		)
			return void handlers.importDroppedFile(file);
	}

	let stencil = handlers.getDraggedStencil();
	if (!stencil && event.dataTransfer) {
		const stencilId = event.dataTransfer.getData('application/x-inkfinite-stencil');
		if (stencilId) stencil = handlers.findStencil(stencilId);
	}
	if (!stencil || !handlers.canvas) return;
	const rect = handlers.canvas.getBoundingClientRect();
	const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
	const world = Camera.screenToWorld(handlers.getState().camera, screen, handlers.getViewport());
	handlers.insertStencil(stencil, world);
	handlers.clearStencilDrag();
}
