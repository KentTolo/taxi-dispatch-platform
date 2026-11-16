"""SMS adapter. The demo build only logs messages; a real provider plugs in here."""

import logging
from collections import deque

from .db import utcnow

log = logging.getLogger("sms")

# Last 200 messages, visible to operators in demo mode.
OUTBOX: deque[dict] = deque(maxlen=200)


def send_sms(to: str, body: str) -> None:
    OUTBOX.appendleft({"to": to, "body": body, "at": utcnow().isoformat() + "Z"})
    log.info("SMS to %s: %s", to, body)
