/*
 * Copyright (c) 2026 Avi Nathan. All rights reserved.
 * No part of this file may be copied, modified or distributed without the written permission of the copyright holder.
 */
/*
 * ScratchQ - Scratch-program questions (version ScratchQ.version). Design: SCRATCH-DESIGN.md.
 *
 * Platform-agnostic: no Moodle, no DOM except where a function says so. Needs the Scratch VM (scratch-vm 4.8.115,
 * BSD-3, the last release before the AGPL relicensing) as global.VirtualMachine or passed in opts.VirtualMachine.
 *
 * THE PROGRAM (the format of record - the questions, the state, the builder's file):
 *   { v: 1,
 *     variables: [{ id, name, value }],        - "for all sprites" (on the stage)
 *     lists:     [{ id, name, items: [] }],
 *     blocks:    { <id>: <block> } }           - Scratch 3 (.sb3 project.json) blocks of the one sprite, as the VM
 *                                                and scratch-blocks keep them (flat: parent / next / inputs / fields)
 *
 * A TEST:
 *   { name, vars: { <name>: value }, lists: { <name>: [..] }   - initial values (over the program's own)
 *     answers: [..],                                            - the answers to "ask", in order
 *     seed }                                                    - for "pick random"
 *
 * A RUN'S RESULT (Runner.run):
 *   { status: "done" | "timeout" | "noAnswer" | "error", message,
 *     say: [{ type: "say" | "think" | "ask", text }],          - text as the speech bubble shows it
 *     vars: { <name>: value }, lists: { <name>: [..] },
 *     ticks, seconds }                                          - frames (1/30 s) and virtual seconds
 */
