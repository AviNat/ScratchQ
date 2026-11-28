# ScratchQ: Scratch-program questions for Moodle (design)

Status: the builder and the libraries 0.1.0 were built on 2026-11-26 (§12). Not yet tried on a real STACK server.

## 0. Decided (user, 2026-11-26)

1. **Use an existing, freely available Scratch interpreter** rather than our own (see §5). We use scratch-vm 4.8.115, the last BSD-3 release; our own interpreter is only the fallback.
2. **Small language first** (the v1 column of §4). The VM makes it easier to widen the language later.
3. **Tests first.** Black-box tests are the only checking mechanism in the first phases. Structural rules come later (§9). (My reading of "test as first step".)
4. **Blocks stay in English** (LTR), as students use them. The question text, instructions, buttons and feedback are in **Hebrew or Arabic (RTL)** where needed (§8).
5. **STACK is the container** for the data, the same way as the chemistry keyboard on STACK-JS (§3.2).
6. **Target students: grades 7–9.** This sets the v1 language (§4).

## 1. Goal

The student sees a Scratch program in a UI that looks like the Scratch editor they know. They then do what the teacher asks:

| Kind | The student... | Editing | Checking |
|---|---|---|---|
| **K1 Trace** (simplest) | reads a fixed program with given data and writes the outcome (what the sprite says, the final value of a variable or list) | none (read-only) | the interpreter runs the program; the student's typed answer is compared with the result |
| **K2 Parsons** | puts given blocks into the right order and nesting (distractors are optional) | drag only; the palette has exactly the given blocks | tests and structure |
| **K3 Complete** | fills gaps: empty slots, a missing block, a missing condition | only the gaps; the rest is locked | tests |
| **K4 Fix** | corrects a buggy program | everything, or only the blocks the teacher unlocks | tests and a "changed little" check |
| **K5 Modify / write** | changes the program to meet a new spec, or writes one from a stub | free, with a restricted palette | tests and structural rules |

Not a goal: running the program on a stage. The checker runs the code invisibly. Showing a run (a trace table) is an optional extra, see §8.

## 2. Existing open-source building blocks

| Component | What it is | License | Fit |
|---|---|---|---|
| **scratch-blocks 2.0** (Scratch Foundation) | The block editor of Scratch 3, now rebuilt as a layer on **Blockly 12** rather than an old Blockly fork | Apache-2.0 | Looks exactly like Scratch. It was designed together with scratch-vm (dynamic menus, the variable button). The README warns of "bumps in the road" before a user-facing release, and its API is new. |
| scratch-blocks 1.x | The old fork of 2016-era Blockly (Closure build) | Apache-2.0 | It works and is frozen, but it is legacy. Avoid it. |
| **Blockly 12** + the `zelos` renderer | Generic block library. Zelos is its Scratch-style renderer (round reporters, hexagonal booleans, C-blocks, hats). | Apache-2.0 | Stable and well documented, with RTL support, `readOnly`, locks per block (`setMovable/Deletable/Editable`) and `maxInstances` per block type. We write the ~60 block definitions ourselves (JSON, with Scratch colours and wording). It looks about 90% like Scratch; the palette/flyout and dropdowns differ slightly. |
| **scratchblocks** (scratchblocks.github.io) | Turns text such as `repeat (10)` into SVG pictures of Scratch 3 blocks; it has translations for the Scratch languages | MIT | Small and read-only. Ideal for K1 display, feedback, the review page and teacher text authoring. It cannot edit. |
| scratch-gui (scratch-editor monorepo) | The full Scratch editor | **AGPL-3.0** since the relicensing (Nov 2024); older npm versions are BSD-3 | The UI is exactly the one students know, but it brings the stage, sprites, sound and costumes we don't want. Restricting blocks and locking parts needs a fork, it is several MB, and the AGPL obliges us to publish any modified hosted version. **Rejected as the UI.** |
| **scratch-vm 4.8.115** (npm, 2024-11-25) | The real Scratch 3 interpreter, last version before the relicensing (5.0.0, released the same day, is AGPL-3.0-only; checked on npm) | **BSD-3** | **Chosen interpreter** (§5). Frozen, but the language semantics we need don't change. It runs without a renderer and in Node. |
| TurboWarp scratch-vm | A maintained fork of the BSD code, with a JIT compiler | BSD-3 + MPL-2.0 for TurboWarp's changes | The alternative if 4.8.115 causes trouble: faster and maintained. MPL means we must publish only changes to their files. |
| Snap! | A different block language | AGPL | It looks different from Scratch. Rejected. |
| Whisker (Univ. Passau) | Automated testing of whole Scratch projects running in scratch-vm | GPL-3.0 | Research grade and heavyweight. Its ideas are useful: tests as inputs plus observed outputs, and a step budget. |
| LitterBox (Univ. Passau) | Static analysis (bug patterns, smells) of .sb3 files, in Java | GPL-3.0 | Java plus GPL. Use it as a catalogue of ideas for structural feedback, not as code. |
| Moodle `qtype_blocklymoodle`, NextBlocks | Blockly in Moodle (code generators to JS/Python) | GPL (Moodle) | Old (Moodle 3.2) or not Scratch-like. Not reusable, but they show there is no ready Scratch question type. |

**The key finding:** scratch-blocks 2.0 is now an ordinary Blockly 12 application. So "real Scratch look" (A) and "plain Blockly + zelos" (B) share the same API: workspace, serialization, locks, events. The rest of the system can sit behind one small `BlockEditor` adapter, and switching between A and B costs only the block-definition file. That makes it safe to start with a short spike (§9 P0) instead of betting on one.

## 3. Recommended architecture

