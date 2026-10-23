mapping = {0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9}
for key in [0, 1, 2, 3, 4, 5, 6]:
    del mapping[key]
cursor = reversed(mapping)
print(next(cursor))
for key in [7, 8, 9]:
    del mapping[key]
for key in [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]:
    mapping[key] = key
for key in [3, 4, 5, 6, 7, 8, 9]:
    del mapping[key]
for step in [0, 1, 2]:
    print(next(cursor))
