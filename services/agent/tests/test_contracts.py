"""Pins the agent (producer side) to the cross-platform contracts in /contracts."""

import json
from pathlib import Path

import jsonschema

from agent.executor_client import IDENTITY_HEADERS
from agent.runner import _entity_change_for

REPO_ROOT = Path(__file__).resolve().parents[3]
CONTRACTS = REPO_ROOT / "contracts"

ENTITY_SCHEMA = json.loads((CONTRACTS / "schemas" / "entity_changed.schema.json").read_text())


def test_identity_headers_match_contract_fixture() -> None:
    fixture = json.loads((CONTRACTS / "fixtures" / "identity-headers.json").read_text())
    assert fixture == IDENTITY_HEADERS


def test_emitted_entity_changed_payloads_validate_against_schema() -> None:
    task = {"id": "task_0001", "title": "buy milk"}
    for tool, kind in [("create_task", "CREATED"), ("complete_task", "UPDATED")]:
        payload = _entity_change_for(tool, task)
        assert payload is not None and payload["kind"] == kind
        jsonschema.validate(payload, ENTITY_SCHEMA)
    assert _entity_change_for("list_tasks", [task]) is None


def test_contract_fixtures_validate_on_the_python_side_too() -> None:
    for name in ["created", "updated", "deleted"]:
        fixture = json.loads(
            (CONTRACTS / "fixtures" / "entity-changed" / f"{name}.json").read_text()
        )
        jsonschema.validate(fixture, ENTITY_SCHEMA)


def test_created_payload_matches_canonical_fixture() -> None:
    fixture = json.loads((CONTRACTS / "fixtures" / "entity-changed" / "created.json").read_text())
    assert _entity_change_for("create_task", {"id": "task_0001"}) == fixture
