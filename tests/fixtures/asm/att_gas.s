# x86-64 AT&T syntax (GAS style) fixture
# two functions: hash_token, login_main
    .text
    .globl hash_token
    .type hash_token, @function
hash_token:
    pushq %rbp
    movq %rsp, %rbp
    movzbl (%rdi), %eax
    shll $5, %eax
    xorl %esi, %eax
    addl $0x9e3779b9, %eax
    popq %rbp
    ret
    .size hash_token, .-hash_token

    .globl login_main
    .type login_main, @function
login_main:
    pushq %rbp
    movq %rsp, %rbp
    subq $16, %rsp
    movq %rdi, -8(%rbp)
    callq hash_token@PLT
    testl %eax, %eax
    jz .Ldone
    callq *%rax
.Ldone:
    xorl %eax, %eax
    leave
    ret
    .size login_main, .-login_main
