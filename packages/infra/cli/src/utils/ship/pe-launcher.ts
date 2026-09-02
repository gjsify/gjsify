// The GUI-subsystem launcher `gjsify ship windows` writes for itself.
//
// THE DEFECT IT CLOSES. `node.exe` is an `IMAGE_SUBSYSTEM_WINDOWS_CUI` image —
// `Subsystem` = 3, measured at offset 0xd4 of `node-v24.20.0-win-x64.zip`'s
// `node.exe` — and the Node release carries no `nodew.exe` to put in its place.
// The staged launcher is a `.cmd`, which `cmd.exe` runs, and `cmd.exe` is a
// console image too. So Windows allocates a console for every double-click and
// every installer shortcut, and a black window sits behind the app for its whole
// life. ADR 0024 § M3 records that NO CI leg can see this: every Windows job
// starts the app from a shell and therefore already has a console to inherit.
//
// WHY THIS FILE EMITS THE IMAGE INSTEAD OF SHIPPING ONE. The same argument
// `deb.ts`, `rpm.ts`, `cpio.ts`, `ar.ts`, `zip.ts` and `msi.ts` already make one
// directory over, with one addition that is specific to a PROGRAM:
//
//   * a prebuilt stub is a binary in git, and a binary in git needs a toolchain
//     to reproduce it (there is no MSVC and no mingw on the machine that
//     assembles Windows artifacts — ADR 0024 § A1: assembly happens on Linux),
//     a licence row of its own, and a gate proving the committed bytes are the
//     ones that source produces. Emitting the image needs none of the three: the
//     bytes are a pure function of this file, so `pe-launcher.spec.ts` reads them
//     back on any host.
//   * the alternative that needs no new image at all — patching a copy of
//     `node.exe`'s `Subsystem` from 3 to 2 — does not solve the problem it looks
//     like it solves. The console is allocated for `cmd.exe`, before `node.exe`
//     is started at all, so the field that decides it is `cmd.exe`'s and not
//     ours. It also silently invalidates node.exe's Authenticode signature and
//     makes a modified redistributable of somebody else's binary.
//
// WHAT IT DOES NOT THROW AWAY. A GUI-subsystem image is not a detached one:
// Windows allocates a console only when there is none to INHERIT, so this stub
// started from PowerShell or `cmd.exe` runs inside the console it was started
// from and every byte the app writes to stdout/stderr lands in that terminal,
// exactly as the `.cmd` does today. The Explorer path is the one with nowhere to
// write, and it is the one this stub redirects: with no console, the child is
// created `CREATE_NO_WINDOW` with its stdout and stderr pointing at
// `%TEMP%\<logLeaf>`, so an app that dies in its first second leaves a stack
// trace behind instead of a window that never appeared. Losing the output was the
// obvious design and it is the one that makes an unlaunchable app undiagnosable.
//
// IT RUNS THE `.cmd`, IT DOES NOT REPLACE IT. The stub derives its own path,
// rewrites the trailing `exe` to `cmd` and runs THAT — so every decision the
// launcher makes (the prefix, `XDG_DATA_DIRS`, `GJSIFY_GTK_RUNTIME`,
// `NODE_GI_NATIVE`, `GI_TYPELIB_PATH`, `PATH`, the interpreter) stays in
// `launcher.ts` where `assertLauncherMatchesInterpreter` and
// `.github/ship-oracle/verify-program-dir.py` already read it. A second copy of
// that logic in machine code is a second truth, and it is the copy nobody can
// read.
//
// THE ENCODING IS THE RISKY PART AND IT IS HELD BY A READER THAT IS NOT OURS:
// `objdump -x` (binutils' `pei-x86-64`) and `.github/ship-oracle/verify-program-dir.py`
// both parse the emitted file, and `tests/e2e/ship-windows` drives the emitted
// image through the same `readBinaryArch` that reads a real `node.exe`.

/**
 * `IMAGE_SUBSYSTEM_WINDOWS_GUI` — the one field this whole file exists to set.
 *
 * The counterpart is 3, `_CUI`, which is what `node.exe` and `cmd.exe` are and
 * what makes Windows allocate a console when there is none to inherit.
 */
export const PE_SUBSYSTEM_GUI = 2;

/** Where `Subsystem` lands in the emitted image: `e_lfanew` + 4 + 20 + 68. */
export const PE_SUBSYSTEM_OFFSET = 0x80 + 4 + 20 + 68;

/** `IMAGE_FILE_HEADER.Machine` for x86-64. The only architecture the windows layout has. */
const MACHINE_AMD64 = 0x8664;

/** Where the PE signature starts. MSVC emits 0x78; nothing reads the value except through `e_lfanew`. */
const PE_OFFSET = 0x80;

const FILE_ALIGNMENT = 0x200;
const SECTION_ALIGNMENT = 0x1000;
const IMAGE_BASE = 0x140000000n;

/**
 * The kernel32 entry points the stub calls, in the order its IAT lists them.
 *
 * ONE dll, and every name is a documented kernel32 export — including
 * `GetConsoleCP` (which is what decides whether the child may be given a console
 * of its own) and the two `lstr*` string helpers, which is why the stub needs no
 * CRT and therefore carries nobody's licence but this repository's.
 */
