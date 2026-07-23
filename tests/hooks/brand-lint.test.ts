import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

function runHook(payload: unknown): { code: number; stderr: string } {
  try {
    execFileSync("bash", ["hooks/brand-lint.sh"], {
      input: JSON.stringify(payload), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stderr: "" };
  } catch (e) {
    const err = e as { status: number; stderr: string };
    return { code: err.status, stderr: err.stderr };
  }
}

const write = (path: string, content: string) => ({
  tool_name: "Write", tool_input: { file_path: path, content },
});

const multiEdit = (path: string, edits: unknown) => ({
  tool_name: "MultiEdit", tool_input: { file_path: path, edits },
});

describe("brand-lint hook", () => {
  it("blocks off-brand copy in a content path", () => {
    const r = runHook(write("content/post.md", "Leverage Base1. Learn more."));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("rule");
  });

  it("allows clean copy in a content path", () => {
    expect(runHook(write("content/post.md", "Build your first app. Start building.")).code).toBe(0);
  });

  it("does NOT fire on brand/rules.md", () => {
    expect(runHook(write("brand/rules.md", "Never say leverage. Learn more.")).code).toBe(0);
  });

  it("does NOT fire on memory files", () => {
    expect(runHook(write("memory/patterns.md", "The word leverage was rejected.")).code).toBe(0);
  });

  it("does NOT fire on source code", () => {
    expect(runHook(write("src/lint/brand.ts", 'const WEAK = ["learn more"];')).code).toBe(0);
  });

  it("does NOT fire on repo documentation at the root", () => {
    expect(runHook(write("README.md", "Leverage this. Learn more.")).code).toBe(0);
    expect(runHook(write("CONTRIBUTING.md", "Leverage this. Learn more.")).code).toBe(0);
  });

  it("DOES fire on a generated page", () => {
    expect(runHook(write("build/pages/cc-1/index.html", "<p>Learn more</p>")).code).toBe(2);
  });

  it("ignores non-write tools", () => {
    expect(runHook({ tool_name: "Read", tool_input: { file_path: "content/post.md" } }).code).toBe(0);
  });

  it("allows copy with only a warn-severity rule-7 finding in a content path (severity contract)", () => {
    const r = runHook(write("content/post.md", "It's not marketing, it's storytelling. Start building."));
    expect(r.code).toBe(0);
  });

  it("does not crash on malformed JSON on stdin", () => {
    try {
      execFileSync("bash", ["hooks/brand-lint.sh"], {
        input: "{not json", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      const err = e as { status: number };
      // Must not crash with a signal or an uncontrolled non-2/0 failure.
      expect([0, 2]).toContain(err.status);
      return;
    }
    // fell through: exit 0, also acceptable
    expect(true).toBe(true);
  });

  it("does not crash on empty stdin", () => {
    const result = execFileSync("bash", ["hooks/brand-lint.sh"], {
      input: "", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    expect(result).toBe("");
  });

  it("blocks a MultiEdit with a banned term in the first hunk, in-scope path", () => {
    const r = runHook(
      multiEdit("content/post.md", [
        { old_string: "a", new_string: "Our users can deploy fast." },
        { old_string: "b", new_string: "Build your first app." },
      ]),
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("rule");
  });

  it("blocks a MultiEdit with a banned term only in a later hunk (first hunk clean)", () => {
    // A naive fix that only reads edits[0] would miss this.
    const r = runHook(
      multiEdit("content/post.md", [
        { old_string: "a", new_string: "Build your first app." },
        { old_string: "b", new_string: "Our users can deploy fast." },
      ]),
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("rule");
  });

  it("allows a MultiEdit where every hunk is clean, in-scope path", () => {
    const r = runHook(
      multiEdit("content/post.md", [
        { old_string: "a", new_string: "Build your first app." },
        { old_string: "b", new_string: "Start building today." },
      ]),
    );
    expect(r.code).toBe(0);
  });

  it("does NOT fire a MultiEdit with a banned term on an out-of-scope path", () => {
    const r = runHook(
      multiEdit("brand/rules.md", [
        { old_string: "a", new_string: "Our users can deploy fast." },
      ]),
    );
    expect(r.code).toBe(0);
  });

  it("does not crash on a MultiEdit with a malformed or missing edits array", () => {
    expect(runHook({ tool_name: "MultiEdit", tool_input: { file_path: "content/post.md" } }).code).toBe(0);
    expect(
      runHook({ tool_name: "MultiEdit", tool_input: { file_path: "content/post.md", edits: "not-an-array" } }).code,
    ).toBe(0);
    expect(
      runHook(
        multiEdit("content/post.md", [{ old_string: "a" }, { new_string: 42 }, null, "oops"]),
      ).code,
    ).toBe(0);
  });
});
