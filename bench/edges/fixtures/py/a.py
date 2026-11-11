from b import hash_it, pad

class Store:
    def get(self, k):
        return hash_it(k)

    def put(self, k):
        return self.get(k)

def run(s):
    return pad(s.get("x"))
