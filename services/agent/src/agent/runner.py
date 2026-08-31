"""Turns scripted-model decisions into an AG-UI event stream.

Generic loop (a real model would slot in unchanged): ask the model for the
next action → execute backend tools against the executor → feed results back →
repeat, until the model speaks (run ends) or calls a frontend tool (run ends
deferred; the client executes it and starts a continuation run).

Tool failures come in two flavors, deliberately:
- an executor 4xx (validation, conflict, not-found) becomes a structured
  ERROR RESULT the model can react to with friendly text — the run survives;
- transport failures and 5xx abort the run with a protocol-level RUN_ERROR.

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
from .backend_tools import BACKEND_TOOL_SPECS
from .executor_client import ExecutorClient, ExecutorError
from .scripted_model import SayAction, ToolCallAction, next_action

ENTITY_CHANGED = "entity_changed"
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

            spec = BACKEND_TOOL_SPECS.get(action.name)
            if spec is None:
                # Frontend tool: defer to the client. It executes the tool,
                # appends the tool result message, and starts a continuation
                # run (see /contracts/frontend-tools.md).
                yield RunFinishedEvent(thread_id=run_input.thread_id, run_id=run_id)
                return

            changes: list[dict[str, str]] = []
            try:
                result = await spec.execute(executor, user, run_id, action.args)
                changes = spec.changes(result)
            except ExecutorError as exc:
                if exc.status_code is None or exc.status_code >= 500:
                    raise
                # 4xx: the tool failed in a way the model can talk about —
                # validation, conflict, not-found. No entity changed.
                result = {"error": str(exc)}

            result_json = json.dumps(result)
            result_msg_id = next_id("msg")
            yield ToolCallResultEvent(
                message_id=result_msg_id, tool_call_id=call_id, content=result_json, role="tool"
            )
            working.append(ToolMessage(id=result_msg_id, tool_call_id=call_id, content=result_json))

            for change in changes:
                yield CustomEvent(name=ENTITY_CHANGED, value=change)

        yield RunErrorEvent(
            message=f"scripted model exceeded {_MAX_STEPS} steps", code="loop_limit"
        )
    except Exception as exc:  # noqa: BLE001 — surface any failure as a protocol-level RUN_ERROR
        yield RunErrorEvent(message=str(exc), code="agent_error")