const IMPORTS = [
    'GetModuleFileNameW',
    'GetSystemDirectoryW',
    'GetCommandLineW',
    'GetConsoleCP',
    'GetStdHandle',
    'GetTempPathW',
    'CreateFileW',
    'CreateProcessW',
    'WaitForSingleObject',
    'GetExitCodeProcess',
    'ExitProcess',
    'lstrcpyW',
    'lstrcatW',
] as const;

type ImportName = (typeof IMPORTS)[number];

/**
 * A byte buffer with named positions and deferred 32-bit fixups.
 *
 * Everything this file emits is either an absolute value known at layout time or
 * a RIP-relative displacement that is not — so the assembler records the second
 * kind and patches it once the data section's addresses exist. Fixed instruction
 * lengths (every displacement is a `disp32`, every branch a `rel32`) are what
 * make one patching pass enough.
 */
class Emitter {
    readonly bytes: number[] = [];
    private readonly labels = new Map<string, number>();
    private readonly ripFixups: { at: number; symbol: string }[] = [];
    private readonly branchFixups: { at: number; label: string }[] = [];

    push(...values: number[]): void {
        for (const value of values) this.bytes.push(value & 0xff);
    }

    label(name: string): void {
        this.labels.set(name, this.bytes.length);
    }

    /** A `disp32` that will be `symbolRva - (ripAfterThisInstruction)`. */
    private ripSlot(symbol: string): void {
        this.ripFixups.push({ at: this.bytes.length, symbol });
        this.push(0, 0, 0, 0);
    }

    private branchSlot(label: string): void {
        this.branchFixups.push({ at: this.bytes.length, label });
        this.push(0, 0, 0, 0);
    }

    /** `lea <reg>, [rip + symbol]` — the ModRM byte differs, the REX prefix carries the high bit. */
    leaRip(reg: 'rax' | 'rcx' | 'rdx' | 'rdi' | 'r8' | 'r9', symbol: string): void {
        const modrm = { rax: 0x05, rcx: 0x0d, rdx: 0x15, rdi: 0x3d, r8: 0x05, r9: 0x0d }[reg];
        this.push(reg === 'r8' || reg === 'r9' ? 0x4c : 0x48, 0x8d, modrm);
        this.ripSlot(symbol);
    }

    /** `call qword ptr [rip + symbol]` — an indirect call through the IAT slot. */
    callImport(name: ImportName): void {
        this.push(0xff, 0x15);
        this.ripSlot(`iat.${name}`);
    }

    jmp(label: string): void {
        this.push(0xe9);
        this.branchSlot(label);
    }

    /** `jcc rel32`, spelled by the two-byte form so no branch is ever out of range. */
    jcc(condition: 'e' | 'ne' | 'b', label: string): void {
        this.push(0x0f, { e: 0x84, ne: 0x85, b: 0x82 }[condition]);
        this.branchSlot(label);
    }

    /** Resolve every recorded fixup. `symbolRva` answers for data, the label map for code. */
    resolve(codeRva: number, symbolRva: (symbol: string) => number): Uint8Array {
        const out = Buffer.from(this.bytes);
        for (const { at, symbol } of this.ripFixups) {
            // The displacement is relative to the END of the instruction, which is
            // four bytes past the slot itself — the one rule about RIP-relative
            // addressing that is not visible in the encoding.
            out.writeInt32LE(symbolRva(symbol) - (codeRva + at + 4), at);
        }
        for (const { at, label } of this.branchFixups) {
            const target = this.labels.get(label);
            if (target === undefined) throw new Error(`gjsify ship: the launcher stub jumps to no label "${label}".`);
            out.writeInt32LE(target - (at + 4), at);
        }
        return new Uint8Array(out);
    }
}

/** `mov <reg32>, imm32`. */
function movImm32(emit: Emitter, reg: 'eax' | 'ecx' | 'edx' | 'r8d' | 'r9d' | 'r14d', value: number): void {
    const opcode = { eax: 0xb8, ecx: 0xb9, edx: 0xba, r8d: 0xb8, r9d: 0xb9, r14d: 0xbe }[reg];
    if (reg === 'r8d' || reg === 'r9d' || reg === 'r14d') emit.push(0x41);
    emit.push(opcode);
    const buffer = Buffer.alloc(4);
    buffer.writeInt32LE(value | 0);
    emit.push(...buffer);
}

/** `mov dword ptr [rsp + disp32], imm32`. */
function movStackDword(emit: Emitter, offset: number, value: number): void {
    emit.push(0xc7, 0x84, 0x24);
    const displacement = Buffer.alloc(4);
    displacement.writeInt32LE(offset);
    emit.push(...displacement);
    const immediate = Buffer.alloc(4);
    immediate.writeInt32LE(value | 0);
    emit.push(...immediate);
}

