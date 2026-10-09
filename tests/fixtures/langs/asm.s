.globl main
helper:
    ret
main:
    call helper
    bl helper
    ret
