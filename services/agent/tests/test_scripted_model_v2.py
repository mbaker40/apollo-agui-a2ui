"""Intent-router coverage for the ten v2 scenarios and their edges."""

from conftest import assistant_tool_call, tool_result, user_msg

from agent.scripted_model import (
    TXT_CLEARED,
    TXT_DELETED,
    TXT_DUE_NEED_DATE,
    TXT_DUE_SET,
    TXT_DUPLICATED,
    TXT_NOT_COMPLETED,
    TXT_NOTHING_TO_CLEAR,
    TXT_PRIORITY_NEED_LEVEL,
    TXT_PRIORITY_SET,
    TXT_RENAMED,
    TXT_REOPENED,
    TXT_RESET,
    TXT_TAG_CREATED,
    TXT_TAGGED,
    TXT_TOOL_ERROR,
    SayAction,
    ToolCallAction,
    next_action,
)

NO_FE: frozenset[str] = frozenset()

MILK = {"id": "task_0001", "title": "buy milk", "completed": False, "priority": "MEDIUM"}
MILK_DONE = {**MILK, "completed": True}
VET = {"id": "task_0002", "title": "call the vet", "completed": False, "priority": "MEDIUM"}


def with_list(phrase: str, tasks: list) -> list:
    return [
        user_msg(phrase),
        assistant_tool_call("list_tasks", {}, "c1", "m1"),
        tool_result("c1", tasks, "m2"),
    ]


def after_tool(messages: list, name: str, args: dict, result, call_id: str = "c2") -> list:
    return [
        *messages,
        assistant_tool_call(name, args, call_id, f"m_{call_id}"),
        tool_result(call_id, result, f"mr_{call_id}"),
    ]


def test_rename_flow() -> None:
    phrase = "rename the milk task to buy oat milk"
    assert next_action([user_msg(phrase)], NO_FE) == ToolCallAction("list_tasks")
    listed = with_list(phrase, [MILK, VET])
    assert next_action(listed, NO_FE) == ToolCallAction(
        "rename_task", {"id": "task_0001", "title": "buy oat milk"}
    )
    done = after_tool(listed, "rename_task", {}, {**MILK, "title": "buy oat milk"})
    assert next_action(done, NO_FE) == SayAction(TXT_RENAMED.format(title="buy oat milk"))


def test_due_flow_and_edges() -> None:
    phrase = "the milk task is due 2026-09-01"
    listed = with_list(phrase, [MILK, VET])
    assert next_action(listed, NO_FE) == ToolCallAction(
        "set_due", {"id": "task_0001", "due": "2026-09-01"}
    )
    done = after_tool(listed, "set_due", {}, {**MILK, "due": "2026-09-01"})
    assert next_action(done, NO_FE) == SayAction(
        TXT_DUE_SET.format(title="buy milk", due="2026-09-01")
    )

    # Non-ISO wording still reaches the tool — the executor's 400 comes back
    # as an error result and the generic rule phrases it (runner test).
    fuzzy = with_list("the milk task is due tomorrow", [MILK])
    assert next_action(fuzzy, NO_FE) == ToolCallAction(
        "set_due", {"id": "task_0001", "due": "tomorrow"}
    )

    # No date expression at all → deterministic ask, before any tool call.
    assert next_action([user_msg("when is the milk task due")], NO_FE) == SayAction(
        TXT_DUE_NEED_DATE
    )


def test_priority_flow_and_edge() -> None:
    phrase = "make the milk task high priority"
    listed = with_list(phrase, [MILK, VET])
    assert next_action(listed, NO_FE) == ToolCallAction(
        "set_priority", {"id": "task_0001", "priority": "HIGH"}
    )
    done = after_tool(listed, "set_priority", {}, {**MILK, "priority": "HIGH"})
    assert next_action(done, NO_FE) == SayAction(
        TXT_PRIORITY_SET.format(title="buy milk", level="high")
    )
    assert next_action([user_msg("change the priority")], NO_FE) == SayAction(
        TXT_PRIORITY_NEED_LEVEL
    )


def test_reopen_flow_and_not_completed_edge() -> None:
    phrase = "actually I'm not done with the milk one"
    listed = with_list(phrase, [MILK_DONE, VET])
    assert next_action(listed, NO_FE) == ToolCallAction("reopen_task", {"id": "task_0001"})
    done = after_tool(listed, "reopen_task", {}, {**MILK, "completed": False})
    assert next_action(done, NO_FE) == SayAction(TXT_REOPENED.format(title="buy milk"))

    not_done = with_list("reopen the vet task", [MILK, VET])
    assert next_action(not_done, NO_FE) == SayAction(TXT_NOT_COMPLETED.format(title="call the vet"))


