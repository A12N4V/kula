; Ghidra/IDA-ish export fixture
; two functions: login_main, hash_token
**************************************************************
* FUNCTION login_main @ 00101020
**************************************************************
LAB_00101020  push rbp
LAB_00101021  mov rbp,rsp
LAB_00101024  sub rsp,0x10
LAB_00101028  mov dword ptr [rbp-0x4],edi
LAB_0010102b  call hash_token        ; CALL hash_token
LAB_00101030  test eax,eax
LAB_00101032  je LAB_00101039
LAB_00101034  mov eax,0x1
LAB_00101039  leave
LAB_0010103a  ret
**************************************************************
* FUNCTION hash_token @ 00101040
**************************************************************
LAB_00101040  push rbp
LAB_00101041  mov rbp,rsp
LAB_00101044  movzx eax,byte ptr [rdi]
LAB_00101047  shl eax,0x5
LAB_0010104a  xor eax,esi
LAB_0010104c  add eax,0x9e3779b9    ; CALL auth_check (resolved import comment)
LAB_00101051  pop rbp
LAB_00101052  ret