```
            teacher builder (HTML app, like chemical-question-builder)
                         │  .scratchq (JSON)
                         ▼
┌──────────── scratchq library (platform-agnostic, browser + Node) ──────────────┐
│ ProgramModel  - AST with Scratch opcodes; importers: sb3, Blockly JSON,        │
│                 scratchblocks text; exporters: Blockly JSON, scratchblocks     │
│                 text, sb3 project.json (for the VM)                            │
│ Runner        - headless scratch-vm 4.8.115: virtual clock, seeded random,     │
│                 answers for "ask", captures say / variables / lists, budget    │
│ Checker       - tests + structural rules + rubric -> score + feedback ids      │
│ BlockEditor   - adapter over Blockly (scratch-blocks 2.0 or zelos definitions) │
│ ProgramView   - read-only render (the same editor read-only, or scratchblocks) │
│ TraceAnswer   - answer form for K1 (fields / say-log table)                    │
└─────────────────────────────────────────────────────────────────────────────────┘
                         │
          Moodle container: the same route as chemistry/math
          (STACK-JS now -> the kbdcore qtype later; browser or Node grading)
```

This follows the patterns already used in chemistryLib and CAVectors:
- The library knows nothing about Moodle.
- The rubric uses error ids, a suppression hierarchy and review options.
- A teacher "mistakes" list gives targeted feedback.
- Moodle pages hold data plus a tiny loader, because Moodle escapes `<`, `>` and `&` in pasted scripts.
- The checker runs in Node with no DOM, so it can share the planned grading service with chemistry and math.

### 3.1 Program model

> **Changed at implementation (2026-11-26):** the format of record is **Scratch's own .sb3 block format** (the flat `blocks` map of one sprite, plus `variables` and `lists`), not a separate nested AST. The VM runs it, scratch-blocks edits it through the VM, and .sb3 files import and export it with no conversion. Checks walk the flat map. The text below is the original proposal.

- **Our own nested AST** (a script is a list of blocks; inputs hold blocks or literals) whose block ids are the **Scratch opcodes** (`control_repeat`, `data_setvariableto`, `operator_add`, `looks_say`...). The opcodes match the .sb3 `project.json` format and scratch-blocks, so import from real Scratch is almost a direct mapping.
- I don't store Blockly JSON as the format of record. Blockly JSON carries UI details (x/y, shadow ids) and ties the question files to a library version. sb3's flat parent/next map is awkward to check.
- **sb3 import** is a big win for teachers: they build the program in real Scratch, choose *File → Save to your computer*, and drop the .sb3 into the builder. The builder unzips it, takes one sprite's scripts, and reports any blocks outside the supported subset.
- Every block carries flags: `locked` (cannot move or delete), `fixed` (fields not editable) and `gap` (an empty slot the student must fill).
- To run a program, the AST is converted to a minimal `project.json`: a stage plus one sprite with a tiny inline costume, with the variables and lists declared. The AST stays the format of record, because the checks and mutants (§6) work on it.

### 3.2 STACK as the container (decided)
Exactly the chemistry STACK-JS pattern (chemistryLib/STACKJS-DESIGN.md):
- The question text holds a `[[iframe]]` with one line: a box, the question config as JSON with no `<`, `>`, `&` or line breaks, and a tiny loader. All other code is in the library on GitHub Pages. Moodle escapes those characters in pasted scripts, which is why.
- `ans1` holds the score (0..1), which the PRT reads. **As in the math question (decided by the user, 2026-11-26):**
  - **`ans2`** holds the state as `"sq1:" + base64(UTF-8 JSON)`: letters, digits, `+ / =` only, so STACK's string input never rejects it, however long the program. The JSON is `{v, program (AST, for edit kinds) | answers (for Trace), seed, grade, feedback}`.
  - **Model answer:** the state input's model answer is a **question variable** `sqmodel: "sq1:…";`, because the model answer field holds only 255 characters. Its value is the reference as a whole state, so Moodle's "Fill in correct responses" shows the reference program.
  - **The score** is written as 0, 1 or a fraction (`2/5`), so "Forbid float" doesn't matter.
  - Both inputs need `hideanswer`.
- Review: the inputs are read-only, so the frame shows the student's program read-only together with the feedback.
- Randomization: STACK's random seed (or a value from the question variables) is passed to the frame. The trace data and the random tests are generated from it, so a regrade or review sees the same values.
- Grading runs in the browser (inside the frame), as in chemistry today. So the score can be forged, as noted in the qtype design. The library already runs in Node, which allows a move to server grading later.
- Size: scratch-vm is ~1–2 MB minified. It is loaded once from GitHub Pages and cached. The spike measures a custom bundle without render, audio or extensions.

## 4. Supported subset and what makes Scratch hard

Running Scratch "properly" is hard mainly because of **concurrency** (several scripts take turns at yield points every frame), **time** (wait, timer, glide) and **the stage** (sprites, touching, fencing, rendering). Excluding those three gives a small, sequential, deterministic language.

With scratch-vm (decision 1), the VM already implements concurrency and time correctly. So the exclusions below are no longer about implementation cost. They are about **what can be checked deterministically and what grades 7–9 need first**. Time still matters: `say … for 2 secs` is common in grade 7, so the Runner uses a **virtual clock** (§5.2) and never waits in real time.

v1 for grades 7–9: green flag; say/think (with or without secs); ask/answer; variables; repeat, repeat until, if, if/else; all operators; pick random. Lists come in P1b (grade 9 algorithms).

