"""REST client for the executor (the true backend).

Backend tools call the executor over REST — NEVER through the GraphQL facade.
GraphQL is the read/UI plane; writes triggered by the agent go straight to the
service that owns the datastore, through its compliance middleware.
"""

from typing import Any

import httpx

from .auth import AuthedUser

# Mirrors /contracts/fixtures/identity-headers.json (pinned by tests/test_contracts.py).
IDENTITY_HEADERS = {
    "callerService": "x-caller-service",
    "userId": "x-user-id",
    "userEmail": "x-user-email",
    "agentRunId": "x-agent-run-id",
    "toolName": "x-tool-name",
}

Json = dict[str, Any]


class ExecutorError(Exception):
    pass


class ExecutorClient:
    def __init__(self, base_url: str, client: httpx.AsyncClient | None = None) -> None:
        self._client = client or httpx.AsyncClient(base_url=base_url, timeout=10.0)

    async def aclose(self) -> None:
        await self._client.aclose()

    def _headers(self, user: AuthedUser, run_id: str, tool: str) -> dict[str, str]:
        headers = {
            IDENTITY_HEADERS["callerService"]: "agent",
            IDENTITY_HEADERS["userId"]: user.sub,
            IDENTITY_HEADERS["agentRunId"]: run_id,
            IDENTITY_HEADERS["toolName"]: tool,
        }
        if user.email:
            headers[IDENTITY_HEADERS["userEmail"]] = user.email
        return headers

    async def _call(
        self,
        user: AuthedUser,
        run_id: str,
        tool: str,
        method: str,
        path: str,
        body: Json | None = None,
    ) -> Any:
        try:
            res = await self._client.request(
                method, path, json=body, headers=self._headers(user, run_id, tool)
            )
        except httpx.HTTPError as exc:  # connection refused, timeout, ...
            raise ExecutorError(f"executor unreachable: {exc}") from exc
        if res.status_code >= 400:
            raise ExecutorError(
                f"executor {method} {path} failed with {res.status_code}: {res.text}"
            )
        return res.json()

    async def create_task(
        self, user: AuthedUser, run_id: str, title: str, due: str | None = None
    ) -> Json:
        body: Json = {"title": title}
        if due is not None:
            body["due"] = due
        return await self._call(user, run_id, "create_task", "POST", "/tasks", body)

    async def complete_task(self, user: AuthedUser, run_id: str, task_id: str) -> Json:
        return await self._call(user, run_id, "complete_task", "POST", f"/tasks/{task_id}/complete")

    async def list_tasks(self, user: AuthedUser, run_id: str) -> list[Json]:
        return await self._call(user, run_id, "list_tasks", "GET", "/tasks")
