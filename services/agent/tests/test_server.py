import json
from typing import Any

import httpx
import jwt
import pytest
from fastapi import FastAPI, Request

from agent.config import Settings
from agent.executor_client import ExecutorClient
from agent.server import create_app

DEV_SECRET = "dev-secret-not-for-production-32b-min!"
TOKEN = jwt.encode({"sub": "user-demo", "email": "demo@example.com"}, DEV_SECRET, algorithm="HS256")


def make_stub_executor() -> tuple[FastAPI, dict[str, Any]]:
    """Tiny in-test executor: enough REST surface for the agent's three tools,
    recording the identity headers it receives so tests can assert forwarding."""
    app = FastAPI()
    state: dict[str, Any] = {"tasks": [], "seq": 0, "headers": []}

    def record(request: Request) -> None:
        state["headers"].append({k: v for k, v in request.headers.items() if k.startswith("x-")})

    @app.get("/tasks")
    async def list_tasks(request: Request) -> list[dict[str, Any]]:
        record(request)
        return state["tasks"]

    @app.post("/tasks", status_code=201)
    async def create_task(request: Request) -> dict[str, Any]:
        record(request)
        body = json.loads(await request.body())
        state["seq"] += 1
        task = {
            "id": f"task_{state['seq']:04d}",
            "title": body["title"],
            "due": body.get("due"),
            "completed": False,
            "createdAt": "2026-01-01T00:00:00Z",
        }
        state["tasks"].append(task)
        return task

    @app.post("/tasks/{task_id}/complete")
    async def complete_task(task_id: str, request: Request) -> dict[str, Any]:
        record(request)
        for task in state["tasks"]:
            if task["id"] == task_id:
                task["completed"] = True
                return task
        raise AssertionError(f"stub executor has no task {task_id}")

    return app, state


@pytest.fixture
def stub() -> tuple[httpx.AsyncClient, dict[str, Any]]:
    stub_app, state = make_stub_executor()
    transport = httpx.ASGITransport(app=stub_app)
    return httpx.AsyncClient(transport=transport, base_url="http://stub-executor"), state


@pytest.fixture
def agent_client(stub: tuple[httpx.AsyncClient, dict[str, Any]]) -> httpx.AsyncClient:
    stub_client, _ = stub
    app = create_app(
        settings=Settings(executor_url="http://stub-executor", stream_delay_ms=0),
        executor=ExecutorClient("http://stub-executor", client=stub_client),
    )
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://agent")


def run_body(text: str, tools: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "threadId": "thread_1",
        "runId": "run_http_1",
        "state": None,
        "messages": [{"id": "u1", "role": "user", "content": text}],
        "tools": tools or [],
        "context": [],
        "forwardedProps": None,
    }


def parse_sse(text: str) -> list[dict[str, Any]]:
    events = []
    for line in text.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line.removeprefix("data: ")))
    return events


async def test_healthz(agent_client: httpx.AsyncClient) -> None:
    res = await agent_client.get("/healthz")
    assert res.status_code == 200
    assert res.json()["ok"] is True


async def test_agui_requires_bearer_token(agent_client: httpx.AsyncClient) -> None:
    res = await agent_client.post("/agui", json=run_body("hello"))
    assert res.status_code == 401

    res = await agent_client.post(
        "/agui", json=run_body("hello"), headers={"authorization": "Bearer nope"}
    )
    assert res.status_code == 401


async def test_agui_streams_camel_case_events_and_forwards_identity(
    agent_client: httpx.AsyncClient, stub: tuple[httpx.AsyncClient, dict[str, Any]]
) -> None:
    _, state = stub
    res = await agent_client.post(
        "/agui",
        json=run_body("add a task to buy milk"),
        headers={"authorization": f"Bearer {TOKEN}"},
    )
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")

    events = parse_sse(res.text)
    assert [e["type"] for e in events][:2] == ["RUN_STARTED", "TOOL_CALL_START"]
    assert events[0] == {"type": "RUN_STARTED", "threadId": "thread_1", "runId": "run_http_1"}
    assert events[1]["toolCallName"] == "create_task"
    assert events[1]["parentMessageId"]  # camelCase on the wire
    assert events[-1]["type"] == "RUN_FINISHED"

    custom = [e for e in events if e["type"] == "CUSTOM"]
    assert custom == [
        {
            "type": "CUSTOM",
            "name": "entity_changed",
            "value": {"typename": "Task", "id": "task_0001", "kind": "CREATED", "scope": "tasks"},
        }
    ]

    # The executor stub saw verified identity + the AG-UI run id, per contract.
    assert state["headers"][0]["x-caller-service"] == "agent"
    assert state["headers"][0]["x-user-id"] == "user-demo"
    assert state["headers"][0]["x-agent-run-id"] == "run_http_1"
    assert state["headers"][0]["x-tool-name"] == "create_task"
