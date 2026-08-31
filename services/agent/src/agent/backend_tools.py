"""Backend-tool registry: the one place a new server-side tool is declared.

Each spec pairs an executor call with a function deriving the
`entity_changed` payload(s) from its result — zero, one, or MANY (bulk tools
announce every touched entity; cross-entity tools announce across scopes).
The runner stays generic: it executes whatever spec the scripted model names
and emits whatever changes the spec derives.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from .auth import AuthedUser
from .executor_client import ExecutorClient

SCOPE_TASKS = "tasks"
SCOPE_TAGS = "tags"

Json = dict[str, Any]
Change = dict[str, str]


def _task_change(kind: str, task_id: str) -> Change:
    return {"typename": "Task", "id": task_id, "kind": kind, "scope": SCOPE_TASKS}


def _tag_change(kind: str, tag_id: str) -> Change:
    return {"typename": "Tag", "id": tag_id, "kind": kind, "scope": SCOPE_TAGS}


@dataclass(frozen=True)
class BackendToolSpec:
    execute: Callable[[ExecutorClient, AuthedUser, str, Json], Awaitable[Any]]
    changes: Callable[[Any], list[Change]]


def _no_changes(_result: Any) -> list[Change]:
    return []


def _created(result: Json) -> list[Change]:
    return [_task_change("CREATED", str(result["id"]))]


def _updated(result: Json) -> list[Change]:
    return [_task_change("UPDATED", str(result["id"]))]


def _deleted(result: Json) -> list[Change]:
    return [_task_change("DELETED", str(result["id"]))]


def _bulk_deleted(result: Json) -> list[Change]:
    return [_task_change("DELETED", str(task["id"])) for task in result.get("deleted", [])]


def _tag_created(result: Json) -> list[Change]:
    return [_tag_change("CREATED", str(result["id"]))]


def _tagged(result: Json) -> list[Change]:
    changes = [_task_change("UPDATED", str(result["task"]["id"]))]
    if result.get("tagCreated"):
        changes.append(_tag_change("CREATED", str(result["tag"]["id"])))
    return changes


def _reset(result: Json) -> list[Change]:
    return [_task_change("DELETED", str(i)) for i in result.get("deletedTaskIds", [])] + [
        _tag_change("DELETED", str(i)) for i in result.get("deletedTagIds", [])
    ]


BACKEND_TOOL_SPECS: dict[str, BackendToolSpec] = {
    "list_tasks": BackendToolSpec(
        lambda ex, u, r, a: ex.list_tasks(u, r),
        _no_changes,
    ),
    "create_task": BackendToolSpec(
        lambda ex, u, r, a: ex.create_task(u, r, title=str(a["title"]), due=a.get("due")),
        _created,
    ),
    "complete_task": BackendToolSpec(
        lambda ex, u, r, a: ex.complete_task(u, r, task_id=str(a["id"])),
        _updated,
    ),
    "rename_task": BackendToolSpec(
        lambda ex, u, r, a: ex.rename_task(u, r, task_id=str(a["id"]), title=str(a["title"])),
        _updated,
    ),
    "set_due": BackendToolSpec(
        lambda ex, u, r, a: ex.set_due(u, r, task_id=str(a["id"]), due=a.get("due")),
        _updated,
    ),
    "set_priority": BackendToolSpec(
        lambda ex, u, r, a: ex.set_priority(
            u, r, task_id=str(a["id"]), priority=str(a["priority"])
        ),
        _updated,
    ),
    "reopen_task": BackendToolSpec(
        lambda ex, u, r, a: ex.reopen_task(u, r, task_id=str(a["id"])),
        _updated,
    ),
    "delete_task": BackendToolSpec(
        lambda ex, u, r, a: ex.delete_task(u, r, task_id=str(a["id"])),
        _deleted,
    ),
    "duplicate_task": BackendToolSpec(
        lambda ex, u, r, a: ex.duplicate_task(u, r, task_id=str(a["id"])),
        _created,
    ),
    "clear_completed": BackendToolSpec(
        lambda ex, u, r, a: ex.clear_completed(u, r),
        _bulk_deleted,
    ),
    "create_tag": BackendToolSpec(
        lambda ex, u, r, a: ex.create_tag(u, r, name=str(a["name"])),
        _tag_created,
    ),
    "tag_task": BackendToolSpec(
        lambda ex, u, r, a: ex.tag_task(u, r, task_id=str(a["id"]), name=str(a["name"])),
        _tagged,
    ),
    "reset_demo": BackendToolSpec(
        lambda ex, u, r, a: ex.reset_demo(u, r),
        _reset,
    ),
}

BACKEND_TOOLS = frozenset(BACKEND_TOOL_SPECS)
