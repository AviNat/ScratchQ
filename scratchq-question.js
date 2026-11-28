/*
 * Copyright (c) 2026 Avi Nathan. All rights reserved.
 * No part of this file may be copied, modified or distributed without the written permission of the copyright holder.
 */
/*
 * ScratchQ.Question - a Scratch question in Moodle STACK (STACK-JS) or in any other system. All student-side code
 * is here; the builder (scratch-question-builder.html, tab 5) generates only the configuration and a fixed template,
 * as the math and chemistry questions do.
 *
 *   ScratchQ.Question.mountStackJs(stack_js, config)    inside a STACK [[iframe]]
 *   ScratchQ.Question.mount(element, config, options)   any other system (element: an element or its id)
 *     options.state       the saved state (object, JSON or "sq1:" text) or null
 *     options.readOnly    true: the review
 *     options.onChange    function (state, score) after every change (state null: no answer)
 *     options.editorHost  an element (or its id) for the block editor alone - see config.editorHostId
 *     options.variant     the variant of a question with random values (0 .. variants - 1)
 *
 * WHERE THE QUESTION GOES (the page's layout):
 *   config.hostId        the element of the whole question (STACK; default "scratchq", made at the end of the page
 *                        when there is none)
 *   config.editorHostId  an element of its own for the block editor (a trace question: the program shown) and the
 *                        student's drawing beside it; the feedback and the correct program stay in the question's
 *                        element. With it the
 *                        page decides where the editor is - e.g. a picture beside it:
 *                          <div style="display:flex;gap:16px;align-items:flex-start">
 *                            <div id="sq-editor" style="flex:1;min-width:0"></div>   <- the editor's width: the rest
 *                            <div><svg ...>...</svg></div>                          <- the picture
 *                          </div>
 *                          <div id="scratchq"></div>
 *                        (flex:1 and min-width:0: the editor takes the width the picture leaves; it follows the
 *                        element's size.) No such element on the page: the editor is in the question's element.
 *
 * Needs, loaded before it: the Scratch VM (global VirtualMachine), scratchq.js, scratchq-editor.js. Loads
 * scratch-blocks itself (an ES module) unless config.scratchBlocksUrl says otherwise.
 *
 * The configuration (the builder's "question code"):
 *   { tool: "scratchq-question", formatVersion: 1, questionId,
 *     language: "he" | "ar" | "en" | "system",           - the student language (all texts but the blocks)
 *     kind: "trace" | "program",                          - trace: write what the program gives; program: edit it
 *     params, variants, variant,                          - trace: random values in set blocks (scratchq.js, Params);
 *                                                           variant: the student's (STACK: mountStackJs's 3rd argument)
 *     review: { grade, feedback, reference },             - what the review shows (each true unless false)
 *     inputs: { score: "ans1", state: "ans2" },           - STACK-JS only
 *     reference, initial, locks, palette,                 - programs (scratchq.js), locks (scratchq-editor.js)
 *     tests, observe, mistakes, trace: { items },         - the checking (scratchq.js, Checker)
 *     drawing: { answering, review, grid, axes, side,     - observe.pen only: the student's drawing shown while
 *                size },                                    answering (beside the editor: side "right", the default,
 *                                                           or "left") / in the review (with the correct one when the
 *                                                           review shows the reference); grid and axes in the picture;
 *                                                           size: the picture fits a size x size square, px (120..600,
 *                                                           default 256) - its height is at most size
 *     height }                                            - the block area's height in px
 *
 * The saved state: { v: 1, program | answers, grade (0..100), feedback }; in STACK "sq1:" + base64 of its JSON.
 */
