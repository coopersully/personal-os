#!/usr/bin/env python3
"""Lint repository skills so they load the same way in Claude Code and Codex.

Checks every `.agents/skills/<name>/SKILL.md` (Claude reads the same files through the
`.claude/skills` symlink): frontmatter shape, name/folder agreement, description length,
Codex `agents/openai.yaml` naming and short-description length, and relative links.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKILLS = ROOT / ".agents" / "skills"
# Keys either client understands; anything else is likely a typo or a one-client feature.
ALLOWED_KEYS = {"name", "description", "license", "allowed-tools", "metadata",
                "disable-model-invocation", "user-invocable", "argument-hint"}
LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")


def frontmatter(text):
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---", 4)
    if end < 0:
        return None
    fields = {}
    for line in text[4:end].splitlines():
        match = re.match(r"^([A-Za-z][\w-]*):\s*(.*)$", line)
        if match:
            value = match.group(2).strip()
            # Block scalars and nested values would hide their real content from this
            # line parser; require single-line values so the length checks stay honest.
            if (value == "" or value[0] in ">|") and match.group(1) != "metadata":
                value = None
            if value and value[:1] in ('"', "'") and (len(value) < 2 or value[-1] != value[0]):
                value = None  # unterminated quoted scalar
            fields[match.group(1)] = value if value is None else value.strip('"').strip("'")
    return fields


def check_skill(folder):
    errors = []
    skill = folder / "SKILL.md"
    text = skill.read_text(encoding="utf-8")
    fields = frontmatter(text)
    if fields is None:
        return [f"{skill}: missing YAML frontmatter"]
    if fields.get("name") != folder.name:
        errors.append(f"{skill}: name {fields.get('name')!r} must equal folder {folder.name!r}")
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", folder.name):
        errors.append(f"{skill}: folder name must be lowercase kebab-case")
    if any(value is None for value in fields.values()):
        errors.append(f"{skill}: frontmatter values must be single-line scalars")
    description = fields.get("description") or ""
    if not description or len(description) > 1024:
        errors.append(f"{skill}: description must be 1-1024 characters")
    unknown = set(fields) - ALLOWED_KEYS
    if unknown:
        errors.append(f"{skill}: unsupported frontmatter keys {sorted(unknown)}")
    agents = folder / "agents"
    if (agents / "openai.yml").exists():
        errors.append(f"{agents}/openai.yml: Codex reads agents/openai.yaml")
    meta = agents / "openai.yaml"
    if meta.exists():
        short = re.search(r"^[ \t]*short_description:[ \t]*(.*)$", meta.read_text(encoding="utf-8"), re.M)
        raw = short.group(1).strip() if short else ""
        value = "" if raw[:1] in ">|" else raw.strip('"').strip("'")
        if not value or len(value) > 64:
            errors.append(f"{meta}: short_description must be 1-64 characters")
    for path in [skill, *sorted((folder / "references").glob("*.md"))]:
        body = path.read_text(encoding="utf-8")
        body = re.sub(r"```.*?```", "", body, flags=re.S)  # examples and templates
        for target in LINK.findall(body):
            if re.match(r"^[a-z]+:", target) or target.startswith("#") or "<" in target:
                continue
            target = target.split("#", 1)[0]
            if target and not (path.parent / target).exists():
                errors.append(f"{path}: broken relative link {target}")
    return errors


def main():
    folders = sorted(p.parent for p in SKILLS.glob("*/SKILL.md"))
    errors = [error for folder in folders for error in check_skill(folder)]
    for error in errors:
        print(error, file=sys.stderr)
    if errors:
        return 1
    print(f"Skill lint passed for {len(folders)} skills.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
