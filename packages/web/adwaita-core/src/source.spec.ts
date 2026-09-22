// The 6502 language definition, the palette its token classes are coloured from,
// and the gutter formatters — held to the output of the CodeMirror implementation
// they were lifted out of.
//
// WHERE `ASM_6502_TOKEN_VECTOR` COMES FROM, and why that matters
//
// It was not written by hand and it is not a restatement of the tokenizer. It is
// the captured output of the PREVIOUS implementation — `token6502` in
// `@gjsify/adwaita-web/src/source-view/asm6502.ts`, driven by CodeMirror's real
// `StringStream` over the two programs below, one entry per token in order. The
// move retargeted that function from `StringStream` onto
// {@link AdwSourceTokenStream}; a test written from the NEW code would have
// agreed with whatever the new code did, which is the shape of check that makes
// a refactor look verified and proves nothing.
//
// To re-capture it, build a node entry that imports the tokenizer and
// `StringStream` and, for each line, runs
// `while (!stream.eol()) { cls = token(stream); emit(stream.current(), cls); stream.start = stream.pos }`.
//
// {@link LineStream} below is the second half of the same argument: it implements
// the eight members with CodeMirror's own bodies, so if it drifted from them the
// vector would stop matching.

import { describe, expect, it } from '@gjsify/unit';

import {
    ADW_SOURCE_6502_DIRECTIVES,
    ADW_SOURCE_6502_LINE_COMMENT,
    ADW_SOURCE_6502_OPCODES,
    ADW_SOURCE_6502_REGISTERS,
    ADW_SOURCE_6502_TOKEN_ROLES,
    ADW_SOURCE_HEX_STRIDE,
    ADW_SOURCE_PALETTE_DARK,
    ADW_SOURCE_PALETTE_LIGHT,
    ADW_SOURCE_SYNTAX_ROLES,
    classifyAsm6502Word,
    formatHexAddress,
    formatLineNumber,
    stripSourceWhitespace,
    tokenizeAsm6502,
    type AdwSourceTokenClass,
    type AdwSourceTokenStream,
} from './source.js';

/**
 * One line of text with a cursor — the eight members of
 * {@link AdwSourceTokenStream}, with the bodies CodeMirror's `StringStream` has.
 * The core cannot depend on `@codemirror/language`, so the seam is re-met here
 * instead of imported, and the vector is what holds the two to each other.
 */
class LineStream implements AdwSourceTokenStream {
    pos = 0;
    start = 0;

    constructor(readonly text: string) {}

    eol(): boolean {
        return this.pos >= this.text.length;
    }

    sol(): boolean {
        return this.pos === 0;
    }

    peek(): string | undefined {
        return this.text.charAt(this.pos) || undefined;
    }

    next(): string | void {
        if (this.pos < this.text.length) return this.text.charAt(this.pos++);
    }

    eat(match: string | RegExp | ((ch: string) => boolean)): string | void {
        const ch = this.text.charAt(this.pos);
        const ok =
            typeof match === 'string' ? ch === match : ch && (match instanceof RegExp ? match.test(ch) : match(ch));
        if (ok) {
            ++this.pos;
            return ch;
        }
    }

    eatWhile(match: string | RegExp | ((ch: string) => boolean)): boolean {
        const start = this.pos;
        while (this.eat(match)) {
            // The advance IS the body: `eat` moves the cursor and returns
            // undefined as soon as the character stops matching.
        }
        return this.pos > start;
    }

    eatSpace(): boolean {
        const start = this.pos;
        while (/[\s ]/.test(this.text.charAt(this.pos))) ++this.pos;
        return this.pos > start;
    }

    skipToEnd(): void {
        this.pos = this.text.length;
    }

    current(): string {
        return this.text.slice(this.start, this.pos);
    }
}

