#!/usr/bin/env python3
"""The film's agent session, run for real: Claude Code and Cursor working one
repository through kula.

Every answer the film shows an agent getting – tool results, the hook turning
an edit back, the memory one agent leaves for the other – comes from this
script talking to the real `kula mcp` server and the real `kula guard hook`,
signed in as each agent the way they sign in themselves (MCP clientInfo).
It writes what happened to session.json; the film replays it.

  phase claude   Claude Code reads the workflows, finds no release mode, and
                 proposes one (a suggestion a person accepts in the UI)
                 – after trying to loosen the fences in kula.toml itself, which
                 kula refuses
  phase cursor   Cursor ships a release in that mode: Claude Code's memory
                 recalled, an edit to locked code refused, then the same edit
                 through the shell, then an attempt to end the task – all
                 refused; the version bumped; Claude Code verifies it
  phase research a person commits the release and sets up an autoresearch
                 loop; Claude Code runs experiments in it

usage: python3 promo/session.py <repo> <claude|cursor|research|all> <out/session.json>
       (all accepts the suggestion itself, for a dry run without the UI)
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

KULA = os.environ.get("KULA", str(Path(__file__).resolve().parent.parent / "target/debug/kula"))

RELEASE = {
    "name": "release",
    "about": "Cut a release: the version, packaging and changelog – no code",
    "scope": ["Cargo.toml", "Cargo.lock", "CHANGELOG.md", "packaging/**", "Formula/**"],
    "lock": ["src/**", "web/src/**"],
    "review": ["packaging/apt/**"],
    "memory": "write",
    "steps": [
        "recall what the last release taught us",
        "Bump the version in Cargo.toml; nothing under src/ changes",
        "Update packaging and the changelog to match",
        "verify_edit: only release files touched",
    ],
    "docs": ["docs/CLI.md"],
}


class Agent:
    """One MCP client: `kula mcp` over stdio, signed in as `name`."""

    def __init__(self, repo, name):
        self.name, self.repo, self.n = name, repo, 0
        self.p = subprocess.Popen([KULA, "mcp"], cwd=repo, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        self.rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": name, "version": "1"}})
        self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
        self.p.stdin.flush()

    def rpc(self, method, params):
        self.n += 1
        self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": self.n, "method": method, "params": params}) + "\n")
        self.p.stdin.flush()
        while True:
            m = json.loads(self.p.stdout.readline())
            if m.get("id") == self.n:
                if "error" in m:
                    raise RuntimeError(f"{method}: {m['error']}")
                return m["result"]

    def call(self, tool, **args):
        r = self.rpc("tools/call", {"name": tool, "arguments": args})
        text = "".join(c.get("text", "") for c in r.get("content", []))
        try:
            out = json.loads(text)
        except ValueError:
            out = text
        LOG.append({"agent": self.name, "kind": "tool", "tool": tool, "args": args, "error": bool(r.get("isError")), "result": out})
        return out

    def close(self):
        self.p.stdin.close()
        self.p.wait()


def hook(repo, agent, payload, read=False, what=""):
    """The pre-edit hook exactly as the agent runs it: payload on stdin, exit 2 blocks."""
    cmd = [KULA, "guard", "hook", "--agent", agent] + (["--read"] if read else [])
    r = subprocess.run(cmd, cwd=repo, input=json.dumps(payload), capture_output=True, text=True)
    out = {"agent": agent, "kind": "hook", "what": what, "payload": payload, "code": r.returncode, "stdout": r.stdout.strip(), "stderr": r.stderr.strip()}
    LOG.append(out)
    return out


def sh(repo, *args):
    r = subprocess.run([KULA, *args], cwd=repo, capture_output=True, text=True)
    LOG.append({"agent": "person", "kind": "cli", "cmd": "kula " + " ".join(args), "code": r.returncode, "stdout": r.stdout.strip(), "stderr": r.stderr.strip()})
    return r


def phase_claude(repo):
    cc = Agent(repo, "claude-code")
    cc.call("workflows")
    # the shortcut: loosen the fences by editing kula.toml directly
    hook(repo, "claude", {"hook_event_name": "PreToolUse", "tool_name": "Edit", "tool_input": {"file_path": os.path.join(repo, "kula.toml")}}, what="tamper-config")
    cc.call("suggest", kind="workflow", workflow=RELEASE,
            why="Releases keep reaching into src/. A release mode keeps any agent to the version, packaging and changelog.")
    cc.call("remember", target="repo", text="A release bumps Cargo.toml, packaging/ and CHANGELOG.md together; the tap and apt builds read the tag, never src/.")
    cc.close()


def phase_cursor(repo):
    # the person commits the accepted workflow, so the release starts from a clean tree
    subprocess.run(["git", "commit", "-qam", "A release workflow, suggested by Claude Code"], cwd=repo, check=True)
    # what Cursor's editor shows: the files as they are in the repository
    src = Path(repo, "src/store.rs").read_text().splitlines()
    at = next(i for i, l in enumerate(src) if "fn publish" in l)
    LOG.append({"agent": "cursor", "kind": "files", "files": {
        "Cargo.toml": Path(repo, "Cargo.toml").read_text().splitlines()[:13],
        "src/store.rs": {"from": at - 3, "lines": src[at - 4:at + 12]},
    }})
    cu = Agent(repo, "cursor")
    cu.call("workflows")
    cu.call("start_task", title="Ship 1.0.1", workflow="release")
    cu.call("recall", query="release")
    # Cursor's preToolUse hook: the agent reaches for a typo in locked code ...
    hook(repo, "cursor", {"hook_event_name": "preToolUse", "tool_name": "edit_file", "tool_input": {"file_path": os.path.join(repo, "src/store.rs")}}, what="edit-store")
    # ... the same edit through the shell ...
    hook(repo, "cursor", {"hook_event_name": "beforeShellExecution", "command": "sed -i '' 's/truncate/unlink/' src/store.rs", "cwd": repo}, what="shell-sed")
    # ... and ending the task, to drop its fences
    hook(repo, "cursor", {"hook_event_name": "beforeShellExecution", "command": "kula task done", "cwd": repo}, what="shell-task")
    # the version bump, which is in scope
    hook(repo, "cursor", {"hook_event_name": "preToolUse", "tool_name": "edit_file", "tool_input": {"file_path": os.path.join(repo, "Cargo.toml")}}, what="edit-cargo")
    toml = Path(repo, "Cargo.toml")
    before = toml.read_text()
    old = re.search(r'^version = "([^"]+)"', before, re.M).group(1)
    toml.write_text(before.replace(f'version = "{old}"', 'version = "1.0.1"', 1))
    LOG.append({"agent": "cursor", "kind": "edit", "file": "Cargo.toml", "from": old, "to": "1.0.1"})
    cu.call("verify_edit")
    cu.call("finish_task")
    cu.close()
    cc = Agent(repo, "claude-code")
    cc.call("verify_edit")
    cc.close()


def phase_research(repo):
    """A person ships the release and sets up a loop; Claude Code runs experiments in it."""
    subprocess.run(["git", "commit", "-qam", "Release 1.0.1"], cwd=repo, check=True)
    sh(repo, "research", "init", "--metric", "wc -l < src/kg.rs", "--goal", "min", "--scope", "src/kg.rs", "--budget", "12")
    sh(repo, "research", "start")
    kg = Path(repo, "src/kg.rs")
    tries = [
        ("a header comment block for the module", lambda t: t + "\n// ----\n// RDF\n// ----\n"),
        ("the module docs live in docs/KNOWLEDGE-GRAPH.md – drop the copy", lambda t: "\n".join(l for l in t.split("\n") if not l.strip().startswith("//!"))),
        ("inline the prefix table into the store builder", None),
        ("split the store builder into two passes", lambda t: t + "\nfn build_pass_a() {}\n\nfn build_pass_b() {}\n"),
        ("trim the IRI comments to one line each", lambda t: "\n".join(l for l in t.split("\n") if not (l.strip().startswith("///") and "IRI" in l))),
    ]
    env = {**os.environ, "KULA_AGENT": "claude-code"}
    for hyp, change in tries:
        if change is None:  # out of scope: kula rejects it unrun
            Path(repo, "src/store.rs").write_text(Path(repo, "src/store.rs").read_text() + "\n// prefixes\n")
        else:
            kg.write_text(change(kg.read_text()))
        r = subprocess.run([KULA, "--json", "research", "try", hyp], cwd=repo, capture_output=True, text=True, env=env)
        LOG.append({"agent": "claude-code", "kind": "experiment", "hypothesis": hyp, "result": json.loads(r.stdout) if r.stdout.strip() else None, "stderr": r.stderr.strip()})
    r = subprocess.run([KULA, "--json", "research", "status"], cwd=repo, capture_output=True, text=True)
    LOG.append({"agent": "person", "kind": "research", "result": json.loads(r.stdout)})


LOG = []


def main():
    repo, phase, out = sys.argv[1], sys.argv[2], Path(sys.argv[3])
    repo = str(Path(repo).resolve())
    if phase in ("cursor", "research") and out.exists():
        LOG.extend(json.loads(out.read_text()).get("log", []))
    if phase in ("claude", "all"):
        phase_claude(repo)
    if phase == "all":
        sid = next(e["result"]["id"] for e in LOG if e.get("tool") == "suggest")
        sh(repo, "agents", "accept", str(sid))
    if phase in ("cursor", "all"):
        phase_cursor(repo)
    if phase in ("research", "all"):
        phase_research(repo)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"log": LOG}, indent=1))
    for e in LOG:
        what = e.get("tool") or e.get("cmd") or e.get("kind")
        print(f"{e['agent']:12} {what:14} {'ERR ' if e.get('error') or e.get('code') else ''}{json.dumps(e.get('result', e.get('stderr') or e.get('stdout')))[:150]}")


if __name__ == "__main__":
    main()