/** `mov qword ptr [rsp + disp32], <reg>`. */
function movStackFromReg(emit: Emitter, reg: 'rax' | 'rbx' | 'rsi' | 'rdi', offset: number): void {
    const modrm = { rax: 0x84, rbx: 0x9c, rsi: 0xb4, rdi: 0xbc }[reg];
    emit.push(0x48, 0x89, modrm, 0x24);
    const displacement = Buffer.alloc(4);
    displacement.writeInt32LE(offset);
    emit.push(...displacement);
}

/** `mov rax, qword ptr [rsp + disp32]`. */
function movRaxFromStack(emit: Emitter, offset: number): void {
    emit.push(0x48, 0x8b, 0x84, 0x24);
    const displacement = Buffer.alloc(4);
    displacement.writeInt32LE(offset);
    emit.push(...displacement);
}

/** `lea <reg>, [rsp + disp32]`. */
function leaStack(emit: Emitter, reg: 'rax' | 'rcx' | 'rdx' | 'rdi' | 'r9', offset: number): void {
    const modrm = { rax: 0x84, rcx: 0x8c, rdx: 0x94, rdi: 0xbc, r9: 0x8c }[reg];
    emit.push(reg === 'r9' ? 0x4c : 0x48, 0x8d, modrm, 0x24);
    const displacement = Buffer.alloc(4);
    displacement.writeInt32LE(offset);
    emit.push(...displacement);
}

// The stack frame, as offsets from `rsp` after the prologue. Named because the
// three Win32 structures below are addressed by hand and a wrong offset is a
// silent argument, not a compile error.
const FRAME = {
    /** Shadow space plus the six stack arguments `CreateProcessW` takes. */
    args: 0x20,
    /** `SECURITY_ATTRIBUTES` — 24 bytes, `bInheritHandle` at +0x10. */
    securityAttributes: 0x50,
    /** `STARTUPINFOW` — 104 bytes; `cb` at +0, `dwFlags` at +0x3c, the three handles at +0x50. */
    startupInfo: 0x70,
    /** `PROCESS_INFORMATION` — 24 bytes; `hProcess` first. */
    processInformation: 0xd8,
    /** Where `GetExitCodeProcess` writes. */
    exitCode: 0xf0,
    /** Total frame size, 16-byte aligned. */
    size: 0x110,
} as const;

const STARTUPINFO_CB = 104;
const SECURITY_ATTRIBUTES_CB = 24;
const STARTF_USESTDHANDLES = 0x100;
const CREATE_NO_WINDOW = 0x08000000;
const GENERIC_WRITE = 0x40000000;
const FILE_SHARE_READ_WRITE = 0x3;
const CREATE_ALWAYS = 2;
const FILE_ATTRIBUTE_NORMAL = 0x80;

/** Capacities in WCHARs. `cmdBuf` holds the whole assembled command line. */
const BUFFERS = { sysBuf: 264, selfBuf: 520, tmpBuf: 264, logBuf: 600, cmdBuf: 4096 } as const;

export interface GuiLauncherInput {
    /**
     * The file the stub writes the child's output to under `%TEMP%`, when there
     * is no console to inherit.
     *
     * A LEAF and not a path: `%TEMP%` is the one directory a program can write to
     * on every Windows install, and the program directory is not — `C:\Program
     * Files\<App>` is read-only for the user who runs the app.
     */
    logLeaf: string;
}

/**
 * The stub's instruction stream.
 *
 * Reads top to bottom as the program it is:
 *
 *   1. `GetModuleFileNameW` → our own path; rewrite the trailing `exe` to `cmd`.
 *      A three-character overwrite and not a path search, which is what makes the
 *      whole stub free of string parsing: `<App>.exe` and `<App>.cmd` differ in
 *      exactly those bytes.
 *   2. `GetSystemDirectoryW` → the real `cmd.exe`. `CreateProcessW` with a bare
 *      `cmd.exe` searches the CURRENT directory too, which under Explorer is the
 *      program directory — an absolute path is the only spelling that cannot be
 *      answered by a file sitting beside the app.
 *   3. assemble `"<sys>\cmd.exe" /s /c ""<self>.cmd" <our own arguments>"`. `/s`
 *      is the documented flag that makes `cmd.exe` strip exactly the outer pair
 *      of quotes and take the rest literally, which is the only form that
 *      survives a program directory with a space in its path.
 *   4. `GetConsoleCP` and `GetStdHandle` — two questions, three handles — decide
 *      the two remaining arguments: a console to inherit means no flags and no
 *      redirect (the terminal sees everything an unhidden `.cmd` shows today); no
 *      console but a usable stdout AND stderr means `CREATE_NO_WINDOW` and the
 *      caller's own handles; a dead handle on either means `CREATE_NO_WINDOW` plus
 *      `%TEMP%\<logLeaf>`, substituted for the dead one only so a caller's
 *      surviving redirect is never overwritten. `GetConsoleWindow` is deliberately
 *      NOT the probe — it answers NULL for a windowless console, and the comment at
 *      step 4 below carries the measurement that cost.
 *   5. wait, and exit with the child's status — so `<App>.exe` in a script is a
 *      truthful `%ERRORLEVEL%` and not a fire-and-forget.
 */