| Area | Blocks | v1 | Reason / complication |
|---|---|---|---|
| Events | when green flag clicked (one script) | ✔ | The single entry point. |
| | broadcast **and wait** + when I receive (one receiver) | P3 | Equals a procedure call, so it stays sequential. |
| | broadcast (no wait), several hats, key/click hats | ✘ | Concurrency: the result depends on thread interleaving, which is hard to teach and to check. |
| Control | repeat, repeat until, if, if/else, stop (all / this script) | ✔ | Infinite loops are caught by a step budget ("the program did not stop"). |
| | forever (+ stop) | P2 | Without a stage, `forever` only makes sense together with `stop`. |
| | wait (secs) | ✔ | Virtual clock: costs no real time. |
| | wait until, clones | ✘ | Meaningful only with concurrency. |
| Variables | set, change, variable reporter, show/hide variable (ignored) | ✔ | Single sprite, so "for all sprites" and "this sprite only" are the same. |
| Lists | add, delete, delete all, insert, replace, item, index of, length, contains | P1b | Essential for algorithm exercises. Scratch details: indices start at 1, plus "last"/"random"; an out-of-range index gives "" or does nothing. |
| Operators | + − × ÷, mod, round, mathop (abs, floor, ceiling, sqrt, sin/cos/tan **in degrees**, ...), < = >, and/or/not, join, letter of, length of, contains | ✔ | **Scratch type coercion** is the main trap, see §5.2. |
| | pick random | ✔ seeded | Grade by properties or exclude it from exact tests; see §6.4. |
| My Blocks | define + call with number/text/boolean parameters, recursion | P3 | Easy for a sequential interpreter. "Run without screen refresh" has no meaning here. |
| Sensing | ask and wait + answer | ✔ | The program's **input**: a test supplies a queue of answers. |
| | timer, mouse, key pressed, touching, distance | ✘ | Need time or the stage. |
| Looks | say / think (with or without secs) | ✔ | The program's **output**: a log of what was said. |
| | costumes, size, effects, layers, show/hide | ✘ / P4 | Visual state. Could later be numbers in the state (costume #, size). |
| Motion | move, turn ↻ / ↺, go to x y, glide secs to x y, point in direction, change / set x, change / set y, x position, y position, direction | ✔ (0.2.0, 2026-11-26) | The VM computes these without a renderer. There is no fencing: the sprite may leave the stage (Scratch would stop it at the edge). Every test starts at (0, 0), direction 90, pen up. Glide runs on the virtual clock (the VM's own glide uses a real-time Timer, so the Runner replaces it). Not included: if on edge bounce, go to random / mouse, point towards, rotation style (need the stage or the mouse). |
| Pen | erase all, pen down, pen up | ✔ (0.2.0, 2026-11-26) | Decided: checked **without showing the drawing**. The Runner records a segment for each move of the sprite while the pen is down. The drawing = the segments merged: collinear segments that touch or overlap are one, a segment has no direction, order does not matter, a dot is dropped. Two drawings are the same when every line has a partner with both ends within 0.5. Feedback names the missing and the extra lines as (x, y) – (x, y). Colour and size are not checked (their blocks are not in the palette). scratch-blocks has no pen blocks: the editor defines them. |
| Sound, extensions, multiple sprites, stage scripts, cloud variables | | ✘ | Out of scope. |

## 5. Interpreter

### 5.1 Decision: scratch-vm 4.8.115 (BSD-3), headless

| | scratch-vm 4.8.115 (**chosen**) | TurboWarp vm (alternative) | Current scratch-vm 5.x/15.x | Own interpreter (fallback) |
|---|---|---|---|---|
| License | BSD-3 | BSD-3 + MPL-2.0 | AGPL-3.0-only, so ScratchQ would have to be AGPL too | Ours |
| Fidelity | Exact (it is Scratch) | Near-exact | Exact | Only as good as the conformance suite |
| Maintenance | Frozen (Nov 2024) | Maintained | Maintained | Ours |
| Speed | Frame-based; we drive its steps ourselves | JIT compiler, fast | As 4.8 | Fast |
| Later language growth (broadcast, motion, clones) | Free | Free | Free | Each feature is our work |

Why 4.8.115: "freely available" in both senses, exact semantics, and none of the type-coercion traps (old §5.2) have to be re-implemented. Being frozen is acceptable: the Scratch 3 language hasn't changed, and the VM runs in a sandboxed frame with no network role. We stay pinned to that exact version and never upgrade to 5.x by accident.

### 5.2 The Runner (our wrapper around the VM)

All of the following must be verified in the P0 spike.
- **Load:** `vm.loadProject(projectJson)` with no renderer or audio attached; the costume is a tiny inline SVG through scratch-storage.
- **Run without real time:** `greenFlag()`, then call the runtime's step function in a loop until no threads remain. Stop at a step or tick budget and report "did not stop".
- **Virtual clock:** the VM's `Timer` reads the time through an injectable "now" object. The Runner replaces it with a clock that advances by a fixed amount (1/30 s) per step. Then `wait 2` and `say … for 2 secs` finish in ~60 steps and no real time.
- **Seeded random:** replace `Math.random` with a seeded generator while a test runs.
- **Input:** a queued answer is fed to each `ask` (the VM emits a question event and waits for an answer event). If the queue is empty, the result is "the program asked more than expected".
- **Output:** listen to the VM's say/think event to build the **say log** (each entry: text, say/think, the step it happened at). After the run, read the final variables and lists from the stage and the sprite.
- **Trace table** (optional, later): via the VM's profiler / block-execution hooks, or by instrumenting the program. To be investigated.
- **Bundle:** the browser build is made with webpack from the npm package, without scratch-render, scratch-audio or the extensions (the spike measures the size). In Node the VM runs from the package directly.

### 5.3 Scratch semantics that become free with the VM

We **no longer implement** these, but the K1 answer comparison and the test design must know them:
- **Casting:** "" counts as 0 in arithmetic; a non-numeric text counts as 0; `"10" + 5 = 15`; true/false become 1/0 in arithmetic.
- **Comparison:** if both sides look numeric, compare as numbers; otherwise compare as case-insensitive strings (`"apple" = "APPLE"` is true; `"10" < "9"` is false because both are numbers).
- Division by 0 gives Infinity or −Infinity (0/0 gives NaN, shown as 0 where Scratch does). `mod` is floored, so the result has the sign of the divisor. `round` rounds .5 up (JS `Math.round`). Trigonometry is in degrees and Scratch rounds the results (sin 180 = 0).
- **Number display** in say and the answer: Scratch shows JS number strings (`0.1 + 0.2` shows `0.30000000000000004`). The K1 answer comparison must have a numeric tolerance so students are not penalised for this.
- `letter (n) of`, `item (n) of list`: start at 1; out of range gives "".
- `repeat (n)`: n is rounded; n ≤ 0 runs zero times. `repeat until`: the condition is checked before each iteration.

### 5.4 Runner tests
A small suite of programs with known outputs (each subset feature, the casting traps, the virtual clock, ask/answer, the budget). It runs in Node on every library change, so a change to the Runner or the bundle can't silently change results.

## 6. Checking correctness

### 6.1 Tests (black-box, the main mechanism)
A test is: initial variable and list values, plus the answers to `ask` → the observed **say log**, final variables, final lists (later, the pen segments and sprite x/y).
- **The teacher never types expected values.** The builder runs the teacher's **reference program** on each test, and the expected results are whatever it produced. The teacher only chooses the inputs and *what is observed* (for example "only the say log", or "only variable `sum`").
- Visible tests (shown to the student in feedback) vs hidden tests.
- **Random tests:** generated inputs within teacher-given ranges, seeded per attempt. This defeats hard-coding (`say 42`).
- Outcomes per test: pass, wrong output, did not stop (step budget exceeded), runtime problem (for example an unknown variable after an import).

### 6.2 Structural rules (static), from P3 (decision 3: tests first)
- Must use / must not use a block (for example "use `repeat`, not 10 copies of `move`").
- At most N blocks; the program must not consist of literals only (anti hard-coding).
- Locked blocks unchanged (the editor enforces this; the checker double-checks it, since the browser can be bypassed).
- K4 Fix: how far the program is from the original (tree edit distance), to reward a minimal fix if the teacher wants that.
- K2/K3: compare with the reference structure, for partial credit when the tests fail.

### 6.3 Teacher mistakes, i.e. diagnosing the misconception
As in chemistry `config.mistakes`, but powered by the interpreter:
- **Mistake programs:** the teacher adds a wrong program (for example the loop starts at 0). If the student's output equals that program's output → a specific feedback message.
- **Built-in mutants** for K1 Trace: the system **rewrites the program's AST** to reflect a known misconception and runs each rewritten copy on the same VM. If the student's answer matches one, they get feedback on that misconception. Examples:
  - `repeat (n)` → `repeat (n−1)` and `repeat (n+1)`;
  - list item `i` → `i+1` (counting from 0);
  - `repeat until` condition tested after the body;
  - a `change` inside the loop moved after it (the variable not updated inside the loop);
  - `join` replaced by `+`;
  - the `if` branch always taken, or never.

  Mutants are program transformations, so they work with the real VM, and the list can grow without touching the interpreter. This needs no teacher work and gives strong feedback; it is the most original part of the design.

### 6.4 Randomness
`pick random` uses a seeded generator. Tests then check **properties** ("the value is between 1 and 6", "every item of the list is in the range") instead of exact output. Alternatively the teacher disallows `pick random` in that question.

### 6.5 Score
Through the existing rubric format: categories (tests, structure, mistakes) with weights, error ids with feedback text, and suppression (when every test fails, no structural nags are shown).

## 7. K1 Trace questions in detail (the "simpler version")
- Display: read-only program. The program comes from teacher **parameters** (`set [n] to ({{n}})`, a list of random values), so each student gets their own values, as STACK random variants do.
- The answer form is chosen by what is observed:
  - final value of variable(s): one field per variable;
  - the say log: an ordered list of lines (the student adds lines);
  - final list contents;
  - "how many times does `say` run", "which branch runs": number field or multiple choice.
- The expected answer comes from the interpreter. The comparison tolerates numbers (`5` = `5.0`), whitespace and, optionally, case.
- Feedback: built-in mutants (§6.3) plus an optional **trace table** in review (step, block, variables), generated by the interpreter.
- This needs **no editor at all**. Display can be done with scratchblocks (small, MIT) or with the editor read-only. That is why K1 is the first phase.

## 8. UI details
- Languages (decided):
  - **Blocks are always in English** and the block area is LTR (`dir="ltr"` on its container; Blockly `rtl: false`).
  - Everything around the blocks can be **Hebrew, Arabic or English**: the instructions (the STACK question text), the buttons, labels, answer form and feedback. That part is RTL for Hebrew and Arabic.
  - The library has a message catalogue (`he`, `ar`, `en`) for its own texts. The teacher writes the question-specific feedback in the question's language. The language comes from the config (or the Moodle page language).
  - Strings inside blocks (`say [שלום]`) may be Hebrew or Arabic. The spike checks bidi rendering inside an LTR block, and Hebrew text in the K1 say-log answer form.
  - Variable names: the teacher's choice. English is recommended; the spike checks Hebrew names.
- The palette (toolbox) per question: only the categories and blocks the teacher allows, with optional `maxInstances` (for example exactly 3 `move` blocks in Parsons).
- Variables: the teacher predefines them. "Make a variable" is allowed per question.
- Gaps: shown as empty slots, or a highlighted placeholder block ("put a block here").
- Optional "Run" button (teacher's choice, off in exams): runs the visible tests and shows the say log and the variables, but not the stage. It would bring the familiar "green flag" loop without a stage.
- The review page: the student's program read-only, with blocks highlighted per feedback id.

## 9. Phases

| Phase | Content | Rough size |
|---|---|---|
| **P0 spike** | (a) **Runner:** scratch-vm 4.8.115 headless in Node and in the browser; virtual clock, seeded random, ask/answer, say capture, budget; measure the bundle size. (b) **Editor:** scratch-blocks 2.0 standalone vs Blockly 12 + zelos, with English blocks inside an RTL page, locking, a gap slot, serialization; decide A or B. (c) A STACK-JS frame on the real server loads the VM bundle, tries a download (§11.3 A), and a responses report is downloaded to read the `ans2` format (§11.3 C). | 3–4 days |
| **P1 Trace** | ProgramModel, sb3 + text import, AST → project.json, Runner, read-only display, K1 answer form, built-in mutants, he/ar/en messages, STACK-JS container (§3.2), builder tabs (program, parameters, answer, preview/export) | 3 weeks |
| P1b | Lists (grade 9) | 1 week |
| **P2 Editing + tests** | BlockEditor adapter, K2–K5, tests from a reference program, random/hidden tests, the rubric with test categories, mistake programs, builder tabs (task/locks/toolbox, tests, feedback) | 4–5 weeks |
| P3 | Structural rules, My Blocks, broadcast-and-wait, forever + stop, the run button and trace table | 2–3 weeks |
| P4 | Motion + pen with geometric checking and a small canvas preview (could move earlier, grade 7) | 2 weeks |
| Moodle qtype | Later, if STACK becomes limiting: a third thin qtype on the shared `local_kbdcore` plugin; Node grading in the same service as chemistry/math | with the qtype project |

## 10. Main trade-offs (summary)

1. **Exact Scratch look (scratch-blocks 2.0) vs stability (Blockly + zelos).** Because 2.0 is Blockly-based, this is a reversible choice behind an adapter. Start with the look; fall back if the API is still moving or it needs the VM too much.
2. **Embedding real Scratch (scratch-gui) vs building a question UI.** Embedding gives perfect familiarity but no control: no locks, no palette restriction, it shows the stage, it is heavy, and it is AGPL. Rejected.
3. **Real VM (decided) vs own interpreter.** We get exact semantics, and later language growth costs little. In return:
   - we depend on a frozen 2024 package;
   - the bundle is bigger (~1–2 MB);
   - we must drive the VM's frame loop and clock ourselves (the main spike risk).

   The fallback is TurboWarp's vm, or our own interpreter for the small subset.
4. **Small sequential subset (decided) vs full Scratch.** With the VM, this is about checking and pedagogy, not implementation cost. The cost: no "game-like" exercises (keys, collisions, several sprites), which are what Scratch is famous for. Motion and pen (P4) bring back some of the visual exercises.
5. **Tests from a reference program vs teacher-typed answers.** Less teacher work and no answer typos, but the reference must be right. The builder shows every test's result so the teacher can see what is expected.
6. **Black-box tests vs structure.** Tests accept any correct solution but can be fooled by hard-coding (fixed by random/hidden tests) and give little partial credit. Structure gives partial credit but rejects unusual correct solutions. Hence tests are primary and structure optional, both in the rubric.
7. **Browser grading vs server grading.** As in the qtype design: browser grading is simple, but the score can be forged; Node grading is trustworthy and supports regrading. The library supports both.

## 11. Teacher builder

### 11.1 Same skeleton as chemistry and math
The builder keeps the five tabs of `chemical-question-builder.html` and `mathCheckPlayground.html`. The open tab is remembered, and a tab that needs fixing shows ⚠. It has the same two outputs:
- the **exercise file** `.scratchq`: the builder's whole JSON;
- the **minimal question code**: only what the library reads, with no `<`, `>`, `&` or line breaks.

| Chemistry tab | Scratch tab | Contents |
|---|---|---|
| 1 Keyboard | **1 Palette** | Question kind (K1–K5), the palette (allowed blocks, counts, predefined variables and lists), the language of the surrounding UI, a preview of the student's workspace |
| 2 Checker | **2 Checker** | The **reference program** (block editor), test cases and what is observed, the reference's results live, a "student attempt" program graded live (K1: the answer form and parameters) |
| — | Rubric (inside tab 2, as in chemistry) | Weights per test group (visible / hidden / random), "did not stop", later the structural rules |
| 3 Didactics | **3 Didactics** | The **starting program** (= the initial answer), its locks and gaps; built-in mutants (on/off, messages); teacher mistake programs or wrong outputs; messages in he / ar / en |
| 4 Exercise file | **4 Exercise file** | New / Open / Save / Save as, **+ Import .sb3**, **+ Export .sb3** |
| 5 Question code | **5 Question code** | STACK inputs, "Try it as a student", Copy / Save the code |

### 11.2 What is different, and the approach for each

1. **Reference and starting program = reference and initial answer (decided by the user, 2026-11-26).**
   - **Same as chemistry and math:** the same editing tool (the block editor) creates both. The reference is edited in tab 2 (Checker). The starting program is edited in tab 3 (Didactics), and "Start from the reference" copies the reference in. As in chemistry, the starting program shows "graded as an answer it would get X%", and a warning if it already passes every test.
   - **What Scratch adds:** two marks that exist only on the starting program, set from the block's right-click menu in tab 3:
     - *lock* (the block cannot move or be deleted);
     - *lock fields* (its values cannot be edited).

     A gap is just an empty slot left in the starting program. For K2 Parsons, "Scatter the blocks" puts every block of the reference into the palette, plus any distractor blocks the teacher adds.
   - **The cost:** the two programs are independent, as in chemistry. A later change to the reference isn't carried into the starting program. Tab 3 shows the differences from the reference, so the teacher sees what the student must do.

2. **The question kind reshapes the builder.**
   - **What differs:** chemistry has one interaction.
   - **Approach:** a kind selector at the top of tab 1. It shows or hides the relevant controls: K1 has no palette and its tab 2 is "Answer"; K2 needs the scrambled-block settings; K3/K4 need the overlay marks.

3. **The expected result is computed, not typed.**
   - **What differs:** in chemistry the teacher types the correct answer.
   - **Approach:** tab 2 runs the reference on every test and shows each result as the expected output (say log, variables, lists). The teacher only chooses the inputs and what is observed. The checks are new kinds:
     - ⚠ the reference must finish within the budget and give no runtime problem on every test, **including the random ranges** (the builder samples about 50 seeds);
     - ⚠ for K3/K4, the **starting program must fail** at least one test. It is the analogue of chemistry's "the initial answer is already correct" warning;
     - ⚠ every observed variable and list must exist in the program.

4. **Random variants.**
   - **What differs:** a K1 trace question gets its data from parameters (`n` in 3..9, a random list). Chemistry has nothing like this.
   - **Approach:** a parameters table in tab 2 with **"Show 5 variants"**. Each variant shows the program with its values, the correct answer, and what each mutant would answer.

5. **Didactics means misconceptions, not only wrong answers.**
   - **What differs:** in chemistry a mistake is one wrong answer.
   - **Approach:** in Scratch there are three sources:
     - (a) the **built-in mutants**: a list with on/off and an editable message;
     - (b) **teacher wrong outputs** for K1: like chemistry, a typed wrong answer with a score and a message;
     - (c) **teacher mistake programs** for K2–K5: a wrong program built in the editor.

     Matching is by **behaviour**: the student's outputs on the tests equal the mistake's outputs. It is not by program equality, because many programs make the same mistake.

     One check is unique to this question type: **collisions**. With some data, a mutant gives the same output as the correct program; for example, the off-by-one mistake doesn't show when the loop runs 0 times. Two mutants can also coincide with each other. The builder warns per variant and suggests ranges where the mistakes are distinguishable. This is the didactic heart of the K1 builder.

6. **Programs come from outside.**
   - **What differs:** teachers already write Scratch in Scratch.
   - **Approach:** tab 4 can **import a .sb3**. The teacher picks a sprite and script, and the builder lists any blocks outside the supported language. **Export .sb3** opens the reference (or a student attempt) in real Scratch to see it run. Pasting scratchblocks text is a later option.

7. **The palette is the analogue of the keyboard settings.**
   - **Approach:** tab 1 has a tree of categories and blocks with checkboxes and counts (`maxInstances`), and predefined variables and lists. A **preview** shows the student's workspace exactly as it will appear (palette, locks, gaps, English blocks in the RTL page).

8. **Secrets in the question code.**
   - **What differs:** with browser grading, whatever the library needs is in the page. In chemistry that is one answer; here it is the reference program and the hidden tests.
   - **Approach:**
     - K1 needs no secret, because the answer is computed from the program the student sees anyway.
     - For fixed tests, the code can carry only **hashes of the expected outputs** instead of the reference.
     - Random tests need the reference itself, which the code carries lightly obfuscated, not encrypted. This is a known limit; the real fix is server grading in the future qtype. The builder says which mode the question is in.

9. **Size of the question code.**
   - Programs are larger than a chemical formula. The embedded AST uses a compact encoding (short keys, numbers for opcodes). A builder message warns if the question code passes a size limit (to be measured in STACK).

10. **The builder includes the interpreter.**
    - Tabs 2 and 3 run the VM all the time. Runs are cached per program and test and re-run only after an edit, so the builder stays responsive. Builder and student use the same pinned VM, so what the teacher sees is what the student gets.

### 11.3 Exporting a student's answer as .sb3 (deferred by the user, 2026-11-26)

The user: "leave the copy student's answer to sb3, this will likely require a change in Moodle code; I'll figure it later." The notes below are kept for then. The builder's own **Export .sb3** of the reference or the starting program is not affected.

The student's program is stored in `ans2` as AST JSON. An `.sb3` file is a zip containing:
- `project.json`: the same conversion the Runner already does, plus block positions (scripts laid out top to bottom), variables and lists;
- a backdrop SVG and a costume SVG. We draw our own neutral shape rather than the Scratch cat, which is the Scratch Foundation's character. Each asset file is named by its MD5 hash, as the format requires.

JSZip is already a dependency of the VM. So **one library function, `toSb3(program, {name, comment})` → Blob**, serves every route below. An optional Scratch comment on the script carries the score and the failed tests, so the teacher sees them when the project is opened in Scratch.

Three routes, from one student to the whole class:

| Route | Where | How | Notes |
|---|---|---|---|
| **A. Button in the review** | The question frame, when it is in review (inputs read-only) | "⬇ Download as Scratch (.sb3)" next to the student's program | One click, for one student: the teacher opens the attempt (Results → Responses or Manual grading → Review attempt). The frame can't tell a teacher from a student, so the button shows for whoever sees the review. Students can then take their program home and run it. A builder review option turns it off. **Needs a probe:** does STACK-JS's iframe sandbox allow downloads (`allow-downloads`)? |
| **B. Copy → builder** | The same review frame + the builder | "Copy program" puts the JSON on the clipboard; the probe already showed that the frame may write to it. In the builder: **Open student answer…** (paste) → Export .sb3 | The fallback if the sandbox blocks downloads. It also puts the student's program into tab 2 as the "student attempt", so the teacher can see why it was graded as it was. |
| **C. Whole class** | Moodle Quiz → Results → **Responses** → Download (CSV / Excel) + the builder | In the builder: **Import responses…** reads the file and, from the STACK response summary column, takes each student's `ans2` JSON. Output: a zip of `.sb3` files named `<name>_<attempt>_q<n>.sb3`, plus a table of score / failed tests / matched mistake per student | Runs entirely in the teacher's browser; the student names never leave it. It also gives the class view: how many students made each mistake (analogous to item analysis). **Needs a probe:** does the response summary contain the whole `ans2` string unshortened, and how are its quotes escaped? |

Recommendation: **A + B in P1**. A gives one click for the usual case; B is the safe fallback and is also needed for debugging grading. **C in P2**, when editing questions arrive and whole-class review becomes interesting. C is also the cheapest way to get class statistics, which STACK can't give for JSON answers.

Probes to add to the P0 spike: (1) a download from the STACK-JS frame; (2) one STACK response report downloaded, to read the summary format.

### 11.4 What stays exactly as in chemistry and math
- The exercise file vs minimal code split, Open of old code, Save to the same file.
- The STACK inputs and "?" help, "Try it as a student" + Submit, review options.
- Messages in three languages, the rubric row format, `window.builder` as the test hook.
- The data-plus-loader snippet.

## 12. Implementation 0.1.0 (2026-11-26)

### 12.1 Files (folder `ScratchQ`)

| File | What it is |
|---|---|
| `scratchq.js` | The core, no DOM: the program → project.json conversion, the **Runner**, the **Checker**, the trace grading, the messages (he / ar / en), the STACK state (`sq1:` + base64). |
| `scratchq-editor.js` | The block editor: scratch-blocks 2.2.16 on an editing VM (the Scratch GUI's way), the palette, locks, read-only view. |
| `scratchq-question.js` | The student side: `mountStackJs` / `mount` / `runQuestion`, for both the trace and the program kinds, with the review. |
| `scratch-question-builder.html` | The teacher's builder: five tabs. |
| `examples/sum-1-to-n.scratchq` | An example "fix" question: the loop runs one time too few; `say` is locked with its values; one common mistake (adds 1 instead of i). |
| `tests/` | `run-page.mjs` drives headless Edge (DevTools protocol), with optional screenshots. The test pages: `runner-tests.html` (21), `editor-tests.html` (16), and the builder self-test `scratch-question-builder.html?selftest` (23). All pass. |

How to run the tests: `node tests/run-page.mjs tests/runner-tests.html`. `SHOT=file.png` saves a screenshot, and `FULL=1` makes it the whole page.

### 12.2 What the spike found (P0 a and b done; c, the STACK server, still open)

- **scratch-vm 4.8.115 runs headless** in the browser (the 5.7 MB jsDelivr build, no renderer, no storage; the missing costumes only log warnings).
  - **Virtual clock:** the Runner replaces `runtime.updateCurrentMSecs`.
  - **Say for secs:** `say/think … for secs` use a real `setTimeout` in the VM, so the Runner replaces them with the wait logic.
  - **Work slice:** the frame's work slice is 0.75 ms (`currentStepTime = 1`). A waiting thread counts as active and would use the whole slice: with the default slice, 6 virtual seconds took 718 ms; now they take 180 ms.
  - **Speed:** 10,000 loop rounds take 6 ms. A program that never stops is cut off by the Checker after 400 ms per test.
  - **Random and the sprite:** `pick random` is seeded by swapping `Math.random` during each step. The sprite is hidden, so `ask` shows no bubble.
- **scratch-blocks 2.2.16** is one ES module with Blockly 12.5 inside it, loaded from jsDelivr with no build.
  - It needs a theme with a style per category. A Blockly base theme breaks it ("Invalid colour"), so the theme has no base.
  - The VM's `blockListener` and the `workspaceUpdate` XML work as in the Scratch GUI.
  - Blockly fires the load events a moment later, so the editor reports a change only when the program's blocks differ from the last ones (positions are ignored).
- **Locks:** Blockly's own flags are not enough, because dragging an unlocked block carries the locked ones below it. The editor checks after every change that each locked block is still in its original script, and undoes the change if not. Putting new blocks between locked ones is allowed.
- **STACK escaping:** Scratch's blocks are nested arrays, so the code's JSON has `]]` outside strings. Inside strings it gets `\u` escapes; outside strings, a space (`] ]`).
- **.sb3:** `vm.saveProjectSb3()` works without assets (about 1 KB), and `loadProject(arrayBuffer)` imports.
- **Several VMs on one page (found with the pen, 0.2.0):** the VM registers an extension's blocks through a dispatcher shared by all the VMs of the page, which talks to the VM created last. A VM created while another loads takes the other's pen blocks, and the other's "pen down" does nothing. The Runner therefore creates and loads its VMs one at a time (a queue), and loads once more if the pen blocks are still missing.
- **Glide** uses its own real-time Timer in the VM (not the runtime's clock): the Runner replaces it with the same movement on the virtual clock.
- **In Moodle (2026-11-26):** the frame's height counted the palette's blocks scrolled out of sight (fixed: an element that clips its content counts by its own box); a value typed in a field reached the VM only when the field closed, so pressing Check right after typing graded the old program (fixed: the typed value goes to the VM at once, and the frame's blur grades a pending change). `ScratchQ.DEBUG` (or `debug: true` in the question) logs the steps to the console.

### 12.3 Not done yet
- **The STACK probe on a real server:**
  - the ES module import of scratch-blocks inside the STACK-JS frame;
  - the 5.7 MB VM load time;
  - the frame height.
- **A slimmer VM bundle.**
- **Trace questions:** the built-in mutants (§6.3) - not wanted for now (§12.5); random values done (§12.5).
- **Parsons** (K2) and **structural rules** (§6.2).
- **The builder's interface language:** English only, like the math playground.
- **Hosting:** done - the library is on GitHub Pages, `https://avinat.github.io/ScratchQ/` (repository AviNat/ScratchQ).
- **Pen:** a trace question about a drawing - not wanted for now.

### 12.4 The drawing shown (user, 2026-11-27; lib 0.3.0, question 0.2.0)
- **Pictures, not coordinates.** Lists of segments were too detailed: a drawing moved, turned or reflected lists every line as wrong. The builder and the feedback no longer list coordinates. The feedback gives only counts: "{e} lines were expected; your program drew {g}" (or "the drawing is not the expected one"), then "{m} of the {e} expected lines are drawn as expected".
- **No transformation analysis**, and no acceptance of a moved or turned drawing. There are too many cases: the teacher grades those by hand from the pictures.
- `ScratchQ.Drawing.svg(segments, { grid, axes, width, fit })` draws an SVG as text. The view fits the drawing and (0, 0), on whole grid squares. `fit` puts two pictures side by side on the same scale.
- **The builder (tab 2):** "The reference's drawing" for a chosen test, with Grid and X/Y axes options, **Copy SVG** and **Download .svg** for the question's text. The tests and the attempt show small pictures.
- **The question:** `drawing: { answering, review, grid, axes }`, only when the drawing is checked. *While answering*: the student's drawing under the editor, drawn again after each change (off by default, the earlier decision 9). *In the review*: the student's drawing and, when the review shows the reference, the correct one beside it on the same scale (on by default, for grading by hand). The picture is of the first test that is not hidden.

## 12.5 Trace questions: the design decisions (user, 2026-11-27; implemented: lib 0.4.0, builder 0.2.0)

The open points of §7 (random values), §6.3 (built-in mutants) and §11.2 items 4–5, asked as 14 questions.

**As built:** `scratchq.js` - `Params` (candidates, parseValues, makeVariants, apply, withVariant), `Trace` (ifBlocks,
blockOrder, branch texts), the Runner records `branches`, `gradeTrace` matches the teacher's mistakes.
`scratchq-question.js` - the variant applied before display and grading, radio buttons for "which branch",
`mountStackJs(stack_js, cfg, {#sqvar1#})`, the variant in the saved state. Builder - tab 2 "Random values" (a row per
set block, values, group, variants count, "Other variants", each variant's answer, the variant shown), "which branch"
items, tab 3 typed mistakes, tab 5 the part number, the variant to try, the question variables
(`sqvar1: rand(K); sqmodels1: [...]; sqmodel1: sqmodels1[sqvar1 + 1];`). Tests: `tests/trace-tests.html` (25), the
builder self-test (66). **To verify on a real STACK server:** `{#sqvar1#}` inside the `[[script]]` of the `[[iframe]]`,
and the question variables.

**1. Where the random values come from: the builder (decided).** The teacher gives the parameters and their ranges in
the builder; the library picks the values. The builder can then show variants and check them for collisions.
- **One seed from STACK.** The question variables hold one random number, e.g. `sqseed: rand(99999);`, and the
  question code passes it into the frame (`{#sqseed#}` inside the `[[iframe]]`). The same seed in the attempt, its
  review and a regrade, and for Moodle's deployed variants.
- **The variable's name:** `sqseed` by default, set in the builder. Reason: several Scratch questions in one STACK
  question (one frame each).
- **Several parts: a seed variable each** (decided): `sqseed1`, `sqseed2`, … in the question variables, `{#sqseed1#}`
  in the first part's code, `{#sqseed2#}` in the second's. No mixing of one seed between parts.
- **The model answer must work** (user): Moodle's "Fill in correct responses" is a feature to keep, and **the builder is
  the only interface** - the teacher writes no STACK syntax. The builder generates the question variables, copied
  with `sqmodel` as now.
- **Decided (20 variants by default, several parts kept):** STACK cannot compute the correct answer of random values (Maxima does not run Scratch), so
  the builder prepares **K variants** (e.g. 20): it picks the values (ranges, dealt value lists - 3 + 4), runs the
  program on each, and writes the correct answer of each. The code in the frame carries the table of the K value
  sets; the question variables (generated, copied as one block):
  `sqvar1: rand(20);  sqmodel1: ["sq1:…", "sq1:…", …][sqvar1+1];`
  The frame gets `{#sqvar1#}` (the variant's number) and takes that row. Then the model answer always fits the
  student's values, a later library change cannot make them differ (nothing is recomputed in the frame), and the
  builder can show every variant with its answer. This replaces the seed of the first decision: STACK passes the
  variant number. Several parts: `sqvar1` / `sqmodel1`, `sqvar2` / `sqmodel2`, … Size: a trace model answer is a few
  hundred characters, so 20-50 variants are fine.

**2. What can be random: numbers in `set` blocks only (decided, "2a").** The teacher marks the number in a
`set [n] to (…)` block as a parameter: a range and a step. The student sees the program with the picked number in
that block (`set n to (7)`) and follows `n` through the program; nothing shows that it was random. Not now: a random
number in any block (2c), random lists (2b - how a random list would be used is not clear yet), random texts.
- The question's text cannot show the values (they are picked in the frame, STACK does not know them).

**3 + 4. Parameters that must differ (decided).** A group of parameters takes its values from **one list of values**
given by the teacher, **shuffled with the question's seed**: each parameter of the group gets the next value, so no
two of them are equal (like dealing cards). A parameter outside a group has its own range.
- Collisions with the teacher's mistakes do not arise: mistakes exist only without random values (8).

**5 + 6 + 7. Built-in mutants: not now (decided).** Only the mistakes the teacher defines (8).

**8. The teacher's mistakes (decided): typed wrong answers, only in a question without random values.** Building a
wrong program is too much work for the teacher. As in chemistry: the wrong answer, a message (he / ar / en), a score.
The builder hides the mistakes when the question has parameters. A mistake matches when every answer field equals
the mistake's.

**9. The answer form: add "which branch" (decided).** Besides what the sprite says, a variable and a list.
- The teacher picks an `if / else` (or `if`) block **outside any loop** (decided; the builder does not offer one
  inside a loop). The student answers "the if part" / "the else part" (/ "neither" for an `if` without else).

**10. Scoring: weights and partial credit (changed 2026-11-28; first "no weights").**
- Each answer item (what the sprite says, a variable, a list, which branch) has a weight, 1 by default, set in the
  builder beside the item (`trace.items[i].weight`; 1 is not stored, 0 = not graded). The grade is the weighted mean
  of the items' credits.
- A sequence of values (the say lines, a list) gets partial credit: (n − edits) / n, where n is the number of expected
  values and an edit is a wrong, missing or extra value (an edit distance). A missing value does not make the ones
  after it wrong. Misordered values: a swap costs two edits (the values in place still count), and reversed values
  keep only what stays in place. (A first version gave 0 to any misordering; the user changed it 2026-11-28: a swap
  must keep the credit of the values in place.) Expected 1,3,5,7,9: 1,2,5,7,8 → 60%; 1,3,7,9 → 80%;
  1,3,4,5,7,9 → 80%; 1,5,3,7,9 → 60%; 9,7,5,3,1 → 20%.
- A variable and a branch are right or wrong. A teacher's mistake still matches only an exact answer, and its score
  replaces the grade.
- In the review a field is green (right), yellow (partly right) or red. Code: `sequenceScore`, `traceItemScore`
  in scratchq.js (lib 0.5.0); `gradeTrace` also returns `scores` and `weights`.

**11. What the sprite says: as now (decided).** One line per say, `[10] Hello` for repeats, in order.

**12. The display: the read-only block editor (decided)**, as now.

**13. Trace table in the review: not now (decided).**

**14. Answers to `ask`: not random for now (decided).** Fixed in the builder, as now.

## 13. Open questions for the user
1. ~~Hebrew UI~~ → decided (§0.4). ~~Grades~~ → 7–9. ~~Container~~ → STACK.
2. Grade 7 Scratch is usually taught through motion (move, turn, pen). Should motion + pen (P4) move before editing (P2)?
3. Which Moodle site and course for the first trial (STACK-JS needs a STACK version with `[[iframe]]`, as on Petel)?
4. Project folder name `ScratchQ` and library name are working names.
