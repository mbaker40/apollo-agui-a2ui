from conftest import assistant_tool_call, tool_result, user_msg

from agent.scripted_model import (
    TXT_ALREADY_DONE,
    TXT_CANNOT_OPEN,
    TXT_COMPLETED,
    TXT_CREATED,
    TXT_HELP,
    TXT_NO_MATCH,
    TXT_OPEN_NOT_FOUND,
    TXT_OPENED,
    SayAction,
    ToolCallAction,
    next_action,
)

FRONTEND = frozenset({"open_task"})
NO_FRONTEND: frozenset[str] = frozenset()

MILK = {"id": "task_0001", "title": "buy milk", "due": None, "completed": False}
MILK_DONE = {**MILK, "completed": True}
VET = {"id": "task_0002", "title": "call the vet", "due": None, "completed": False}


def test_add_extracts_title_variants() -> None:
    for phrase, title in [
        ("add a task to buy milk", "buy milk"),
        ("Add task called water the plants", "water the plants"),
        ("create a new task to call the vet", "call the vet"),
        ("add buy milk", "buy milk"),
    ]:
        action = next_action([user_msg(phrase)], NO_FRONTEND)
        assert action == ToolCallAction("create_task", {"title": title}), phrase


def test_add_confirms_after_create_result() -> None:
    messages = [
        user_msg("add a task to buy milk"),
        assistant_tool_call("create_task", {"title": "buy milk"}, "c1", "m1"),
        tool_result("c1", MILK, "m2"),
    ]
    action = next_action(messages, NO_FRONTEND)
    assert action == SayAction(TXT_CREATED.format(title="buy milk", id="task_0001"))


def test_complete_lists_then_completes_then_confirms() -> None:
    first = next_action([user_msg("I'm done with the milk one")], NO_FRONTEND)
    assert first == ToolCallAction("list_tasks")

    messages = [
        user_msg("I'm done with the milk one"),
        assistant_tool_call("list_tasks", {}, "c1", "m1"),
        tool_result("c1", [MILK, VET], "m2"),
    ]
    second = next_action(messages, NO_FRONTEND)
    assert second == ToolCallAction("complete_task", {"id": "task_0001"})

    messages += [
        assistant_tool_call("complete_task", {"id": "task_0001"}, "c2", "m3"),
        tool_result("c2", MILK_DONE, "m4"),
    ]
    third = next_action(messages, NO_FRONTEND)
    assert third == SayAction(TXT_COMPLETED.format(title="buy milk"))


def test_complete_no_match_and_already_done() -> None:
    base = [
        user_msg("I'm done with the dentist one"),
        assistant_tool_call("list_tasks", {}, "c1", "m1"),
        tool_result("c1", [MILK], "m2"),
    ]
    assert next_action(base, NO_FRONTEND) == SayAction(TXT_NO_MATCH.format(hint="dentist"))

    already = [
        user_msg("done with the milk one"),
        assistant_tool_call("list_tasks", {}, "c1", "m1"),
        tool_result("c1", [MILK_DONE], "m2"),
    ]
    assert next_action(already, NO_FRONTEND) == SayAction(TXT_ALREADY_DONE.format(title="buy milk"))


def test_open_requires_capability() -> None:
    assert next_action([user_msg("open the milk task")], NO_FRONTEND) == SayAction(TXT_CANNOT_OPEN)


def test_open_lists_then_calls_frontend_tool() -> None:
    assert next_action([user_msg("open the milk task")], FRONTEND) == ToolCallAction("list_tasks")

    messages = [
        user_msg("open the milk task"),
        assistant_tool_call("list_tasks", {}, "c1", "m1"),
        tool_result("c1", [MILK, VET], "m2"),
    ]
    assert next_action(messages, FRONTEND) == ToolCallAction("open_task", {"id": "task_0001"})


def test_open_continuation_reflects_client_result() -> None:
    base = [
        user_msg("open the milk task"),
        assistant_tool_call("list_tasks", {}, "c1", "m1"),
        tool_result("c1", [MILK], "m2"),
        assistant_tool_call("open_task", {"id": "task_0001"}, "c2", "m3"),
    ]
    opened = [*base, tool_result("c2", {"status": "opened", "id": "task_0001"}, "m4")]
    assert next_action(opened, FRONTEND) == SayAction(TXT_OPENED.format(title="buy milk"))

    missing = [*base, tool_result("c2", {"status": "not_found", "id": "task_0001"}, "m4")]
    assert next_action(missing, FRONTEND) == SayAction(TXT_OPEN_NOT_FOUND.format(id="task_0001"))


def test_unknown_utterance_gets_help() -> None:
    assert next_action([user_msg("what's the weather like?")], FRONTEND) == SayAction(TXT_HELP)