/** Tokenize `source` line by line into the vector's one-entry-per-line format. */
function tokenVector(source: string): string {
    const out: string[] = [];
    for (const line of source.split('\n')) {
        const stream = new LineStream(line);
        while (!stream.eol()) {
            const before = stream.pos;
            const cls = tokenizeAsm6502(stream);
            if (stream.pos === before) {
                throw new Error(`tokenizer made no progress at ${before} in ${JSON.stringify(line)}`);
            }
            out.push(`${cls ?? '-'} ${JSON.stringify(stream.current())}`);
            stream.start = stream.pos;
        }
    }
    return out.join('\n');
}

/** Name the first differing entry, so a failure reads as a token, not a 12 KB blob. */
function firstDifference(actual: string, expected: string): string | null {
    const a = actual.split('\n');
    const e = expected.split('\n');
    if (a.length !== e.length) return `entry count ${a.length}, expected ${e.length}`;
    for (let i = 0; i < e.length; i++) {
        if (a[i] !== e[i]) return `entry ${i + 1}: ${a[i]} — expected ${e[i]}`;
    }
    return null;
}

/** The easy6502 snake game — the canonical real 6502 program this mode exists for. */
const ASM_6502_SNAKE = `;  ___ _ __   __ _ _  _____
; / __| '_ \\ / _\` | |/ / _ \\
; \\__ \\ | | | (_| |   <  __/
; |___/_| |_|\\__,_|_|\\_\\___|

; Change direction: W A S D

define appleL         $00 ; screen location of apple, low byte
define appleH         $01 ; screen location of apple, high byte
define snakeHeadL     $10 ; screen location of snake head, low byte
define snakeHeadH     $11 ; screen location of snake head, high byte
define snakeBodyStart $12 ; start of snake body byte pairs
define snakeDirection $02 ; direction (possible values are below)
define snakeLength    $03 ; snake length, in bytes

; Directions (each using a separate bit)
define movingUp      1
define movingRight   2
define movingDown    4
define movingLeft    8

define sysRandom     $fe ; RNG
define sysLastKey    $ff ; last key pressed

  jsr init
  jsr loop

init:
  jsr initSnake
  jsr generateApplePosition
  rts

initSnake:
  lda #movingRight  ;start direction
  sta snakeDirection

  lda #4  ;start length (2 segments)
  sta snakeLength

  lda #$11
  sta snakeHeadL

  lda #$10
  sta snakeBodyStart

  lda #$0f
  sta $14 ; body segment 1

  lda #$04
  sta snakeHeadH
  sta $13 ; body segment 1
  sta $15 ; body segment 2
  rts

generateApplePosition:
  ;load a new random byte into $00
  lda sysRandom
  sta appleL

  ;load a new random number from 2 to 5 into $01
  lda sysRandom
  and #$03 ;mask out lowest 2 bits
  clc
  adc #2
  sta appleH

  rts

loop:
  jsr readKeys
  jsr checkCollision
  jsr updateSnake
  jsr drawApple
  jsr drawSnake
  jsr spinWheels
  jmp loop

readKeys:
  lda sysLastKey
  cmp #$77
  beq upKey
  cmp #$64
  beq rightKey
  cmp #$73
  beq downKey
  cmp #$61
  beq leftKey
  rts
upKey:
  lda #movingDown
  bit snakeDirection
  bne illegalMove

  lda #movingUp
  sta snakeDirection
  rts
rightKey:
  lda #movingLeft
  bit snakeDirection
  bne illegalMove

  lda #movingRight
  sta snakeDirection
  rts
downKey:
  lda #movingUp
  bit snakeDirection
  bne illegalMove

  lda #movingDown
  sta snakeDirection
  rts
leftKey:
  lda #movingRight
  bit snakeDirection
  bne illegalMove

  lda #movingLeft
  sta snakeDirection
  rts

illegalMove:
  rts

checkCollision:
  jsr checkAppleCollision
  jsr checkSnakeCollision
  rts

checkAppleCollision:
  lda appleL
  cmp snakeHeadL
  bne doneCheckingAppleCollision
  lda appleH
  cmp snakeHeadH
  bne doneCheckingAppleCollision

  ;eat apple
  inc snakeLength
  inc snakeLength ;increase length
  jsr generateApplePosition
doneCheckingAppleCollision:
  rts

checkSnakeCollision:
  ldx #2 ;start with second segment
snakeCollisionLoop:
  lda snakeHeadL,x
  cmp snakeHeadL
  bne continueCollisionLoop

maybeCollided:
  lda snakeHeadH,x
  cmp snakeHeadH
  beq didCollide

continueCollisionLoop:
  inx
  inx
  cpx snakeLength ;got to last section with no collision
  beq didntCollide
  jmp snakeCollisionLoop

didCollide:
  jmp gameOver
didntCollide:
  rts

updateSnake:
  ldx snakeLength
  dex
  txa
updateloop:
  lda snakeHeadL,x
  sta snakeBodyStart,x
  dex
  bpl updateloop

  lda snakeDirection
  lsr
  bcs up
  lsr
  bcs right
  lsr
  bcs down
  lsr
  bcs left
up:
  lda snakeHeadL
  sec
  sbc #$20
  sta snakeHeadL
  bcc upup
  rts
upup:
  dec snakeHeadH
  lda #$1
  cmp snakeHeadH
  beq collision
  rts
right:
  inc snakeHeadL
  lda #$1f
  bit snakeHeadL
  beq collision
  rts
down:
  lda snakeHeadL
  clc
  adc #$20
  sta snakeHeadL
  bcs downdown
  rts
downdown:
  inc snakeHeadH
  lda #$6
  cmp snakeHeadH
  beq collision
  rts
left:
  dec snakeHeadL
  lda snakeHeadL
  and #$1f
  cmp #$1f
  beq collision
  rts
collision:
  jmp gameOver

drawApple:
  ldy #0
  lda sysRandom
  sta (appleL),y
  rts

drawSnake:
  ldx #0
  lda #1
  sta (snakeHeadL,x) ; paint head

  ldx snakeLength
  lda #0
  sta (snakeHeadL,x) ; erase end of tail
  rts

spinWheels:
  ldx #0
spinloop:
  nop
  nop
  dex
  bne spinloop
  rts

gameOver:
`;

