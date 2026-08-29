FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY services/agent/pyproject.toml services/agent/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev
COPY services/agent/src src
COPY contracts /contracts
RUN uv sync --frozen --no-dev
EXPOSE 7462
CMD ["uv", "run", "--no-dev", "uvicorn", "agent.main:app", "--host", "0.0.0.0", "--port", "7462"]
