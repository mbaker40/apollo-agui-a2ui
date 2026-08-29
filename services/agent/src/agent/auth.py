from dataclasses import dataclass

import jwt


@dataclass(frozen=True)
class AuthedUser:
    sub: str
    email: str | None = None
    name: str | None = None


def verify_bearer(authorization: str | None, secret: str) -> AuthedUser | None:
    """Demo-grade but real in shape: verify the HS256 dev JWT, extract identity.

    Returns None for missing/invalid tokens; the caller turns that into a 401.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.removeprefix("Bearer ")
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None
    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub:
        return None
    email = payload.get("email")
    name = payload.get("name")
    return AuthedUser(
        sub=sub,
        email=email if isinstance(email, str) else None,
        name=name if isinstance(name, str) else None,
    )
