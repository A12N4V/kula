//! Regex-free, std-only parser for disassembly text (`.s`, `.asm`, objdump
//! listings, Ghidra dumps).
//!
//! Labels (`name:` at line start, allowing leading whitespace, plus MASM
//! `name PROC` / `ENDP` blocks and objdump `00000000 <name>:` headers) open a
//! function that spans to the next label or EOF. Directives, local `.L*`
//! labels, numeric labels and ARM `$a`/`$d` mapping symbols are skipped.
//!
//! `call` / `callq` / `bl` / `blx` / `bls` (case-insensitive) record a call to
//! the target symbol with the byte offset of the target token, so the caller
//! can attribute it to the enclosing def. `jmp`/`jcc`/`ret` are not calls.

/// One assembly function: the byte range it spans plus its FNV-1a hash.
#[derive(Debug, Clone)]
pub struct AsmDef {
    pub name: String,
    pub start_line: u32,
    pub end_line: u32,
    pub start_byte: usize,
    pub end_byte: usize,
    pub hash: u64,
}

/// Defs plus raw call sites, mirroring the shape `index::ParsedFile` needs.
#[allow(dead_code)]
#[derive(Debug, Default)]
pub struct AsmCalls {
    pub defs: Vec<AsmDef>,
    pub calls: Vec<(String, usize)>,
}

/// FNV-1a, same constants as `index::fnv` (stable across runs and platforms).
fn fnv(b: &[u8]) -> u64 {
    b.iter().fold(0xcbf29ce484222325u64, |h, x| (h ^ *x as u64).wrapping_mul(0x100000001b3))
}

fn is_sym_start(b: u8) -> bool {
    b.is_ascii_alphabetic() || b == b'_'
}

fn is_sym_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'.' || b == b'$'
}

/// A bare name (no `@suffix`, no `+offset`) is a usable symbol when it looks
/// like `foo`, `foo.bar`, `foo$1`, `LAB_0010abcd` or `FUN_00401230`.
fn valid_sym(name: &str) -> bool {
    let b = name.as_bytes();
    if b.is_empty() || !is_sym_start(b[0]) {
        return false;
    }
    if !b.iter().all(|c| is_sym_char(*c)) {
        return false;
    }
    // Locals, directives, mapping symbols and registers are never defs.
    if name.starts_with(".L") || name.starts_with('.') || name.starts_with('$') {
        return false;
    }
    if name == "$a" || name == "$d" || name == "$t" {
        return false;
    }
    if is_register(name) {
        return false;
    }
    true
}

