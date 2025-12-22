import type { Action } from "./actions";
import type { EditorState, ToolId } from "./reactivity";

/**
 * Tool interface - defines behavior for each editor tool
 *
 * Tools are explicit state machines that handle user input actions.
 * Each tool decides how to respond to actions and can update editor state.
 */
export interface Tool {
  /** Unique identifier for this tool */
  readonly id: ToolId;

  /**
   * Called when the tool becomes active
   *
   * @param state - Current editor state
   * @returns Updated editor state
   */
  onEnter(state: EditorState): EditorState;

  /**
   * Called when an action occurs while this tool is active
   *
   * @param state - Current editor state
   * @param action - The action to handle
   * @returns Updated editor state
   */
  onAction(state: EditorState, action: Action): EditorState;

  /**
   * Called when the tool becomes inactive
   *
   * @param state - Current editor state
   * @returns Updated editor state
   */
  onExit(state: EditorState): EditorState;
}

/**
 * Route an action to the currently active tool
 *
 * @param state - Current editor state
 * @param action - Action to route
 * @param tools - Map of tool ID to tool instance
 * @returns Updated editor state after tool handles the action
 */
export function routeAction(state: EditorState, action: Action, tools: Map<ToolId, Tool>): EditorState {
  const currentTool = tools.get(state.ui.toolId);
  if (!currentTool) return state;
  return currentTool.onAction(state, action);
}

/**
 * Switch from current tool to a new tool
 *
 * Calls onExit on the current tool (if it exists), then onEnter on the new tool.
 *
 * @param state - Current editor state
 * @param newToolId - ID of tool to switch to
 * @param tools - Map of tool ID to tool instance
 * @returns Updated editor state with new tool active
 */
export function switchTool(state: EditorState, newToolId: ToolId, tools: Map<ToolId, Tool>): EditorState {
  if (state.ui.toolId === newToolId) {
    return state;
  }

  const currentTool = tools.get(state.ui.toolId);
  let nextState = state;
  if (currentTool) {
    nextState = currentTool.onExit(nextState);
  }

  nextState = { ...nextState, ui: { ...nextState.ui, toolId: newToolId } };

  const newTool = tools.get(newToolId);
  if (newTool) {
    nextState = newTool.onEnter(nextState);
  }

  return nextState;
}

/**
 * Create a map of tools from an array
 *
 * @param toolList - Array of tool instances
 * @returns Map of tool ID to tool instance
 */
export function createToolMap(toolList: Tool[]): Map<ToolId, Tool> {
  const map = new Map<ToolId, Tool>();
  for (const tool of toolList) {
    map.set(tool.id, tool);
  }
  return map;
}
