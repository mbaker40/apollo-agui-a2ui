# Contract: frontend tools

Frontend tools are executed **on the client**, not by the agent. They are the
"hybrid" half of the architecture: backend tools go chat → agent → executor;
frontend tools go chat → agent → _back to the client that asked_.

## Declaration

A client that can perform a client-local action declares it in
`RunAgentInput.tools` using the shape in
[`schemas/frontend-tools.schema.json`](./schemas/frontend-tools.schema.json).
The v1 tool is `open_task` — its canonical declaration is
[`fixtures/frontend-tools/open-task.json`](./fixtures/frontend-tools/open-task.json)
and every client MUST send exactly that declaration (each platform pins a
conformance test to the fixture).

## Capability awareness (agent side)

The agent MUST NOT call a tool the **current run** did not declare. If the user
asks for a client-local action the client can't perform (e.g. "open the milk
task" from a client that didn't declare `open_task`), the agent responds with a
capability-aware fallback message instead of a tool call.

## Execution loop (client side)

AG-UI models frontend tools as _deferred_ tool calls:

1. Agent emits `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` for the
   frontend tool, then ends the run (`RUN_FINISHED`) **without** a
   `TOOL_CALL_RESULT` for it.
2. The client executes the tool locally (web: navigate/highlight; mobile: a
   registered callback).
3. The client appends a tool-result message to the conversation:
   `{ "id": "<new>", "role": "tool", "toolCallId": "<from step 1>", "content": "<JSON string>" }`
4. The client immediately starts a **new run** (same `threadId`, fresh `runId`)
   with the updated message list. The agent sees the tool result and streams
   follow-up text that reflects it.

All three clients implement the same loop; the mobile cores expose it as a
`FrontendToolRegistry` + run-continuation helper, the web app implements it in
`apps/web/src/lib/agent.ts`.

## Result shape (v1, `open_task`)

```json
{ "status": "opened", "id": "task_0001" }
{ "status": "not_found", "id": "task_9999" }
```

The result is serialized as a JSON **string** in the tool message `content`.
