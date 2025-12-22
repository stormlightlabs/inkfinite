<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    Store,
    EditorState,
    PageRecord,
    ShapeRecord,
    SelectTool,
    routeAction,
    createToolMap,
    type Action,
    type Viewport,
    Camera,
  } from 'inkfinite-core';
  import { createRenderer, type Renderer } from 'inkfinite-renderer';
  import { createInputAdapter, type InputAdapter } from '../input';

  // Create the editor store
  const store = new Store();

  // Initialize with a default page and some test shapes
  store.setState((state) => {
    const page = PageRecord.create('Page 1');
    const rect1 = ShapeRecord.createRect(
      page.id,
      -200,
      -100,
      { w: 150, h: 100, fill: '#ff6b6b', stroke: '#c92a2a', radius: 8 },
    );
    const rect2 = ShapeRecord.createRect(
      page.id,
      50,
      -50,
      { w: 120, h: 80, fill: '#4dabf7', stroke: '#1971c2', radius: 8 },
    );
    const ellipse = ShapeRecord.createEllipse(
      page.id,
      -100,
      100,
      { w: 100, h: 100, fill: '#51cf66', stroke: '#2f9e44' },
    );

    page.shapeIds.push(rect1.id, rect2.id, ellipse.id);

    return {
      ...state,
      doc: {
        ...state.doc,
        pages: { [page.id]: page },
        shapes: {
          [rect1.id]: rect1,
          [rect2.id]: rect2,
          [ellipse.id]: ellipse,
        },
      },
      ui: {
        ...state.ui,
        currentPageId: page.id,
      },
    };
  });

  // Set up tools
  const selectTool = new SelectTool();
  const tools = createToolMap([selectTool]);

  // Handle actions from input adapter
  function handleAction(action: Action) {
    store.setState((state) => routeAction(state, action, tools));
  }

  let canvas: HTMLCanvasElement;
  let renderer: Renderer | null = null;
  let inputAdapter: InputAdapter | null = null;

  onMount(() => {
    // Create renderer
    renderer = createRenderer(canvas, store);

    // Get viewport dimensions
    function getViewport(): Viewport {
      const rect = canvas.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }

    // Get current camera
    function getCamera() {
      return store.getState().camera;
    }

    // Create input adapter
    inputAdapter = createInputAdapter({
      canvas,
      getCamera,
      getViewport,
      onAction: handleAction,
    });
  });

  onDestroy(() => {
    renderer?.dispose();
    inputAdapter?.dispose();
  });
</script>

<canvas bind:this={canvas}></canvas>

<style>
  canvas {
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
    cursor: default;
  }
</style>
