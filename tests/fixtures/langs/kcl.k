import base.util
schema Person:
    name: str
helper = lambda s: str -> str { s.upper() }
greeting = helper("x")
