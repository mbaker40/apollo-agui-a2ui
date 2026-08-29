"""The scripted fake model — deterministic, keyless, and pure.

This module plays the role a real LLM would: given the conversation so far
(including tool results) and the set of frontend tools the CLIENT advertised
for this run, decide the next action. It is a pure function, which is what
makes every scenario in /e2e reproducible without an API key.

Design note vs. the handoff doc: instead of an agent framework's FunctionModel
facility, the "model" is this ~150-line step function driven by a generic
runner loop (runner.py). Same shape as a real model loop — decide → tool →
observe → decide — with strictly less machinery and zero framework churn.
A real model could replace `next_action` behind the same interface.
"""

import json
import re
from dataclasses import dataclass, field
from typing import Any

from ag_ui.core import AssistantMessage, Message, ToolMessage, UserMessage

BACKEND_TOOLS = frozenset({"create_task", "complete_task", "list_tasks"})
OPEN_TASK = "open_task"

# Canned texts — exported so unit/e2e tests assert against one source of truth.
TXT_CREATED = 'Created "{title}" ({id}). Anything else?'
TXT_COMPLETED = 'Nice — marked "{title}" as done.'
TXT_ALREADY_DONE = '"{title}" is already marked done.'
TXT_NO_MATCH = "I couldn't find a task matching \"{hint}\". Try 'add a task to …' first."
TXT_EMPTY_TITLE = "What should the task say? Try 'add a task to buy milk'."
TXT_OPENED = 'Opened "{title}" for you.'
TXT_OPEN_NOT_FOUND = "I asked the app to open {id}, but it couldn't find that task on screen."
TXT_CANNOT_OPEN = (
    "This client didn't advertise the open_task tool, so I can't open it from chat — "
    "you'll find it in your task list."
)
TXT_HELP = (
    "I'm a scripted demo model (no LLM behind me). Try: 'add a task to buy milk', "
    "\"I'm done with the milk one\", or 'open the milk task'."
)

_STOPWORDS = frozenset(
    [
        "a",
        "an",
        "the",
        "i",
        "im",
        "is",
        "it",
        "of",
        "to",
        "my",
        "me",
        "with",
        "that",
        "this",
        "one",
        "task",
        "tasks",
        "done",
        "complete",
        "completed",
        "finish",
        "finished",
        "open",
        "show",
        "view",
        "add",
        "create",
        "new",
        "please",
        "mark",
        "as",
    ]
)


@dataclass(frozen=True)
class SayAction:
    text: str


@dataclass(frozen=True)
class ToolCallAction:
    name: str
    args: dict[str, Any] = field(default_factory=dict)


Action = SayAction | ToolCallAction


@dataclass(frozen=True)
class _ToolInteraction:
    name: str
    args: dict[str, Any]
    result: Any  # parsed JSON result, or None while pending


def _text_of(message: Message) -> str:
    content = getattr(message, "content", None)
    return content if isinstance(content, str) else ""


def _conversation_view(messages: list[Message]) -> tuple[str, list[_ToolInteraction]]:
    """Last user utterance + the tool interactions that happened after it."""
    last_user_idx = -1
    for i, msg in enumerate(messages):
        if isinstance(msg, UserMessage):
            last_user_idx = i
    last_user = _text_of(messages[last_user_idx]) if last_user_idx >= 0 else ""

    results_by_call_id: dict[str, Any] = {}
    for msg in messages[last_user_idx + 1 :]:
        if isinstance(msg, ToolMessage):
            try:
                results_by_call_id[msg.tool_call_id] = json.loads(msg.content)
            except (json.JSONDecodeError, TypeError):
                results_by_call_id[msg.tool_call_id] = msg.content

    interactions: list[_ToolInteraction] = []
    for msg in messages[last_user_idx + 1 :]:
        if isinstance(msg, AssistantMessage) and msg.tool_calls:
            for call in msg.tool_calls:
                try:
                    args = json.loads(call.function.arguments) if call.function.arguments else {}
                except json.JSONDecodeError:
                    args = {}
                interactions.append(
                    _ToolInteraction(
                        name=call.function.name,
                        args=args,
                        result=results_by_call_id.get(call.id),
                    )
                )
    return last_user, interactions


