import { describe, expect, it } from "vitest";
import { filterMcpTools, selectMcpTools, summarizeMcpSelection } from "./mcpToolSelection.js";

const tools = [
  { name: "list_issues", description: "Read project issues" },
  { name: "create_issue", description: "Create an issue" },
  { name: "get_file", description: "Read repository file" },
];

describe("MCP tool selection", () => {
  it("disables one tool from all mode without disabling the rest", () => {
    expect(selectMcpTools(tools, undefined, ["create_issue"], false)).toEqual(["list_issues", "get_file"]);
  });

  it("changes only the filtered tools and preserves unavailable configured names", () => {
    const selected = ["get_file", "retired_tool"];
    const found = filterMcpTools(tools, selected, " ISSUE ", false);
    expect(found.map(tool => tool.name)).toEqual(["list_issues", "create_issue"]);
    const next = selectMcpTools(tools, selected, found.map(tool => tool.name), true);
    expect(next).toEqual(["get_file", "retired_tool", "list_issues", "create_issue"]);
    expect(selectMcpTools(tools, next, found.map(tool => tool.name), false)).toEqual(selected);
  });

  it("searches descriptions and intersects search with active-only mode", () => {
    expect(filterMcpTools(tools, ["get_file"], "read", true)).toEqual([tools[2]]);
    expect(filterMcpTools(tools, undefined, "read", true)).toEqual([tools[0], tools[2]]);
    expect(filterMcpTools(tools, [], "", true)).toEqual([]);
  });

  it("reports only discovered active tools and separately reports unavailable names", () => {
    expect(summarizeMcpSelection(tools, undefined)).toEqual({ activeCount: 3, unavailableNames: [] });
    expect(summarizeMcpSelection(tools, [])).toEqual({ activeCount: 0, unavailableNames: [] });
    expect(summarizeMcpSelection(tools, ["get_file", "get_file", "retired_tool"])).toEqual({ activeCount: 1, unavailableNames: ["retired_tool"] });
  });

  it("supports a 116-tool catalog and an explicit subset that excludes future tools", () => {
    const catalog = Array.from({ length: 116 }, (_, i) => ({ name: `tool_${i}`, description: "" }));
    const subset = selectMcpTools(catalog, [], ["tool_0", "tool_115"], true);
    expect(summarizeMcpSelection(catalog, subset).activeCount).toBe(2);
    expect(selectMcpTools([...catalog, { name: "future_tool", description: "" }], subset, [], true)).toEqual(subset);
    expect(selectMcpTools(catalog, undefined, catalog.map(tool => tool.name), false)).toEqual([]);
  });
});
