"""Pins the agent (producer side) to the cross-platform contracts in /contracts.

v2: every backend-tool spec's derived entity_changed payloads validate against
the schema — a new tool with a malformed changes() fails here before any
client sees it.
"""

import json
from pathlib import Path
from typing import Any

import jsonschema

from agent.backend_tools import BACKEND_TOOL_SPECS
from agent.executor_client import IDENTITY_HEADERS

REPO_ROOT = Path(__file__).resolve().parents[3]
CONTRACTS = REPO_ROOT / "contracts"

ENTITY_SCHEMA = json.loads((CONTRACTS / "schemas" / "entity_changed.schema.json").read_text())

TASK = {"id": "task_0001", "title": "buy milk"}
TASK2 = {"id": "task_0002", "title": "call the vet"}
TAG = {"id": "tag_0001", "name": "errand"}

SAMPLE_RESULTS: dict[str, Any] = {
    "list_tasks": [TASK],
    "create_task": TASK,
    "complete_task": TASK,
    "rename_task": TASK,
    "set_due": TASK,
    "set_priority": TASK,
    "reopen_task": TASK,
    "delete_task": TASK,
    "duplicate_task": TASK2,
    "clear_completed": {"deleted": [TASK, TASK2]},
    "create_tag": TAG,
    "tag_task": {"task": TASK, "tag": TAG, "tagCreated": True},
    "reset_demo": {"deletedTaskIds": ["task_0001"], "deletedTagIds": ["tag_0001"]},
}

EXPECTED_CHANGE_COUNTS = {
    "list_tasks": 0,
    "create_task": 1,
    "complete_task": 1,
    "rename_task": 1,
    "set_due": 1,
    "set_priority": 1,
    "reopen_task": 1,
    "delete_task": 1,
    "duplicate_task": 1,
    "clear_completed": 2,  # bulk: one event per removed entity
    "create_tag": 1,
    "tag_task": 2,  # cross-entity: Task UPDATED + Tag CREATED
    "reset_demo": 2,  # cross-scope: tasks + tags
}


def test_identity_headers_match_contract_fixture() -> None:
    fixture = json.loads((CONTRACTS / "fixtures" / "identity-headers.json").read_text())
    assert fixture == IDENTITY_HEADERS


def test_every_spec_is_sampled() -> None:
    assert set(SAMPLE_RESULTS) == set(BACKEND_TOOL_SPECS)


def test_all_spec_changes_validate_against_the_schema() -> None:
    for name, spec in BACKEND_TOOL_SPECS.items():
        changes = spec.changes(SAMPLE_RESULTS[name])
        assert len(changes) == EXPECTED_CHANGE_COUNTS[name], name
        for change in changes:
            jsonschema.validate(change, ENTITY_SCHEMA)


def test_cross_scope_specs_emit_the_right_scopes() -> None:
    tagged = BACKEND_TOOL_SPECS["tag_task"].changes(SAMPLE_RESULTS["tag_task"])
    assert [(c["typename"], c["kind"], c["scope"]) for c in tagged] == [
        ("Task", "UPDATED", "tasks"),
        ("Tag", "CREATED", "tags"),
    ]
    # No new tag → only the task change.
    existing = BACKEND_TOOL_SPECS["tag_task"].changes(
        {"task": TASK, "tag": TAG, "tagCreated": False}
    )
    assert len(existing) == 1

    reset = BACKEND_TOOL_SPECS["reset_demo"].changes(SAMPLE_RESULTS["reset_demo"])
    assert [(c["typename"], c["kind"], c["scope"]) for c in reset] == [
        ("Task", "DELETED", "tasks"),
        ("Tag", "DELETED", "tags"),
    ]


def test_contract_fixtures_validate_on_the_python_side_too() -> None:
    for name in ["created", "updated", "deleted"]:
        fixture = json.loads(
            (CONTRACTS / "fixtures" / "entity-changed" / f"{name}.json").read_text()
        )
        jsonschema.validate(fixture, ENTITY_SCHEMA)


def test_created_payload_matches_canonical_fixture() -> None:
    fixture = json.loads((CONTRACTS / "fixtures" / "entity-changed" / "created.json").read_text())
    assert BACKEND_TOOL_SPECS["create_task"].changes({"id": "task_0001"}) == [fixture]