/// True for machine registers (case-insensitive), which appear as call
/// operands (`call *%rax`, `blx r3`) but are never callee symbols.
fn is_register(name: &str) -> bool {
    let s = name.strip_prefix('%').unwrap_or(name);
    if s.is_empty() {
        return false;
    }
    // Lowercase once into a small buffer-friendly String; names are short.
    let lower = s.to_ascii_lowercase();
    let l = lower.as_str();
    if matches!(
        l,
        "rax"
            | "rbx"
            | "rcx"
            | "rdx"
            | "rsi"
            | "rdi"
            | "rbp"
            | "rsp"
            | "eax"
            | "ebx"
            | "ecx"
            | "edx"
            | "esi"
            | "edi"
            | "ebp"
            | "esp"
            | "ax"
            | "bx"
            | "cx"
            | "dx"
            | "si"
            | "di"
            | "bp"
            | "sp"
            | "al"
            | "bl"
            | "cl"
            | "dl"
            | "ah"
            | "bh"
            | "ch"
            | "dh"
            | "sil"
            | "dil"
            | "bpl"
            | "spl"
            | "rip"
            | "eip"
            | "eflags"
            | "rflags"
            | "cs"
            | "ds"
            | "es"
            | "fs"
            | "gs"
            | "ss"
            | "lr"
            | "pc"
            | "cpsr"
            | "spsr"
            | "xzr"
            | "wzr"
            | "st"
            | "mxcsr"
    ) {
        return true;
    }
    let b = l.as_bytes();
    // r0..r15, w0..w30, x0..x30, d/s/q/v/h/b/p/z + digits, cr/dr + digit,
    // mm/xmm/ymm/zmm + digits, st(0..7).
    let digits = |bs: &[u8]| !bs.is_empty() && bs.iter().all(|c| c.is_ascii_digit());
    if b.len() >= 2 {
        match b[0] {
            b'r' if digits(&b[1..]) => return true,
            b'w' | b'x' if digits(&b[1..]) => return true,
            b'd' | b's' | b'q' | b'v' | b'h' | b'p' if digits(&b[1..]) => return true,
            b'c' if b[1] == b'r' && digits(&b[2..]) => return true,
            b'z' if digits(&b[1..]) => return true,
            _ => {}
        }
        if l.starts_with("mm") && digits(&b[2..]) {
            return true;
        }
        if (l.starts_with("xmm") || l.starts_with("ymm") || l.starts_with("zmm")) && digits(&b[3..]) {
            return true;
        }
        if l.starts_with("st") && (l.len() == 2 || digits(&b[2..])) {
            return true;
        }
        if l.starts_with("r8") || l.starts_with("r9") {
            // r8..r15 with optional w/d/b suffix (r8d, r15w, r9b, ...).
            let rest = &b[2..];
            if rest.is_empty() || digits(rest) {
                return true;
            }
            if rest.len() == 2 && rest[0].is_ascii_digit() && matches!(rest[1], b'w' | b'd' | b'b') {
                return true;
            }
            if rest.len() == 1 && matches!(rest[0], b'w' | b'd' | b'b') {
                return true;
            }
        }
        if l.starts_with('r') && b.len() == 3 && b[1].is_ascii_digit() && matches!(b[2], b'w' | b'd' | b'b') {
            return true; // r10w-style handled above; r8d-style two-digit covered too
        }
    }
    if b.len() == 3 && b[0] == b'r' && b[1].is_ascii_digit() && b[1] <= b'9' && digits(&b[1..2]) && b[2].is_ascii_digit() {
        return true; // r10..r15 plain
    }
    false
}

/// Strip `;` and `//` comments (leaves `@PLT` and `#imm` intact).
fn strip_comment(line: &str) -> &str {
    let mut end = line.len();
    if let Some(i) = line.find(';') {
        end = end.min(i);
    }
    if let Some(i) = line.find("//") {
        end = end.min(i);
    }
    line[..end].trim_end()
}

fn clean_token(tok: &str) -> &str {
    tok.trim_matches(|c| matches!(c, ':' | ',' | ';' | '"' | '\'' | '(' | ')' | '[' | ']'))
}

/// `name PROC` or `PROC name` (MASM, case-insensitive). Returns the proc name.
fn proc_start(line: &str) -> Option<String> {
    let code = strip_comment(line);
    let toks: Vec<&str> = code.split_whitespace().map(clean_token).filter(|t| !t.is_empty()).collect();
    let pos = toks.iter().position(|t| t.eq_ignore_ascii_case("proc"))?;
    let raw = if pos == 0 { toks.get(1).copied()? } else { toks[pos - 1] };
    let name = raw.split('@').next().unwrap_or(raw);
    valid_sym(name).then(|| name.to_string())
}

/// Any line whose tokens contain `ENDP` (MASM `name ENDP`, case-insensitive).
fn is_endp(line: &str) -> bool {
    strip_comment(line).split_whitespace().any(|t| clean_token(t).eq_ignore_ascii_case("endp"))
}

/// Objdump header `00000000 <foo>:` (or `<foo+0x10>:`). Returns `foo`.
fn objdump_label(line: &str) -> Option<&str> {
    if !line.contains("Disassembly of section") {
        let lt = line.find('<')?;
        let rel = line[lt..].find('>')?;
        let gt = lt + rel;
        if !line[gt + 1..].trim_start().starts_with(':') {
            return None;
        }
        let inside = line[lt + 1..gt].trim();
        let mut base = inside;
        if let Some(i) = base.find('+') {
            base = base[..i].trim();
        }
        if base.is_empty() {
            return None;
        }
        return Some(base);
    }
    None
}