(function (global) {
"use strict";

const ScratchQ = global.ScratchQ;
if (!ScratchQ || !ScratchQ.Editor) throw new Error("scratchq-question.js needs scratchq.js and scratchq-editor.js");

const VERSION = "0.5.0";
const UI = {
    en: { answerHere: "Your answer:", sayHint: "One line for each thing the sprite says, in order. The same thing several times in a row:", listHint: "One item per line.",
          yourProgram: "Your program:", loading: "Loading…" },
    he: { answerHere: "התשובה שלך:", sayHint: "שורה לכל דבר שהדמות אומרת, לפי הסדר. אותו דבר כמה פעמים ברצף:", listHint: "פריט אחד בכל שורה.",
          yourProgram: "התוכנית שלך:", loading: "טוען…" },
    ar: { answerHere: "إجابتك:", sayHint: "سطر لكل ما يقوله الكائن، بالترتيب. الشيء نفسه عدة مرات متتالية:", listHint: "عنصر واحد في كل سطر.",
          yourProgram: "برنامجك:", loading: "جارٍ التحميل…" }
};

let sbLoading = null;
function loadScratchBlocks(url) {
    if (global.ScratchBlocks) return Promise.resolve(global.ScratchBlocks);
    if (!sbLoading) sbLoading = import(url || ScratchQ.Editor.SCRATCH_BLOCKS_URL).then(function (m) { global.ScratchBlocks = m; return m; });
    return sbLoading;
}

/* an element, or the element with that id (null when there is none) */
function elementOf(e) {
    if (!e) return null;
    return typeof e === "string" ? document.getElementById(e) : e;
}

function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text !== undefined) e.textContent = text;
    return e;
}

/* the program the student starts from: the teacher's, or an empty workspace with the reference's variables and lists
   (the tests observe them by name, so the student gets them ready - "Make a Variable" is still there) */
function startingProgram(cfg) {
    if (cfg.initial) return cfg.initial;
    const ref = cfg.reference || {};
    return { v: 1, variables: JSON.parse(JSON.stringify(ref.variables || [])), lists: JSON.parse(JSON.stringify(ref.lists || [])), blocks: {} };
}

function studentLanguage(cfg) {
    const s = ScratchQ.supportedLanguage;
    return cfg.language === "system"
        ? (s(global.studentLanguage) || s(document.documentElement.lang) || "en")
        : (s(cfg.language) || "en");
}

/*
 * The drawing (observe.pen): the picture of a program's run on the first test the student may see. The checking
 * compares the lines; the picture lets the student (and the teacher grading by hand) see what was drawn.
 */
function drawingShown(cfg, where) {
    return cfg.kind !== "trace" && !!(cfg.observe && cfg.observe.pen) && !!(cfg.drawing && cfg.drawing[where] === true);
}
function drawingTest(cfg) {
    const tests = cfg.tests && cfg.tests.length ? cfg.tests : [{ name: "1" }];
    return tests.find(function (t) { return !t.hidden; }) || tests[0];
}
function drawingOf(program, cfg) {
    return ScratchQ.Runner.run(program, drawingTest(cfg), { maxMs: 400 }).then(function (r) { return ScratchQ.Drawing.merge(r.pen); });
}
/* the student's (and the correct) drawing: within a size x size square, px - drawing.size, 120..600, default 256 */
const DRAWING_SIZE = 256;
function drawingSize(cfg) {
    const s = Number(cfg.drawing && cfg.drawing.size);
    return s > 0 ? Math.max(120, Math.min(600, Math.round(s))) : DRAWING_SIZE;
}
function drawingFigure(title, segments, cfg, fit) {
    const d = cfg.drawing || {};
    const fig = el("figure", "margin:0;display:inline-flex;flex-direction:column;gap:4px");
    fig.appendChild(el("figcaption", "font-weight:bold", title));
    const pic = el("div", "border:1px solid #ccd3db;border-radius:6px;overflow:hidden;line-height:0;width:max-content");
    pic.innerHTML = ScratchQ.Drawing.svg(segments, { grid: d.grid !== false, axes: d.axes !== false, size: drawingSize(cfg), fit: fit });
    fig.appendChild(pic);
    return fig;
}

/* the feedback block of the review: the grade line, then the rest */
function showFeedback(box, cfg, saved, lang) {
    const show = cfg.review || {};
    if (!saved) { box.appendChild(el("div", "font-weight:bold;margin-top:8px", ScratchQ.tr(lang, "empty"))); return; }
    const lines = String(saved.feedback || "").split("\n");
    if (show.grade !== false) box.appendChild(el("div", "font-weight:bold;font-size:17px;margin-top:8px", lines[0]));
    if (show.feedback !== false && lines.length > 1) box.appendChild(feedbackBlock(lines.slice(1)));
}
/*
 * The feedback, one element per line, each in its own direction (dir="auto", from its first letter): what the sprite
 * said reads as Scratch shows it - English left to right - inside Hebrew / Arabic feedback, as in the builder's table.
 */
