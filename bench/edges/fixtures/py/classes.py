class Base:
    def greet(self):
        return "hi"

    def run(self):
        return self.greet()


class Child(Base):
    def shout(self):
        return self.greet()


class Item:
    def use(self):
        return 1


class Builder:
    def make(self):
        return Item()

    @classmethod
    def build(cls):
        return cls.make()


def build_item():
    item = Item()
    return item.use()