/// A label that opens a function, or `None` for directives/locals/headers.
fn label_def(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    if trimmed.is_empty() {
        return None;
    }
    // Directives (`.text`, `.globl x`, `.cfi_*`, ...) and `.L*` locals.
    if trimmed.starts_with('.') {
        return None;
    }
    // Comment lines.
    if trimmed.starts_with(';') || trimmed.starts_with('#') || trimmed.starts_with("//") {
        return None;
    }
    if line.contains("Disassembly of section") {
        return None;
    }
    // Objdump `addr <name>:` form.
    if let Some(base) = objdump_label(line) {
        let name = base.split('@').next().unwrap_or(base);
        if valid_sym(name) {
            return Some(name.to_string());
        }
        return None;
    }
    // `name:` at line start (Ghidra `LAB_...:` / `FUN_...:` match too).
    let colon = trimmed.find(':')?;
    let candidate = trimmed[..colon].trim_end();
    if candidate.is_empty() || candidate.bytes().any(|b| b == b' ' || b == b'\t') {
        return None;
    }
    // Numeric-only labels (`1:`).
    if candidate.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let name = candidate.split('@').next().unwrap_or(candidate);
    valid_sym(name).then(|| name.to_string())
}

/// Split a line into `(byte_offset_in_line, token)` on whitespace/`[,;]`.
fn tokens_with_pos(line: &str) -> Vec<(usize, &str)> {
    let mut out = Vec::new();
    let mut start: Option<usize> = None;
    for (i, c) in line.char_indices() {
        if c.is_whitespace() || c == ',' || c == ';' {
            if let Some(s) = start {
                out.push((s, &line[s..i]));
                start = None;
            }
        } else if start.is_none() {
            start = Some(i);
        }
    }
    if let Some(s) = start {
        out.push((s, &line[s..]));
    }
    out
}

fn is_call_mnemonic(tok: &str) -> bool {
    let t = clean_token(tok);
    t.eq_ignore_ascii_case("call")
        || t.eq_ignore_ascii_case("callq")
        || t.eq_ignore_ascii_case("bl")
        || t.eq_ignore_ascii_case("blx")
        || t.eq_ignore_ascii_case("bls")
}

/// Normalize a raw call operand to a symbol, or `None` for registers/junk.
/// `foo@PLT` -> `foo`, `foo+0x10` -> `foo`, `*%rax` -> register -> `None`.
fn normalize_target(raw: &str) -> Option<&str> {
    let mut t = clean_token(raw);
    t = t.trim_start_matches('*');
    t = t.strip_prefix('%').unwrap_or(t);
    t = t.trim_matches(|c| matches!(c, '(' | ')' | '[' | ']' | '<' | '>' | '"' | '\''));
    if t.is_empty() {
        return None;
    }
    if let Some(i) = t.find('@') {
        t = t[..i].trim_end();
    }
    if let Some(i) = t.find('+') {
        t = t[..i].trim_end();
    } else if let Some(i) = t[1..].find('-').map(|p| p + 1) {
        // `foo-0x4`, but not a leading `-` (immediate).
        t = t[..i].trim_end();
    }
    if let Some(i) = t.find('(') {
        t = t[..i].trim_end();
    }
    if t.is_empty() || t.starts_with('.') || t.starts_with('$') || t.starts_with('%') {
        return None;
    }
    let b = t.as_bytes();
    if !is_sym_start(b[0]) || !b.iter().all(|c| is_sym_char(*c)) {
        return None;
    }
    if is_register(t) {
        return None;
    }
    Some(t)
}

/// The call target on this line plus its byte offset within the line.
fn call_target(line: &str) -> Option<(String, usize)> {
    let code = strip_comment(line);
    if code.trim().is_empty() {
        return None;
    }
    let toks = tokens_with_pos(code);
    let pos = toks.iter().position(|(_, t)| is_call_mnemonic(t))?;
    let (m_start, m_tok) = toks[pos];
    let m_end = m_start + m_tok.len();
    let rest = &code[m_end..];
    // Objdump `call 9 <foo>` / `bl 1234 <foo+0x8>`: prefer `<...>`.
    if let Some(lt) = rest.find('<') {
        if let Some(rel) = rest[lt..].find('>') {
            let inside = rest[lt + 1..lt + rel].trim();
            let mut base = inside;
            if let Some(i) = base.find('+') {
                base = base[..i].trim();
            }
            if let Some(norm) = normalize_target(base) {
                let inner = lt + 1 + rest[lt + 1..].find(norm).unwrap_or(0);
                return Some((norm.to_string(), m_end + inner));
            }
            return None;
        }
    }
    let (t_start, raw) = toks.get(pos + 1).copied()?;
    let norm = normalize_target(raw)?;
    let inner = raw.find(norm).unwrap_or(0);
    Some((norm.to_string(), t_start + inner))
}

