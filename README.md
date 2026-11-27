# ScratchQ: developer guide

ScratchQ makes Scratch-program questions for Moodle (STACK-JS) or for any web page. A student writes or fixes a
Scratch program, or traces one. The browser runs the program on test inputs and grades it. Teachers make the
questions with a builder page.

- The design and all decisions: [SCRATCH-DESIGN.md](SCRATCH-DESIGN.md). Section 0 lists the decisions, section 11
  describes the builder and section 12 has the implementation notes.
- The library is served by GitHub Pages from `https://avinat.github.io/ScratchQ/`. Questions load it from there, so a
  change reaches Moodle only after it is pushed to `main`.

## Dependencies (from jsDelivr, nothing to install)

| Library | Version | Licence | Used for |
|---|---|---|---|
| scratch-vm | 4.8.115 (pinned) | BSD-3 | Runs the programs. 4.8.115 is the last release before the AGPL relicensing (5.0.0), so do not upgrade it. |
| scratch-blocks | 2.2.16 (pinned) | Apache-2.0 | The block editor, loaded as an ES module. |

To run the tests you also need Node.js and Microsoft Edge.

## Load order

```
scratch-vm.min.js  ->  scratchq.js  ->  scratchq-editor.js  ->  scratchq-question.js
(global VirtualMachine)  (ScratchQ)     (ScratchQ.Editor)       (ScratchQ.Question)
```

Each file checks that the files before it are loaded and throws an error if one is missing.

## Files

### The library (what questions load)

| File | Role | What it does |
|---|---|---|
| [scratchq.js](scratchq.js) | Core: running and checking. It works with any platform and uses no DOM. | Defines the **program format** (`{ v: 1, variables, lists, blocks }`, which holds Scratch 3 blocks of one sprite) and turns a program and a test into a `project.json` (`toProject`). **`ScratchQ.Runner.run`** runs a program on the VM for one test, with initial values, answers to "ask" and a random seed. It returns what the sprite said or thought, the final variables and lists, the pen segments, and the status (`done`, `timeout`, `noAnswer` or `error`). **`ScratchQ.Checker`** runs the reference and the student program on every test, compares only what the question observes (say lines, variables, lists, the drawing), recognises the teacher's common mistakes, and grades trace answers. **`ScratchQ.Drawing`** merges pen segments and compares two drawings with a 0.5 px tolerance. It also holds the feedback texts in he, ar and en (`TEXT`, `tr`), the `[10] Hello` repeat-line notation, and the saved state codec (`sq1:` + base64 JSON). Set `ScratchQ.DEBUG = true` to see console logs. Version `0.2.0`. |
| [scratchq-editor.js](scratchq-editor.js) | The block editor. Runs in the browser only. | **`ScratchQ.Editor.create(element, opts)`** places scratch-blocks on an editing VM, the way the Scratch GUI does. The workspace and the VM stay in step, and `getProgram()` reads the program back from the VM. It handles the **palette** (`{ blocks: [opcode…] }`, shown in Scratch's category order, and `toolboxXml`), the **locks** (the builder marks them with the right-click menu, and the student cannot break them), read-only view, and the block size (1.44× Scratch's size, palette included). It defines the block language (`CATEGORIES`, `ALL_BLOCKS`) with the palette's default inputs. Returns `{ workspace, vm, getProgram, setProgram, setPalette, getLocks, dispose }`. |
| [scratchq-question.js](scratchq-question.js) | Student side. All the question's runtime code is here. | **`ScratchQ.Question.mountStackJs(stack_js, config)`** runs inside a STACK `[[iframe]]`. It writes the score and the state to the STACK inputs (`ans1` and `ans2`) and resizes the frame. **`ScratchQ.Question.mount(element, config, options)`** works in any other system and supports `state`, `readOnly` (review) and `onChange`. It shows the editor, or the answer boxes for a trace question. It grades after every change and shows feedback in he, ar or en. In review it can show the reference program. It loads scratch-blocks itself. It also exports `startingProgram`, `runQuestion` and `scoreText`, which the builder uses. Version `0.1.2`. |

### The teacher tool

