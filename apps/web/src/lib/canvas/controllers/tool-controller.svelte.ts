import { switchTool, type Store, type Tool, type ToolId } from "inkfinite-core";

export class ToolController {
  currentToolId = $state<ToolId>("select");

  constructor(
    private store: Store,
    private tools: Map<ToolId, Tool>,
  ) {
    store.subscribe((state) => {
      this.currentToolId = state.ui.toolId;
    });
  }

  handleChange = (toolId: ToolId) => {
    this.store.setState((state) => switchTool(state, toolId, this.tools));
  };
}
