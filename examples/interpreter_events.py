"""Small domain module for the persistent module-events/1 embedding example."""

revision = 0
total = 0


def adjust(amount):
    global revision, total
    total += amount
    revision += 1
    return snapshot()


def snapshot():
    return {"schema": 1, "revision": revision, "total": total}
