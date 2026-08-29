import json
from typing import Any

import pytest
from ag_ui.core import (
    AssistantMessage,
    BaseEvent,
    FunctionCall,
    Message,
    RunAgentInput,
    Tool,
    ToolCall,
    ToolMessage,
    UserMessage,
)

from agent.auth import AuthedUser
from agent.runner import run_agent

OPEN_TASK_TOOL = Tool(
    name="open_task",
    description="Open the task with the given id in the client UI so the user can see it. "
    "Only call this when the current run declared it.",
    parameters={
        "type": "object",
        "additionalProperties": False,
        "required": ["id"],
        "properties": {"id": {"type": "string", "description": "Id of the task to open"}},
    },
)

USER = AuthedUser(sub="user-demo", email="demo@example.com", name="Demo User")


class FakeExecutor:
    """Duck-typed stand-in for ExecutorClient with an in-memory store.

    Mirrors the real executor's interesting behaviors: 4xx ExecutorErrors for
    invalid due dates and duplicate tag names, tag auto-creation, bulk clear,
    and cross-type reset.
    """

    def __init__(self, tasks: list[dict[str, Any]] | None = None) -> None:
        self.tasks: list[dict[str, Any]] = tasks or []
        self.tags: list[dict[str, Any]] = []
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self._seq = len(self.tasks)
        self._tag_seq = 0

    def _find(self, task_id: str) -> dict[str, Any]:
        for task in self.tasks:
            if task["id"] == task_id:
                return task
        from agent.executor_client import ExecutorError

        raise ExecutorError(f"no task with id '{task_id}'", status_code=404)

    async def create_task(
        self, user: AuthedUser, run_id: str, title: str, due: str | None = None
    ) -> dict[str, Any]:
        self.calls.append(("create_task", {"title": title, "run_id": run_id, "user": user.sub}))
        self._seq += 1
        task = {
            "id": f"task_{self._seq:04d}",
            "title": title,
            "due": due,
            "completed": False,
            "priority": "MEDIUM",
            "tags": [],
            "createdAt": "2026-01-01T00:00:00Z",
        }
        self.tasks.append(task)
        return task

    async def complete_task(self, user: AuthedUser, run_id: str, task_id: str) -> dict[str, Any]:
        self.calls.append(("complete_task", {"id": task_id, "run_id": run_id}))
        task = self._find(task_id)
        task["completed"] = True
        return dict(task)

    async def list_tasks(self, user: AuthedUser, run_id: str) -> list[dict[str, Any]]:
        self.calls.append(("list_tasks", {"run_id": run_id}))
        return [dict(t) for t in self.tasks]

    async def rename_task(
        self, user: AuthedUser, run_id: str, task_id: str, title: str
    ) -> dict[str, Any]:
        self.calls.append(("rename_task", {"id": task_id, "title": title}))
        task = self._find(task_id)
        task["title"] = title
        return dict(task)

    async def set_due(
        self, user: AuthedUser, run_id: str, task_id: str, due: str | None
    ) -> dict[str, Any]:
        self.calls.append(("set_due", {"id": task_id, "due": due}))
        import re as _re

        from agent.executor_client import ExecutorError

        if due is not None and not _re.fullmatch(r"\d{4}-\d{2}-\d{2}", due):
            raise ExecutorError(
                f"'{due}' is not a valid ISO date (expected YYYY-MM-DD)", status_code=400
            )
        task = self._find(task_id)
        task["due"] = due
        return dict(task)

    async def set_priority(
        self, user: AuthedUser, run_id: str, task_id: str, priority: str
    ) -> dict[str, Any]:
        self.calls.append(("set_priority", {"id": task_id, "priority": priority}))
        task = self._find(task_id)
        task["priority"] = priority
        return dict(task)

    async def reopen_task(self, user: AuthedUser, run_id: str, task_id: str) -> dict[str, Any]:
        self.calls.append(("reopen_task", {"id": task_id}))
        task = self._find(task_id)
        task["completed"] = False
        return dict(task)

    async def delete_task(self, user: AuthedUser, run_id: str, task_id: str) -> dict[str, Any]:
        self.calls.append(("delete_task", {"id": task_id}))
        task = self._find(task_id)
        self.tasks.remove(task)
        return dict(task)

    async def duplicate_task(self, user: AuthedUser, run_id: str, task_id: str) -> dict[str, Any]:
        self.calls.append(("duplicate_task", {"id": task_id}))
        source = self._find(task_id)
        self._seq += 1
        copy = {
            **source,
            "id": f"task_{self._seq:04d}",
            "title": f"{source['title']} (copy)",
            "completed": False,
        }
        self.tasks.append(copy)
        return dict(copy)

    async def clear_completed(self, user: AuthedUser, run_id: str) -> dict[str, Any]:
        self.calls.append(("clear_completed", {"run_id": run_id}))
        deleted = [t for t in self.tasks if t["completed"]]
        self.tasks = [t for t in self.tasks if not t["completed"]]
        return {"deleted": [dict(t) for t in deleted]}

    async def create_tag(self, user: AuthedUser, run_id: str, name: str) -> dict[str, Any]:
        self.calls.append(("create_tag", {"name": name}))
        from agent.executor_client import ExecutorError

        if any(t["name"].lower() == name.lower() for t in self.tags):
            raise ExecutorError(f"a tag named '{name}' already exists", status_code=409)
        self._tag_seq += 1
        tag = {"id": f"tag_{self._tag_seq:04d}", "name": name}
        self.tags.append(tag)
        return dict(tag)

    async def tag_task(
        self, user: AuthedUser, run_id: str, task_id: str, name: str
    ) -> dict[str, Any]:
        self.calls.append(("tag_task", {"id": task_id, "name": name}))
        task = self._find(task_id)
        existing = next((t for t in self.tags if t["name"].lower() == name.lower()), None)
        tag = existing
        if tag is None:
            self._tag_seq += 1
            tag = {"id": f"tag_{self._tag_seq:04d}", "name": name}
            self.tags.append(tag)
        if tag not in task["tags"]:
            task["tags"] = [*task["tags"], dict(tag)]
        return {"task": dict(task), "tag": dict(tag), "tagCreated": existing is None}

    async def reset_demo(self, user: AuthedUser, run_id: str) -> dict[str, Any]:
        self.calls.append(("reset_demo", {"run_id": run_id}))
        result = {
            "deletedTaskIds": [t["id"] for t in self.tasks],
            "deletedTagIds": [t["id"] for t in self.tags],
        }
        self.tasks = []
        self.tags = []
        return result


def user_msg(text: str, id: str = "u1") -> UserMessage:
    return UserMessage(id=id, content=text)


def assistant_tool_call(name: str, args: dict[str, Any], call_id: str, msg_id: str) -> Message:
    return AssistantMessage(
        id=msg_id,
        tool_calls=[
            ToolCall(id=call_id, function=FunctionCall(name=name, arguments=json.dumps(args)))
        ],
    )


def tool_result(call_id: str, result: Any, msg_id: str) -> ToolMessage:
    return ToolMessage(id=msg_id, tool_call_id=call_id, content=json.dumps(result))


def make_input(
    messages: list[Message],
    tools: list[Tool] | None = None,
    run_id: str = "run_1",
    thread_id: str = "thread_1",
) -> RunAgentInput:
    return RunAgentInput(
        thread_id=thread_id,
        run_id=run_id,
        messages=messages,
        tools=tools or [],
        context=[],
        forwarded_props=None,
        state=None,
    )


async def collect_events(run_input: RunAgentInput, executor: FakeExecutor) -> list[BaseEvent]:
    return [event async for event in run_agent(run_input, USER, executor)]  # type: ignore[arg-type]


@pytest.fixture
def fake_executor() -> FakeExecutor:
    return FakeExecutor()