/** Literal and punctuation forms snake has none of: strings, binary, dot-directives. */
const ASM_6502_LITERALS = `.org $0600
.byte "Hello, \\"world\\"!", 0
.ascii 'it''s fine'
.asciiz "unterminated
	dcb %10110001, %0011, 42, $ff
banner .word $1234 + $5678 - 16
	LDA #%1010_0000
	lda ($10,X)
	lda ($10),Y
	ASL A
	JMP (indirect)
label_with_underscores:
  .unknown@directive ? ! \`
  eor #$0F ^ $F0 & $0F | ~$00
  lda [$12] , 3
  .
  .5
  #
`;

/** Captured from the CodeMirror implementation — see the file header. */
const ASM_6502_TOKEN_VECTOR = `comment ";  ___ _ __   __ _ _  _____"
comment "; / __| '_ \\\\ / _\` | |/ / _ \\\\"
comment "; \\\\__ \\\\ | | | (_| |   <  __/"
comment "; |___/_| |_|\\\\__,_|_|\\\\_\\\\___|"
comment "; Change direction: W A S D"
directive "define"
- " "
identifier "appleL"
- "         "
number "$00"
- " "
comment "; screen location of apple, low byte"
directive "define"
- " "
identifier "appleH"
- "         "
number "$01"
- " "
comment "; screen location of apple, high byte"
directive "define"
- " "
identifier "snakeHeadL"
- "     "
number "$10"
- " "
comment "; screen location of snake head, low byte"
directive "define"
- " "
identifier "snakeHeadH"
- "     "
number "$11"
- " "
comment "; screen location of snake head, high byte"
directive "define"
- " "
identifier "snakeBodyStart"
- " "
number "$12"
- " "
comment "; start of snake body byte pairs"
directive "define"
- " "
identifier "snakeDirection"
- " "
number "$02"
- " "
comment "; direction (possible values are below)"
directive "define"
- " "
identifier "snakeLength"
- "    "
number "$03"
- " "
comment "; snake length, in bytes"
comment "; Directions (each using a separate bit)"
directive "define"
- " "
identifier "movingUp"
- "      "
number "1"
directive "define"
- " "
identifier "movingRight"
- "   "
number "2"
directive "define"
- " "
identifier "movingDown"
- "    "
number "4"
directive "define"
- " "
identifier "movingLeft"
- "    "
number "8"
directive "define"
- " "
identifier "sysRandom"
- "     "
number "$fe"
- " "
comment "; RNG"
directive "define"
- " "
identifier "sysLastKey"
- "    "
number "$ff"
- " "
comment "; last key pressed"
- "  "
opcode "jsr"
- " "
identifier "init"
- "  "
opcode "jsr"
- " "
identifier "loop"
label "init"
- ":"
- "  "
opcode "jsr"
- " "
identifier "initSnake"
- "  "
opcode "jsr"
- " "
identifier "generateApplePosition"
- "  "
opcode "rts"
label "initSnake"
- ":"
- "  "
opcode "lda"
- " "
operator "#"
identifier "movingRight"
- "  "
comment ";start direction"
- "  "
opcode "sta"
- " "
identifier "snakeDirection"
- "  "
opcode "lda"
- " "
operator "#"
number "4"
- "  "
comment ";start length (2 segments)"
- "  "
opcode "sta"
- " "
identifier "snakeLength"
- "  "
opcode "lda"
- " "
operator "#"
number "$11"
- "  "
opcode "sta"
- " "
identifier "snakeHeadL"
- "  "
opcode "lda"
- " "
operator "#"
number "$10"
- "  "
opcode "sta"
- " "
identifier "snakeBodyStart"
- "  "
opcode "lda"
- " "
operator "#"
number "$0f"
- "  "
opcode "sta"
- " "
number "$14"
- " "
comment "; body segment 1"
- "  "
opcode "lda"
- " "
operator "#"
number "$04"
- "  "
opcode "sta"
- " "
identifier "snakeHeadH"
- "  "
opcode "sta"
- " "
number "$13"
- " "
comment "; body segment 1"
- "  "
opcode "sta"
- " "
number "$15"
- " "
comment "; body segment 2"
- "  "
opcode "rts"
label "generateApplePosition"
- ":"
- "  "
comment ";load a new random byte into $00"
- "  "
opcode "lda"
- " "
identifier "sysRandom"
- "  "
opcode "sta"
- " "
identifier "appleL"
- "  "
comment ";load a new random number from 2 to 5 into $01"
- "  "
opcode "lda"
- " "
identifier "sysRandom"
- "  "
opcode "and"
- " "
operator "#"
number "$03"
- " "
comment ";mask out lowest 2 bits"
- "  "
opcode "clc"
- "  "
opcode "adc"
- " "
operator "#"
number "2"
- "  "
opcode "sta"
- " "
identifier "appleH"
- "  "
opcode "rts"
label "loop"
- ":"
- "  "
opcode "jsr"
- " "
identifier "readKeys"
- "  "
opcode "jsr"
- " "
identifier "checkCollision"
- "  "
opcode "jsr"
- " "
identifier "updateSnake"
- "  "
opcode "jsr"
- " "
identifier "drawApple"
- "  "
opcode "jsr"
- " "
identifier "drawSnake"
- "  "
opcode "jsr"
- " "
identifier "spinWheels"
- "  "
opcode "jmp"
- " "
identifier "loop"
label "readKeys"
- ":"
- "  "
opcode "lda"
- " "
identifier "sysLastKey"
- "  "
opcode "cmp"
- " "
operator "#"
number "$77"
- "  "
opcode "beq"
- " "
identifier "upKey"
- "  "
opcode "cmp"
- " "
operator "#"
number "$64"
- "  "
opcode "beq"
- " "
identifier "rightKey"
- "  "
opcode "cmp"
- " "
operator "#"
number "$73"
- "  "
opcode "beq"
- " "
identifier "downKey"
- "  "
opcode "cmp"
- " "
operator "#"
number "$61"
- "  "
opcode "beq"
- " "
identifier "leftKey"
- "  "
opcode "rts"
label "upKey"
- ":"
- "  "
opcode "lda"
- " "
operator "#"
identifier "movingDown"
- "  "
opcode "bit"
- " "
identifier "snakeDirection"
- "  "
opcode "bne"
- " "
identifier "illegalMove"
- "  "
opcode "lda"
- " "
operator "#"
identifier "movingUp"
- "  "
opcode "sta"
- " "
identifier "snakeDirection"
- "  "
opcode "rts"
label "rightKey"
- ":"
- "  "
opcode "lda"
- " "
operator "#"
identifier "movingLeft"
- "  "
opcode "bit"
- " "
identifier "snakeDirection"
- "  "
opcode "bne"
- " "
identifier "illegalMove"
- "  "
opcode "lda"
- " "
operator "#"
identifier "movingRight"
- "  "
opcode "sta"
- " "
identifier "snakeDirection"
- "  "
opcode "rts"
label "downKey"
- ":"
- "  "
opcode "lda"
- " "
operator "#"
identifier "movingUp"
- "  "
opcode "bit"
- " "
identifier "snakeDirection"
- "  "
opcode "bne"
- " "
identifier "illegalMove"
- "  "
opcode "lda"
- " "
operator "#"
identifier "movingDown"
- "  "
opcode "sta"
- " "
identifier "snakeDirection"
- "  "
opcode "rts"
label "leftKey"
- ":"
- "  "
opcode "lda"
- " "
operator "#"
identifier "movingRight"
- "  "
opcode "bit"
- " "
identifier "snakeDirection"
- "  "
opcode "bne"
- " "
identifier "illegalMove"
- "  "
opcode "lda"
- " "
operator "#"
identifier "movingLeft"
- "  "
opcode "sta"
- " "
identifier "snakeDirection"
- "  "
opcode "rts"
label "illegalMove"
- ":"
- "  "
opcode "rts"
label "checkCollision"
- ":"
- "  "
opcode "jsr"
- " "
identifier "checkAppleCollision"
- "  "
opcode "jsr"
- " "
identifier "checkSnakeCollision"
- "  "
opcode "rts"
label "checkAppleCollision"
- ":"
- "  "
opcode "lda"
- " "
identifier "appleL"
- "  "
opcode "cmp"
- " "
identifier "snakeHeadL"
- "  "
opcode "bne"
- " "
identifier "doneCheckingAppleCollision"
- "  "
opcode "lda"
- " "
identifier "appleH"
- "  "
opcode "cmp"
- " "
identifier "snakeHeadH"
- "  "
opcode "bne"
- " "
identifier "doneCheckingAppleCollision"
- "  "
comment ";eat apple"
- "  "
opcode "inc"
- " "
identifier "snakeLength"
- "  "
opcode "inc"
- " "
identifier "snakeLength"
- " "
comment ";increase length"
- "  "
opcode "jsr"
- " "
identifier "generateApplePosition"
label "doneCheckingAppleCollision"
- ":"
- "  "
opcode "rts"
label "checkSnakeCollision"
- ":"
- "  "
opcode "ldx"
- " "
operator "#"
number "2"
- " "
comment ";start with second segment"
label "snakeCollisionLoop"
- ":"
- "  "
opcode "lda"
- " "
identifier "snakeHeadL"
operator ","
register "x"
- "  "
opcode "cmp"
- " "
identifier "snakeHeadL"
- "  "
opcode "bne"
- " "
identifier "continueCollisionLoop"
label "maybeCollided"
- ":"
- "  "
opcode "lda"
- " "
identifier "snakeHeadH"
operator ","
register "x"
- "  "
opcode "cmp"
- " "
identifier "snakeHeadH"
- "  "
opcode "beq"
- " "
identifier "didCollide"
label "continueCollisionLoop"
- ":"
- "  "
opcode "inx"
- "  "
opcode "inx"
- "  "
opcode "cpx"
- " "
identifier "snakeLength"
- " "
comment ";got to last section with no collision"
- "  "
opcode "beq"
- " "
identifier "didntCollide"
- "  "
opcode "jmp"
- " "
identifier "snakeCollisionLoop"
label "didCollide"
- ":"
- "  "
opcode "jmp"
- " "
identifier "gameOver"
label "didntCollide"
- ":"
- "  "
opcode "rts"
label "updateSnake"
- ":"
- "  "
opcode "ldx"
- " "
identifier "snakeLength"
- "  "
opcode "dex"
- "  "
opcode "txa"
label "updateloop"
- ":"
- "  "
opcode "lda"
- " "
identifier "snakeHeadL"
operator ","
register "x"
- "  "
opcode "sta"
- " "
identifier "snakeBodyStart"
operator ","
register "x"
- "  "
opcode "dex"
- "  "
opcode "bpl"
- " "
identifier "updateloop"
- "  "
opcode "lda"
- " "
identifier "snakeDirection"
- "  "
opcode "lsr"
- "  "
opcode "bcs"
- " "
identifier "up"
- "  "
opcode "lsr"
- "  "
opcode "bcs"
- " "
identifier "right"
- "  "
opcode "lsr"
- "  "
opcode "bcs"
- " "
identifier "down"
- "  "
opcode "lsr"
- "  "
opcode "bcs"
- " "
identifier "left"
label "up"
- ":"
- "  "
opcode "lda"
- " "
identifier "snakeHeadL"
- "  "
opcode "sec"
- "  "
opcode "sbc"
- " "
operator "#"
number "$20"
- "  "
opcode "sta"
- " "
identifier "snakeHeadL"
- "  "
opcode "bcc"
- " "
identifier "upup"
- "  "
opcode "rts"
label "upup"
- ":"
- "  "
opcode "dec"
- " "
identifier "snakeHeadH"
- "  "
opcode "lda"
- " "
operator "#"
number "$1"
- "  "
opcode "cmp"
- " "
identifier "snakeHeadH"
- "  "
opcode "beq"
- " "
identifier "collision"
- "  "
opcode "rts"
label "right"
- ":"
- "  "
opcode "inc"
- " "
identifier "snakeHeadL"
- "  "
opcode "lda"
- " "
operator "#"
number "$1f"
- "  "
opcode "bit"
- " "
identifier "snakeHeadL"
- "  "
opcode "beq"
- " "
identifier "collision"
- "  "
opcode "rts"
label "down"
- ":"
- "  "
opcode "lda"
- " "
identifier "snakeHeadL"
- "  "
opcode "clc"
- "  "
opcode "adc"
- " "
operator "#"
number "$20"
- "  "
opcode "sta"
- " "
identifier "snakeHeadL"
- "  "
opcode "bcs"
- " "
identifier "downdown"
- "  "
opcode "rts"
label "downdown"
- ":"
- "  "
opcode "inc"
- " "
identifier "snakeHeadH"
- "  "
opcode "lda"
- " "
operator "#"
number "$6"
- "  "
opcode "cmp"
- " "
identifier "snakeHeadH"
- "  "
opcode "beq"
- " "
identifier "collision"
- "  "
opcode "rts"
label "left"
- ":"
- "  "
opcode "dec"
- " "
identifier "snakeHeadL"
- "  "
opcode "lda"
- " "
identifier "snakeHeadL"
- "  "
opcode "and"
- " "
operator "#"
number "$1f"
- "  "
opcode "cmp"
- " "
operator "#"
number "$1f"
- "  "
opcode "beq"
- " "
identifier "collision"
- "  "
opcode "rts"
label "collision"
- ":"
- "  "
opcode "jmp"
- " "
identifier "gameOver"
label "drawApple"
- ":"
- "  "
opcode "ldy"
- " "
operator "#"
number "0"
- "  "
opcode "lda"
- " "
identifier "sysRandom"
- "  "
opcode "sta"
- " "
operator "("
identifier "appleL"
operator ")"
operator ","
register "y"
- "  "
opcode "rts"
label "drawSnake"
- ":"
- "  "
opcode "ldx"
- " "
operator "#"
number "0"
- "  "
opcode "lda"
- " "
operator "#"
number "1"
- "  "
opcode "sta"
- " "
operator "("
identifier "snakeHeadL"
operator ","
register "x"
operator ")"
- " "
comment "; paint head"
- "  "
opcode "ldx"
- " "
identifier "snakeLength"
- "  "
opcode "lda"
- " "
operator "#"
number "0"
- "  "
opcode "sta"
- " "
operator "("
identifier "snakeHeadL"
operator ","
register "x"
operator ")"
- " "
comment "; erase end of tail"
- "  "
opcode "rts"
label "spinWheels"
- ":"
- "  "
opcode "ldx"
- " "
operator "#"
number "0"
label "spinloop"
- ":"
- "  "
opcode "nop"
- "  "
opcode "nop"
- "  "
opcode "dex"
- "  "
opcode "bne"
- " "
identifier "spinloop"
- "  "
opcode "rts"
label "gameOver"
- ":"
directive ".org"
- " "
number "$0600"
directive ".byte"
- " "
string "\\"Hello, \\\\\\"world\\\\\\"!\\""
operator ","
- " "
number "0"
directive ".ascii"
- " "
string "'it'"
string "'s fine'"
directive ".asciiz"
- " "
string "\\"unterminated"
- "\\t"
directive "dcb"
- " "
number "%10110001"
operator ","
- " "
number "%0011"
operator ","
- " "
number "42"
operator ","
- " "
number "$ff"
label "banner"
- " "
directive ".word"
- " "
number "$1234"
- " "
operator "+"
- " "
number "$5678"
- " "
operator "-"
- " "
number "16"
- "\\t"
opcode "LDA"
- " "
operator "#"
number "%1010"
identifier "_0000"
- "\\t"
opcode "lda"
- " "
operator "("
number "$10"
operator ","
register "X"
operator ")"
- "\\t"
opcode "lda"
- " "
operator "("
number "$10"
operator ")"
operator ","
register "Y"
- "\\t"
opcode "ASL"
- " "
register "A"
- "\\t"
opcode "JMP"
- " "
operator "("
identifier "indirect"
operator ")"
label "label_with_underscores"
- ":"
- "  "
directive ".unknown"
- "@"
identifier "directive"
- " "
- "?"
- " "
- "!"
- " "
- "\`"
- "  "
opcode "eor"
- " "
operator "#"
number "$0F"
- " "
operator "^"
- " "
number "$F0"
- " "
operator "&"
- " "
number "$0F"
- " "
operator "|"
- " "
operator "~"
number "$00"
- "  "
opcode "lda"
- " "
operator "["
number "$12"
operator "]"
- " "
operator ","
- " "
number "3"
- "  "
- "."
- "  "
directive ".5"
- "  "
operator "#"`;