def _tokens(text: str) -> list[str]:
    words = (w.replace("'", "") for w in re.findall(r"[a-z0-9']+", text.lower()))
    return [w for w in words if w and w not in _STOPWORDS]


def _best_match(tasks: list[dict[str, Any]], utterance: str) -> dict[str, Any] | None:
    wanted = set(_tokens(utterance))
    best: dict[str, Any] | None = None
    best_score = 0
    for task in tasks:
        score = len(wanted & set(_tokens(str(task.get("title", "")))))
        if score > best_score:
            best, best_score = task, score
    return best


def _extract_title(text: str) -> str:
    m = re.search(
        r"\b(?:add|create)\b(?:\s+(?:a|an|another))?(?:\s+new)?\s+task"
        r"(?:\s+(?:to|called|named|for|that says))?[:\s]\s*(.+)",
        text,
        re.IGNORECASE,
    )
    if not m:
        m = re.search(r"\b(?:add|create)\b\s+(.+)", text, re.IGNORECASE)
    return m.group(1).strip(" .!?\"'") if m else ""


def _intent(text: str) -> str:
    lowered = text.lower()
    if re.search(r"\b(add|create)\b", lowered):
        return "add"
    if re.search(r"\b(done|complete|completed|finish|finished)\b", lowered):
        return "complete"
    if re.search(r"\b(open|show|view)\b", lowered):
        return "open"
    return "other"


def _first(interactions: list[_ToolInteraction], name: str) -> _ToolInteraction | None:
    return next((i for i in interactions if i.name == name), None)


def next_action(messages: list[Message], frontend_tools: frozenset[str] | set[str]) -> Action:
    """Decide the next step from the conversation. Pure and deterministic."""
    last_user, interactions = _conversation_view(messages)
    intent = _intent(last_user)

    if intent == "add":
        created = _first(interactions, "create_task")
        if created is None:
            title = _extract_title(last_user)
            if not title:
                return SayAction(TXT_EMPTY_TITLE)
            return ToolCallAction("create_task", {"title": title})
        task = created.result or {}
        return SayAction(TXT_CREATED.format(title=task.get("title", "?"), id=task.get("id", "?")))

    if intent == "complete":
        listed = _first(interactions, "list_tasks")
        if listed is None:
            return ToolCallAction("list_tasks")
        match = _best_match(listed.result or [], last_user)
        if match is None:
            return SayAction(TXT_NO_MATCH.format(hint=" ".join(_tokens(last_user)) or last_user))
        completed = _first(interactions, "complete_task")
        if completed is None:
            if match.get("completed"):
                return SayAction(TXT_ALREADY_DONE.format(title=match.get("title", "?")))
            return ToolCallAction("complete_task", {"id": str(match.get("id"))})
        task = completed.result or {}
        return SayAction(TXT_COMPLETED.format(title=task.get("title", "?")))

    if intent == "open":
        if OPEN_TASK not in frontend_tools:
            return SayAction(TXT_CANNOT_OPEN)
        listed = _first(interactions, "list_tasks")
        if listed is None:
            return ToolCallAction("list_tasks")
        match = _best_match(listed.result or [], last_user)
        if match is None:
            return SayAction(TXT_NO_MATCH.format(hint=" ".join(_tokens(last_user)) or last_user))
        opened = _first(interactions, OPEN_TASK)
        if opened is None:
            return ToolCallAction(OPEN_TASK, {"id": str(match.get("id"))})
        # The client executed open_task (possibly in a previous run — the tool
        # result arrives in the input messages of the continuation run).
        result = opened.result if isinstance(opened.result, dict) else {}
        if result.get("status") == "opened":
            return SayAction(TXT_OPENED.format(title=match.get("title", "?")))
        return SayAction(TXT_OPEN_NOT_FOUND.format(id=opened.args.get("id", "?")))

    return SayAction(TXT_HELP)