function emitStub(): Emitter {
    const emit = new Emitter();

    // `and rsp, -16` then `sub rsp, FRAME.size`. The entry point is called, so
    // `rsp % 16 == 8` here; aligning explicitly is cheaper than reasoning about it
    // and is what every call below needs.
    emit.push(0x48, 0x83, 0xe4, 0xf0);
    emit.push(0x48, 0x81, 0xec, FRAME.size & 0xff, (FRAME.size >> 8) & 0xff, 0, 0);

    // Zero everything from the outgoing arguments to the end of the frame. The
    // stack argument slots are eight bytes each while `bInheritHandles` and
    // `dwCreationFlags` are DWORDs, so their upper halves are read from whatever
    // was there — `rep stosq` is what makes them defined.
    leaStack(emit, 'rdi', FRAME.args);
    emit.push(0x31, 0xc0); // xor eax, eax
    movImm32(emit, 'ecx', (FRAME.size - FRAME.args) / 8);
    emit.push(0xf3, 0x48, 0xab); // rep stosq

    // ── 1. our own path, rewritten to the `.cmd` beside us ───────────────────
    emit.push(0x31, 0xc9); // xor ecx, ecx  — hModule = NULL
    emit.leaRip('rdx', 'selfBuf');
    movImm32(emit, 'r8d', BUFFERS.selfBuf);
    emit.callImport('GetModuleFileNameW');
    emit.push(0x83, 0xf8, 0x04); // cmp eax, 4
    emit.jcc('b', 'fail');
    emit.leaRip('rdx', 'selfBuf');
    emit.push(0x89, 0xc1); // mov ecx, eax  (zero-extends: the length in WCHARs)
    emit.push(0x48, 0x8d, 0x04, 0x4a); // lea rax, [rdx + rcx*2] — one past the last WCHAR
    emit.push(0x66, 0xc7, 0x40, 0xfa, 0x63, 0x00); // mov word [rax-6], 'c'
    emit.push(0x66, 0xc7, 0x40, 0xfc, 0x6d, 0x00); // mov word [rax-4], 'm'
    emit.push(0x66, 0xc7, 0x40, 0xfe, 0x64, 0x00); // mov word [rax-2], 'd'

    // ── 2. the real cmd.exe ──────────────────────────────────────────────────
    emit.leaRip('rcx', 'sysBuf');
    movImm32(emit, 'edx', BUFFERS.sysBuf);
    emit.callImport('GetSystemDirectoryW');

    // ── 3. the command line ──────────────────────────────────────────────────
    emit.leaRip('rcx', 'cmdBuf');
    emit.leaRip('rdx', 'strQuote');
    emit.callImport('lstrcpyW');
    for (const part of ['sysBuf', 'strCmdExe', 'selfBuf', 'strQuoteSpace'] as const) {
        emit.leaRip('rcx', 'cmdBuf');
        emit.leaRip('rdx', part);
        emit.callImport('lstrcatW');
    }

    // Our own arguments, which are everything after argv[0]. Windows hands the
    // raw line back, so argv[0] is skipped by the same rule the C runtime uses:
    // a quoted first token ends at its closing quote, an unquoted one at the
    // first space or tab.
    emit.callImport('GetCommandLineW');
    emit.push(0x48, 0x89, 0xc2); // mov rdx, rax
    emit.push(0x66, 0x83, 0x3a, 0x22); // cmp word [rdx], '"'
    emit.jcc('ne', 'skipPlain');
    emit.push(0x48, 0x83, 0xc2, 0x02); // add rdx, 2
    emit.label('skipQuoted');
    emit.push(0x66, 0x8b, 0x02); // mov ax, [rdx]
    emit.push(0x66, 0x85, 0xc0); // test ax, ax
    emit.jcc('e', 'argsReady');
    emit.push(0x48, 0x83, 0xc2, 0x02); // add rdx, 2
    emit.push(0x66, 0x83, 0xf8, 0x22); // cmp ax, '"'
    emit.jcc('ne', 'skipQuoted');
    emit.jmp('skipSpace');
    emit.label('skipPlain');
    emit.push(0x66, 0x8b, 0x02); // mov ax, [rdx]
    emit.push(0x66, 0x85, 0xc0); // test ax, ax
    emit.jcc('e', 'argsReady');
    emit.push(0x66, 0x83, 0xf8, 0x20); // cmp ax, ' '
    emit.jcc('e', 'skipSpace');
    emit.push(0x66, 0x83, 0xf8, 0x09); // cmp ax, '\t'
    emit.jcc('e', 'skipSpace');
    emit.push(0x48, 0x83, 0xc2, 0x02); // add rdx, 2
    emit.jmp('skipPlain');
    emit.label('skipSpace');
    emit.push(0x66, 0x8b, 0x02); // mov ax, [rdx]
    emit.push(0x66, 0x83, 0xf8, 0x20); // cmp ax, ' '
    emit.jcc('e', 'skipSpaceStep');
    emit.push(0x66, 0x83, 0xf8, 0x09); // cmp ax, '\t'
    emit.jcc('ne', 'argsReady');
    emit.label('skipSpaceStep');
    emit.push(0x48, 0x83, 0xc2, 0x02); // add rdx, 2
    emit.jmp('skipSpace');
    emit.label('argsReady');
    emit.leaRip('rcx', 'cmdBuf');
    emit.callImport('lstrcatW');
    emit.leaRip('rcx', 'cmdBuf');
    emit.leaRip('rdx', 'strQuote');
    emit.callImport('lstrcatW');

    // ── 4. a console to inherit, standard handles to pass on, or a log file ──
    //
    // TWO INDEPENDENT QUESTIONS, and collapsing them into one is the mistake this
    // sequence is the second version of. "Does this process own a console" decides
    // whether `cmd.exe` may be given one of its own (`CREATE_NO_WINDOW`, which is a
    // console with no window rather than no console); "can this process write
    // anywhere" decides whether the child's output needs a file. They come apart in
    // both directions — a scheduled task has a console with NO WINDOW, and a GUI
    // process started with a redirected stdout has a writable handle and no console
    // at all.
    //
    // `GetConsoleWindow` was the first probe and it answers neither: it returns NULL
    // for a windowless console, so a task-launched run took the log branch while its
    // caller's own `> file` redirect captured nothing. `GetConsoleCP` fails with no
    // console and succeeds with a windowless one, which is the question actually
    // being asked.
    //
    // `rbx`, `rsi`, `rdi` and `r14` are all non-volatile, so the handles and the
    // creation flags survive every call below.
    movImm32(emit, 'ecx', -10); // STD_INPUT_HANDLE
    emit.callImport('GetStdHandle');
    emit.push(0x48, 0x89, 0xc7); // mov rdi, rax
    movImm32(emit, 'ecx', -11); // STD_OUTPUT_HANDLE
    emit.callImport('GetStdHandle');
    emit.push(0x48, 0x89, 0xc3); // mov rbx, rax
    movImm32(emit, 'ecx', -12); // STD_ERROR_HANDLE
    emit.callImport('GetStdHandle');
    emit.push(0x48, 0x89, 0xc6); // mov rsi, rax

    emit.callImport('GetConsoleCP');
    emit.push(0x85, 0xc0); // test eax, eax
    emit.jcc('ne', 'haveConsole');

    // No console: the child may not be given a window, and the handles have to be
    // named explicitly — a process that allocates a console gets that console's
    // buffers as its standard handles unless `STARTF_USESTDHANDLES` says otherwise.
    movImm32(emit, 'r14d', CREATE_NO_WINDOW);
    // BOTH HANDLES ARE PROBED, not just stdout, and the reason is the whole point
    // of this file: `fd 2` is where an uncaught exception's trace comes out, and
    // Node prints it from C++ (`src/debug_utils.cc`), so a dead stderr loses the
    // one output that says why the app did not start.
    //
    // MEASURED, red before green, on `win11-gjsify` (2026-09-02). The state is
    // constructible with `CreateProcessW` + `DETACHED_PROCESS` (no console at all)
    // and `STARTF_USESTDHANDLES` where `hStdOutput` is a real file and `hStdError`
    // is NULL: with `rbx` probed alone, the child's `console.log` reached the
    // caller's file and the stderr line plus the entire uncaught-exception trace
    // reached NOTHING — no `%TEMP%` log was even opened, because stdout looked
    // fine. With both probed, the trace lands in `%TEMP%\<logLeaf>` and the
    // caller's stdout redirect is untouched. `INVALID_HANDLE_VALUE` in place of
    // NULL takes the same path, measured separately.
    //
    // The predicate is the SAME for both, deliberately: NULL or
    // `INVALID_HANDLE_VALUE`. A handle that is neither is the caller's, and the
    // caller's redirect always wins over our log file.
    emit.push(0x48, 0x85, 0xdb); // test rbx, rbx
    emit.jcc('e', 'needLog');
    emit.push(0x48, 0x83, 0xfb, 0xff); // cmp rbx, -1  (INVALID_HANDLE_VALUE)
    emit.jcc('e', 'needLog');
    emit.push(0x48, 0x85, 0xf6); // test rsi, rsi
    emit.jcc('e', 'needLog');
    emit.push(0x48, 0x83, 0xfe, 0xff); // cmp rsi, -1
    emit.jcc('ne', 'useStdHandles');

    emit.label('needLog');
    movImm32(emit, 'ecx', BUFFERS.tmpBuf);
    emit.leaRip('rdx', 'tmpBuf');
    emit.callImport('GetTempPathW');
    emit.leaRip('rcx', 'logBuf');
    emit.leaRip('rdx', 'tmpBuf');
    emit.callImport('lstrcpyW');
    emit.leaRip('rcx', 'logBuf');
    emit.leaRip('rdx', 'strLogLeaf');
    emit.callImport('lstrcatW');

    emit.leaRip('rcx', 'logBuf');
    movImm32(emit, 'edx', GENERIC_WRITE);
    movImm32(emit, 'r8d', FILE_SHARE_READ_WRITE);
    leaStack(emit, 'r9', FRAME.securityAttributes);
    movStackDword(emit, FRAME.securityAttributes, SECURITY_ATTRIBUTES_CB);
    // Inheritable, or the child cannot be handed it — the one field that makes this
    // a redirect rather than a file this process opened and nobody wrote to.
    movStackDword(emit, FRAME.securityAttributes + 0x10, 1);
    movStackDword(emit, FRAME.args, CREATE_ALWAYS);
    movStackDword(emit, FRAME.args + 0x8, FILE_ATTRIBUTE_NORMAL);
    movStackDword(emit, FRAME.args + 0x10, 0); // hTemplateFile
    emit.callImport('CreateFileW');
    emit.push(0x48, 0x83, 0xf8, 0xff); // cmp rax, -1
    // A `%TEMP%` that cannot be written to is not a reason to refuse to start the
    // app: run it with no window and no output rather than not at all.
    emit.jcc('e', 'create');
    // THE LOG REPLACES ONLY WHAT IS UNUSABLE. Both handles reach here when either
    // one is dead, so substituting blindly would overwrite a redirect the caller
    // asked for — `cmd /c "app.exe > file"` with a broken stderr must still put
    // stdout in `file`. Each is tested again against the same predicate as above
    // and only the dead one becomes the log.
    emit.push(0x48, 0x85, 0xdb); // test rbx, rbx
    emit.jcc('e', 'logIsStdout');
    emit.push(0x48, 0x83, 0xfb, 0xff); // cmp rbx, -1
    emit.jcc('ne', 'stdoutKept');
    emit.label('logIsStdout');
    emit.push(0x48, 0x89, 0xc3); // mov rbx, rax
    emit.label('stdoutKept');
    emit.push(0x48, 0x85, 0xf6); // test rsi, rsi
    emit.jcc('e', 'logIsStderr');
    emit.push(0x48, 0x83, 0xfe, 0xff); // cmp rsi, -1
    emit.jcc('ne', 'useStdHandles');
    emit.label('logIsStderr');
    emit.push(0x48, 0x89, 0xc6); // mov rsi, rax

    emit.label('useStdHandles');
    movStackFromReg(emit, 'rdi', FRAME.startupInfo + 0x50); // hStdInput
    movStackFromReg(emit, 'rbx', FRAME.startupInfo + 0x58); // hStdOutput
    movStackFromReg(emit, 'rsi', FRAME.startupInfo + 0x60); // hStdError
    movStackDword(emit, FRAME.startupInfo + 0x3c, STARTF_USESTDHANDLES);
    emit.jmp('create');

    // A console of our own: hand the child nothing and let it share everything —
    // the console, and any redirection already applied to it. This is the branch
    // that makes `<App>.exe` in a terminal behave exactly as the `.cmd` does.
    emit.label('haveConsole');
    emit.push(0x45, 0x31, 0xf6); // xor r14d, r14d

    // ── 5. run it, wait, and be its exit code ────────────────────────────────
    emit.label('create');
    movStackDword(emit, FRAME.startupInfo, STARTUPINFO_CB); // si.cb
    emit.push(0x31, 0xc9); // xor ecx, ecx — lpApplicationName = NULL
    emit.leaRip('rdx', 'cmdBuf');
    emit.push(0x45, 0x31, 0xc0); // xor r8d, r8d
    emit.push(0x45, 0x31, 0xc9); // xor r9d, r9d
    movStackDword(emit, FRAME.args, 1); // bInheritHandles = TRUE
    emit.push(0x44, 0x89, 0xb4, 0x24); // mov [rsp + disp32], r14d — dwCreationFlags
    {
        const displacement = Buffer.alloc(4);
        displacement.writeInt32LE(FRAME.args + 0x8);
        emit.push(...displacement);
    }
    movStackDword(emit, FRAME.args + 0x10, 0); // lpEnvironment
    movStackDword(emit, FRAME.args + 0x18, 0); // lpCurrentDirectory
    leaStack(emit, 'rax', FRAME.startupInfo);
    movStackFromReg(emit, 'rax', FRAME.args + 0x20);
    leaStack(emit, 'rax', FRAME.processInformation);
    movStackFromReg(emit, 'rax', FRAME.args + 0x28);
    emit.callImport('CreateProcessW');
    emit.push(0x85, 0xc0); // test eax, eax
    emit.jcc('e', 'fail');

    movRaxFromStack(emit, FRAME.processInformation); // hProcess
    emit.push(0x48, 0x89, 0xc1); // mov rcx, rax
    movImm32(emit, 'edx', -1); // INFINITE
    emit.callImport('WaitForSingleObject');
    movRaxFromStack(emit, FRAME.processInformation);
    emit.push(0x48, 0x89, 0xc1); // mov rcx, rax
    leaStack(emit, 'rdx', FRAME.exitCode);
    emit.callImport('GetExitCodeProcess');
    emit.push(0x8b, 0x8c, 0x24); // mov ecx, [rsp + disp32]
    {
        const displacement = Buffer.alloc(4);
        displacement.writeInt32LE(FRAME.exitCode);
        emit.push(...displacement);
    }
    emit.callImport('ExitProcess');

    // Unreachable except through the two guards above. `ExitProcess` does not
    // return, so there is nothing after it to fall into.
    emit.label('fail');
    movImm32(emit, 'ecx', 1);
    emit.callImport('ExitProcess');
    emit.push(0xcc); // int3 — a trap, not a fallthrough into the data section

    return emit;
}