def test_delete_and_duplicate_flows() -> None:
    listed = with_list("delete the vet task", [MILK, VET])
    assert next_action(listed, NO_FE) == ToolCallAction("delete_task", {"id": "task_0002"})
    done = after_tool(listed, "delete_task", {}, VET)
    assert next_action(done, NO_FE) == SayAction(
        TXT_DELETED.format(title="call the vet", id="task_0002")
    )

    dup = with_list("duplicate the milk task", [MILK])
    assert next_action(dup, NO_FE) == ToolCallAction("duplicate_task", {"id": "task_0001"})
    dup_done = after_tool(
        dup, "duplicate_task", {}, {"id": "task_0003", "title": "buy milk (copy)"}
    )
    assert next_action(dup_done, NO_FE) == SayAction(
        TXT_DUPLICATED.format(title="buy milk (copy)", id="task_0003")
    )


def test_clear_flow_and_empty_edge() -> None:
    phrase = "clear my completed tasks"
    # Router ordering guard: 'completed' must NOT route this to complete_task.
    assert next_action([user_msg(phrase)], NO_FE) == ToolCallAction("clear_completed")

    cleared = after_tool([user_msg(phrase)], "clear_completed", {}, {"deleted": [MILK, VET]}, "c1")
    assert next_action(cleared, NO_FE) == SayAction(TXT_CLEARED.format(count=2, s="s"))

    empty = after_tool([user_msg(phrase)], "clear_completed", {}, {"deleted": []}, "c1")
    assert next_action(empty, NO_FE) == SayAction(TXT_NOTHING_TO_CLEAR)


def test_create_tag_flow_and_router_guard() -> None:
    phrase = "add a tag called urgent"
    # Router ordering guard: 'add' must NOT route this to create_task.
    assert next_action([user_msg(phrase)], NO_FE) == ToolCallAction(
        "create_tag", {"name": "urgent"}
    )
    done = after_tool(
        [user_msg(phrase)], "create_tag", {}, {"id": "tag_0001", "name": "urgent"}, "c1"
    )
    assert next_action(done, NO_FE) == SayAction(TXT_TAG_CREATED.format(name="urgent"))


def test_tag_task_flow_reports_new_tag() -> None:
    phrase = "tag the milk task as urgent"
    listed = with_list(phrase, [MILK, VET])
    assert next_action(listed, NO_FE) == ToolCallAction(
        "tag_task", {"id": "task_0001", "name": "urgent"}
    )
    done = after_tool(
        listed,
        "tag_task",
        {},
        {"task": MILK, "tag": {"id": "tag_0001", "name": "urgent"}, "tagCreated": True},
    )
    assert next_action(done, NO_FE) == SayAction(
        TXT_TAGGED.format(title="buy milk", tag="urgent", suffix=" (new tag)")
    )


def test_reset_flow() -> None:
    assert next_action([user_msg("start over")], NO_FE) == ToolCallAction("reset_demo")
    done = after_tool(
        [user_msg("start over")],
        "reset_demo",
        {},
        {"deletedTaskIds": ["task_0001", "task_0002"], "deletedTagIds": ["tag_0001"]},
        "c1",
    )
    assert next_action(done, NO_FE) == SayAction(TXT_RESET.format(tasks=2, tags=1))


def test_generic_tool_error_rule() -> None:
    listed = with_list("the milk task is due tomorrow", [MILK])
    errored = after_tool(
        listed, "set_due", {}, {"error": "'tomorrow' is not a valid ISO date (expected YYYY-MM-DD)"}
    )
    assert next_action(errored, NO_FE) == SayAction(
        TXT_TOOL_ERROR.format(error="'tomorrow' is not a valid ISO date (expected YYYY-MM-DD)")
    )


def test_router_guard_mid_sentence_copy_still_completes() -> None:
    # "copy" as a noun must not trigger the duplicate intent (verb-anchored).
    phrase = "I'm done with the copy one"
    assert next_action([user_msg(phrase)], NO_FE) == ToolCallAction("list_tasks")
    listed = with_list(
        phrase, [MILK, {"id": "task_0003", "title": "buy milk (copy)", "completed": False}]
    )
    assert next_action(listed, NO_FE) == ToolCallAction("complete_task", {"id": "task_0003"})