function feedbackBlock(lines) {
    const block = el("div", "margin-top:4px");
    lines.forEach(function (line) {
        const d = el("div", "white-space:pre-wrap;text-align:start;min-height:1.2em", line);
        d.dir = "auto";
        block.appendChild(d);
    });
    return block;
}

/*
 * host - an element; cfg - the configuration; adapter - { state, review, save(state, score) }.
 * Returns a promise of { editor?, grade() }.
 */
/* the steps from an edit to the saving, in the console when ScratchQ.DEBUG is on (to follow a question in Moodle) */
function debug() { ScratchQ.log.apply(null, arguments); }

function runQuestion(host, cfg, adapter) {
    adapter = adapter || {};
    if (cfg.debug === true) ScratchQ.DEBUG = true;               // the builder's "Console logs" option
    /* random values: this student's variant in the program (shown and graded) */
    cfg = ScratchQ.Params.withVariant(cfg);
    if (cfg.variantIndex !== undefined) debug("variant " + (cfg.variantIndex + 1) + " of " + cfg.variants.length + (cfg.variantIndex !== Number(cfg.variant) ? " (given: " + JSON.stringify(cfg.variant) + ")" : ""));
    const lang = studentLanguage(cfg);
    const ui = UI[lang] || UI.en;
    const review = adapter.review === true;
    const saved = ScratchQ.parseState(adapter.state);
    host.textContent = "";
    host.dir = lang === "en" ? "ltr" : "rtl";
    /* the block editor's own element (config.editorHostId / options.editorHost), or the question's */
    let editorHost = elementOf(adapter.editorHost || cfg.editorHostId);
    if (editorHost && (editorHost === host || !editorHost.isConnected)) editorHost = null;   // inside the question's element: emptied above
    if (editorHost) editorHost.textContent = "";
    if (cfg.editorHostId && !editorHost && adapter.editorHost === undefined) debug("no element with the id \"" + cfg.editorHostId + "\": the editor is in the question's element");
    function editorPlace(box) { (editorHost || host).appendChild(box); }
    const loading = el("div", "color:#666", ui.loading);
    host.appendChild(loading);
    /* the question shown again in the same element before this one is ready (a page or the builder redraws it): the
       newer one wins, this one stops */
    const mountToken = {};
    host.scratchqMount = mountToken;

    return loadScratchBlocks(cfg.scratchBlocksUrl).then(function (SB) {
        if (host.scratchqMount !== mountToken) return null;
        if (loading.parentNode === host) host.removeChild(loading);
        return cfg.kind === "trace" ? runTrace(SB) : runProgram(SB);
    });

    /* ---------- a trace question: the program read-only, the answer fields ---------- */
    function runTrace(SB) {
        const items = (cfg.trace && cfg.trace.items) || [{ kind: "say" }];
        const progBox = el("div", "margin-bottom:10px");
        editorPlace(progBox);
        const answers = (saved && saved.answers) || { say: [], vars: {}, lists: {}, branches: {} };
        const form = el("div", "display:grid;gap:10px;max-width:560px");
        host.appendChild(el("div", "font-weight:bold;margin:6px 0", ui.answerHere));
        host.appendChild(form);
        const fields = [];
        items.forEach(function (it, n) {
            const row = el(it.kind === "branch" ? "div" : "label", "display:flex;flex-direction:column;gap:3px");
            row.appendChild(el("span", "font-weight:bold", itemTitle(it)));
            let input;
            if (it.kind === "branch") {
                /* the parts of the if block: radio buttons (an if without else: the "then" part or neither) */
                const ifElse = cfg.reference.blocks[it.block] && cfg.reference.blocks[it.block].opcode === "control_if_else";
                input = el("div", "display:flex;flex-direction:column;gap:2px;padding:4px 6px;border-radius:6px");
                const chosen = (answers.branches || {})[it.block] || "";
                /* one name for the block's choices (a group: one of them), unique on the page */
                const group = "sq-branch-" + n + "-" + Math.random().toString(36).slice(2, 8);
                (ifElse ? ["if", "else"] : ["if", "none"]).forEach(function (v) {
                    const opt = el("label", "display:flex;gap:6px;align-items:center");
                    const r = el("input");
                    r.type = "radio";
                    r.name = group;
                    r.value = v;
                    r.checked = chosen === v;
                    r.disabled = review;
                    opt.appendChild(r);
                    opt.appendChild(el("span", "", ScratchQ.Trace.branchName(lang, v)));
                    input.appendChild(opt);
                });
            } else if (it.kind === "var") {
                input = el("input", "font:inherit;padding:5px 8px;width:220px;direction:ltr;unicode-bidi:plaintext");
                input.type = "text";
                input.value = answers.vars && answers.vars[it.name] !== undefined ? answers.vars[it.name] : "";
            } else {
                input = el("textarea", "font:inherit;padding:5px 8px;min-height:80px;unicode-bidi:plaintext");
                const value = it.kind === "say" ? answers.say : (answers.lists || {})[it.name];
                input.value = (value || []).join("\n");
                const hint = el("span", "font-size:13px;color:#666", it.kind === "say" ? ui.sayHint + " " : ui.listHint);
                if (it.kind === "say") {
                    /* the example is typed as in English, left to right, in any language (in RTL it would read "Hello [10]") */
                    const ex = el("span", "font-family:Consolas,monospace;unicode-bidi:isolate", "[10] Hello");
                    ex.dir = "ltr";
                    hint.appendChild(ex);
                }
                row.appendChild(hint);
            }
            input.readOnly = review;
            row.appendChild(input);
            form.appendChild(row);
            fields.push({ item: it, input: input });
        });
        function itemTitle(it) {
            if (it.kind === "say") return ScratchQ.tr(lang, "traceSay");
            if (it.kind === "branch") return ScratchQ.Trace.branchTitle(lang, cfg.reference, it.block);
            return ScratchQ.tr(lang, it.kind === "var" ? "traceVar" : "traceList", { v: it.name });
        }
        function read() {
            const a = { say: [], vars: {}, lists: {}, branches: {} };
            fields.forEach(function (f) {
                if (f.item.kind === "var") a.vars[f.item.name] = f.input.value.trim();
                else if (f.item.kind === "branch") {
                    const r = f.input.querySelector("input:checked");
                    a.branches[f.item.block] = r ? r.value : "";
                } else {
                    const lines = f.input.value.split("\n").map(function (s) { return s.trim(); }).filter(function (s) { return s !== ""; });
                    if (f.item.kind === "say") a.say = lines; else a.lists[f.item.name] = lines;
                }
            });
            return a;
        }
        function empty(a) {
            return !a.say.length && Object.keys(a.vars).every(function (k) { return a.vars[k] === ""; }) &&
                Object.keys(a.lists).every(function (k) { return !a.lists[k].length; }) &&
                Object.keys(a.branches).every(function (k) { return a.branches[k] === ""; });
        }
        function grade() {
            const a = read();
            return ScratchQ.Checker.gradeTrace(cfg, a, lang).then(function (g) { return { answers: a, result: g }; });
        }
        let timer = null;
        if (!review) {
            form.addEventListener("input", function () {
                clearTimeout(timer);
                timer = setTimeout(function () {
                    const a = read();
                    if (empty(a)) { if (adapter.save) adapter.save(null, 0); return; }
                    grade().then(function (g) {
                        const st = { v: 1, answers: g.answers, grade: g.result.grade, feedback: g.result.feedback };
                        if (cfg.variantIndex !== undefined) st.variant = cfg.variantIndex;
                        if (adapter.save) adapter.save(st, g.result.grade / 100);
                    });
                }, 300);
            });
            form.addEventListener("change", function (e) {                 // a radio button sends no "input" in every browser
                if (e.target && e.target.type === "radio") form.dispatchEvent(new Event("input"));
            });
        }
        return ScratchQ.Editor.create(progBox, { ScratchBlocks: SB, program: cfg.reference, readOnly: true, height: cfg.height || 320 }).then(function (view) {
            if (review) {
                const box = el("div");
                host.appendChild(box);
                return grade().then(function (g) {
                    showFeedback(box, cfg, saved ? { feedback: g.result.feedback } : null, lang);
                    fields.forEach(function (f, i) {
                        const s = g.result.scores ? g.result.scores[i] : (g.result.marks[i] ? 1 : 0);
                        f.input.style.background = !saved ? "" : (s >= 1 ? "#e6f4ea" : s > 0 ? "#fff4d6" : "#fde8e8");  // right, partly, wrong
                    });
                    if (cfg.review && cfg.review.reference === false) return { view: view, grade: grade };
                    box.appendChild(el("div", "font-weight:bold;margin-top:10px", ScratchQ.tr(lang, "correctAnswer")));
                    g.result.expected.items.forEach(function (it) {
                        const title = itemTitle(it);
                        if (it.kind === "branch") {
                            box.appendChild(el("div", "", title + " " + ScratchQ.Trace.branchName(lang, it.value)));
                            return;
                        }
                        if (it.kind === "say") {
                            /* one line each, repeats counted as in the browser's console: [10] Hello */
                            box.appendChild(el("div", "", title + ":"));
                            box.appendChild(el("div", "white-space:pre-wrap;unicode-bidi:plaintext;padding-inline-start:16px;font-family:Consolas,monospace",
                                ScratchQ.sayText(it.value, ScratchQ.tr(lang, "nothing"))));
                            return;
                        }
                        const v = Array.isArray(it.value) ? it.value.join(" | ") : String(it.value);
                        box.appendChild(el("div", "unicode-bidi:plaintext", title + ": " + v));
                    });
                    return { view: view, grade: grade };
                });
            }
            return { view: view, grade: grade };
        });
    }

    /* ---------- a program question: edit the starting program ---------- */
    function runProgram(SB) {
        const checker = ScratchQ.Checker.create(cfg);
        const initial = startingProgram(cfg);
        const program = saved && saved.program ? saved.program : initial;
        /*
         * The editor and, beside it, the student's drawing while answering (drawn again after each change): one row,
         * the drawing on the right (drawing.side "left": on the left) in any page direction. A narrow screen puts the
         * drawing under the editor. Without the drawing the editor has the whole width.
         */
        const edRow = el("div", "display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start");
        edRow.dir = cfg.drawing && cfg.drawing.side === "left" ? "rtl" : "ltr";
        const edBox = el("div", "flex:1 1 420px;min-width:0");
        edRow.appendChild(edBox);
        editorPlace(edRow);
        const liveDrawing = !review && drawingShown(cfg, "answering") ? el("div", "flex:0 0 auto") : null;
        if (liveDrawing) {
            liveDrawing.dir = host.dir;                              // the caption in the student's language
            edRow.appendChild(liveDrawing);
        }
        let drawTimer = null, drawSeq = 0;
        function redraw(p) {
            if (!liveDrawing) return;
            clearTimeout(drawTimer);
            drawTimer = setTimeout(function () {
                const mine = drawSeq += 1;
                drawingOf(p, cfg).then(function (segs) {
                    if (mine !== drawSeq) return;
                    liveDrawing.textContent = "";
                    liveDrawing.appendChild(drawingFigure(ScratchQ.tr(lang, "yourDrawing"), segs, cfg));
                });
            }, 150);
        }
        redraw(program);
        let timer = null, seq = 0, pending = null;
        function changed(p) {
            redraw(p);
            debug("the program changed (" + Object.keys(p.blocks || {}).length + " blocks)" + (review ? " - review, not saved" : !adapter.save ? " - nothing to save to" : ""));
            if (review || !adapter.save) return;
            clearTimeout(timer);
            pending = p;
            timer = setTimeout(gradeNow, 100);
        }
        /*
         * Pressing Moodle's Check takes the focus out of this frame (the button is on the page): the last edit is graded
         * at once then, so its score is in the input before the page is sent.
         */
        if (adapter.gradeOnBlur && !review) global.addEventListener("blur", function () {
            if (editorApi) editorApi.flush();
            if (pending) { debug("the frame lost the focus: grading now"); gradeNow(); }
        });
        let editorApi = null;
        function gradeNow() {
            clearTimeout(timer);
            const p = pending;
            pending = null;
            if (!p) return;
            /* the starting program untouched (or put back as it was) is not an answer */
            if (ScratchQ.sameProgram(p, initial)) { adapter.save(null, 0); return; }
            const mine = seq += 1, start = Date.now();
            debug("grading #" + mine + "...");
            const slow = setTimeout(function () { debug("grading #" + mine + " still running after 5 s"); }, 5000);
            checker.grade(p, lang).then(function (g) {
                clearTimeout(slow);
                debug("grading #" + mine + " done in " + (Date.now() - start) + " ms: " + g.grade + "%" + (mine !== seq ? " - a newer change replaces it" : ""));
                if (mine !== seq) return;                        // a newer change is being graded
                adapter.save({ v: 1, program: p, grade: g.grade, feedback: g.feedback }, g.grade / 100);
            }).catch(function (e) {
                clearTimeout(slow);
                /* nothing is saved: the inputs keep their last values */
                if (global.console) console.error("[ScratchQ] grading failed:", e);
            });
        }
        return ScratchQ.Editor.create(edBox, {
            ScratchBlocks: SB, program: program, palette: cfg.palette, readOnly: review,
            locks: cfg.locks, enforceLocks: true, height: cfg.height || 460, onChange: changed
        }).then(function (editor) {
            editorApi = editor;
            debug("the editor is ready (" + editor.workspace.getAllBlocks(false).length + " blocks)" + (review ? " - review" : ""));
            /* every edit's event (not the clicks and scrolling): shows whether the edits reach the editor */
            if (!review) editor.workspace.addChangeListener(function (e) { if (ScratchQ.DEBUG && !e.isUiEvent) debug("edit event: " + e.type); });
            const api = { editor: editor, grade: function () { return checker.grade(editor.getProgram(), lang); } };
            if (!review) return api;
            const box = el("div");
            host.appendChild(box);
            if (!saved || !saved.program) { showFeedback(box, cfg, null, lang); }
            else {
                /* graded again with the question's current tests - the saved grade is what Moodle has */
                return api.grade().then(function (g) {
                    showFeedback(box, cfg, { feedback: g.feedback }, lang);
                    return showDrawings(box);
                }).then(function () { return showReference(box); }).then(function () { return api; });
            }
            return showReference(box).then(function () { return api; });
        });
        /* the review: the student's drawing, and the correct one beside it when the review shows the reference */
        function showDrawings(box) {
            if (!drawingShown(cfg, "review")) return Promise.resolve();
            const withRef = !(cfg.review && cfg.review.reference === false);
            return Promise.all([drawingOf(saved.program, cfg), withRef ? drawingOf(cfg.reference, cfg) : null]).then(function (d) {
                const row = el("div", "display:flex;flex-wrap:wrap;gap:16px;margin-top:12px;align-items:flex-start");
                /* the same scale and place for both: the difference is what the eye compares */
                row.appendChild(drawingFigure(ScratchQ.tr(lang, "yourDrawing"), d[0], cfg, d[1] || []));
                if (withRef) row.appendChild(drawingFigure(ScratchQ.tr(lang, "refDrawing"), d[1], cfg, d[0]));
                box.appendChild(row);
            });
        }
        function showReference(box) {
            if (cfg.review && cfg.review.reference === false) return Promise.resolve();
            box.appendChild(el("div", "font-weight:bold;margin-top:12px", ScratchQ.tr(lang, "reference")));
            const refBox = el("div");
            box.appendChild(refBox);
            return ScratchQ.Editor.create(refBox, { ScratchBlocks: SB, program: cfg.reference, readOnly: true, height: 300 });
        }
    }
}