export default async () => {
    await describe('AdwSource 6502 tokenizer', async () => {
        await it("reproduces the stream CodeMirror's StringStream produced, token for token", () => {
            const actual = `${tokenVector(ASM_6502_SNAKE)}\n${tokenVector(ASM_6502_LITERALS)}`;
            expect(firstDifference(actual, ASM_6502_TOKEN_VECTOR)).toBe(null);
        });

        await it('loses no character of the source', () => {
            // The vector pins classes and boundaries; this pins that the boundaries
            // TILE the line — a tokenizer that skipped or double-counted a character
            // could still emit a plausible class sequence.
            for (const line of `${ASM_6502_SNAKE}\n${ASM_6502_LITERALS}`.split('\n')) {
                const stream = new LineStream(line);
                let rebuilt = '';
                while (!stream.eol()) {
                    tokenizeAsm6502(stream);
                    rebuilt += stream.current();
                    stream.start = stream.pos;
                }
                expect(rebuilt).toBe(line);
            }
        });

        await it('reads a bare word by column, a known one by the table', () => {
            // The only positional decision in the tokenizer: column 0 makes an
            // unknown word a DEFINITION, anywhere else a REFERENCE.
            expect(classifyAsm6502Word('loop', true)).toBe('label');
            expect(classifyAsm6502Word('loop', false)).toBe('identifier');
            expect(classifyAsm6502Word('lda', false)).toBe('opcode');
            expect(classifyAsm6502Word('LDA', true)).toBe('opcode');
            expect(classifyAsm6502Word('define', true)).toBe('directive');
            expect(classifyAsm6502Word('x', false)).toBe('register');
        });

        await it('keeps the tables at the sizes the 6502 has', () => {
            expect(ADW_SOURCE_6502_OPCODES.size).toBe(56);
            expect(ADW_SOURCE_6502_REGISTERS.size).toBe(3);
            expect(ADW_SOURCE_6502_DIRECTIVES.size).toBe(19);
            expect(ADW_SOURCE_6502_LINE_COMMENT).toBe(';');
        });
    });

    await describe('AdwSource syntax palette', async () => {
        await it('gives every emitted token class a role, and every role both schemes', () => {
            // What makes the palette a table rather than sixteen loose colours: a
            // class the tokenizer can emit with no role renders unstyled, and a role
            // missing from one scheme is a colour that vanishes in dark mode only.
            const emitted = new Set<AdwSourceTokenClass>();
            for (const entry of ASM_6502_TOKEN_VECTOR.split('\n')) {
                const cls = entry.slice(0, entry.indexOf(' '));
                if (cls !== '-') emitted.add(cls as AdwSourceTokenClass);
            }
            expect(emitted.size).toBe(9);
            for (const cls of emitted) {
                const role = ADW_SOURCE_6502_TOKEN_ROLES[cls];
                // `identifier` is deliberately uncoloured — it takes the view foreground.
                expect(role === null || ADW_SOURCE_SYNTAX_ROLES.includes(role)).toBe(true);
            }
            for (const role of ADW_SOURCE_SYNTAX_ROLES) {
                expect(typeof ADW_SOURCE_PALETTE_LIGHT[role]).toBe('string');
                expect(typeof ADW_SOURCE_PALETTE_DARK[role]).toBe('string');
                expect(ADW_SOURCE_PALETTE_LIGHT[role] === ADW_SOURCE_PALETTE_DARK[role]).toBe(false);
            }
        });
    });

    await describe('AdwSource gutter formatting', async () => {
        await it('advances a hex address by the stride, 4 digits, uppercase', () => {
            expect(ADW_SOURCE_HEX_STRIDE).toBe(16);
            expect(formatHexAddress(1, 0x0600)).toBe('0600');
            expect(formatHexAddress(2, 0x0600)).toBe('0610');
            expect(formatHexAddress(17, 0x0600)).toBe('0700');
            expect(formatHexAddress(1, 0x000a)).toBe('000A');
            expect(formatHexAddress(3, 0x0000, 1)).toBe('0002');
        });

        await it('offsets the decimal gutter so `start` is the first line', () => {
            expect(formatLineNumber(1)).toBe('1');
            expect(formatLineNumber(1, 0)).toBe('0');
            expect(formatLineNumber(5, 10)).toBe('14');
        });

        await it('strips every whitespace class from a copied hex run', () => {
            expect(stripSourceWhitespace('0600 a9 01 \t8d\n00 02')).toBe('0600a9018d0002');
            expect(stripSourceWhitespace('')).toBe('');
        });
    });
};