| File | Role | What it does |
|---|---|---|
| [scratch-question-builder.html](scratch-question-builder.html) | The builder, one page. It has the same five tabs as the chemistry and math builders. | **1. Question & blocks:** the kind (`program` or `trace`), the student's language, the palette checkboxes, and a preview of the student's workspace. **2. Checker:** the reference program, what is observed, the tests with the reference's outputs, and a student attempt graded live. **3. Didactics:** the starting program and its locks, and the teacher's common mistakes, each with a program and a message in he, ar and en. **4. File:** opens or saves the exercise file (`.scratchq`, the builder's whole state) and exports to `.sb3`. **5. Question:** the code for STACK-JS (one line with no `<`, `>` or `&` in the script, because Moodle escapes them) or for a stand-alone page, plus a try as a student. The model answer is the STACK variable `sqmodel`. Constants: `BUILDER_VERSION`, **`CODE_VERSION`** (raise it whenever the generated template changes) and `DEFAULT_LIBRARY`. Add `?selftest` to the URL to load `tests/builder-tests.js`. |

### Examples

| File | Role | What it does |
|---|---|---|
| [examples/sum-1-to-n.scratchq](examples/sum-1-to-n.scratchq) | A sample exercise file and test fixture. | A "fix the program" question. The starting program loops `n − 1` times instead of `n` times, and one step is locked. It has two tests and one common mistake (adding 1 instead of `i`). The file is generated by `tests/make-example.html`. The builder and STACK simulation tests load it. |

### Tests

Every test page sets `window.__result = { passed, failed, lines }` and `window.__done = true`.

| File | Role | What it does |
|---|---|---|
| [tests/run-page.mjs](tests/run-page.mjs) | Test runner (Node). | Serves the ScratchQ folder over http (ES modules do not work from `file://`), opens a page in headless Edge, waits for `__done`, prints the result and exits with code 0 only when no test failed. Environment variables: `SHOW_CONSOLE=1` prints the page's console, `SHOT=file.png` saves a screenshot and `FULL=1` makes it a full-page screenshot. |
| [tests/program-helper.js](tests/program-helper.js) | Test helper. | `prog(decl, ...scripts)` builds a program from a short nested description (`["looks_say", { MESSAGE: … }]`), so tests do not need hand-written flat `.sb3` blocks. |
| [tests/runner-tests.html](tests/runner-tests.html) | Tests for `scratchq.js`. | Runs programs (loops, join, ask, lists, random seed, timeouts, pen and more) and checks the Runner's output, the Checker and the state codec. |
| [tests/editor-tests.html](tests/editor-tests.html) | Tests for `scratchq-editor.js`. | Uses an RTL Hebrew page with LTR English blocks. Checks that a program goes from the workspace to the VM and runs the same. Edits and added blocks reach the program, and `onChange` fires. Locks hold: a locked block can't be moved, deleted or edited, and a drag that carries locked blocks away is undone. The builder's lock marking and the read-only view work. The palette shows "set" once a variable exists, has the motion and pen blocks, and the editor's program draws a square. |
| [tests/builder-tests.js](tests/builder-tests.js) | Builder self-test. | Loaded by `scratch-question-builder.html?selftest`. Loads the example and checks every tab: the reference's outputs, the palette following tab 1, the variables, the tests, the attempt grading, the mistakes, the generated code, opening the code again, `.sb3` export, pen drawings and trace questions. Add `&tab=<name>` to end on a given tab, for a screenshot. |
| [tests/stack-sim.html](tests/stack-sim.html) | Simulated STACK frame. | Runs `mountStackJs` with a stand-in for `stack_js` (two inputs and `resize_containing_frame`). Checks the frame's height and how soon the score input is filled after an edit. |
| [tests/make-example.html](tests/make-example.html) | Fixture generator. | Builds `examples/sum-1-to-n.scratchq` with `program-helper.js` and prints its JSON. |

### Other

| File | Role |
|---|---|
| [SCRATCH-DESIGN.md](SCRATCH-DESIGN.md) | The design document: goals, question kinds K1–K5, architecture, the supported block subset, the interpreter, checking, the builder, the implementation notes and open questions. |
| [.gitattributes](.gitattributes) | `* text=auto`: Git normalises line endings. |

## Running the tests

From the ScratchQ folder:

```
node tests/run-page.mjs tests/runner-tests.html
node tests/run-page.mjs tests/editor-tests.html
node tests/run-page.mjs "scratch-question-builder.html?selftest" 240
node tests/run-page.mjs tests/stack-sim.html 120
```

The second argument is the timeout in seconds. The pages need the network for the CDN libraries.

## Data formats, in short

- **Program**: `{ v: 1, variables: [{id,name,value}], lists: [{id,name,items}], blocks: {id: block} }`. The full
  format is in the header of `scratchq.js`.
- **Test**: `{ name, vars, lists, answers, seed }`.
- **Question configuration** (the code the builder generates): `{ tool: "scratchq-question", formatVersion: 1, kind,
  language, reference, initial, locks, palette, tests, observe, mistakes, trace, review, inputs, height }`. The full
  format is in the header of `scratchq-question.js`.
- **Saved state**: `{ v: 1, program | answers, grade, feedback }`. STACK stores it as `sq1:` + base64 JSON.
- **Exercise file** (`.scratchq`): the builder's whole state (`tool: "scratchq-builder"`), a superset of the
  configuration.

## Conventions

- Student-side behaviour goes in `scratchq-question.js`. The builder only generates configuration and a fixed
  loader template.
- The generated script must not contain `<`, `>` or `&`, because Moodle escapes them in pasted scripts. In the
  builder, write `"<"+"script"` instead of a literal script tag.
- Blocks are always in English. The surrounding UI and feedback are in he, ar or en.
- Raise `CODE_VERSION` when the template changes, and raise each library's `VERSION` when its behaviour changes.
- Not done yet: trace parameters and mutants, Parsons questions, structural rules, and a smaller VM bundle.
