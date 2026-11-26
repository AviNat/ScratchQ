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
 *   ScratchQ.Question.mount(element, config, options)   any other system
 *     options.state     the saved state (object, JSON or "sq1:" text) or null
 *     options.readOnly  true: the review
 *     options.onChange  function (state, score) after every change (state null: no answer)
 *
 * Needs, loaded before it: the Scratch VM (global VirtualMachine), scratchq.js, scratchq-editor.js. Loads
 * scratch-blocks itself (an ES module) unless config.scratchBlocksUrl says otherwise.
 *
 * The configuration (the builder's "question code"):
 *   { tool: "scratchq-question", formatVersion: 1, questionId,
 *     language: "he" | "ar" | "en" | "system",           - the student language (all texts but the blocks)
 *     kind: "trace" | "program",                          - trace: write what the program gives; program: edit it
 *     review: { grade, feedback, reference },             - what the review shows (each true unless false)
 *     inputs: { score: "ans1", state: "ans2" },           - STACK-JS only
 *     reference, initial, locks, palette,                 - programs (scratchq.js), locks (scratchq-editor.js)
 *     tests, observe, mistakes, trace: { items },         - the checking (scratchq.js, Checker)
 *     height }                                            - the block area's height in px
 *
 * The saved state: { v: 1, program | answers, grade (0..100), feedback }; in STACK "sq1:" + base64 of its JSON.
 */
(function (global) {
"use strict";

const ScratchQ = global.ScratchQ;
if (!ScratchQ || !ScratchQ.Editor) throw new Error("scratchq-question.js needs scratchq.js and scratchq-editor.js");

const VERSION = "0.1.0";
const UI = {
    en: { answerHere: "Your answer:", sayHint: "One line for each thing the sprite says, in order. The same thing several times in a row: [10] Hello", listHint: "One item per line.",
          yourProgram: "Your program:", loading: "Loading…" },
    he: { answerHere: "התשובה שלך:", sayHint: "שורה לכל דבר שהדמות אומרת, לפי הסדר. אותו דבר כמה פעמים ברצף: [10] Hello", listHint: "פריט אחד בכל שורה.",
          yourProgram: "התוכנית שלך:", loading: "טוען…" },
    ar: { answerHere: "إجابتك:", sayHint: "سطر لكل ما يقوله الكائن، بالترتيب. الشيء نفسه عدة مرات متتالية: [10] Hello", listHint: "عنصر واحد في كل سطر.",
          yourProgram: "برنامجك:", loading: "جارٍ التحميل…" }
};

let sbLoading = null;
function loadScratchBlocks(url) {
    if (global.ScratchBlocks) return Promise.resolve(global.ScratchBlocks);
    if (!sbLoading) sbLoading = import(url || ScratchQ.Editor.SCRATCH_BLOCKS_URL).then(function (m) { global.ScratchBlocks = m; return m; });
    return sbLoading;
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

/* the feedback block of the review: the grade line, then the rest */
function showFeedback(box, cfg, saved, lang) {
    const show = cfg.review || {};
    if (!saved) { box.appendChild(el("div", "font-weight:bold;margin-top:8px", ScratchQ.tr(lang, "empty"))); return; }
    const lines = String(saved.feedback || "").split("\n");
    if (show.grade !== false) box.appendChild(el("div", "font-weight:bold;font-size:17px;margin-top:8px", lines[0]));
    if (show.feedback !== false && lines.length > 1) box.appendChild(el("div", "white-space:pre-wrap;margin-top:4px", lines.slice(1).join("\n")));
}

/*
 * host - an element; cfg - the configuration; adapter - { state, review, save(state, score) }.
 * Returns a promise of { editor?, grade() }.
 */
function runQuestion(host, cfg, adapter) {
    adapter = adapter || {};
    const lang = studentLanguage(cfg);
    const ui = UI[lang] || UI.en;
    const review = adapter.review === true;
    const saved = ScratchQ.parseState(adapter.state);
    host.textContent = "";
    host.dir = lang === "en" ? "ltr" : "rtl";
    const loading = el("div", "color:#666", ui.loading);
    host.appendChild(loading);

    return loadScratchBlocks(cfg.scratchBlocksUrl).then(function (SB) {
        host.removeChild(loading);
        return cfg.kind === "trace" ? runTrace(SB) : runProgram(SB);
    });

    /* ---------- a trace question: the program read-only, the answer fields ---------- */
    function runTrace(SB) {
        const items = (cfg.trace && cfg.trace.items) || [{ kind: "say" }];
        const progBox = el("div", "margin-bottom:10px");
        host.appendChild(progBox);
        const answers = (saved && saved.answers) || { say: [], vars: {}, lists: {} };
        const form = el("div", "display:grid;gap:10px;max-width:560px");
        host.appendChild(el("div", "font-weight:bold;margin:6px 0", ui.answerHere));
        host.appendChild(form);
        const fields = [];
        items.forEach(function (it) {
            const row = el("label", "display:flex;flex-direction:column;gap:3px");
            const title = it.kind === "say" ? ScratchQ.tr(lang, "traceSay") : ScratchQ.tr(lang, it.kind === "var" ? "traceVar" : "traceList", { v: it.name });
            row.appendChild(el("span", "font-weight:bold", title));
            let input;
            if (it.kind === "var") {
                input = el("input", "font:inherit;padding:5px 8px;width:220px;direction:ltr;unicode-bidi:plaintext");
                input.type = "text";
                input.value = answers.vars && answers.vars[it.name] !== undefined ? answers.vars[it.name] : "";
            } else {
                input = el("textarea", "font:inherit;padding:5px 8px;min-height:80px;unicode-bidi:plaintext");
                const value = it.kind === "say" ? answers.say : (answers.lists || {})[it.name];
                input.value = (value || []).join("\n");
                row.appendChild(el("span", "font-size:13px;color:#666", it.kind === "say" ? ui.sayHint : ui.listHint));
            }
            input.readOnly = review;
            row.appendChild(input);
            form.appendChild(row);
            fields.push({ item: it, input: input });
        });
        function read() {
            const a = { say: [], vars: {}, lists: {} };
            fields.forEach(function (f) {
                if (f.item.kind === "var") a.vars[f.item.name] = f.input.value.trim();
                else {
                    const lines = f.input.value.split("\n").map(function (s) { return s.trim(); }).filter(function (s) { return s !== ""; });
                    if (f.item.kind === "say") a.say = lines; else a.lists[f.item.name] = lines;
                }
            });
            return a;
        }
        function empty(a) {
            return !a.say.length && Object.keys(a.vars).every(function (k) { return a.vars[k] === ""; }) &&
                Object.keys(a.lists).every(function (k) { return !a.lists[k].length; });
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
                        if (adapter.save) adapter.save({ v: 1, answers: g.answers, grade: g.result.grade, feedback: g.result.feedback }, g.result.grade / 100);
                    });
                }, 300);
            });
        }
        return ScratchQ.Editor.create(progBox, { ScratchBlocks: SB, program: cfg.reference, readOnly: true, height: cfg.height || 320 }).then(function (view) {
            if (review) {
                const box = el("div");
                host.appendChild(box);
                return grade().then(function (g) {
                    showFeedback(box, cfg, saved ? { feedback: g.result.feedback } : null, lang);
                    fields.forEach(function (f, i) {
                        f.input.style.background = !saved ? "" : (g.result.marks[i] ? "#e6f4ea" : "#fde8e8");
                    });
                    if (cfg.review && cfg.review.reference === false) return { view: view, grade: grade };
                    box.appendChild(el("div", "font-weight:bold;margin-top:10px", ScratchQ.tr(lang, "correctAnswer")));
                    g.result.expected.items.forEach(function (it) {
                        const title = it.kind === "say" ? ScratchQ.tr(lang, "traceSay") : ScratchQ.tr(lang, it.kind === "var" ? "traceVar" : "traceList", { v: it.name });
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
        const edBox = el("div");
        host.appendChild(edBox);
        let timer = null, seq = 0;
        function changed(p) {
            if (review || !adapter.save) return;
            clearTimeout(timer);
            timer = setTimeout(function () {
                /* the starting program untouched (or put back as it was) is not an answer */
                if (ScratchQ.sameProgram(p, initial)) { adapter.save(null, 0); return; }
                const mine = seq += 1;
                checker.grade(p, lang).then(function (g) {
                    if (mine !== seq) return;                        // a newer change is being graded
                    adapter.save({ v: 1, program: p, grade: g.grade, feedback: g.feedback }, g.grade / 100);
                });
            }, 400);
        }
        return ScratchQ.Editor.create(edBox, {
            ScratchBlocks: SB, program: program, palette: cfg.palette, readOnly: review,
            locks: cfg.locks, enforceLocks: true, height: cfg.height || 460, onChange: changed
        }).then(function (editor) {
            const api = { editor: editor, grade: function () { return checker.grade(editor.getProgram(), lang); } };
            if (!review) return api;
            const box = el("div");
            host.appendChild(box);
            if (!saved || !saved.program) { showFeedback(box, cfg, null, lang); }
            else {
                /* graded again with the question's current tests - the saved grade is what Moodle has */
                return api.grade().then(function (g) {
                    showFeedback(box, cfg, { feedback: g.feedback }, lang);
                    return showReference(box).then(function () { return api; });
                });
            }
            return showReference(box).then(function () { return api; });
        });
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

function mountStackJs(stackJs, cfg) {
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
    function put(e, value) {
        if (!e || e.value === value) return;
        e.value = value;
        e.dispatchEvent(new Event("change"));
    }
    return Promise.all([access(names.score), access(names.state)]).then(function (els) {
        const scoreEl = els[0], stateEl = els[1];
        const review = [scoreEl, stateEl].some(function (e) { return e && (e.readOnly || e.disabled); });
        fitFrame(stackJs);
        return runQuestion(host, cfg, {
            state: stateEl ? stateEl.value : null,
            review: review,
            save: function (state, score) {
                put(stateEl, state ? ScratchQ.encodeState(state) : "");
                put(scoreEl, state ? scoreText(score) : "");
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
    return runQuestion(element, cfg, {
        state: opts.state || null,
        review: opts.readOnly === true,
        save: typeof opts.onChange === "function" ? opts.onChange : null
    });
}

ScratchQ.Question = { version: VERSION, mount: mount, mountStackJs: mountStackJs, runQuestion: runQuestion, scoreText: scoreText, startingProgram: startingProgram };
})(typeof window !== "undefined" ? window : this);
