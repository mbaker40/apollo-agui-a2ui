"""Turns scripted-model decisions into an AG-UI event stream.

Generic loop (a real model would slot in unchanged): ask the model for the
next action → execute backend tools against the executor → feed results back →
repeat, until the model speaks (run ends) or calls a frontend tool (run ends
deferred; the client executes it and starts a continuation run).

TRACING HOOK: in production a Langfuse (or OTel) trace would wrap this loop —
one span per run keyed by run_id, one child span per tool call, sharing the
same run id the executor writes to its audit log. Deliberately absent here.
"""

import asyncio
import json
from collections.abc import AsyncIterator

from ag_ui.core import (
    AssistantMessage,
    BaseEvent,
    CustomEvent,
    FunctionCall,
    Message,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCall,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
    ToolMessage,
)

from .auth import AuthedUser
from .executor_client import ExecutorClient
from .scripted_model import BACKEND_TOOLS, SayAction, ToolCallAction, next_action

ENTITY_CHANGED = "entity_changed"
SCOPE_TASKS = "tasks"
_MAX_STEPS = 8


def _split_deltas(text: str) -> list[str]:
    """Split text into small word-group deltas so streaming is visible."""
    words = text.split(" ")
    return [(" " if i else "") + " ".join(words[i : i + 2]) for i in range(0, len(words), 2)]


async def run_agent(
    run_input: RunAgentInput,
    user: AuthedUser,
    executor: ExecutorClient,
    stream_delay_ms: int = 0,
) -> AsyncIterator[BaseEvent]:
    run_id = run_input.run_id
    yield RunStartedEvent(thread_id=run_input.thread_id, run_id=run_id)

    working: list[Message] = list(run_input.messages)
    frontend_tools = frozenset(t.name for t in run_input.tools)
    seq = 0

    def next_id(prefix: str) -> str:
        nonlocal seq
        seq += 1
        return f"{run_id}_{prefix}_{seq}"

    try:
        for _ in range(_MAX_STEPS):
            action = next_action(working, frontend_tools)

            if isinstance(action, SayAction):
                message_id = next_id("msg")
                yield TextMessageStartEvent(message_id=message_id)
                for delta in _split_deltas(action.text):
                    yield TextMessageContentEvent(message_id=message_id, delta=delta)
                    if stream_delay_ms > 0:
                        await asyncio.sleep(stream_delay_ms / 1000)
                yield TextMessageEndEvent(message_id=message_id)
                yield RunFinishedEvent(thread_id=run_input.thread_id, run_id=run_id)
                return

            assert isinstance(action, ToolCallAction)
            call_id = next_id("call")
            parent_id = next_id("msg")
            args_json = json.dumps(action.args)
            yield ToolCallStartEvent(
                tool_call_id=call_id, tool_call_name=action.name, parent_message_id=parent_id
            )
            yield ToolCallArgsEvent(tool_call_id=call_id, delta=args_json)
            yield ToolCallEndEvent(tool_call_id=call_id)
            working.append(
                AssistantMessage(
                    id=parent_id,
                    tool_calls=[
                        ToolCall(
                            id=call_id, function=FunctionCall(name=action.name, arguments=args_json)
                        )
                    ],
                )
            )

            if action.name not in BACKEND_TOOLS:
                # Frontend tool: defer to the client. It executes the tool,
                # appends the tool result message, and starts a continuation
                # run (see /contracts/frontend-tools.md).
                yield RunFinishedEvent(thread_id=run_input.thread_id, run_id=run_id)
                return

            result = await _execute_backend_tool(executor, user, run_id, action)
            result_json = json.dumps(result)
            result_msg_id = next_id("msg")
            yield ToolCallResultEvent(
                message_id=result_msg_id, tool_call_id=call_id, content=result_json, role="tool"
            )
            working.append(ToolMessage(id=result_msg_id, tool_call_id=call_id, content=result_json))

            changed = _entity_change_for(action.name, result)
            if changed is not None:
                yield CustomEvent(name=ENTITY_CHANGED, value=changed)

        yield RunErrorEvent(
            message=f"scripted model exceeded {_MAX_STEPS} steps", code="loop_limit"
        )
    except Exception as exc:  # noqa: BLE001 — surface any failure as a protocol-level RUN_ERROR
        yield RunErrorEvent(message=str(exc), code="agent_error")


async def _execute_backend_tool(
    executor: ExecutorClient, user: AuthedUser, run_id: str, action: ToolCallAction
) -> object:
    if action.name == "create_task":
        return await executor.create_task(
            user, run_id, title=str(action.args["title"]), due=action.args.get("due")
        )
    if action.name == "complete_task":
        return await executor.complete_task(user, run_id, task_id=str(action.args["id"]))
    if action.name == "list_tasks":
        return await executor.list_tasks(user, run_id)
    raise ValueError(f"unknown backend tool: {action.name}")


def _entity_change_for(tool_name: str, result: object) -> dict[str, str] | None:
    """Mutating tools announce what changed so clients can reconcile caches."""
    if not isinstance(result, dict):
        return None
    if tool_name == "create_task":
        kind = "CREATED"
    elif tool_name == "complete_task":
        kind = "UPDATED"
    else:
        return None
    return {"typename": "Task", "id": str(result["id"]), "kind": kind, "scope": SCOPE_TASKS}
