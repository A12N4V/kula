%include "macros.inc"
section .text
global main
helper:
    ret
main:
    call helper
    ret