/// Parse disassembly text into function defs and call sites.
///
/// `rel` is accepted for API symmetry and currently unused. Defs span from
/// their label to the next label (or `ENDP`/EOF). Call offsets are absolute
/// byte offsets into `src` pointing at the target token.
pub fn parse_asm(rel: &str, src: &str) -> (Vec<AsmDef>, Vec<(String, usize)>) {
    let _ = rel;
    if src.is_empty() {
        return (Vec::new(), Vec::new());
    }
    // Lines with 1-based numbers and absolute byte offsets.
    let mut lines: Vec<(u32, usize, usize, &str)> = Vec::new(); // (no, start, raw_len, text)
    let mut off = 0usize;
    let mut no = 1u32;
    for chunk in src.split_inclusive('\n') {
        let raw_len = chunk.len();
        let text = chunk.strip_suffix('\n').unwrap_or(chunk);
        let text = text.strip_suffix('\r').unwrap_or(text);
        lines.push((no, off, raw_len, text));
        off += raw_len;
        no += 1;
    }
    let total_lines = lines.len() as u32;

    // Open defs: (name, start_line, start_byte); closed ones gain end/hash.
    struct Open {
        name: String,
        start_line: u32,
        start_byte: usize,
    }
    let mut opens: Vec<Open> = Vec::new();
    let mut spans: Vec<(String, u32, u32, usize, usize)> = Vec::new(); // (name, sline, eline, sbyte, ebyte)
    let close_open = |end_line: u32, end_byte: usize, opens: &mut Vec<Open>, spans: &mut Vec<(String, u32, u32, usize, usize)>| {
        if let Some(o) = opens.pop() {
            spans.push((o.name, o.start_line, end_line, o.start_byte, end_byte));
        }
    };

    for (idx, (lineno, start, raw_len, text)) in lines.iter().enumerate() {
        if is_endp(text) {
            // `name ENDP` closes the current proc, ENDP line included.
            let end_byte = start + raw_len;
            close_open(*lineno, end_byte, &mut opens, &mut spans);
            continue;
        }
        let def = proc_start(text).or_else(|| label_def(text));
        if let Some(name) = def {
            if opens.last().is_some() {
                close_open(lineno - 1, *start, &mut opens, &mut spans);
            }
            opens.push(Open { name, start_line: *lineno, start_byte: *start });
        }
        let _ = idx;
    }
    if let Some(o) = opens.pop() {
        spans.push((o.name, o.start_line, total_lines, o.start_byte, src.len()));
    }
    spans.sort_by_key(|(_, s, _, b, _)| (*b, *s));

    let bytes = src.as_bytes();
    let defs: Vec<AsmDef> = spans
        .into_iter()
        .map(|(name, start_line, end_line, start_byte, end_byte)| {
            let end_byte = end_byte.min(bytes.len());
            let start_byte = start_byte.min(end_byte);
            let hash = fnv(&bytes[start_byte..end_byte]);
            AsmDef { name, start_line, end_line, start_byte, end_byte, hash }
        })
        .collect();

    let mut calls = Vec::new();
    for (_, start, _, text) in &lines {
        if let Some((target, off_in_line)) = call_target(text) {
            calls.push((target, start + off_in_line));
        }
    }
    (defs, calls)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(defs: &[AsmDef]) -> Vec<&str> {
        defs.iter().map(|d| d.name.as_str()).collect()
    }

    fn targets(calls: &[(String, usize)]) -> Vec<&str> {
        calls.iter().map(|(t, _)| t.as_str()).collect()
    }

    #[test]
    fn x86_intel_labels_and_call() {
        let src = "main:\n    push rbp\n    call helper\n    ret\nhelper:\n    ret\n";
        let (defs, calls) = parse_asm("a.asm", src);
        assert_eq!(names(&defs), vec!["main", "helper"]);
        assert_eq!(defs[0].start_line, 1);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "helper");
        assert!(src[calls[0].1..].starts_with("helper"));
        // No jmp/jcc/ret treated as calls.
        let (_, calls2) = parse_asm("b.asm", "f:\n    jmp g\ng:\n    je g\n    ret\n");
        assert!(calls2.is_empty(), "jmp/jcc/ret must not be calls: {calls2:?}");
    }

    #[test]
    fn x86_att_callq_and_plt() {
        let src = "\t.text\n\t.globl main\nmain:\n\tcallq foo@PLT\n\tcallq *%rax\n\tret\nfoo:\n\tret\n";
        let (defs, calls) = parse_asm("a.s", src);
        // Directives and .globl hints are not defs.
        assert_eq!(names(&defs), vec!["main", "foo"]);
        // `foo@PLT` -> `foo`; `*%rax` is a register, not a call.
        assert_eq!(targets(&calls), vec!["foo"]);
        assert!(src[calls[0].1..].starts_with("foo"));
    }

    #[test]
    fn arm_bl_and_blx() {
        let src = "_start:\n    bl main\n    blx r3\n    bl helper+0x4\nmain:\n    bx lr\nhelper:\n    bx lr\n";
        let (defs, calls) = parse_asm("a.s", src);
        assert_eq!(names(&defs), vec!["_start", "main", "helper"]);
        // `blx r3` targets a register and is dropped; `helper+0x4` -> `helper`.
        assert_eq!(targets(&calls), vec!["main", "helper"]);
    }

    #[test]
    fn objdump_headers_and_disassembly_line() {
        let src = "Disassembly of section .text:\n\n00000000 <foo>:\n   0:\te8 00 00 00 00 \tcall   5 <bar>\n   5:\tc3                   \tret\n\n00000010 <bar>:\n  10:\tc3 \tret\n";
        let (defs, calls) = parse_asm("dump.txt", src);
        assert_eq!(names(&defs), vec!["foo", "bar"]);
        assert_eq!(targets(&calls), vec!["bar"]);
        assert!(src[calls[0].1..].starts_with("bar"));
    }

    #[test]
    fn ghidra_lab_labels() {
        let src = "LAB_0010abcd:\n    call FUN_0010ab12\n    ret\nFUN_0010ab12:\n    ret\n";
        let (defs, calls) = parse_asm("ghidra.txt", src);
        assert_eq!(names(&defs), vec!["LAB_0010abcd", "FUN_0010ab12"]);
        assert_eq!(targets(&calls), vec!["FUN_0010ab12"]);
    }

    #[test]
    fn local_labels_registers_and_mapping_symbols_filtered() {
        let src = "\t.text\n.L1:\n    jmp .L1\n    call rax\n    call *%rbx\n    call r0\n$a:\nreal_fn:\n    call helper\n1:\n    nop\nhelper:\n    ret\n";
        let (defs, calls) = parse_asm("a.s", src);
        assert_eq!(names(&defs), vec!["real_fn", "helper"], "locals/registers/mapping/numeric labels skipped: {defs:?}");
        assert_eq!(targets(&calls), vec!["helper"]);
    }

    #[test]
    fn masm_proc_endp() {
        let src = "myproc PROC\n    call other\nmyproc ENDP\nother PROC\n    ret\nother ENDP\n";
        let (defs, calls) = parse_asm("a.asm", src);
        assert_eq!(names(&defs), vec!["myproc", "other"]);
        assert_eq!(targets(&calls), vec!["other"]);
    }

    #[test]
    fn def_spans_and_hash_match_fnv() {
        let src = "a:\n    call b\nb:\n    ret\n";
        let (defs, _) = parse_asm("a.asm", src);
        assert_eq!(defs.len(), 2);
        assert_eq!(defs[0].start_line, 1);
        assert_eq!(defs[0].end_line, 2);
        assert_eq!(defs[1].start_line, 3);
        let expect = fnv(&src.as_bytes()[defs[0].start_byte..defs[0].end_byte]);
        assert_eq!(defs[0].hash, expect);
    }

    #[test]
    fn case_insensitive_mnemonics() {
        let src = "f:\n    CALL g\n    BL h\ng:\n    ret\nh:\n    ret\n";
        let (_, calls) = parse_asm("a.s", src);
        assert_eq!(targets(&calls), vec!["g", "h"]);
    }
}
