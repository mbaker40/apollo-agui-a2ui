import json

import pytest
from ag_ui.core import EventType
from conftest import (
    OPEN_TASK_TOOL,
    USER,
    FakeExecutor,
    assistant_tool_call,
    collect_events,
    make_input,
    tool_result,
    user_msg,
)

from agent.executor_client import ExecutorError
from agent.runner import run_agent
from agent.scripted_model import TXT_CANNOT_OPEN, TXT_CREATED, TXT_OPENED

MILK = {"id": "task_0001", "title": "buy milk", "due": None, "completed": False}


def types(events: list) -> list[EventType]:
    return [e.type for e in events]


def full_text(events: list) -> str:
    return "".join(e.delta for e in events if e.type == EventType.TEXT_MESSAGE_CONTENT)


async def test_backend_write_event_sequence(fake_executor: FakeExecutor) -> None:
    events = await collect_events(make_input([user_msg("add a task to buy milk")]), fake_executor)

    assert types(events) == [
        EventType.RUN_STARTED,
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_END,
        EventType.TOOL_CALL_RESULT,
        EventType.CUSTOM,
        EventType.TEXT_MESSAGE_START,
        *([EventType.TEXT_MESSAGE_CONTENT] * 3),
        EventType.TEXT_MESSAGE_END,
        EventType.RUN_FINISHED,
    ]

    start = events[1]
    assert start.tool_call_name == "create_task"
    assert json.loads(events[2].delta) == {"title": "buy milk"}

    custom = events[5]
    assert custom.name == "entity_changed"
    assert custom.value == {
        "typename": "Task",
        "id": "task_0001",
        "kind": "CREATED",
        "scope": "tasks",
    }

    assert full_text(events) == TXT_CREATED.format(title="buy milk", id="task_0001")
    assert fake_executor.calls[0][1]["run_id"] == "run_1"


async def test_read_then_write_emits_updated(fake_executor: FakeExecutor) -> None:
    fake_executor.tasks.append(dict(MILK))
    events = await collect_events(
        make_input([user_msg("I'm done with the milk one")]), fake_executor
    )

    tool_starts = [e.tool_call_name for e in events if e.type == EventType.TOOL_CALL_START]
    assert tool_starts == ["list_tasks", "complete_task"]

    customs = [e for e in events if e.type == EventType.CUSTOM]
    assert len(customs) == 1  # list_tasks (read-only) emits nothing
    assert customs[0].value == {
        "typename": "Task",
        "id": "task_0001",
        "kind": "UPDATED",
        "scope": "tasks",
    }
    assert events[-1].type == EventType.RUN_FINISHED


async def test_frontend_tool_is_deferred(fake_executor: FakeExecutor) -> None:
    fake_executor.tasks.append(dict(MILK))
    events = await collect_events(
        make_input([user_msg("open the milk task")], tools=[OPEN_TASK_TOOL]), fake_executor
    )

    # list_tasks executes (has a result); open_task is emitted but NOT executed:
    # the run finishes so the client can run the tool and continue.
    tool_starts = [e.tool_call_name for e in events if e.type == EventType.TOOL_CALL_START]
    assert tool_starts == ["list_tasks", "open_task"]
    results = [e for e in events if e.type == EventType.TOOL_CALL_RESULT]
    assert len(results) == 1
    assert events[-1].type == EventType.RUN_FINISHED
    assert [e for e in events if e.type == EventType.TEXT_MESSAGE_CONTENT] == []

    open_call_id = [e for e in events if e.type == EventType.TOOL_CALL_START][1].tool_call_id

    # Continuation run: client executed open_task and sends the full history back.
    history = [
        user_msg("open the milk task"),
        assistant_tool_call("list_tasks", {}, "c1", "m1"),
        tool_result("c1", [MILK], "m2"),
        assistant_tool_call("open_task", {"id": "task_0001"}, open_call_id, "m3"),
        tool_result(open_call_id, {"status": "opened", "id": "task_0001"}, "m4"),
    ]
    continuation = await collect_events(
        make_input(history, tools=[OPEN_TASK_TOOL], run_id="run_2"), fake_executor
    )
    assert types(continuation)[0] == EventType.RUN_STARTED
    assert continuation[-1].type == EventType.RUN_FINISHED
    assert full_text(continuation) == TXT_OPENED.format(title="buy milk")


async def test_without_capability_no_tool_call(fake_executor: FakeExecutor) -> None:
    events = await collect_events(make_input([user_msg("open the milk task")]), fake_executor)
    assert [e for e in events if e.type == EventType.TOOL_CALL_START] == []
    assert full_text(events) == TXT_CANNOT_OPEN
    assert fake_executor.calls == []


async def test_executor_failure_becomes_run_error() -> None:
    class BrokenExecutor:
        async def create_task(self, *args: object, **kwargs: object) -> None:
            raise ExecutorError("executor unreachable: connection refused")

    events = [
        e
        async for e in run_agent(
            make_input([user_msg("add a task to buy milk")]),
            USER,
            BrokenExecutor(),  # type: ignore[arg-type]
        )
    ]
    assert events[-1].type == EventType.RUN_ERROR
    assert "unreachable" in events[-1].message


@pytest.mark.parametrize("phrase", ["hello there", "what can you do?"])
async def test_smalltalk_streams_help(fake_executor: FakeExecutor, phrase: str) -> None:
    events = await collect_events(make_input([user_msg(phrase)]), fake_executor)
    assert types(events)[0] == EventType.RUN_STARTED
    assert events[-1].type == EventType.RUN_FINISHED
    assert "scripted demo model" in full_text(events)
