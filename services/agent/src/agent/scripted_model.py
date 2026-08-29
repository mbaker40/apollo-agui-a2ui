"""The scripted fake model — deterministic, keyless, and pure.

This module plays the role a real LLM would: given the conversation so far
(including tool results) and the set of frontend tools the CLIENT advertised
for this run, decide the next action. It is a pure function, which is what
makes every scenario in /e2e reproducible without an API key.

v2 structure (see docs/SCALING.md): an ORDERED intent router (first regex
wins — ordering is the fragile part keyword routing buys you) dispatching to
small handlers, most of which are one `_single_task_flow` call: find the
task by fuzzy title match, call one backend tool, phrase the result. A tool
result carrying {"error": ...} short-circuits to a friendly message — the
generic rule that lets validation/conflict edges (bad date, duplicate tag)
scale without per-tool error handling.

A real model would replace `next_action` behind the same interface.
"""

import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from ag_ui.core import AssistantMessage, Message, ToolMessage, UserMessage

from .backend_tools import BACKEND_TOOLS  # noqa: F401  (re-exported for compat)

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
TXT_RENAMED = 'Renamed it to "{title}".'
TXT_RENAME_HOW = "Try 'rename the milk task to buy oat milk'."
TXT_DUE_SET = '"{title}" is now due {due}.'
TXT_DUE_NEED_DATE = (
    "Tell me the date as YYYY-MM-DD — e.g. 'the milk task is due 2026-09-01'. "
    "(I'm scripted; a real model would happily parse 'tomorrow'.)"
)
TXT_PRIORITY_SET = 'Set "{title}" to {level} priority.'
TXT_PRIORITY_NEED_LEVEL = "Which priority — low, medium, or high?"
TXT_REOPENED = 'Reopened "{title}".'
TXT_NOT_COMPLETED = "\"{title}\" isn't marked done, so there's nothing to reopen."
TXT_DELETED = 'Deleted "{title}" ({id}).'
TXT_DUPLICATED = 'Duplicated it as "{title}" ({id}).'
TXT_CLEARED = "Cleared {count} completed task{s}."
TXT_NOTHING_TO_CLEAR = "There are no completed tasks to clear."
TXT_TAGGED = "Tagged \"{title}\" with '{tag}'{suffix}."
TXT_TAG_HOW = "Try 'tag the milk task as urgent'."
TXT_TAG_CREATED = "Created tag '{name}'."
TXT_TAG_NEED_NAME = "What should the tag be called? Try 'add a tag called urgent'."
TXT_RESET = "Fresh start: removed {tasks} task(s) and {tags} tag(s)."
TXT_TOOL_ERROR = "That didn't work: {error}"
TXT_HELP = (
    "I'm a scripted demo model (no LLM behind me). Try: 'add a task to buy milk', "
    "\"I'm done with the milk one\", 'rename the milk task to buy oat milk', "
    "'the milk task is due 2026-09-01', 'make the milk task high priority', "
    "'tag the milk task as urgent', 'duplicate the milk task', 'delete the vet task', "
    "'clear my completed tasks', 'open the milk task', or 'start over'."
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
        "rename",
        "delete",
        "remove",
        "duplicate",
        "reopen",
        "clear",
        "make",
        "set",
        "priority",
        "due",
        "tag",
        "by",
        "on",
        "for",
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


def _best_match(tasks: list[dict[str, Any]], hint: str) -> dict[str, Any] | None:
    wanted = set(_tokens(hint))
    best: dict[str, Any] | None = None
    best_score = 0
    for task in tasks:
        score = len(wanted & set(_tokens(str(task.get("title", "")))))
        if score > best_score:
            best, best_score = task, score
    return best


def _first(interactions: list[_ToolInteraction], name: str) -> _ToolInteraction | None:
    return next((i for i in interactions if i.name == name), None)


def _single_task_flow(
    interactions: list[_ToolInteraction],
    hint: str,
    tool: str,
    args: Callable[[dict[str, Any]], dict[str, Any]],
    say: Callable[[dict[str, Any], dict[str, Any]], Action],
    precheck: Callable[[dict[str, Any]], Action | None] | None = None,
) -> Action:
    """The shared shape of every act-on-one-task scenario:
    list → fuzzy-match the target → (precheck) → call the tool → phrase the result."""
    listed = _first(interactions, "list_tasks")
    if listed is None:
        return ToolCallAction("list_tasks")
    match = _best_match(listed.result or [], hint)
    if match is None:
        return SayAction(TXT_NO_MATCH.format(hint=" ".join(_tokens(hint)) or hint.strip()))
    acted = _first(interactions, tool)
    if acted is None:
        if precheck is not None:
            blocked = precheck(match)
            if blocked is not None:
                return blocked
        return ToolCallAction(tool, args(match))
    result = acted.result if isinstance(acted.result, dict) else {}
    return say(result, match)


def _strip(text: str) -> str:
    return text.strip(" .!?\"'")


# ── intent handlers ─────────────────────────────────────────────────────────


def _handle_add(text: str, interactions: list[_ToolInteraction], _fe: frozenset[str]) -> Action:
    created = _first(interactions, "create_task")
    if created is None:
        m = re.search(
            r"\b(?:add|create)\b(?:\s+(?:a|an|another))?(?:\s+new)?\s+task"
            r"(?:\s+(?:to|called|named|for|that says))?[:\s]\s*(.+)",
            text,
            re.IGNORECASE,
        ) or re.search(r"\b(?:add|create)\b\s+(.+)", text, re.IGNORECASE)
        title = _strip(m.group(1)) if m else ""
        if not title:
            return SayAction(TXT_EMPTY_TITLE)
        return ToolCallAction("create_task", {"title": title})
    task = created.result if isinstance(created.result, dict) else {}
    return SayAction(TXT_CREATED.format(title=task.get("title", "?"), id=task.get("id", "?")))


def _handle_complete(
    text: str, interactions: list[_ToolInteraction], _fe: frozenset[str]
) -> Action:
    return _single_task_flow(
        interactions,
        text,
        "complete_task",
        args=lambda t: {"id": str(t.get("id"))},
        say=lambda res, _t: SayAction(TXT_COMPLETED.format(title=res.get("title", "?"))),
        precheck=lambda t: (
            SayAction(TXT_ALREADY_DONE.format(title=t.get("title", "?")))
            if t.get("completed")
            else None
        ),
    )


def _handle_open(text: str, interactions: list[_ToolInteraction], fe: frozenset[str]) -> Action:
    if OPEN_TASK not in fe:
        return SayAction(TXT_CANNOT_OPEN)

    def say(result: dict[str, Any], match: dict[str, Any]) -> Action:
        if result.get("status") == "opened":
            return SayAction(TXT_OPENED.format(title=match.get("title", "?")))
        return SayAction(TXT_OPEN_NOT_FOUND.format(id=match.get("id", "?")))

    return _single_task_flow(
        interactions, text, OPEN_TASK, args=lambda t: {"id": str(t.get("id"))}, say=say
    )


def _handle_rename(text: str, interactions: list[_ToolInteraction], _fe: frozenset[str]) -> Action:
    m = re.search(r"\brename\s+(?:the\s+)?(.+?)(?:\s+task|\s+one)?\s+to\s+(.+)$", text, re.I)
    if not m:
        return SayAction(TXT_RENAME_HOW)
    hint, new_title = m.group(1), _strip(m.group(2))
    return _single_task_flow(
        interactions,
        hint,
        "rename_task",
        args=lambda t: {"id": str(t.get("id")), "title": new_title},
        say=lambda res, _t: SayAction(TXT_RENAMED.format(title=res.get("title", new_title))),
    )


def _handle_due(text: str, interactions: list[_ToolInteraction], _fe: frozenset[str]) -> Action:
    m = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", text)
    candidate = m.group(1) if m else None
    if candidate is None:
        m2 = re.search(r"\bdue\s+(?:on\s+|by\s+)?([^\s.!?,]+)", text, re.I)
        candidate = m2.group(1) if m2 else None
    if not candidate:
        return SayAction(TXT_DUE_NEED_DATE)
    hint = text.replace(candidate, " ")
    due = candidate
    return _single_task_flow(
        interactions,
        hint,
        "set_due",
        args=lambda t: {"id": str(t.get("id")), "due": due},
        say=lambda res, _t: SayAction(
            TXT_DUE_SET.format(title=res.get("title", "?"), due=res.get("due", due))
        ),
    )


def _handle_priority(
    text: str, interactions: list[_ToolInteraction], _fe: frozenset[str]
) -> Action:
    m = re.search(r"\b(low|medium|high)\b", text, re.I)
    if not m:
        return SayAction(TXT_PRIORITY_NEED_LEVEL)
    level = m.group(1).upper()
    hint = re.sub(r"\b(low|medium|high)\b", " ", text, flags=re.I)
    return _single_task_flow(
        interactions,
        hint,
        "set_priority",
        args=lambda t: {"id": str(t.get("id")), "priority": level},
        say=lambda res, _t: SayAction(
            TXT_PRIORITY_SET.format(
                title=res.get("title", "?"), level=str(res.get("priority", level)).lower()
            )
        ),
    )


def _handle_reopen(text: str, interactions: list[_ToolInteraction], _fe: frozenset[str]) -> Action:
    return _single_task_flow(
        interactions,
        text,
        "reopen_task",
        args=lambda t: {"id": str(t.get("id"))},
        say=lambda res, _t: SayAction(TXT_REOPENED.format(title=res.get("title", "?"))),
        precheck=lambda t: (
            None
            if t.get("completed")
            else SayAction(TXT_NOT_COMPLETED.format(title=t.get("title", "?")))
        ),
    )


def _handle_delete(text: str, interactions: list[_ToolInteraction], _fe: frozenset[str]) -> Action:
    return _single_task_flow(
        interactions,
        text,
        "delete_task",
        args=lambda t: {"id": str(t.get("id"))},
        say=lambda res, _t: SayAction(
            TXT_DELETED.format(title=res.get("title", "?"), id=res.get("id", "?"))
        ),
    )


def _handle_duplicate(
    text: str, interactions: list[_ToolInteraction], _fe: frozenset[str]
) -> Action:
    return _single_task_flow(
        interactions,
        text,
        "duplicate_task",
        args=lambda t: {"id": str(t.get("id"))},
        say=lambda res, _t: SayAction(
            TXT_DUPLICATED.format(title=res.get("title", "?"), id=res.get("id", "?"))
        ),
    )


def _handle_clear(_text: str, interactions: list[_ToolInteraction], _fe: frozenset[str]) -> Action:
    acted = _first(interactions, "clear_completed")
    if acted is None:
        return ToolCallAction("clear_completed")
    deleted = (acted.result or {}).get("deleted", []) if isinstance(acted.result, dict) else []
    if not deleted:
        return SayAction(TXT_NOTHING_TO_CLEAR)
    return SayAction(TXT_CLEARED.format(count=len(deleted), s="" if len(deleted) == 1 else "s"))


def _handle_create_tag(
    text: str, interactions: list[_ToolInteraction], _fe: frozenset[str]
) -> Action:
    acted = _first(interactions, "create_tag")
    if acted is None:
        m = re.search(r"\btag\s+(?:called|named)\s+['\"]?(.+?)['\"]?\s*$", text, re.I) or re.search(
            r"\btag\s+(.+)$", text, re.I
        )
        name = _strip(m.group(1)) if m else ""
        if not name:
            return SayAction(TXT_TAG_NEED_NAME)
        return ToolCallAction("create_tag", {"name": name})
    result = acted.result if isinstance(acted.result, dict) else {}
    return SayAction(TXT_TAG_CREATED.format(name=result.get("name", "?")))


def _handle_tag(text: str, interactions: list[_ToolInteraction], _fe: frozenset[str]) -> Action:
    m = re.search(
        r"\btag\s+(?:the\s+)?(.+?)(?:\s+task|\s+one)?\s+(?:as|with)\s+['\"]?(.+?)['\"]?\s*$",
        text,
        re.I,
    )
    if not m:
        return SayAction(TXT_TAG_HOW)
    hint, name = m.group(1), _strip(m.group(2))

    def say(result: dict[str, Any], _match: dict[str, Any]) -> Action:
        task = result.get("task", {}) if isinstance(result.get("task"), dict) else {}
        tag = result.get("tag", {}) if isinstance(result.get("tag"), dict) else {}
        suffix = " (new tag)" if result.get("tagCreated") else ""
        return SayAction(
            TXT_TAGGED.format(
                title=task.get("title", "?"), tag=tag.get("name", name), suffix=suffix
            )
        )

    return _single_task_flow(
        interactions,
        hint,
        "tag_task",
        args=lambda t: {"id": str(t.get("id")), "name": name},
        say=say,
    )


def _handle_reset(_text: str, interactions: list[_ToolInteraction], _fe: frozenset[str]) -> Action:
    acted = _first(interactions, "reset_demo")
    if acted is None:
        return ToolCallAction("reset_demo")
    result = acted.result if isinstance(acted.result, dict) else {}
    return SayAction(
        TXT_RESET.format(
            tasks=len(result.get("deletedTaskIds", [])), tags=len(result.get("deletedTagIds", []))
        )
    )


# ── the router ──────────────────────────────────────────────────────────────
# ORDERED — first match wins. The ordering constraints are load-bearing:
# reset/clear before complete ("clear my COMPLETED tasks"), create-tag before
# add ("ADD a TAG called urgent"), reopen before complete ("NOT DONE with"),
# tag after delete ("delete" never mentions tags). This fragility is a
# documented scaling finding — a real model replaces the router wholesale.

Handler = Callable[[str, list[_ToolInteraction], frozenset[str]], Action]

_ROUTES: list[tuple[re.Pattern[str], Handler]] = [
    (re.compile(r"\bstart\s+over\b|\breset\b", re.I), _handle_reset),
    (re.compile(r"\bclear\b", re.I), _handle_clear),
    (re.compile(r"\b(?:add|create)\b[^.]*\btag\b", re.I), _handle_create_tag),
    (re.compile(r"\b(?:add|create)\b", re.I), _handle_add),
    # Verb-anchored: mid-sentence 'copy' must not swallow "done with the
    # copy one" — a real collision this router grew during v2 (docs/SCALING.md).
    (re.compile(r"^\s*(?:please\s+)?(?:duplicate|copy)\b", re.I), _handle_duplicate),
    (re.compile(r"\brename\b", re.I), _handle_rename),
    (re.compile(r"\bdue\b", re.I), _handle_due),
    (re.compile(r"\b(?:low|medium|high)\s+priority\b|\bpriority\b", re.I), _handle_priority),
    (
        re.compile(r"\breopen\b|\bnot\s+(?:done|finished)\b|\bdidn'?t\s+finish\b", re.I),
        _handle_reopen,
    ),
    (re.compile(r"\b(?:done|complete|completed|finish|finished)\b", re.I), _handle_complete),
    (re.compile(r"\b(?:delete|remove)\b", re.I), _handle_delete),
    (re.compile(r"\btag\b", re.I), _handle_tag),
    (re.compile(r"\b(?:open|show|view)\b", re.I), _handle_open),
]


def next_action(messages: list[Message], frontend_tools: frozenset[str] | set[str]) -> Action:
    """Decide the next step from the conversation. Pure and deterministic."""
    last_user, interactions = _conversation_view(messages)

    # Generic tool-error rule: any 4xx-style error result ends the turn with a
    # friendly explanation (validation, conflict, not-found — one rule for all).
    for interaction in interactions:
        if isinstance(interaction.result, dict) and "error" in interaction.result:
            return SayAction(TXT_TOOL_ERROR.format(error=interaction.result["error"]))

    for pattern, handler in _ROUTES:
        if pattern.search(last_user):
            return handler(last_user, interactions, frozenset(frontend_tools))
    return SayAction(TXT_HELP)
