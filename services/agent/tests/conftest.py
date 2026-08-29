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
    """Duck-typed stand-in for ExecutorClient with an in-memory store."""

    def __init__(self, tasks: list[dict[str, Any]] | None = None) -> None:
        self.tasks: list[dict[str, Any]] = tasks or []
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self._seq = len(self.tasks)

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
            "createdAt": "2026-01-01T00:00:00Z",
        }
        self.tasks.append(task)
        return task

    async def complete_task(self, user: AuthedUser, run_id: str, task_id: str) -> dict[str, Any]:
        self.calls.append(("complete_task", {"id": task_id, "run_id": run_id}))
        for task in self.tasks:
            if task["id"] == task_id:
                task = {**task, "completed": True}
                return task
        raise AssertionError(f"fake executor has no task {task_id}")

    async def list_tasks(self, user: AuthedUser, run_id: str) -> list[dict[str, Any]]:
        self.calls.append(("list_tasks", {"run_id": run_id}))
        return list(self.tasks)


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
