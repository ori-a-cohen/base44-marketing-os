import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Claude Code invokes hooks via an absolute path ($CLAUDE_PROJECT_DIR/hooks/...),
// never a path relative to whatever the current working directory happens to
// be, so the script under test is always addressed absolutely here too --
// that is the realistic invocation the "different working directory" test
// below is checking.
const HOOK = resolve(__dirname, "../../hooks/design-lint.sh");

function runHook(payload: unknown, cwd?: string): { code: number; stderr: string } {
  try {
    execFileSync("bash", [HOOK], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
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

describe("design-lint hook", () => {
  it("blocks an off-token hex in generated markup", () => {
    const r = runHook(write("build/pages/cc-1/index.html", "<p style='color:#FF6B00'>hi</p>"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("#FF6B00");
  });

  it("allows a token hex", () => {
    expect(runHook(write("build/pages/cc-1/index.html", "<p style='color:#FF6A00'>hi</p>")).code).toBe(0);
  });

  it("blocks a gradient", () => {
    const r = runHook(write("build/pages/cc-1/index.html", "<div style='background:linear-gradient(#fff,#000)'>"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("radient");
  });

  it("blocks a box-shadow", () => {
    const r = runHook(write("build/pages/cc-1/index.html", "<div style='box-shadow:0 2px 4px #000'>"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("levation");
  });

  it("does NOT fire on brand/DESIGN.md itself", () => {
    expect(runHook(write("brand/DESIGN.md", 'primary: "#FF6A00" and an example #FF6B00')).code).toBe(0);
  });

  it("does NOT fire on source code", () => {
    expect(runHook(write("src/render/page.ts", "const FALLBACK = '#FF6B00';")).code).toBe(0);
  });

  it("does NOT fire on memory files", () => {
    expect(runHook(write("memory/patterns.md", "We once shipped #FF6B00 by mistake.")).code).toBe(0);
  });

  it("does NOT fire on repo documentation at the root", () => {
    expect(runHook(write("README.md", "The old color was #FF6B00.")).code).toBe(0);
    expect(runHook(write("CONTRIBUTING.md", "The old color was #FF6B00.")).code).toBe(0);
  });

  it("does NOT fire on a generated artifact of the wrong file type", () => {
    expect(runHook(write("build/pages/cc-1/data.json", '{"color":"#FF6B00"}')).code).toBe(0);
  });

  it("ignores non-write tools", () => {
    expect(runHook({ tool_name: "Read", tool_input: { file_path: "build/pages/cc-1/index.html" } }).code).toBe(0);
  });

  it("blocks a MultiEdit with the off-token colour only in a later hunk", () => {
    // A naive fix that only reads edits[0] would miss this.
    const r = runHook(
      multiEdit("build/pages/cc-1/index.html", [
        { old_string: "a", new_string: "<p style='color:#FF6A00'>ok</p>" },
        { old_string: "b", new_string: "<p style='color:#FF6B00'>bad</p>" },
      ]),
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("#FF6B00");
  });

  it("allows a MultiEdit where every hunk is on-token", () => {
    const r = runHook(
      multiEdit("build/pages/cc-1/index.html", [
        { old_string: "a", new_string: "<p style='color:#FF6A00'>ok</p>" },
        { old_string: "b", new_string: "<p style='color:#1E1E24'>ok too</p>" },
      ]),
    );
    expect(r.code).toBe(0);
  });

  it("does NOT fire a MultiEdit with an off-token colour on an out-of-scope path", () => {
    const r = runHook(
      multiEdit("src/render/page.ts", [{ old_string: "a", new_string: "const X = '#FF6B00';" }]),
    );
    expect(r.code).toBe(0);
  });

  it("does not crash on a MultiEdit with a malformed or missing edits array", () => {
    expect(
      runHook({ tool_name: "MultiEdit", tool_input: { file_path: "build/pages/cc-1/index.html" } }).code,
    ).toBe(0);
    expect(
      runHook({
        tool_name: "MultiEdit",
        tool_input: { file_path: "build/pages/cc-1/index.html", edits: "not-an-array" },
      }).code,
    ).toBe(0);
    expect(
      runHook(
        multiEdit("build/pages/cc-1/index.html", [{ old_string: "a" }, { new_string: 42 }, null, "oops"]),
      ).code,
    ).toBe(0);
  });

  it("does not crash on malformed JSON on stdin", () => {
    try {
      execFileSync("bash", [HOOK], {
        input: "{not json",
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      const err = e as { status: number };
      expect([0, 2]).toContain(err.status);
      return;
    }
    expect(true).toBe(true);
  });

  it("does not crash on empty stdin", () => {
    const result = execFileSync("bash", [HOOK], {
      input: "",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(result).toBe("");
  });

  it("does not crash on missing fields", () => {
    expect(runHook({ tool_name: "Write" }).code).toBe(0);
    expect(runHook({ tool_input: { file_path: "build/pages/cc-1/index.html", content: "#FF6B00" } }).code).toBe(0);
  });

  it("works when invoked from a different working directory", () => {
    const r = runHook(write("build/pages/cc-1/index.html", "<p style='color:#FF6B00'>hi</p>"), "/tmp");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("#FF6B00");
  });
});