/** UTF-16LE with the terminator, which is what every `lstr*W` reads to. */
function wide(text: string): Uint8Array {
    return new Uint8Array(Buffer.from(`${text}\0`, 'utf16le'));
}

interface DataItem {
    symbol: string;
    bytes: Uint8Array;
}

/**
 * Everything the stub reads or writes, laid out in one read-write section.
 *
 * The IAT comes FIRST because two data directories name it and the loader writes
 * it; the strings and the buffers follow. Buffers are emitted as zeros rather
 * than declared as uninitialised data — a `VirtualSize` larger than
 * `SizeOfRawData` is the same thing with one more field to get wrong, and eleven
 * kilobytes of zeros compresses to nothing in every container this image ships
 * inside.
 */
function dataItems(input: GuiLauncherInput): DataItem[] {
    const items: DataItem[] = [];
    for (const name of IMPORTS) items.push({ symbol: `iat.${name}`, bytes: new Uint8Array(8) });
    items.push({ symbol: 'iat.null', bytes: new Uint8Array(8) });
    items.push({ symbol: 'importDescriptors', bytes: new Uint8Array(40) });
    for (const name of IMPORTS) items.push({ symbol: `ilt.${name}`, bytes: new Uint8Array(8) });
    items.push({ symbol: 'ilt.null', bytes: new Uint8Array(8) });
    for (const name of IMPORTS) {
        // IMAGE_IMPORT_BY_NAME: a two-byte hint the loader may ignore, the name,
        // its terminator, and a pad byte when that lands odd — the structure has
        // to start on an even address.
        const raw = Buffer.from(`\0\0${name}\0`, 'latin1');
        items.push({
            symbol: `hint.${name}`,
            bytes: new Uint8Array(raw.length % 2 === 0 ? raw : Buffer.concat([raw, Buffer.alloc(1)])),
        });
    }
    items.push({ symbol: 'dllName', bytes: new Uint8Array(Buffer.from('KERNEL32.dll\0\0', 'latin1')) });
    items.push({ symbol: 'strQuote', bytes: wide('"') });
    items.push({ symbol: 'strCmdExe', bytes: wide('\\cmd.exe" /s /c ""') });
    items.push({ symbol: 'strQuoteSpace', bytes: wide('" ') });
    items.push({ symbol: 'strLogLeaf', bytes: wide(input.logLeaf) });
    for (const [name, capacity] of Object.entries(BUFFERS)) {
        items.push({ symbol: name, bytes: new Uint8Array(capacity * 2) });
    }
    return items;
}

