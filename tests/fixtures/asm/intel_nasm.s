; x86-64 Intel syntax (NASM style): auth_check, hash_token, login_main
section .text
global auth_check
global hash_token
auth_check:
    push rbp
    mov rbp, rsp
    mov eax, edi
    cmp eax, 0
    je .L1
    xor eax, eax
    pop rbp
    ret
.L1:
    mov eax, 1
    pop rbp
    ret

hash_token:
    push rbp
    mov rbp, rsp
    movzx eax, byte [rdi]
    shl eax, 5
    xor eax, esi
    add eax, 0x9e3779b9
    pop rbp
    ret

login_main:
    push rbp
    mov rbp, rsp
    sub rsp, 16
    call auth_check
    test eax, eax
    jz .done
    mov edi, eax
.done:
    xor eax, eax
    leave
    ret
