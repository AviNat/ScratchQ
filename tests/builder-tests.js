/*
 * The builder's self-test: scratch-question-builder.html?selftest loads this file.
 *   node tests/run-page.mjs "scratch-question-builder.html?selftest" 180
 * Sets window.__result / __done for run-page.mjs. ?selftest&tab=<name> ends on that tab (for a screenshot).
 */
(async function () {
"use strict";
const out = { passed: 0, failed: 0, lines: [] };
function ok(cond, name, detail) {
    if (cond) out.passed += 1; else out.failed += 1;
    out.lines.push((cond ? "ok   " : "FAIL ") + name + (cond || detail === undefined ? "" : "  -> " + String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 700)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(cond, ms) { const t = Date.now(); while (Date.now() - t < (ms || 8000)) { if (cond()) return true; await sleep(100); } return false; }
const $ = id => document.getElementById(id);
const B = window.builder;

try {
    await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "tests/program-helper.js"; s.onload = res; s.onerror = rej; document.body.appendChild(s); });
    ok(await until(() => B.editors.ref && B.editors.init), "the builder started (two editors)");

    /* the example: "sum 1..n" - a fix question: the starting program runs the loop one time too few */
    const ex = await (await fetch("examples/sum-1-to-n.scratchq", { cache: "no-store" })).json();
    B.loadState(ex, "sum-1-to-n.scratchq", null);
    await until(() => B.editors.ref && B.editors.ref.workspace.getAllBlocks(false).length > 5);
    await B.runChecks();
    await sleep(300);
    ok(/says:\n\s+The sum is 6/.test($("testExp0").textContent) && /sum = 55/.test($("testExp1").textContent), "tab 2: the reference's outputs per test", $("testExp0").textContent + " / " + $("testExp1").textContent);
    ok(/would get 0%/.test($("initStatus").textContent) && !/common mistake/.test($("initStatus").textContent), "tab 3: what the starting program would get", $("initStatus").textContent);
    ok(!B.isDirty(), "loading the file leaves it unchanged (not dirty)");
    ok(/It gives/.test($("mistakeStatus0").textContent), "tab 3: the mistake's outputs", $("mistakeStatus0").textContent);
    ok(Object.keys(B.state.locks).length === 1, "the lock of the example");
    ok(!document.querySelector("nav.tabs button.has-issue"), "no tab has an issue", Array.from(document.querySelectorAll("nav.tabs button.has-issue")).map(b => b.id));

    /* the reference's palette follows tab 1 */
    const refPalette = () => B.editors.ref.workspace.getFlyout().getWorkspace().getTopBlocks(false).map(b => b.type);
    const offOp = "looks_say";
    const offBox = $("paletteCats").querySelector("input[data-op=" + offOp + "]");
    ok(offBox && offBox.checked && refPalette().includes(offOp), "the reference's palette has a block of tab 1", refPalette());
    if (offBox) {
        offBox.checked = false;
        offBox.dispatchEvent(new Event("change", { bubbles: true }));
        ok(await until(() => !refPalette().includes(offOp), 3000), "a block taken off tab 1's palette leaves the reference's palette", refPalette());
        offBox.checked = true;
        offBox.dispatchEvent(new Event("change", { bubbles: true }));
        ok(await until(() => refPalette().includes(offOp), 3000), "and comes back when it is put back");
    }

    /* a category's checkbox: the whole category off and on; a dash when only some of it is on */
    const penCat = Array.from($("paletteCats").querySelectorAll(".palette-cat")).find(d => /Pen/.test(d.textContent));
    const penBox = penCat && penCat.querySelector("input[data-cat]");
    const penOps = () => Array.from(penCat.querySelectorAll("input[data-op]"));
    if (penBox) {
        const before = B.state.palette.blocks.slice();
        penBox.checked = false; penBox.dispatchEvent(new Event("change", { bubbles: true }));
        ok(penOps().every(i => !i.checked) && !B.state.palette.blocks.some(op => op.indexOf("pen_") === 0), "category box off: all its blocks off");
        penOps()[0].checked = true; penOps()[0].dispatchEvent(new Event("change", { bubbles: true }));
        ok(penBox.indeterminate && !penBox.checked, "one block of the category on: the category box shows a dash");
        penBox.checked = true; penBox.dispatchEvent(new Event("change", { bubbles: true }));
        ok(penOps().every(i => i.checked) && !penBox.indeterminate, "category box on: all its blocks on");
        B.loadState(Object.assign(JSON.parse(B.fileText()), { palette: { blocks: before } }), "sum-1-to-n.scratchq", null);
        await until(() => B.editors.ref && B.editors.ref.workspace.getAllBlocks(false).length > 5);
    } else ok(false, "the Pen category has a checkbox");

    /* "Block area height": the builder's editors, the preview included, take it at once */
    B.showTab("palette");
    await until(() => B.editors.preview, 5000);
    const blockAreaH = e => Math.round(e.workspace.getParentSvg().getBoundingClientRect().height);
    const h0 = B.state.height;
    $("height").value = 300;
    $("height").dispatchEvent(new Event("change"));
    await sleep(200);
    /* the other tabs are hidden: their editors' set height (they draw it when their tab is shown) */
    const setH = id => $(id).firstElementChild && $(id).firstElementChild.style.height;
    ok(B.editors.preview && blockAreaH(B.editors.preview) === 300 && setH("refHost") === "300px" && setH("initHost") === "300px",
        "the block area height: the preview and the editors follow at once",
        { preview: B.editors.preview && blockAreaH(B.editors.preview), ref: setH("refHost"), init: setH("initHost") });
    $("height").value = h0;
    $("height").dispatchEvent(new Event("change"));

    /* a variable no block uses: made, then deleted - "What is checked" and the tests follow */
    const refWs = B.editors.ref.workspace;
    const hasTmp = () => !!$("observeBox").querySelector("input[data-name=tmp]") && !!$("testsBox").querySelector("input[data-f=var][data-name=tmp]");
    refWs.createVariable("tmp", "", "vtmp");
    ok(await until(hasTmp, 3000), "a new variable appears in what is checked and in the tests");
    refWs.deleteVariableById("vtmp");
    ok(await until(() => !$("observeBox").querySelector("input[data-name=tmp]") && !$("testsBox").querySelector("input[data-name=tmp]"), 3000),
        "a deleted variable (no block uses it) leaves what is checked and the tests");
    /* the refresh button reads the reference again */
    $("refreshTests").click();
    await sleep(500);
    ok(/says:\n\s+The sum is 6/.test($("testExp0").textContent), "↻ Refresh: the reference's outputs again", $("testExp0").textContent);
    /* delete a test: the button on each card (a test added, then deleted) */
    const nTests = B.state.tests.length;
    $("addTest").click();
    await sleep(200);
    /* the new test copies the last one's answers: the same inputs - a warning on its card and on the tab */
    B.state.tests[nTests].answers = B.state.tests[nTests - 1].answers.slice();
    await B.runChecks();
    ok(/same inputs as test/.test($("testNote" + nTests).textContent) && $("tabBtnChecker").classList.contains("has-issue"), "a test with the same inputs as another is a warning", $("testNote" + nTests).textContent);
    /* other inputs, the same outputs: a note only */
    B.state.tests[nTests].answers = ["3.0"];
    await B.runChecks();
    ok(/same outputs as in test/.test($("testNote" + nTests).textContent) && !$("tabBtnChecker").classList.contains("has-issue"), "other inputs with the same outputs: a note, not an issue", $("testNote" + nTests).textContent);
    $("testsBox").querySelectorAll("button[data-del]")[nTests].click();
    await sleep(200);
    ok(B.state.tests.length === nTests && $("testsBox").querySelectorAll(".card").length === nTests, "🗑 Delete test removes the test", B.state.tests.length);
    await B.runChecks();

    /* the attempt starts from the starting program: not an answer */
    await until(() => B.editors.attempt);
    await sleep(600);
    ok(/untouched: no answer/.test($("attemptResult").textContent), "attempt: the untouched starting program is no answer", $("attemptResult").textContent);
    /* fix it in the attempt: repeat (n - 1) -> repeat (n) - put the variable n in the TIMES input */
    const ws = B.editors.attempt.workspace;
    const rep = ws.getAllBlocks(false).find(b => b.type === "control_repeat");
    const minus = rep.getInputTargetBlock("TIMES");
    const nBlock = minus.getInputTargetBlock("NUM1");
    rep.getInput("TIMES").connection.connect(nBlock.outputConnection);
    minus.dispose(false);
    await until(() => /Grade: 100%/.test($("attemptResult").textContent), 6000);
    ok(/Grade: 100%/.test($("attemptResult").textContent), "attempt: the fixed program gets 100%", $("attemptResult").textContent);

    /* the reference with an endless loop: an issue on tab 2 */
    const saved = JSON.parse(JSON.stringify(B.state.reference));
    const bad = prog({ vars: { n: 0, sum: 0, i: 0 } }, [["event_whenflagclicked"], ["sensing_askandwait", { QUESTION: "n?" }], ["control_forever", { SUBSTACK: [["data_changevariableby", { VALUE: 1 }, { VARIABLE: "i" }]] }]]);
    B.state.reference = bad;
    await B.runChecks();
    ok($("tabBtnChecker").classList.contains("has-issue") && B.issues.checker.some(x => /does not finish/.test(x[1])), "a reference that never stops is an issue", B.issues.checker);
    B.state.reference = saved;
    await B.runChecks();

    /* tab 5: the code */
    B.showTab("question");
    await sleep(400);
    const code = $("code").value;
    const script = code.slice(code.indexOf("[[script type=\"module\"]]"), code.indexOf("[[/script]]"));
    ok(code.indexOf("ScratchQ.Question.mountStackJs(stack_js,") > 0 && !/[<>&]/.test(script) && code.indexOf("\n") < 0, "tab 5: one line, no < > & in the script");
    ok(/^sqmodel: "sq1:[A-Za-z0-9+/=]+";$/.test($("modelVar").value), "tab 5: the model answer variable", $("modelVar").value.slice(0, 80));
    const model = ScratchQ.parseState($("modelVar").value.slice(10, -2));
    ok(model && ScratchQ.sameProgram(model.program, B.state.reference), "the model answer is the reference");
    ok(await until(() => $("tryHost").querySelector(".blocklySvg"), 6000), "tab 5: the try shows the student's workspace");

    /* the student's view: a mistake's program gets the teacher's message and grade */
    const ch = ScratchQ.Checker.create(B.questionConfig());
    const gm = await ch.grade(B.state.mistakes[0].program, "he");
    ok(gm.grade === 20 && gm.feedback.indexOf("בכל סיבוב") === 0, "the mistake's message (Hebrew) and grade", gm.feedback);

    /* the student page: an edit saves a state and a score; the review shows the teacher's message and the reference */
    const qHost = document.createElement("div");
    document.body.appendChild(qHost);
    let stSaved = null, stScore = null, saves = 0;
    const qApi = await ScratchQ.Question.mount(qHost, B.questionConfig(), { onChange: (s, sc) => { stSaved = s; stScore = sc; saves += 1; } });
    const qws = qApi.editor.workspace;
    const qRep = qws.getAllBlocks(false).find(b => b.type === "control_repeat");
    const qMinus = qRep.getInputTargetBlock("TIMES");
    qRep.getInput("TIMES").connection.connect(qMinus.getInputTargetBlock("NUM1").outputConnection);
    qMinus.dispose(false);
    await until(() => stSaved && stSaved.grade === 100, 6000);
    ok(stSaved && stSaved.grade === 100 && stScore === 1 && stSaved.program, "student: the fixed program is stSaved with score 1", { grade: stSaved && stSaved.grade, stScore });
    const enc = ScratchQ.encodeState(stSaved);
    ok(/^sq1:/.test(enc) && ScratchQ.sameProgram(ScratchQ.parseState(enc).program, stSaved.program), "student: the state as STACK keeps it");
    /* back to the starting program (undo) -> no answer */
    while (qws.getUndoStack().length) qws.undo(false);
    await until(() => stSaved === null, 6000);
    ok(stSaved === null && stScore === 0, "student: the starting program again is no answer");
    qApi.editor.dispose();

    const revHost = document.createElement("div");
    revHost.lang = "he";
    document.body.appendChild(revHost);
    await ScratchQ.Question.mount(revHost, B.questionConfig(), { state: ScratchQ.encodeState({ v: 1, program: B.state.mistakes[0].program, grade: 20, feedback: "" }), readOnly: true });
    await sleep(500);
    ok(revHost.textContent.indexOf("בכל סיבוב") >= 0 && revHost.textContent.indexOf("התוכנית הנכונה") >= 0 && revHost.querySelectorAll(".blocklySvg").length >= 2,
        "review: the mistake's message, the reference program (Hebrew)", revHost.textContent.slice(0, 200));
    /* the feedback line by line: what the sprite said is left to right inside the Hebrew feedback, the Hebrew right to left */
    const fbLines = Array.from(revHost.querySelectorAll("div[dir=auto]"));
    const saidLine = fbLines.find(d => /The sum is/.test(d.textContent)), hebLine = fbLines.find(d => /בדיקה/.test(d.textContent));
    ok(saidLine && getComputedStyle(saidLine).direction === "ltr" && hebLine && getComputedStyle(hebLine).direction === "rtl",
        "review feedback: the said text left to right, the Hebrew right to left", fbLines.map(d => getComputedStyle(d).direction + ":" + d.textContent).join(" | ").slice(0, 400));
    revHost.remove();

    /* the code opens again as an exercise (after emptying the mistakes and tests here) */
    const before = B.state.reference;
    B.state.mistakes = [];
    B.state.tests = B.state.tests.slice(0, 1);
    B.openText(code, "q.stack.txt", null);
    await until(() => B.editors.ref && B.editors.ref.workspace.getAllBlocks(false).length > 5);
    ok(ScratchQ.sameProgram(B.state.reference, before) && B.state.mistakes.length === 1 && B.state.tests.length === 3 && Object.keys(B.state.locks).length === 1,
        "Open of the code restores the exercise");

    /* .sb3: export with the VM's writer, and import back */
    const vm = new VirtualMachine();
    await vm.loadProject(ScratchQ.toProject(B.state.reference, {}));
    const blob = await vm.saveProjectSb3();
    const vm2 = new VirtualMachine();
    await vm2.loadProject(await blob.arrayBuffer());
    const sprite = vm2.runtime.targets.find(t => !t.isStage);
    ok(blob.size > 300 && Object.values(sprite.blocks._blocks).some(b => b.opcode === "control_repeat"), "an .sb3 export loads back (" + blob.size + " bytes)");

    /* a pen exercise: the drawing is checked, the outputs list the lines, a missing side is named */
    const square = n => prog({}, [["event_whenflagclicked"], ["pen_clear"], ["pen_penDown"],
        ["control_repeat", { TIMES: n, SUBSTACK: [["motion_movesteps", { STEPS: 100 }], ["motion_turnright", { DEGREES: 90 }]] }]]);
    const penEx = JSON.parse(JSON.stringify(B.state));
    Object.assign(penEx, { reference: square(4), initial: null, locks: {}, mistakes: [], tests: [{ name: "1", vars: {}, lists: {}, answers: [], seed: 1, hidden: false }],
        observe: { say: true, vars: [], lists: [], caseSensitive: false } });
    B.loadState(penEx, "square.scratchq", null);
    await until(() => B.editors.ref && B.editors.ref.workspace.getAllBlocks(false).some(b => b.type === "pen_penDown"));
    await B.runChecks();
    await sleep(300);
    ok(B.state.observe.pen === true && $("observeBox").querySelector("input[data-obs=pen]:checked"), "pen: the drawing is checked (ticked by itself)");
    ok(/draws 4 lines/.test($("testExp0").textContent) && !/\(0, /.test($("testExp0").textContent) && $("testExp0").querySelector("svg"),
        "pen: the test shows the count and a picture, no coordinates", $("testExp0").textContent);
    ok(/font-style="italic">x</.test($("testExp0").innerHTML), "pen: the test's picture has the x and y axes");
    ok($("addTest").disabled, "no inputs (no ask, variables, lists, random): + Add a test is disabled");
    const pg = await ScratchQ.Checker.create(B.questionConfig()).grade(square(3), "en");
    ok(pg.grade === 0 && /3 of the 4 expected lines/.test(pg.feedback), "pen: three sides of the square get 0, counted", pg.feedback);
    /* the reference's drawing: shown, grid / axes, copy-ready SVG */
    ok(!$("drawingSection").hidden && await until(() => $("drawPic").querySelector("svg path[stroke='#2f5fd0']"), 3000), "drawing section: the reference's picture");
    ok(/<text/.test($("drawPic").innerHTML), "drawing section: the axes by default");
    $("drawAxes").click();
    ok(await until(() => $("drawPic").querySelector("svg") && !/<text/.test($("drawPic").innerHTML), 3000) && B.state.drawing.axes === false, "drawing section: the axes off");
    $("drawAxes").click();
    const dcfg = B.questionConfig();
    ok(dcfg.drawing && dcfg.drawing.review === true && dcfg.drawing.answering === false && dcfg.drawing.axes === true, "the code carries the drawing options", dcfg.drawing);
    /* the student's drawing: while answering (on) and in the review */
    $("drawAnswering").click();
    const stuHost = document.createElement("div");
    document.body.appendChild(stuHost);
    await ScratchQ.Question.mount(stuHost, B.questionConfig(), { onChange: () => {} });
    ok(await until(() => /Your drawing|הציור שלך/.test(stuHost.textContent) && stuHost.querySelector("svg path[stroke='#2f5fd0']") === null, 5000),
        "student: the drawing while answering (the starting program draws nothing)", stuHost.textContent.slice(0, 200));
    const penRevHost = document.createElement("div");
    document.body.appendChild(penRevHost);
    await ScratchQ.Question.mount(penRevHost, B.questionConfig(), { readOnly: true, state: { v: 1, program: square(3), grade: 0, feedback: "" } });
    ok(await until(() => penRevHost.querySelectorAll("figure svg").length === 2, 5000), "review: the student's drawing and the correct one", penRevHost.querySelectorAll("figure").length);
    stuHost.remove(); penRevHost.remove();
    $("drawAnswering").click();
    B.loadState(ex, "sum-1-to-n.scratchq", null);
    await until(() => B.editors.ref && B.editors.ref.workspace.getAllBlocks(false).length > 5);

    /* the trace kind */
    document.querySelector("input[name=kind][value=trace]").click();
    await B.runChecks();
    await sleep(300);
    ok(!$("traceSection").hidden && /says:\n\s+The sum is 6/.test($("traceExpected").textContent), "trace: the correct answer shown", $("traceExpected").textContent);
    const cfg = B.questionConfig();
    ok(cfg.kind === "trace" && cfg.tests.length === 1 && !cfg.palette, "trace: the code's configuration", Object.keys(cfg));
    ok(/^sqmodel: "sq1:/.test(await B.questionVariables()), "a file made before part numbers keeps the variable sqmodel", await B.questionVariables());
    document.querySelector("input[name=kind][value=program]").click();
    await sleep(300);

    /* ---------- a trace question with random values, which branch, the teacher's mistakes ---------- */
    const traceProg = prog({ vars: { n: 0, s: 0 } }, [["event_whenflagclicked"],
        ["data_setvariableto", { VALUE: 4 }, { VARIABLE: "n" }],
        ["data_setvariableto", { VALUE: 0 }, { VARIABLE: "s" }],
        ["control_repeat", { TIMES: { v: "n" }, SUBSTACK: [
            ["control_if", { CONDITION: ["operator_gt", { OPERAND1: { v: "s" }, OPERAND2: 100 }], SUBSTACK: [["looks_say", { MESSAGE: "big" }]] }],
            ["data_changevariableby", { VALUE: 3 }, { VARIABLE: "s" }]] }],
        ["control_if_else", { CONDITION: ["operator_gt", { OPERAND1: { v: "s" }, OPERAND2: 15 }],
            SUBSTACK: [["looks_say", { MESSAGE: "more" }]], SUBSTACK2: [["looks_say", { MESSAGE: "less" }]] }]]);
    B.loadState({ tool: "scratchq-builder", kind: "trace", reference: traceProg, trace: { items: [{ kind: "say" }, { kind: "var", name: "s" }] } }, "trace.scratchq", null);
    await until(() => B.editors.ref && B.editors.ref.workspace.getAllBlocks(false).length > 5);
    await B.runChecks();
    ok(B.state.question.part === "1" && /^sqmodel1: "sq1:/.test(await B.questionVariables()), "a new question: part 1, sqmodel1");
    /* only what a trace question uses: no starting values, seed, palette, starting program */
    B.state.tests[0].vars = { n: "9" };
    const tcfg = B.checkConfig();
    ok($("traceRunBox").hidden && !$("traceTestBox").querySelector("input") && JSON.stringify(tcfg.tests[0].vars) === "{}",
        "trace without ask: no data fields, a variable's starting value is not used", tcfg.tests[0]);
    ok($("paletteSection").hidden && $("initialSection").hidden && $("mistakesSection").hidden && $("testsSection").hidden && $("observeSection").hidden &&
        $("exportInit").hidden && $("importTargetInit").disabled, "trace: the palette, starting program, program mistakes, tests and what is checked are hidden");
    /* which branch: the if outside the loop is offered, the one inside is not */
    const branchBoxes = $("traceItemsBox").querySelectorAll("input[data-item=branch]");
    ok(branchBoxes.length === 1 && /inside a loop/.test($("traceItemsBox").textContent), "which branch: only the if outside the loop", $("traceItemsBox").textContent);
    branchBoxes[0].click();
    await B.runChecks();
    ok(/if block no\. 2: the "else" part/.test($("traceExpected").textContent) && /s = 12/.test($("traceExpected").textContent),
        "which branch: the correct answer (n = 4: s = 12, not more than 15 - the else part)", $("traceExpected").textContent);
    /* the weights: a field beside each item, enabled when the item is ticked; 1 is not stored */
    const bw = branchBoxes[0].parentNode.querySelector("input.weight");
    ok(bw && !bw.disabled && bw.value === "1", "weights: the branch's weight field, 1 by default");
    /* an answer typed in the attempt stays when only a weight changes, and is graded again */
    await until(() => $("attemptHost").querySelector("textarea, input[type=text]"), 8000);
    const typed = $("attemptHost").querySelector("textarea, input[type=text]");
    typed.value = "wrong";
    typed.dispatchEvent(new Event("input", { bubbles: true }));
    await until(() => /Grade/.test($("attemptResult").textContent), 6000);
    const resultBefore = $("attemptResult").textContent;
    bw.value = "3";
    bw.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(300);
    await until(() => $("attemptHost").querySelector("textarea, input[type=text]"), 8000);
    await until(() => /Grade/.test($("attemptResult").textContent), 6000);
    const kept = $("attemptHost").querySelector("textarea, input[type=text]");
    ok(kept && kept.value === "wrong" && /Grade/.test($("attemptResult").textContent), "weights: the attempt's typed answer stays, graded again", { before: resultBefore, after: $("attemptResult").textContent });
    const bItem = B.state.trace.items.find(it => it.kind === "branch");
    ok(bItem && bItem.weight === 3 && B.questionConfig().trace.items.find(it => it.kind === "branch").weight === 3, "weights: kept in the state and in the code", B.state.trace.items);
    bw.value = "1";
    bw.dispatchEvent(new Event("change", { bubbles: true }));
    ok(B.state.trace.items.find(it => it.kind === "branch").weight === undefined, "weights: back to 1 - not stored");
    /* the random values: n from 3..9 - 7 variants (fewer than 20: all of them) */
    const nBox = $("paramsBox").querySelector("input[data-pon]");
    ok(!$("paramsSection").hidden && nBox && $("paramsBox").querySelectorAll("input[data-pon]").length === 2, "random values: the two set blocks offered");
    nBox.click();
    const nValues = $("paramsBox").querySelector("input[data-pvalues]:not([disabled])");
    nValues.value = "3..9";
    nValues.dispatchEvent(new Event("change", { bubbles: true }));
    await B.runChecks();
    ok(B.state.variants.length === 7 && $("variantsTable").querySelectorAll("tr").length === 8 && /all the possible ones/.test($("variantsStatus").textContent),
        "random values: 7 variants, each with its answer", $("variantsStatus").textContent);
    const qc = B.questionConfig();
    ok(qc.params.length === 1 && qc.variants.length === 7 && qc.variant === undefined, "the code carries the parameters and the variants (not a variant)", { params: qc.params, variant: qc.variant });
    const traceCode = B.stackCode(qc);
    ok(/mountStackJs\(stack_js,\{.*\},\{#sqvar1#\}\);\[\[\/script\]\]/.test(traceCode), "the STACK code passes the variant: {#sqvar1#}");
    const qv = await B.questionVariables();
    ok(/^sqvar1: rand\(7\);\nsqmodels1: \["sq1:[^"]+"(, "sq1:[^"]+"){6}\];\nsqmodel1: sqmodels1\[ev\(sqvar1 \+ 1, simp\)\];$/.test(qv), "the question variables: the variant and a model answer for each", qv.slice(0, 200));
    /* each variant's model answer is the correct answer of that variant */
    const models = qv.split("\n")[1].match(/"sq1:[^"]+"/g).map(s => ScratchQ.parseState(s.slice(1, -1)));
    let allRight = true;
    for (let i = 0; i < models.length; i += 1) {
        const g = await ScratchQ.Checker.gradeTrace(Object.assign({}, qc, { variant: i }), models[i].answers, "en");
        if (g.grade !== 100 || models[i].variant !== i) allRight = false;
    }
    ok(allRight, "every variant's model answer gets 100% on its own variant");
    const wrongVariant = await ScratchQ.Checker.gradeTrace(Object.assign({}, qc, { variant: 0 }), models.find((m, i) => i > 0 && JSON.stringify(m.answers) !== JSON.stringify(models[0].answers)).answers, "en");
    ok(wrongVariant.grade < 100, "another variant's answer is not correct");
    /* the mistakes are not used with random values */
    B.showTab("didactics");
    ok($("addTraceMistake").disabled && /random values/.test($("traceMistakesBox").textContent), "mistakes: off with random values");
    /* the code opens again with its parameters and variants */
    const variantsBefore = JSON.stringify(B.state.variants);
    B.openText(traceCode, "", null);
    await until(() => B.editors.ref && B.editors.ref.workspace.getAllBlocks(false).length > 5);
    ok(B.state.params.length === 1 && B.state.params[0].values === "3..9" && JSON.stringify(B.state.variants) === variantsBefore, "opening the code: the parameters and the same variants");
    /* without random values: a typed mistake */
    B.showTab("checker");
    $("paramsBox").querySelector("input[data-pon]:checked").click();
    await B.runChecks();
    ok(!B.state.params.length && $("shownVariantField").hidden, "random values off");
    B.showTab("didactics");
    $("addTraceMistake").click();
    ok(await until(() => $("traceMistakesBox").querySelector("input[data-tm=var]"), 3000), "a mistake: its fields, from the correct answer");
    await B.runChecks();
    ok(/correct answer - not a mistake/.test($("traceMistakeStatus0").textContent), "a mistake equal to the correct answer: flagged", $("traceMistakeStatus0").textContent);
    const sField = $("traceMistakesBox").querySelector("input[data-tm=var]");
    sField.value = "15";
    sField.dispatchEvent(new Event("input", { bubbles: true }));
    const heField = $("traceMistakesBox").querySelector("input[data-tm=he]");
    heField.value = "הלולאה רצה פעם אחת יותר מדי";
    heField.dispatchEvent(new Event("input", { bubbles: true }));
    await B.runChecks();
    ok(/2 of 3 fields are correct/.test($("traceMistakeStatus0").textContent), "the mistake: 2 of 3 fields", $("traceMistakeStatus0").textContent);
    const mq = B.questionConfig();
    const gtm = await ScratchQ.Checker.gradeTrace(mq, Object.assign({}, B.state.traceMistakes[0].answers, { vars: { s: "15" } }), "he");
    ok(mq.mistakes.length === 1 && gtm.mistake === 0 && /^הלולאה רצה פעם אחת יותר מדי/.test(gtm.feedback), "a student's answer equal to the mistake: its message", gtm.feedback);
    B.showTab("checker");
} catch (e) {
    ok(false, "exception: " + (e && e.stack || e));
}
const m = /[?&]tab=(\w+)/.exec(location.search);
B.showTab(m ? m[1] : "checker");
await sleep(1200);
window.__result = out;
window.__done = true;
})();
