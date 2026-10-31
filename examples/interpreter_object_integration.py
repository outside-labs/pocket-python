"""Compose slots, native payloads, property metadata and owned dynamic code."""
namespace={"seed":7}
exec(compile("class Amount(int): pass\nclass Box:\n __slots__=('value',)\n def __init__(self,value): self.value=Amount(value)\n @property\n def doubled(self): return self.value*2\nbox=Box(seed)","box.py","exec"),namespace)
box=namespace["box"]
box.value+=2
print(box.doubled,eval("box.value+1",namespace))
read=namespace["Box"].__dict__["doubled"].fget
print(read.__globals__ is namespace,read.__code__.co_name)
