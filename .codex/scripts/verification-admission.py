"""Supplemental inventory classification; no probes, signals or admission grants.

Callers supply one fresh snapshot with actual argv/parent identities and Docker
state. Keep their existing unknown-role, lock, pressure and baseline checks.
Private admission scripts must explicitly adopt these functions; importing this
module does not alter verification-runner.py or repair an existing private copy.
"""


def _name(value):
    return value.replace("\\", "/").rsplit("/", 1)[-1]


def _node_script(arguments):
    values = {"-r", "--require", "--import", "--loader", "--experimental-loader"}
    index = 0
    while index < len(arguments):
        argument = arguments[index]
        if (argument in {"-e", "--eval", "-p", "--print"}
                or argument.startswith(("--eval=", "--print=", "-e", "-p"))):
            return []  # Inline code is not executable identity evidence.
        if argument == "--":
            return arguments[index + 1:]
        if argument in values:
            index += 2
        elif argument.startswith("-"):
            index += 1
        else:
            return arguments[index:]
    return []


def _material_command(argv):
    command, arguments = argv[0], argv[1:]
    if _name(command) in {"node", "nodejs", "node.exe"}:
        script = _node_script(arguments)
        if not script:
            return None
        command, arguments = script[0], script[1:]
    name = _name(command)
    if name in {"pnpm", "pnpm.cjs", "pnpm.mjs"}:
        values = {"--filter", "-F", "--dir", "-C", "--prefix"}
        index = 0
        while index < len(arguments) and arguments[index].startswith("-"):
            index += 2 if arguments[index] in values else 1
        arguments = arguments[index:]
        if arguments and arguments[0] == "run":
            arguments = arguments[1:]
        if not arguments:
            return None
        if arguments[0] == "exec":
            return _material_command(arguments[1:]) if len(arguments) > 1 else None
        if arguments[0] in {
            "verify:pr", "verify", "check:node", "test",
            "test:coverage", "test:e2e", "typecheck",
        }:
            return arguments[0]
    if name == "verify-pr.mjs":
        return "verify:pr"
    if name == "jest" or command.replace("\\", "/").endswith(
        ("/jest/bin/jest.js", "/jest-cli/bin/jest.js")
    ):
        return "jest"
    if name in {"vitest", "vitest.mjs", "tsc"}:
        return name
    if name == "playwright" and arguments and arguments[0] == "test":
        return "playwright test"
    return None


def material_verifier_processes(processes):
    """Return positive verifier identities; an empty result is NOT admission.

    Each queried row has pid, ppid, argv (token list) and explicit present bool.
    Absent rows cannot supply stale argv/ancestry. Unknown live readers remain
    the caller's responsibility, rather than becoming automatically eligible.
    """
    live = {}
    for row in processes:
        if row.get("present") is False:
            continue
        if row.get("present") is not True:
            raise ValueError("Process presence must be observed explicitly")
        pid, ppid, argv = row.get("pid"), row.get("ppid"), row.get("argv")
        if (type(pid) is not int or pid <= 0 or pid in live
                or type(ppid) is not int or ppid < 0
                or not isinstance(argv, list) or not argv
                or not all(isinstance(value, str) and value for value in argv)):
            raise ValueError("Invalid or duplicate live process identity")
        live[pid] = row
    classified = {}
    for pid, row in live.items():
        command = _material_command(row["argv"])
        if command:
            classified[pid] = {
                "pid": pid, "root_pid": pid, "reason": "argv", "command": command,
            }
    # Descendants inherit only an observed verifier in this snapshot, never an
    # arbitrary ancestor's name. Iteration terminates even with malformed cycles.
    changed = True
    while changed:
        changed = False
        for pid, row in live.items():
            parent = classified.get(row["ppid"])
            if pid not in classified and parent:
                classified[pid] = {
                    "pid": pid, "root_pid": parent["root_pid"],
                    "reason": "ancestor", "command": parent["command"],
                }
                changed = True
    return [classified[pid] for pid in live if pid in classified]


def container_inventory(containers):
    """Retain ALL resources; activity is separate from ownership or eligibility."""
    result = {"baseline": list(containers), "active": [], "inactive": [], "unknown": []}
    seen = set()
    for row in result["baseline"]:
        identity, state = row.get("id"), row.get("state")
        if not isinstance(identity, str) or not identity or identity in seen:
            raise ValueError("Invalid or duplicate container identity")
        seen.add(identity)
        if state in {"running", "restarting", "paused"}:
            group = "active"
        elif state in {"exited", "created", "dead"}:
            group = "inactive"
        else:
            group = "unknown"
        result[group].append(identity)
    return result
