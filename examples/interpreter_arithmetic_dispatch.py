class Matrix:
    def __init__(self, value):
        self.value = value

    def __matmul__(self, other):
        return Matrix(self.value * other.value)

    def __imatmul__(self, other):
        self.value *= other.value
        return self

    def __pow__(self, exponent, modulus=None):
        return pow(self.value, exponent, modulus)


matrix = Matrix(3)
matrix @= Matrix(4)
print((matrix @ Matrix(2)).value, pow(matrix, 3, 7))
