"""Synthetic, explicitly rooted home/workflow. No real user configuration is read."""
import json
import os
from pathlib import Path


def create_fixture(root: Path, api_url="http://127.0.0.1:1"):
    root.mkdir(parents=True, exist_ok=True)
    root.chmod(0o700)

    def write(path, text, executable=False):
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
        target.chmod(0o755 if executable else 0o600)

    def link(path, destination):
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.symlink_to(destination)

    skill = "workflow/agents/skills/workspace-notes"
    write(f"{skill}/SKILL.md", """---
name: workspace-notes
description: Organize project notes, check references, and preserve their source relationships.
license: MIT
metadata:
  author: Otter Test Fixture
---

# Workspace Notes

Keep project knowledge close to its source.

## Workflow

1. Read the [project conventions](references/conventions.md).
2. Check links with `scripts/check-links.sh` when explicitly requested.
3. Review changes before sharing the package.

> This fixture never runs scripts or contacts an agent model.

| Resource | Purpose |
| --- | --- |
| `references/` | Supporting material |
| `scripts/` | User-invoked checks |
""")
    write(f"{skill}/references/conventions.md", "# Conventions\n\nKeep changes reviewable.\n")
    write(f"{skill}/scripts/check-links.sh", "#!/bin/sh\nset -eu\nprintf 'check links\\n'\n", True)
    write(f"{skill}/agents/openai.yaml", 'interface:\n  display_name: "Workspace Notes"\n  short_description: "Keep project notes connected"\npolicy:\n  allow_implicit_invocation: true\n')
    write("workflow/agents/AGENTS.md", "# Workflow\n\nKeep changes reviewable. Preserve local configuration and drafts.\n")
    write("workflow/agents/commands/review.md", "---\ndescription: Review the current changes.\n---\n\nReview the diff and its validation.\n")
    write("workflow/agents/rules/git.md", "# Git\n\nKeep user changes intact.\n")
    write("home/.codex/instructions.md", "# Earlier instructions\n\nKeep changes small.\n")
    write("home/.codex/config.toml", 'model = "example-model"\n')
    write("home/.claude/settings.json", '{"permissions":{"allow":[]}}\n')
    write("home/.zshrc", "export EDITOR=vim\n")
    write("home/.hermes/SOUL.md", "# Fixture persona\n\nOffline example.\n")
    write("home/.hermes/config.yaml", "model: example-model\n")
    write("home/.hermes/profiles/cherry/SOUL.md", "# Cherry\n\nAn independent persona.\n")
    write("home/.hermes/profiles/cherry/skills/category/herdr-control/SKILL.md", "---\nname: herdr-control\ndescription: Manage fixture sessions.\ntags: [fixture]\n---\n\n# Control\n")
    write("workflow/hermes/skills/herdr-control/SKILL.md", "---\nname: herdr-control\ndescription: Coordinate explicit local sessions.\n---\n\n# Control\n")
    link("home/.agents/skills/workspace-notes", root / skill)
    link("home/.claude/skills/workspace-notes", "../../.agents/skills/workspace-notes")
    link("home/.claude/CLAUDE.md", root / "workflow/agents/AGENTS.md")
    link("home/.claude/commands/review.md", root / "workflow/agents/commands/review.md")
    link("home/.hermes/skills/workspace-notes", root / skill)
    # A known broken entry exercises diagnostics without inferring an intended source.
    link("home/.codex/skills/moved-skill", "../../../missing-source")
    write("data/workspace.json", json.dumps({
        "version": 1,
        "home": str(root / "home"),
        "sources": [str(root / "workflow")],
        "projects": [],
        "bindings": [],
        "apiURL": api_url,
        "cliConfigDirectory": str(root / "cli-config"),
        "cliOutputDirectory": str(root / "snapshots"),
        "development": False,
        "appearance": "light",
        "editorFontSize": 13,
    }, indent=2))
    write("cli-config/config.json", '{"token":"otk_native_fixture_only"}\n')
    write("fixture.json", json.dumps({"kind": "otter-native-fixture", "id": root.name}))
    return root


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    args = parser.parse_args()
    create_fixture(args.root.resolve())
