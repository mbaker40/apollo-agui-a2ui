from collections.abc import AsyncIterator

from ag_ui.core import RunAgentInput
from ag_ui.encoder import EventEncoder
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from .auth import verify_bearer
from .config import Settings
from .executor_client import ExecutorClient
from .runner import run_agent


def create_app(settings: Settings | None = None, executor: ExecutorClient | None = None) -> FastAPI:
    settings = settings or Settings()
    executor = executor or ExecutorClient(settings.executor_url)

    app = FastAPI(title="mwe-agent")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # dev-only; the demo web app runs on another port
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/healthz")
    async def healthz() -> dict[str, object]:
        return {"ok": True, "service": "agent"}

    @app.post("/agui")
    async def agui(run_input: RunAgentInput, request: Request) -> Response:
        user = verify_bearer(request.headers.get("authorization"), settings.jwt_secret)
        if user is None:
            return JSONResponse({"error": "missing or invalid bearer token"}, status_code=401)

        encoder = EventEncoder(accept=request.headers.get("accept") or "text/event-stream")

        async def stream() -> AsyncIterator[str]:
            async for event in run_agent(
                run_input, user, executor, stream_delay_ms=settings.stream_delay_ms
            ):
                yield encoder.encode(event)

        return StreamingResponse(stream(), media_type=encoder.get_content_type())

    return app
