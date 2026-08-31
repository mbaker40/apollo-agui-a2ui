"""Runner-level coverage of the v2 event patterns: bulk, cross-scope, 4xx tolerance."""

from ag_ui.core import EventType
from conftest import FakeExecutor, collect_events, make_input, user_msg

from agent.scripted_model import TXT_CLEARED, TXT_RESET, TXT_TOOL_ERROR

MILK = {
    "id": "task_0001",
    "title": "buy milk",
    "due": None,
    "completed": False,
    "priority": "MEDIUM",
    "tags": [],
}
VET = {**MILK, "id": "task_0002", "title": "call the vet"}


def customs(events: list) -> list:
    return [e.value for e in events if e.type == EventType.CUSTOM]


def full_text(events: list) -> str:
    return "".join(e.delta for e in events if e.type == EventType.TEXT_MESSAGE_CONTENT)


async def test_bulk_clear_emits_one_deleted_event_per_task() -> None:
    executor = FakeExecutor(
        [
            dict(MILK, completed=True),
            dict(VET, completed=True),
            {**MILK, "id": "task_0003", "title": "open item"},
        ]
    )
    events = await collect_events(make_input([user_msg("clear my completed tasks")]), executor)

    assert customs(events) == [
        {"typename": "Task", "id": "task_0001", "kind": "DELETED", "scope": "tasks"},
        {"typename": "Task", "id": "task_0002", "kind": "DELETED", "scope": "tasks"},
    ]
    assert full_text(events) == TXT_CLEARED.format(count=2, s="s")
    assert events[-1].type == EventType.RUN_FINISHED


async def test_tag_task_emits_across_two_scopes_when_tag_is_new() -> None:
    executor = FakeExecutor([dict(MILK)])
    events = await collect_events(make_input([user_msg("tag the milk task as urgent")]), executor)

    assert customs(events) == [
        {"typename": "Task", "id": "task_0001", "kind": "UPDATED", "scope": "tasks"},
        {"typename": "Tag", "id": "tag_0001", "kind": "CREATED", "scope": "tags"},
    ]
    assert "(new tag)" in full_text(events)

    # Same request again: the tag exists now → only the Task event.
    again = await collect_events(
        make_input([user_msg("tag the milk task as urgent")], run_id="run_2"), executor
    )
    assert customs(again) == [
        {"typename": "Task", "id": "task_0001", "kind": "UPDATED", "scope": "tasks"},
    ]
    assert "(new tag)" not in full_text(again)


async def test_reset_emits_deletions_across_both_scopes() -> None:
    executor = FakeExecutor([dict(MILK)])
    executor.tags.append({"id": "tag_0001", "name": "urgent"})
    events = await collect_events(make_input([user_msg("start over")]), executor)

    assert customs(events) == [
        {"typename": "Task", "id": "task_0001", "kind": "DELETED", "scope": "tasks"},
        {"typename": "Tag", "id": "tag_0001", "kind": "DELETED", "scope": "tags"},
    ]
    assert full_text(events) == TXT_RESET.format(tasks=1, tags=1)


async def test_executor_4xx_becomes_a_tool_error_result_not_a_run_error() -> None:
    executor = FakeExecutor([dict(MILK)])
    events = await collect_events(make_input([user_msg("the milk task is due tomorrow")]), executor)

    # The failing tool round-trip is visible, carries the error as its result,
    # changes nothing, and the run still finishes with friendly text.
    results = [e for e in events if e.type == EventType.TOOL_CALL_RESULT]
    assert any('"error"' in r.content for r in results)
    assert customs(events) == []
    assert full_text(events) == TXT_TOOL_ERROR.format(
        error="'tomorrow' is not a valid ISO date (expected YYYY-MM-DD)"
    )
    assert events[-1].type == EventType.RUN_FINISHED
    assert not any(e.type == EventType.RUN_ERROR for e in events)


async def test_duplicate_tag_conflict_is_also_survivable() -> None:
    executor = FakeExecutor()
    executor.tags.append({"id": "tag_0001", "name": "urgent"})
    events = await collect_events(make_input([user_msg("add a tag called urgent")]), executor)

    assert customs(events) == []
    assert "already exists" in full_text(events)
    assert events[-1].type == EventType.RUN_FINISHED
