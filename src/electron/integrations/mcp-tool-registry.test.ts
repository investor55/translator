import { describe, expect, it } from "vitest";
import { isMutatingToolName } from "./mcp-tool-registry";

describe("isMutatingToolName", () => {
  it("flags known mutating verbs", () => {
    expect(isMutatingToolName("create_issue")).toBe(true);
    expect(isMutatingToolName("update_page")).toBe(true);
    expect(isMutatingToolName("delete_comment")).toBe(true);
  });

  it("does not flag common read-only verbs", () => {
    expect(isMutatingToolName("get_issue")).toBe(false);
    expect(isMutatingToolName("list_projects")).toBe(false);
    expect(isMutatingToolName("search_docs")).toBe(false);
  });
});
