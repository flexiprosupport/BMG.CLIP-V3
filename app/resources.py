"""Shared local resource gates, including manual reframe exports."""
from contextlib import contextmanager
from functools import wraps
import shutil
import threading
from .models import ClipGenerationError
from .paths import CLIPS_DIR

_CONDITION = threading.Condition()
_ACTIVE = {"download":0,"process":0,"render":0}
LIMITS = {"max_parallel_jobs":1,"max_downloads":2,"retry_limit":2}

def configure(values):
    with _CONDITION:
        LIMITS.update(values)
        _CONDITION.notify_all()

def ready(kind):
    limit = LIMITS["max_downloads"] if kind=="download" else LIMITS["max_parallel_jobs"] if kind=="process" else 1
    if _ACTIVE[kind] >= limit:
        return False
    if kind=="process":
        from . import transcriber
        free = transcriber._available_ram_gb()
        if free is not None and free < (.35 if _ACTIVE[kind]==0 else 2.0):
            return False
    return True

@contextmanager
def slot(kind,cancelled=lambda:False,on_wait=None):
    with _CONDITION:
        while not ready(kind):
            if cancelled():
                raise ClipGenerationError("Processing cancelled while waiting for resources.")
            if on_wait:
                on_wait()
            _CONDITION.wait(.3)
        if cancelled():
            raise ClipGenerationError("Processing cancelled.")
        if kind in ("process","download") and shutil.disk_usage(CLIPS_DIR).free < 512 * 1024**2:
            raise ClipGenerationError("Not enough free disk space. Free at least 512 MB and retry.")
        _ACTIVE[kind] += 1
    try:
        yield
    finally:
        with _CONDITION:
            _ACTIVE[kind] -= 1
            _CONDITION.notify_all()

def render_guard(function):
    @wraps(function)
    def guarded(*args,**kwargs):
        with slot("render",kwargs.get("cancelled") or (lambda:False)):
            return function(*args,**kwargs)
    return guarded