/* ============================================================
   STACK-JS - inside a STACK [[iframe]]
   ============================================================ */
/* the score as STACK's numerical input takes it also with "Forbid float": 0, 1 or a fraction (as the math question) */
function scoreText(score) {
    const n = Math.max(0, Math.min(10000, Math.round(score * 10000)));
    if (n === 0 || n === 10000) return String(n / 10000);
    let a = n, b = 10000;
    while (b) { const t = a % b; a = b; b = t; }
    return (n / a) + "/" + (10000 / a);
}

/* variant: this student's variant of a question with random values - STACK puts the question variable in: {#sqvar1#} */
function mountStackJs(stackJs, cfg, variant) {
    if (variant !== undefined) cfg = Object.assign({}, cfg, { variant: variant });
    if (cfg.debug === true) ScratchQ.DEBUG = true;
    const names = cfg.inputs || { score: "ans1", state: "ans2" };
    let host = document.getElementById(cfg.hostId || "scratchq");
    if (!host) {
        host = document.createElement("div");
        host.id = cfg.hostId || "scratchq";
        document.body.appendChild(host);
    }
    function access(name) {
        if (!name) return Promise.resolve(null);
        return Promise.resolve(stackJs.request_access_to_input(name, false, true)).then(function (id) { return document.getElementById(id); });
    }
    /* what goes into STACK's inputs (ScratchQ.DEBUG) */
    const log = debug;
    function put(e, value, name) {
        if (!e) { log(name + ": no such input - not saved"); return; }
        if (e.value === value) { log(name + " unchanged:", JSON.stringify(value.length > 60 ? value.slice(0, 60) + "... (" + value.length + " chars)" : value)); return; }
        e.value = value;
        e.dispatchEvent(new Event("change"));
        log(name + " =", JSON.stringify(value.length > 60 ? value.slice(0, 60) + "... (" + value.length + " chars)" : value));
    }
    return Promise.all([access(names.score), access(names.state)]).then(function (els) {
        const scoreEl = els[0], stateEl = els[1];
        const review = [scoreEl, stateEl].some(function (e) { return e && (e.readOnly || e.disabled); });
        log("library " + VERSION + "; the inputs when the question opened: " + names.score + " = " + JSON.stringify(scoreEl ? scoreEl.value : null) +
            ", " + names.state + ": " + (stateEl ? stateEl.value.length + " chars" : "missing") + "; review: " + review);
        fitFrame(stackJs);
        return runQuestion(host, cfg, {
            state: stateEl ? stateEl.value : null,
            review: review,
            gradeOnBlur: true,                           // the frame is the whole page: its blur is a click outside
            save: function (state, score) {
                log(state ? "graded: " + state.grade + "%" : "no answer (the starting program, or nothing)");
                put(stateEl, state ? ScratchQ.encodeState(state) : "", names.state);
                put(scoreEl, state ? scoreText(score) : "", names.score);
            }
        });
    }).catch(function (e) {
        const msg = "Scratch question: " + (e && e.message ? e.message : e);
        if (stackJs.display_error) stackJs.display_error(msg);
        if (global.console) console.error(msg, e);
    });
}

