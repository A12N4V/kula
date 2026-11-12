from .core import helper
from . import core


def via_relative(v):
    return helper(v)


def via_module(v):
    return core.helper(v)
