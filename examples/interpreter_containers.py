"""Group records and process a mutable work queue with practical container APIs."""

records = [("todo", "read"), ("done", "ship"), ("todo", "write")]


def completed(rows):
    for state, title in rows:
        if state == "done":
            yield title


groups = {}
for state, title in records:
    groups.setdefault(state, []).append(title)

pending = groups.get("todo").copy()
pending.insert(0, "review")
pending.extend(completed(records))
print(pending.pop(0), pending.count("ship"), pending.index("read"))
snapshot = pending.copy()
snapshot.reverse()
print(snapshot[0], pending[0])

view = groups.items()
groups["hold"] = []
for state, titles in view:
    print(state, len(titles))
removed = groups.pop("hold")
pending.clear()
print(len(pending), len(removed))
