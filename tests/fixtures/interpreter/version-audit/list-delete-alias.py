values = [10, 20, 30, 40]
alias = values
del values[1]
del values[-1]
print(alias is values, len(alias), alias[0], alias[1])
