import { describe, expect, it } from "vitest";
import { Action, Modifiers, PointerButtons } from "../src/actions";
import { Vec2 } from "../src/math";
import type { TextProps } from "../src/model";
import { EditorState } from "../src/reactivity";
import type { Tool } from "../src/tools";
import { createToolMap, routeAction, switchTool, TextTool } from "../src/tools";

describe("Tools", () => {
  describe("Tool interface", () => {
    it("should allow creating a tool with all required methods", () => {
      const tool: Tool = {
        id: "select",
        onEnter: (state) => state,
        onAction: (state, _action) => state,
        onExit: (state) => state,
      };

      expect(tool.id).toBe("select");
      expect(typeof tool.onEnter).toBe("function");
      expect(typeof tool.onAction).toBe("function");
      expect(typeof tool.onExit).toBe("function");
    });
  });

  describe("createToolMap", () => {
    it("should create a map from tool array", () => {
      const selectTool: Tool = {
        id: "select",
        onEnter: (state) => state,
        onAction: (state, _action) => state,
        onExit: (state) => state,
      };

      const rectTool: Tool = {
        id: "rect",
        onEnter: (state) => state,
        onAction: (state, _action) => state,
        onExit: (state) => state,
      };

      const map = createToolMap([selectTool, rectTool]);

      expect(map.size).toBe(2);
      expect(map.get("select")).toBe(selectTool);
      expect(map.get("rect")).toBe(rectTool);
    });

    it("should handle empty array", () => {
      const map = createToolMap([]);
      expect(map.size).toBe(0);
    });
  });

  describe("switchTool", () => {
    it("should call onExit and onEnter in correct order when switching tools", () => {
      const callLog: string[] = [];

      const selectTool: Tool = {
        id: "select",
        onEnter: (state) => {
          callLog.push("select:onEnter");
          return state;
        },
        onAction: (state, _action) => state,
        onExit: (state) => {
          callLog.push("select:onExit");
          return state;
        },
      };

      const rectTool: Tool = {
        id: "rect",
        onEnter: (state) => {
          callLog.push("rect:onEnter");
          return state;
        },
        onAction: (state, _action) => state,
        onExit: (state) => {
          callLog.push("rect:onExit");
          return state;
        },
      };

      const tools = createToolMap([selectTool, rectTool]);
      const initialState = EditorState.create();
      const newState = switchTool(initialState, "rect", tools);

      expect(callLog).toEqual(["select:onExit", "rect:onEnter"]);
      expect(newState.ui.toolId).toBe("rect");
    });

    it("should update toolId in state", () => {
      const selectTool: Tool = {
        id: "select",
        onEnter: (state) => state,
        onAction: (state, _action) => state,
        onExit: (state) => state,
      };

      const rectTool: Tool = {
        id: "rect",
        onEnter: (state) => state,
        onAction: (state, _action) => state,
        onExit: (state) => state,
      };

      const tools = createToolMap([selectTool, rectTool]);
      const initialState = EditorState.create();

      expect(initialState.ui.toolId).toBe("select");

      const newState = switchTool(initialState, "rect", tools);
      expect(newState.ui.toolId).toBe("rect");
    });

    it("should do nothing if already on the target tool", () => {
      const callLog: string[] = [];

      const selectTool: Tool = {
        id: "select",
        onEnter: (state) => {
          callLog.push("select:onEnter");
          return state;
        },
        onAction: (state, _action) => state,
        onExit: (state) => {
          callLog.push("select:onExit");
          return state;
        },
      };

      const tools = createToolMap([selectTool]);
      const initialState = EditorState.create();

      const newState = switchTool(initialState, "select", tools);

      expect(callLog).toEqual([]);
      expect(newState.ui.toolId).toBe("select");
      expect(newState).toBe(initialState);
    });

    it("should handle switching when current tool is not registered", () => {
      const rectTool: Tool = {
        id: "rect",
        onEnter: (state) => state,
        onAction: (state, _action) => state,
        onExit: (state) => state,
      };

      const tools = createToolMap([rectTool]);
      const initialState = EditorState.create();
      const newState = switchTool(initialState, "rect", tools);
      expect(newState.ui.toolId).toBe("rect");
    });

    it("should handle switching to unregistered tool", () => {
      const selectTool: Tool = {
        id: "select",
        onEnter: (state) => state,
        onAction: (state, _action) => state,
        onExit: (state) => state,
      };

      const tools = createToolMap([selectTool]);
      const initialState = EditorState.create();
      const newState = switchTool(initialState, "rect", tools);
      expect(newState.ui.toolId).toBe("rect");
    });

    it("should allow tools to modify state during onExit and onEnter", () => {
      const selectTool: Tool = {
        id: "select",
        onEnter: (state) => state,
        onAction: (state, _action) => state,
        onExit: (state) => ({ ...state, ui: { ...state.ui, selectionIds: [] } }),
      };

      const rectTool: Tool = {
        id: "rect",
        onEnter: (state) => ({ ...state, ui: { ...state.ui, selectionIds: [] } }),
        onAction: (state, _action) => state,
        onExit: (state) => state,
      };

      const tools = createToolMap([selectTool, rectTool]);
      const initialState = {
        ...EditorState.create(),
        ui: { ...EditorState.create().ui, selectionIds: ["shape-1", "shape-2"] },
      };

      const newState = switchTool(initialState, "rect", tools);

      expect(newState.ui.toolId).toBe("rect");
      expect(newState.ui.selectionIds).toEqual([]);
    });
  });

  describe("routeAction", () => {
    it("should delegate action to active tool", () => {
      const actionsReceived: Action[] = [];

      const selectTool: Tool = {
        id: "select",
        onEnter: (state) => state,
        onAction: (state, action) => {
          actionsReceived.push(action);
          return state;
        },
        onExit: (state) => state,
      };

      const tools = createToolMap([selectTool]);
      const state = EditorState.create();

      const action = Action.pointerDown(
        Vec2.create(100, 200),
        Vec2.create(50, 100),
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      );

      routeAction(state, action, tools);

      expect(actionsReceived).toHaveLength(1);
      expect(actionsReceived[0]).toMatchObject({
        type: "pointer-down",
        screen: { x: 100, y: 200 },
        world: { x: 50, y: 100 },
      });
    });

    it("should allow tool to update state based on action", () => {
      const selectTool: Tool = {
        id: "select",
        onEnter: (state) => state,
        onAction: (state, action) => {
          if (action.type === "pointer-down") {
            return { ...state, ui: { ...state.ui, selectionIds: ["shape-1"] } };
          }
          return state;
        },
        onExit: (state) => state,
      };

      const tools = createToolMap([selectTool]);
      const initialState = EditorState.create();

      const action = Action.pointerDown(
        Vec2.create(100, 200),
        Vec2.create(50, 100),
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      );

      const newState = routeAction(initialState, action, tools);

      expect(newState.ui.selectionIds).toEqual(["shape-1"]);
    });

    it("should return state unchanged if current tool is not registered", () => {
      const tools = createToolMap([]);
      const state = EditorState.create();

      const action = Action.pointerDown(
        Vec2.create(100, 200),
        Vec2.create(50, 100),
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      );

      const newState = routeAction(state, action, tools);

      expect(newState).toBe(state);
    });

    it("should allow tool to ignore actions it doesn't care about", () => {
      const callLog: string[] = [];

      const selectTool: Tool = {
        id: "select",
        onEnter: (state) => state,
        onAction: (state, action) => {
          if (action.type.startsWith("pointer-")) {
            callLog.push(action.type);
            return { ...state, ui: { ...state.ui, selectionIds: ["handled"] } };
          }

          return state;
        },
        onExit: (state) => state,
      };

      const tools = createToolMap([selectTool]);
      const state = EditorState.create();
      const keyAction = Action.keyDown("a", "KeyA", Modifiers.create());
      const afterKeyAction = routeAction(state, keyAction, tools);

      expect(afterKeyAction.ui.selectionIds).toEqual([]);
      expect(callLog).toEqual([]);

      const pointerAction = Action.pointerDown(
        Vec2.create(0, 0),
        Vec2.create(0, 0),
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      );
      const afterPointerAction = routeAction(state, pointerAction, tools);

      expect(afterPointerAction.ui.selectionIds).toEqual(["handled"]);
      expect(callLog).toEqual(["pointer-down"]);
    });

    it("should handle multiple different actions deterministically", () => {
      const stateLog: string[] = [];

      const dummyTool: Tool = {
        id: "select",
        onEnter: (state) => state,
        onAction: (state, action) => {
          switch (action.type) {
            case "pointer-down": {
              stateLog.push("down");
              return { ...state, ui: { ...state.ui, selectionIds: ["pointer-down"] } };
            }
            case "pointer-move": {
              stateLog.push("move");
              return { ...state, ui: { ...state.ui, selectionIds: ["pointer-move"] } };
            }
            case "pointer-up": {
              stateLog.push("up");
              return { ...state, ui: { ...state.ui, selectionIds: [] } };
            }
            default: {
              return state;
            }
          }
        },
        onExit: (state) => state,
      };

      const tools = createToolMap([dummyTool]);
      let state = EditorState.create();

      const down = Action.pointerDown(
        Vec2.create(0, 0),
        Vec2.create(0, 0),
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      );
      state = routeAction(state, down, tools);

      const move = Action.pointerMove(
        Vec2.create(10, 10),
        Vec2.create(5, 5),
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      );
      state = routeAction(state, move, tools);

      const up = Action.pointerUp(
        Vec2.create(10, 10),
        Vec2.create(5, 5),
        0,
        PointerButtons.create(false, false, false),
        Modifiers.create(),
      );
      state = routeAction(state, up, tools);

      expect(stateLog).toEqual(["down", "move", "up"]);
      expect(state.ui.selectionIds).toEqual([]);
    });
  });

  describe("Tool state machine behavior", () => {
    it("should demonstrate complete tool lifecycle", () => {
      const lifecycle: string[] = [];

      const selectTool: Tool = {
        id: "select",
        onEnter: (state) => {
          lifecycle.push("select:enter");
          return state;
        },
        onAction: (state, action) => {
          lifecycle.push(`select:action:${action.type}`);
          return state;
        },
        onExit: (state) => {
          lifecycle.push("select:exit");
          return state;
        },
      };

      const rectTool: Tool = {
        id: "rect",
        onEnter: (state) => {
          lifecycle.push("rect:enter");
          return state;
        },
        onAction: (state, action) => {
          lifecycle.push(`rect:action:${action.type}`);
          return state;
        },
        onExit: (state) => {
          lifecycle.push("rect:exit");
          return state;
        },
      };

      const tools = createToolMap([selectTool, rectTool]);
      let _state = EditorState.create();

      const action1 = Action.pointerDown(
        Vec2.create(0, 0),
        Vec2.create(0, 0),
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      );
      _state = routeAction(_state, action1, tools);

      _state = switchTool(_state, "rect", tools);

      const action2 = Action.pointerMove(
        Vec2.create(10, 10),
        Vec2.create(5, 5),
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      );
      _state = routeAction(_state, action2, tools);

      _state = switchTool(_state, "select", tools);

      expect(lifecycle).toEqual([
        "select:action:pointer-down",
        "select:exit",
        "rect:enter",
        "rect:action:pointer-move",
        "rect:exit",
        "select:enter",
      ]);
    });
  });

  describe("TextTool", () => {
    it("uses a readable default color", () => {
      const tool = new TextTool();
      const state = EditorState.create();
      const pageId = "page:default";
      const withPage = {
        ...state,
        doc: { ...state.doc, pages: { [pageId]: { id: pageId, name: "Page", shapeIds: [] } } },
        ui: { ...state.ui, currentPageId: pageId },
      };

      const action = Action.pointerDown(
        Vec2.create(0, 0),
        Vec2.create(100, 200),
        0,
        PointerButtons.create(true, false, false),
        Modifiers.create(),
      );
      const nextState = tool.onAction(withPage, action);
      const shapeId = nextState.ui.selectionIds[0];
      const createdShape = shapeId ? nextState.doc.shapes[shapeId] : null;

      expect(createdShape?.type).toBe("text");
      expect((createdShape?.props as TextProps).color).toBe("#1f2933");
    });
  });
});
