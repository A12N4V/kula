// ARMv8 (AArch64, GAS style) fixture
// two functions: hash_token, login_main
    .arch armv8-a
    .text
    .global hash_token
    .type hash_token, %function
hash_token:
    stp x29, x30, [sp, #-16]!
    mov x29, sp
    ldrb w0, [x0]
    lsl w0, w0, #5
    eor w0, w0, w1
    add w0, w0, #0x9e3
    ldp x29, x30, [sp], #16
    ret
    .size hash_token, .-hash_token

    .global login_main
    .type login_main, %function
login_main:
    stp x29, x30, [sp, #-16]!
    mov x29, sp
    str x0, [sp, #-8]
    bl hash_token
    cbz w0, .Ldone
    blx r3
.Ldone:
    mov w0, #0
    ldp x29, x30, [sp], #16
    ret
    .size login_main, .-login_main