(function (global) {
"use strict";

const VERSION = "0.1.0";

/* ============================================================
   THE PROGRAM -> a Scratch 3 project (project.json)
   ============================================================ */
const FRAME_MS = 1000 / 30;

/* a tiny costume: the VM loads none without storage (a warning only) - the sprite exists without a picture */
function costume(name, cx, cy) {
    return { assetId: "cd21514d0531fdffb22204e0ec5ed84a", name: name, md5ext: "cd21514d0531fdffb22204e0ec5ed84a.svg",
        dataFormat: "svg", rotationCenterX: cx, rotationCenterY: cy };
}

function emptyProgram() {
    return { v: 1, variables: [], lists: [], blocks: {} };
}

/*
 * program + test -> project.json. The variables and lists are global (on the stage); the test's values replace the
 * program's initial ones by name. The sprite is hidden: "ask" then asks without a speech bubble, so the say log has
 * only what the program says.
 */
function toProject(program, test) {
    program = program || emptyProgram();
    test = test || {};
    const tv = test.vars || {}, tl = test.lists || {};
    const variables = {}, lists = {};
    (program.variables || []).forEach(function (v) {
        const value = Object.prototype.hasOwnProperty.call(tv, v.name) ? tv[v.name] : v.value;
        variables[v.id] = [v.name, value === undefined ? 0 : value];
    });
    (program.lists || []).forEach(function (l) {
        const items = Object.prototype.hasOwnProperty.call(tl, l.name) ? tl[l.name] : l.items;
        lists[l.id] = [l.name, (items || []).slice()];
    });
    return {
        targets: [
            { isStage: true, name: "Stage", variables: variables, lists: lists, broadcasts: {}, blocks: {}, comments: {},
                currentCostume: 0, costumes: [costume("backdrop1", 240, 180)], sounds: [], volume: 100, layerOrder: 0,
                tempo: 60, videoTransparency: 50, videoState: "off", textToSpeechLanguage: null },
            { isStage: false, name: "Sprite1", variables: {}, lists: {}, broadcasts: {},
                blocks: JSON.parse(JSON.stringify(program.blocks || {})), comments: {},
                currentCostume: 0, costumes: [costume("costume1", 0, 0)], sounds: [], volume: 100, layerOrder: 1,
                visible: false, x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: "all around" }
        ],
        monitors: [], extensions: [], meta: { semver: "3.0.0", vm: "0.2.0", agent: "ScratchQ " + VERSION }
    };
}

/* ============================================================
   SEEDED RANDOM - "pick random" uses Math.random
   ============================================================ */
function seededRandom(seed) {
    let a = (Number(seed) || 0) >>> 0;
    if (!a) a = 0x9E3779B9;
    return function () {                               // mulberry32
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/* ============================================================
   THE RUNNER - the real Scratch VM, headless, on a virtual clock
   ============================================================ */
/* the bubble's text, as Scratch shows it (scratch3_looks._formatBubbleText) */
function bubbleText(text) {
    if (text === "") return text;
    if (typeof text === "number" && Math.abs(text) >= 0.01 && text % 1 !== 0) text = text.toFixed(2);
    return String(text).substr(0, 330);
}

function vmClass(opts) {
    const VM = (opts && opts.VirtualMachine) || global.VirtualMachine;
    if (!VM) throw new Error("ScratchQ: the Scratch VM (scratch-vm) is not loaded");
    return VM;
}

function microtask() { return Promise.resolve(); }

/*
 * Runs the program (its green-flag scripts) on one test. opts: { maxTicks (default 30000 = 1000 virtual seconds),
 * maxMs (real time, default 1500), sliceMs, VirtualMachine }.
 *
 * The clock: the VM's timers (wait, glide) read runtime.currentMSecs, which the Runner advances by one frame per
 * step - no real waiting. "say/think for (n) secs" use a real setTimeout in the VM, so they are replaced by the same
 * logic as "wait". Every step's Math.random is the test's seeded generator.
 */
function run(program, test, opts) {
    opts = opts || {};
    test = test || {};
    const VM = vmClass(opts);
    const vm = new VM();
    const rt = vm.runtime;
    const result = { status: "done", message: "", say: [], vars: {}, lists: {}, ticks: 0, seconds: 0 };
    const answers = (test.answers || []).slice();
    let now = 0, noAnswer = false;

    /*
     * The sequencer works 75% of currentStepTime (real time) per frame, then the frame ends - also when its only
     * thread is waiting (wait, say for secs: a yielding thread counts as active). A small slice (0.75 ms): 6 virtual
     * seconds of waiting cost ~180 frames x 0.75 ms instead of 180 x 25 ms. The virtual clock is separate (FRAME_MS
     * per frame), so the slice does not change any result of one script; a long computation just takes more frames.
     */
    rt.currentStepTime = opts.sliceMs || 1;
    rt.updateCurrentMSecs = function () { this.currentMSecs = now; };

    rt.on("SAY", function (target, type, text) {
        if (target && target.isStage) return;
        const shown = bubbleText(text);
        if (shown === "") return;                       // a bubble cleared
        result.say.push({ type: type, text: shown });
    });
    rt.on("QUESTION", function (question) {
        if (question === null) return;                  // questions cleared (stop)
        result.say.push({ type: "ask", text: String(question) });
        if (!answers.length) { noAnswer = true; return; }
        rt.emit("ANSWER", String(answers.shift()));
    });

    return vm.loadProject(toProject(program, test)).then(function () {
        const p = rt._primitives;
        const wait = p.control_wait;
        if (wait) {
            ["say", "think"].forEach(function (kind) {
                const show = p["looks_" + kind];
                p["looks_" + kind + "forsecs"] = function (args, util) {
                    if (util.stackTimerNeedsInit()) show(args, util);
                    wait({ DURATION: args.SECS }, util);
                    if (!util.stackTimerNeedsInit() && util.stackTimerFinished()) {
                        rt.emit("SAY", util.target, kind, "");
                    }
                };
            });
        }
        const random = seededRandom(test.seed);
        const realRandom = Math.random;
        const maxTicks = opts.maxTicks || 30000, maxMs = opts.maxMs || 1500;
        const start = Date.now();

        function step() {
            now += FRAME_MS;
            result.ticks += 1;
            Math.random = random;
            try { rt._step(); } finally { Math.random = realRandom; }
        }
        function alive() {
            return rt.threads.some(function (t) { return t.stack.length > 0 && !t.isKilled; });
        }

        rt.greenFlag();
        function loop() {
            for (let i = 0; i < 200; i += 1) {          // a batch of frames, then the promises (ask) resolve
                if (!alive()) return finish();
                if (noAnswer) { result.status = "noAnswer"; return finish(); }
                if (result.ticks >= maxTicks || Date.now() - start > maxMs) { result.status = "timeout"; return finish(); }
                step();
            }
            return microtask().then(loop);
        }
        return microtask().then(loop);
    }).catch(function (e) {
        result.status = "error";
        result.message = e && e.message ? e.message : String(e);
        return finish();
    });

    function finish() {
        result.seconds = Math.round(now) / 1000;
        try {
            rt.stopAll();
            rt.targets.forEach(function (t) {
                Object.keys(t.variables || {}).forEach(function (id) {
                    const v = t.variables[id];
                    if (v.type === "list") result.lists[v.name] = v.value.slice();
                    else if (v.type === "" || v.type === undefined) result.vars[v.name] = v.value;
                });
            });
        } catch (e) { /* keep what was read */ }
        try { vm.quit && vm.quit(); } catch (e) { /* ignore */ }
        return result;
    }
}

/* ============================================================
   COMPARING PROGRAMS (the untouched starting program is not an answer)
   ============================================================ */
/* the blocks without positions and comments, in a stable order - two programs are the same when this is */
function programKey(program) {
    if (!program) return "";
    const blocks = program.blocks || {};
    const clean = {};
    Object.keys(blocks).sort().forEach(function (id) {
        const b = blocks[id];
        if (Array.isArray(b)) { clean[id] = b.slice(0, 3); return; }        // a top-level variable / list reporter
        clean[id] = { o: b.opcode, n: b.next, p: b.parent, i: b.inputs, f: b.fields, s: !!b.shadow, m: b.mutation || null };
    });
    return JSON.stringify(clean);
}
function sameProgram(a, b) { return programKey(a) === programKey(b); }

/* the green-flag scripts of a program: is there anything that runs? */
function hasScript(program) {
    const blocks = (program && program.blocks) || {};
    return Object.keys(blocks).some(function (id) {
        const b = blocks[id];
        return b && b.opcode === "event_whenflagclicked" && b.next;
    });
}

/* ============================================================
   THE CHECKER - tests: the reference's outputs are what is expected
   ============================================================ */
/*
 * The question's checking settings (part of the question configuration):
 *   tests:   [{ name, vars, lists, answers, seed, hidden }]       - none: one test with the program's own values
 *   observe: { say: true, vars: [names], lists: [names], caseSensitive: false }
 *   mistakes: [{ program, message: { he, ar, en }, score }]       - teacher mistake programs (score 0..100 or null)
 */
const TEXT = {
    en: {
        passed: "Passed {p} of {n} tests.", allPassed: "Correct - all {n} tests passed.", noScript: "The program has no script that starts with the green flag.",
        test: "Test", hiddenFailed: "A hidden test failed.", timeout: "The program did not stop.", noAnswer: "The program asked more questions than the test answers.",
        error: "The program could not run: {m}", expectedSay: "Expected the sprite to say: {e}", gotSay: "Your program said: {g}", nothing: "(nothing)",
        expectedVar: "Expected {v} = {e}; it is {g}.", expectedList: "Expected the list {v} = [{e}]; it is [{g}].",
        traceCorrect: "Correct.", traceWrong: "{p} of {n} answers are correct.", traceSay: "What the sprite says", traceVar: "The value of {v}", traceList: "The list {v}",
        reference: "The correct program:", correctAnswer: "The correct answer:", empty: "No answer was given."
    },
    he: {
        passed: "עברו {p} מתוך {n} בדיקות.", allPassed: "נכון - כל {n} הבדיקות עברו.", noScript: "אין בתוכנית תסריט שמתחיל בדגל הירוק.",
        test: "בדיקה", hiddenFailed: "בדיקה נסתרת נכשלה.", timeout: "התוכנית לא נעצרה.", noAnswer: "התוכנית שאלה יותר שאלות מהתשובות שבבדיקה.",
        error: "לא ניתן להריץ את התוכנית: {m}", expectedSay: "הדמות הייתה צריכה לומר: {e}", gotSay: "התוכנית שלך אמרה: {g}", nothing: "(כלום)",
        expectedVar: "היה צריך להיות {v} = {e}; הערך הוא {g}.", expectedList: "הרשימה {v} הייתה צריכה להיות [{e}]; היא [{g}].",
        traceCorrect: "נכון.", traceWrong: "{p} מתוך {n} תשובות נכונות.", traceSay: "מה הדמות אומרת", traceVar: "הערך של {v}", traceList: "הרשימה {v}",
        reference: "התוכנית הנכונה:", correctAnswer: "התשובה הנכונה:", empty: "לא ניתנה תשובה."
    },
    ar: {
        passed: "نجح {p} من {n} اختبارات.", allPassed: "صحيح - نجحت جميع الاختبارات ({n}).", noScript: "لا يوجد في البرنامج نص برمجي يبدأ بالعلم الأخضر.",
        test: "اختبار", hiddenFailed: "فشل اختبار مخفي.", timeout: "البرنامج لم يتوقف.", noAnswer: "طرح البرنامج أسئلة أكثر من الإجابات في الاختبار.",
        error: "تعذّر تشغيل البرنامج: {m}", expectedSay: "كان يجب أن يقول الكائن: {e}", gotSay: "قال برنامجك: {g}", nothing: "(لا شيء)",
        expectedVar: "كان يجب أن يكون {v} = {e}؛ القيمة {g}.", expectedList: "كان يجب أن تكون القائمة {v} = [{e}]؛ هي [{g}].",
        traceCorrect: "صحيح.", traceWrong: "{p} من {n} إجابات صحيحة.", traceSay: "ماذا يقول الكائن", traceVar: "قيمة {v}", traceList: "القائمة {v}",
        reference: "البرنامج الصحيح:", correctAnswer: "الإجابة الصحيحة:", empty: "لم تُعطَ إجابة."
    }
};
function supportedLanguage(code) {
    code = String(code || "").replace(/['"\s]/g, "").toLowerCase().slice(0, 2);
    return TEXT[code] ? code : "";
}
function tr(lang, key, vars) {
    let s = (TEXT[lang] || TEXT.en)[key] || TEXT.en[key] || key;
    Object.keys(vars || {}).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
    return s;
}

/* two values as Scratch shows them: numbers by value (5 = 5.0 = "5"), text trimmed, case by the setting */
function isNumeric(s) { return /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i.test(String(s)); }
function sameValue(a, b, caseSensitive) {
    const sa = String(a === undefined || a === null ? "" : a).trim(), sb = String(b === undefined || b === null ? "" : b).trim();
    if (isNumeric(sa) && isNumeric(sb)) {
        const x = Number(sa), y = Number(sb);
        return x === y || Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
    }
    return caseSensitive ? sa === sb : sa.toLowerCase() === sb.toLowerCase();
}
function sameList(a, b, cs) {
    a = a || []; b = b || [];
    return a.length === b.length && a.every(function (v, i) { return sameValue(v, b[i], cs); });
}

/* what a test observes of a run: the say log (say / think, not the questions), chosen variables and lists */
function observed(run, observe) {
    observe = observe || { say: true };
    const o = { status: run.status, message: run.message };
    if (observe.say !== false) o.say = run.say.filter(function (s) { return s.type !== "ask"; }).map(function (s) { return s.text; });
    o.vars = {};
    (observe.vars || []).forEach(function (n) { o.vars[n] = run.vars[n]; });
    o.lists = {};
    (observe.lists || []).forEach(function (n) { o.lists[n] = run.lists[n] || []; });
    return o;
}
function sameObserved(a, b, observe) {
    const cs = !!(observe && observe.caseSensitive);
    if (a.status !== b.status && (a.status !== "done" || b.status !== "done")) return false;
    if (a.say || b.say) { if (!sameList(a.say, b.say, cs)) return false; }
    if (Object.keys(a.vars).some(function (n) { return !sameValue(a.vars[n], b.vars[n], cs); })) return false;
    if (Object.keys(a.lists).some(function (n) { return !sameList(a.lists[n], b.lists[n], cs); })) return false;
    return true;
}

function testsOf(q) { return q.tests && q.tests.length ? q.tests : [{ name: "1" }]; }

/* runs a program on every test of the question: [observed] */
function runTests(program, q, opts) {
    const tests = testsOf(q);
    return tests.reduce(function (p, test) {
        return p.then(function (all) {
            return run(program, test, opts).then(function (r) { all.push(observed(r, q.observe)); return all; });
        });
    }, Promise.resolve([]));
}

/*
 * A say log as people read it - the convention of the browser's console: consecutive repeats are one line with the
 * count before it, ["Hello!","Hello!","Hello!","Bye"] -> ["[3] Hello!", "Bye"]. Nobody has to count the repetitions.
 * sayText joins the lines (default: a new line each, as in the console).
 */
function sayLines(lines) {
    const runs = [];
    (lines || []).forEach(function (s) {
        const last = runs[runs.length - 1];
        if (last && last.text === s) last.n += 1; else runs.push({ text: s, n: 1 });
    });
    return runs.map(function (r) { return (r.n > 1 ? "[" + r.n + "] " : "") + r.text; });
}
function sayText(lines, nothing, separator) {
    if (!lines || !lines.length) return nothing === undefined ? "" : nothing;
    return sayLines(lines).join(separator === undefined ? "\n" : separator);
}
/* the other way (a trace answer typed by the student): "[10] Hello" is ten lines "Hello" */
const REPEAT_LINE = /^\[(\d{1,4})\]\s?(.*)$/;
function expandSayLines(lines) {
    const out = [];
    (lines || []).forEach(function (s) {
        const m = REPEAT_LINE.exec(String(s).trim());
        if (m && Number(m[1]) > 0) { for (let i = 0; i < Number(m[1]); i += 1) out.push(m[2].trim()); }
        else out.push(String(s).trim());
    });
    return out;
}

/* the feedback lines of one failed test */
function failLines(lang, exp, got, observe) {
    const lines = [];
    const cs = !!(observe && observe.caseSensitive);
    if (got.status === "timeout") return [tr(lang, "timeout")];
    if (got.status === "noAnswer") return [tr(lang, "noAnswer")];
    if (got.status === "error") return [tr(lang, "error", { m: got.message })];
    if ((exp.say || got.say) && !sameList(exp.say, got.say, cs)) {
        /* each said line on its own line, indented under its title (the feedback is shown with line breaks kept) */
        lines.push(tr(lang, "expectedSay", { e: "" }).trim());
        lines.push(sayText(exp.say, tr(lang, "nothing"), "\n    ").replace(/^/, "    "));
        lines.push(tr(lang, "gotSay", { g: "" }).trim());
        lines.push(sayText(got.say, tr(lang, "nothing"), "\n    ").replace(/^/, "    "));
    }
    Object.keys(exp.vars).forEach(function (n) {
        if (!sameValue(exp.vars[n], got.vars[n], cs)) lines.push(tr(lang, "expectedVar", { v: n, e: exp.vars[n], g: got.vars[n] === undefined ? "?" : got.vars[n] }));
    });
    Object.keys(exp.lists).forEach(function (n) {
        if (!sameList(exp.lists[n], got.lists[n], cs)) lines.push(tr(lang, "expectedList", { v: n, e: exp.lists[n].join(", "), g: (got.lists[n] || []).join(", ") }));
    });
    return lines;
}

/*
 * A checker for one question (q = the question configuration: reference, tests, observe, mistakes). It keeps the
 * reference's and the mistakes' outputs, so a student program costs only its own runs.
 *   checker.grade(program, lang) -> { grade 0..100, tests: [{ name, hidden, pass, expected, got }], feedback, mistake }
 */
function createChecker(q, opts) {
    /* 400 ms of real time per test: ~600,000 loop rounds here (10,000 take 6 ms), plenty for grades 7-9 even on a
       slow school computer; a program that never stops costs 0.4 s per test instead of 1.5 s */
    opts = Object.assign({ maxMs: 400 }, opts || {});
    let expected = null, mistakeOutputs = null;
    function reference() {
        if (!expected) expected = runTests(q.reference, q, opts);
        return expected;
    }
    function mistakes() {
        if (!mistakeOutputs) {
            mistakeOutputs = (q.mistakes || []).reduce(function (p, m) {
                return p.then(function (all) {
                    return runTests(m.program, q, opts).then(function (o) { all.push(o); return all; });
                });
            }, Promise.resolve([]));
        }
        return mistakeOutputs;
    }
    function grade(program, lang) {
        lang = supportedLanguage(lang) || "en";
        const tests = testsOf(q);
        if (!hasScript(program)) {
            return Promise.resolve({ grade: 0, tests: [], feedback: tr(lang, "noScript"), mistake: null });
        }
        return Promise.all([reference(), runTests(program, q, opts), mistakes()]).then(function (all) {
            const exp = all[0], got = all[1], mist = all[2];
            const results = tests.map(function (t, i) {
                return { name: t.name || String(i + 1), hidden: !!t.hidden, pass: sameObserved(exp[i], got[i], q.observe), expected: exp[i], got: got[i] };
            });
            const passed = results.filter(function (r) { return r.pass; }).length;
            let score = Math.round(10000 * passed / results.length) / 100;
            const lines = [passed === results.length ? tr(lang, "allPassed", { n: results.length }) : tr(lang, "passed", { p: passed, n: results.length })];
            let hiddenFailed = false;
            results.forEach(function (r) {
                if (r.pass) return;
                if (r.hidden) { hiddenFailed = true; return; }
                lines.push(tr(lang, "test") + " " + r.name + ":");
                failLines(lang, r.expected, r.got, q.observe).forEach(function (l) { lines.push("  " + l); });
            });
            if (hiddenFailed) lines.push(tr(lang, "hiddenFailed"));
            /* a teacher mistake: the student's outputs equal the mistake program's on every test */
            let mistake = null;
            if (passed < results.length) {
                const i = mist.findIndex(function (mo) { return mo.every(function (o, k) { return sameObserved(o, got[k], q.observe); }); });
                if (i >= 0) {
                    const m = q.mistakes[i];
                    mistake = i;
                    const msg = m.message && (m.message[lang] || m.message.en || m.message.he || m.message.ar);
                    if (msg) lines.unshift(msg);
                    if (typeof m.score === "number" && m.score >= 0) score = m.score;
                }
            }
            return { grade: score, tests: results, feedback: lines.join("\n"), mistake: mistake };
        });
    }
    return { grade: grade, reference: reference, mistakes: mistakes };
}

/*
 * A trace question (K1): the student writes what the shown program gives. q.trace.items: [{ kind: "say" }
 * | { kind: "var", name } | { kind: "list", name }]; answers: { say: [lines], vars: { name: text }, lists: { name: [..] } }.
 */
function traceExpected(q, opts) {
    const test = testsOf(q)[0];
    return run(q.reference, test, opts).then(function (r) {
        const items = (q.trace && q.trace.items) || [{ kind: "say" }];
        return {
            status: r.status,
            items: items.map(function (it) {
                if (it.kind === "say") return { kind: "say", value: r.say.filter(function (s) { return s.type !== "ask"; }).map(function (s) { return s.text; }) };
                if (it.kind === "var") return { kind: "var", name: it.name, value: r.vars[it.name] };
                return { kind: "list", name: it.name, value: r.lists[it.name] || [] };
            })
        };
    });
}
function gradeTrace(q, answers, lang, opts) {
    lang = supportedLanguage(lang) || "en";
    const cs = !!(q.trace && q.trace.caseSensitive);
    answers = answers || {};
    return traceExpected(q, opts).then(function (exp) {
        const marks = exp.items.map(function (it) {
            if (it.kind === "say") {
                const lines = expandSayLines((answers.say || []).map(function (s) { return String(s).trim(); }).filter(function (s) { return s !== ""; }));
                return sameList(it.value, lines, cs);
            }
            if (it.kind === "var") return sameValue(it.value, (answers.vars || {})[it.name], cs);
            const given = (answers.lists || {})[it.name] || [];
            return sameList(it.value, given.map(function (s) { return String(s).trim(); }).filter(function (s) { return s !== ""; }), cs);
        });
        const ok = marks.filter(Boolean).length;
        return {
            grade: Math.round(10000 * ok / marks.length) / 100, marks: marks, expected: exp,
            feedback: ok === marks.length ? tr(lang, "traceCorrect") : tr(lang, "traceWrong", { p: ok, n: marks.length })
        };
    });
}

/* ============================================================
   THE STATE IN STACK - as the math question: prefix + base64 of the JSON (UTF-8)
   ============================================================ */
const STATE_PREFIX = "sq1:";
function encodeState(state) {
    const bytes = new TextEncoder().encode(JSON.stringify(state));
    let bin = "";
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return STATE_PREFIX + global.btoa(bin);
}
function parseState(text) {
    if (text && typeof text === "object") return text;
    if (!text) return null;
    text = String(text).trim();
    try {
        if (text.indexOf(STATE_PREFIX) === 0) {
            const bin = global.atob(text.slice(STATE_PREFIX.length).replace(/\s+/g, ""));
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
            text = new TextDecoder().decode(bytes);
        }
        const s = JSON.parse(text);
        return s && typeof s === "object" ? s : null;
    } catch (e) { return null; }
}

const ScratchQ = {
    version: VERSION,
    emptyProgram: emptyProgram,
    toProject: toProject,
    seededRandom: seededRandom,
    Runner: { run: run, bubbleText: bubbleText },
    programKey: programKey,
    sameProgram: sameProgram,
    hasScript: hasScript,
    sameValue: sameValue,
    sayText: sayText,
    sayLines: sayLines,
    expandSayLines: expandSayLines,
    Checker: { create: createChecker, runTests: runTests, observed: observed, sameObserved: sameObserved, traceExpected: traceExpected, gradeTrace: gradeTrace },
    TEXT: TEXT,
    supportedLanguage: supportedLanguage,
    tr: tr,
    encodeState: encodeState,
    parseState: parseState
};
if (typeof module === "object" && module.exports) module.exports = ScratchQ;
global.ScratchQ = ScratchQ;
})(typeof window !== "undefined" ? window : this);
