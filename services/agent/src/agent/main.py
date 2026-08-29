import uvicorn

from .config import Settings
from .server import create_app

app = create_app()


def run() -> None:
    uvicorn.run(app, host="0.0.0.0", port=Settings().port)


if __name__ == "__main__":
    run()