/*
 * The frame follows its content (as the math question): the bottom of every element shown. An element that clips
 * its content (overflow hidden / scroll, an <svg>) counts by its own box only: the palette's blocks scrolled out of
 * sight are far below the editor, and counting them made the frame as tall as the whole palette.
 */
function fitFrame(stackJs) {
    let last = 0, pending = false;
    function clips(e) {
        if (e instanceof SVGElement) return true;
        const s = global.getComputedStyle(e);
        return s.display === "none" || (s.overflowY && s.overflowY !== "visible");
    }
    function bottomOf(e, bottom) {
        const r = e.getBoundingClientRect();
        if (r.width && r.height && r.bottom > bottom) bottom = r.bottom;
        if (clips(e)) return bottom;
        for (let c = e.firstElementChild; c; c = c.nextElementSibling) bottom = bottomOf(c, bottom);
        return bottom;
    }
    function needed() {
        let bottom = 0;
        for (let c = document.body.firstElementChild; c; c = c.nextElementSibling) {
            if (c.tagName === "SCRIPT" || c.tagName === "STYLE") continue;
            bottom = bottomOf(c, bottom);
        }
        return Math.ceil(bottom + (global.scrollY || 0) + 12);
    }
    function check() {
        pending = false;
        const h = needed();
        if (Math.abs(h - last) < 3) return;
        last = h;
        stackJs.resize_containing_frame("100%", h + "px");
    }
    function soon() {
        if (pending) return;
        pending = true;
        setTimeout(check, 50);
    }
    if (global.ResizeObserver) new ResizeObserver(soon).observe(document.body);
    if (global.MutationObserver) new MutationObserver(soon).observe(document.body, { childList: true, subtree: false });
    global.addEventListener("resize", soon);
    document.documentElement.style.overflow = "hidden";
    soon();
}

/* ============================================================
   ANY OTHER SYSTEM
   ============================================================ */
function mount(element, cfg, opts) {
    opts = opts || {};
    const host = elementOf(element);
    if (!host) return Promise.reject(new Error("ScratchQ.Question.mount: no element " + JSON.stringify(element)));
    if (opts.variant !== undefined) cfg = Object.assign({}, cfg, { variant: opts.variant });
    return runQuestion(host, cfg, {
        state: opts.state || null,
        review: opts.readOnly === true,
        editorHost: opts.editorHost,
        save: typeof opts.onChange === "function" ? opts.onChange : null
    });
}

ScratchQ.Question = { version: VERSION, mount: mount, mountStackJs: mountStackJs, runQuestion: runQuestion, scoreText: scoreText, startingProgram: startingProgram };
})(typeof window !== "undefined" ? window : this);