function align(value: number, to: number): number {
    return Math.ceil(value / to) * to;
}

/**
 * The GUI-subsystem launcher, as a complete PE32+ image.
 *
 * Deterministic: the same input always produces the same bytes, with no
 * timestamp, no checksum and no build-host string anywhere in the file — which
 * is what lets `tests/e2e/ship-windows` compare two runs and what keeps the
 * artifact reproducible for anyone who repacks a stage (ADR 0024 § A2).
 */
export function buildGuiLauncher(input: GuiLauncherInput): Uint8Array {
    if (input.logLeaf === '' || /[\\/:*?"<>|]/.test(input.logLeaf)) {
        throw new Error(
            `gjsify ship: "${input.logLeaf}" cannot be the launcher's log file name — it is empty or holds a ` +
                'character Windows refuses in one. The stub writes it into `%TEMP%`, so the value is a leaf ' +
                'and never a path.',
        );
    }

    const code = emitStub();
    const codeSize = code.bytes.length;
    const textRva = SECTION_ALIGNMENT;
    const dataRva = textRva + align(codeSize, SECTION_ALIGNMENT);

    const items = dataItems(input);
    const offsets = new Map<string, number>();
    let cursor = 0;
    for (const item of items) {
        offsets.set(item.symbol, cursor);
        cursor += item.bytes.length;
    }
    const dataSize = cursor;
    const rvaOf = (symbol: string): number => {
        const offset = offsets.get(symbol);
        if (offset === undefined) throw new Error(`gjsify ship: the launcher stub names no datum "${symbol}".`);
        return dataRva + offset;
    };

    const data = Buffer.alloc(dataSize);
    for (const item of items) data.set(item.bytes, offsets.get(item.symbol) ?? 0);

    // The import descriptor and both thunk arrays, filled now that every RVA is
    // known. The ILT and the IAT hold the SAME values before the loader runs; the
    // loader overwrites the IAT with the resolved addresses and leaves the ILT,
    // which is what lets a tool read the names back out of a bound image.
    data.writeUInt32LE(rvaOf('ilt.GetModuleFileNameW'), offsets.get('importDescriptors') ?? 0);
    data.writeUInt32LE(rvaOf('dllName'), (offsets.get('importDescriptors') ?? 0) + 12);
    data.writeUInt32LE(rvaOf('iat.GetModuleFileNameW'), (offsets.get('importDescriptors') ?? 0) + 16);
    for (const name of IMPORTS) {
        const hint = BigInt(rvaOf(`hint.${name}`));
        data.writeBigUInt64LE(hint, offsets.get(`ilt.${name}`) ?? 0);
        data.writeBigUInt64LE(hint, offsets.get(`iat.${name}`) ?? 0);
    }

    const text = code.resolve(textRva, rvaOf);

    const textRaw = align(codeSize, FILE_ALIGNMENT);
    const dataRaw = align(dataSize, FILE_ALIGNMENT);
    const headerSize = FILE_ALIGNMENT;
    const textOffset = headerSize;
    const dataOffset = textOffset + textRaw;

    const image = Buffer.alloc(dataOffset + dataRaw);

    // ── DOS header ───────────────────────────────────────────────────────────
    image.write('MZ', 0, 'ascii');
    image.write('This program cannot be run in DOS mode.\r\r\n$', 0x40, 'ascii');
    image.writeUInt32LE(PE_OFFSET, 0x3c);

    // ── COFF header ──────────────────────────────────────────────────────────
    image.write('PE\0\0', PE_OFFSET, 'ascii');
    const coff = PE_OFFSET + 4;
    image.writeUInt16LE(MACHINE_AMD64, coff);
    image.writeUInt16LE(2, coff + 2); // NumberOfSections
    image.writeUInt32LE(0, coff + 4); // TimeDateStamp — zero, so the image is reproducible
    image.writeUInt16LE(240, coff + 16); // SizeOfOptionalHeader (112 + 16 * 8)
    // EXECUTABLE_IMAGE | LARGE_ADDRESS_AWARE | RELOCS_STRIPPED. The stub is
    // position-independent (every reference is RIP-relative) and carries no
    // `.reloc`, so it says so rather than letting the loader look for one.
    image.writeUInt16LE(0x0002 | 0x0020 | 0x0001, coff + 18);

    // ── optional header ──────────────────────────────────────────────────────
    const opt = coff + 20;
    image.writeUInt16LE(0x20b, opt); // PE32+
    image.writeUInt8(14, opt + 2); // MajorLinkerVersion — cosmetic
    image.writeUInt32LE(textRaw, opt + 4); // SizeOfCode
    image.writeUInt32LE(dataRaw, opt + 8); // SizeOfInitializedData
    image.writeUInt32LE(textRva, opt + 16); // AddressOfEntryPoint
    image.writeUInt32LE(textRva, opt + 20); // BaseOfCode
    image.writeBigUInt64LE(IMAGE_BASE, opt + 24);
    image.writeUInt32LE(SECTION_ALIGNMENT, opt + 32);
    image.writeUInt32LE(FILE_ALIGNMENT, opt + 36);
    image.writeUInt16LE(6, opt + 40); // MajorOperatingSystemVersion
    image.writeUInt16LE(6, opt + 48); // MajorSubsystemVersion
    image.writeUInt32LE(dataRva + align(dataSize, SECTION_ALIGNMENT), opt + 56); // SizeOfImage
    image.writeUInt32LE(headerSize, opt + 60); // SizeOfHeaders
    image.writeUInt16LE(PE_SUBSYSTEM_GUI, opt + 68);
    image.writeUInt16LE(0x0100 | 0x8000, opt + 70); // NX_COMPAT | TERMINAL_SERVER_AWARE
    image.writeBigUInt64LE(0x100000n, opt + 72); // SizeOfStackReserve
    image.writeBigUInt64LE(0x1000n, opt + 80); // SizeOfStackCommit
    image.writeBigUInt64LE(0x100000n, opt + 88); // SizeOfHeapReserve
    image.writeBigUInt64LE(0x1000n, opt + 96); // SizeOfHeapCommit
    image.writeUInt32LE(16, opt + 108); // NumberOfRvaAndSizes

    const directories = opt + 112;
    image.writeUInt32LE(rvaOf('importDescriptors'), directories + 1 * 8); // IMPORT
    image.writeUInt32LE(40, directories + 1 * 8 + 4);
    image.writeUInt32LE(rvaOf('iat.GetModuleFileNameW'), directories + 12 * 8); // IAT
    image.writeUInt32LE((IMPORTS.length + 1) * 8, directories + 12 * 8 + 4);

    // ── section table ────────────────────────────────────────────────────────
    const sections = directories + 16 * 8;
    const writeSection = (
        index: number,
        name: string,
        rva: number,
        virtualSize: number,
        raw: number,
        rawSize: number,
        characteristics: number,
    ): void => {
        const at = sections + index * 40;
        image.write(name.padEnd(8, '\0'), at, 'latin1');
        image.writeUInt32LE(virtualSize, at + 8);
        image.writeUInt32LE(rva, at + 12);
        image.writeUInt32LE(rawSize, at + 16);
        image.writeUInt32LE(raw, at + 20);
        image.writeUInt32LE(characteristics, at + 36);
    };
    writeSection(0, '.text', textRva, codeSize, textOffset, textRaw, 0x60000020);
    writeSection(1, '.data', dataRva, dataSize, dataOffset, dataRaw, 0xc0000040);

    image.set(text, textOffset);
    image.set(data, dataOffset);
    return new Uint8Array(image);
}
