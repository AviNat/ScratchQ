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

    const rHost = document.createElement("div");
    rHost.lang = "he";
    document.body.appendChild(rHost);
    await ScratchQ.Question.mount(rHost, B.questionConfig(), { state: ScratchQ.encodeState({ v: 1, program: B.state.mistakes[0].program, grade: 20, feedback: "" }), readOnly: true });
    await sleep(500);
    ok(rHost.textContent.indexOf("בכל סיבוב") >= 0 && rHost.textContent.indexOf("התוכנית הנכונה") >= 0 && rHost.querySelectorAll(".blocklySvg").length >= 2,
        "review: the mistake's message, the reference program (Hebrew)", rHost.textContent.slice(0, 200));
    rHost.remove();

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

    /* the trace kind */
    document.querySelector("input[name=kind][value=trace]").click();
    await B.runChecks();
    await sleep(300);
    ok(!$("traceSection").hidden && /says:\n\s+The sum is 6/.test($("traceExpected").textContent), "trace: the correct answer shown", $("traceExpected").textContent);
    const cfg = B.questionConfig();
    ok(cfg.kind === "trace" && cfg.tests.length === 1 && !cfg.palette, "trace: the code's configuration", Object.keys(cfg));
    document.querySelector("input[name=kind][value=program]").click();
    await sleep(300);
} catch (e) {
    ok(false, "exception: " + (e && e.stack || e));
}
const m = /[?&]tab=(\w+)/.exec(location.search);
B.showTab(m ? m[1] : "checker");
await sleep(1200);
window.__result = out;
window.__done = true;
})();
