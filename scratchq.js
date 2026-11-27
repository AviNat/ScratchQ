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
 *     pen: [[x1, y1, x2, y2]],                                  - the lines drawn with the pen, as drawn
 *     ticks, seconds }                                          - frames (1/30 s) and virtual seconds
 *
 * Every test starts with the sprite at (0, 0), pointing right (90), pen up. There is no stage edge: Scratch keeps a
 * sprite inside the stage, here it may go anywhere.
 */
(function (global) {
"use strict";

const VERSION = "0.3.0";

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
/*
 * Creating and loading the VMs one at a time. The VM registers an extension's blocks (the pen) through a dispatcher
 * shared by all the VMs of the page, which talks to the VM created last: a VM created while another one loads gets
 * the other's pen blocks, and the other's "pen down" does nothing. The checker runs the reference and the student's
 * program side by side, so the loads wait in a queue - and a load that still lacks an extension's blocks (a VM made
 * elsewhere, e.g. by an editor, at that moment) is done once again.
 */
let vmQueue = Promise.resolve();
function extensionOpcodes(program) {
    const ops = {};
    Object.keys((program && program.blocks) || {}).forEach(function (id) {
        const b = program.blocks[id];
        if (b && !Array.isArray(b) && /^pen_/.test(b.opcode)) ops[b.opcode] = true;
    });
    return Object.keys(ops);
}
function loadVm(VM, project, needs) {
    function attempt(again) {
        const vm = new VM();
        return vm.loadProject(project).then(function () {
            const missing = needs.some(function (op) { return !vm.runtime._primitives[op]; });
            if (!missing || again) return vm;
            try { vm.quit && vm.quit(); } catch (e) { /* ignore */ }
            return attempt(true);
        });
    }
    const job = vmQueue.then(function () { return attempt(false); });
    vmQueue = job.catch(function () { /* the next load does not depend on this one */ });
    return job;
}
function toNumber(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

function run(program, test, opts) {
    opts = opts || {};
    test = test || {};
    const result = { status: "done", message: "", say: [], vars: {}, lists: {}, pen: [], ticks: 0, seconds: 0 };
    const answers = (test.answers || []).slice();
    let now = 0, noAnswer = false, vm = null, rt = null;

    let project;
    try { project = toProject(program, test); } catch (e) { return Promise.resolve(failed(e)); }
    return loadVm(vmClass(opts), project, extensionOpcodes(program)).then(function (loaded) {
        vm = loaded;
        rt = vm.runtime;
        /*
         * The sequencer works 75% of currentStepTime (real time) per frame, then the frame ends - also when its only
         * thread is waiting (wait, say for secs: a yielding thread counts as active). A small slice (0.75 ms): 6
         * virtual seconds of waiting cost ~180 frames x 0.75 ms instead of 180 x 25 ms. The virtual clock is separate
         * (FRAME_MS per frame), so the slice does not change any result of one script; a long computation just takes
         * more frames.
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

        const p = rt._primitives;
        /*
         * Glide: the VM times it with the real clock (its own Timer), not the runtime's - the same movement on the
         * virtual clock: from where the sprite is to (x, y) in SECS, one position per frame.
         */
        p.motion_glidesecstoxy = function (args, util) {
            const f = util.stackFrame;
            if (f.sqGlideStart === undefined) {
                f.sqGlideStart = now;
                f.sqDuration = toNumber(args.SECS) * 1000;
                f.sqX0 = util.target.x; f.sqY0 = util.target.y;
                f.sqX1 = toNumber(args.X); f.sqY1 = toNumber(args.Y);
                if (f.sqDuration <= 0) { util.target.setXY(f.sqX1, f.sqY1); return; }
                util.yield();
                return;
            }
            const t = (now - f.sqGlideStart) / f.sqDuration;
            if (t < 1) {
                util.target.setXY(f.sqX0 + (f.sqX1 - f.sqX0) * t, f.sqY0 + (f.sqY1 - f.sqY0) * t);
                util.yield();
            } else {
                util.target.setXY(f.sqX1, f.sqY1);
            }
        };
        /*
         * The pen without a stage: every move of the sprite while its pen is down is a line, from where it was to
         * where it is ("move", "go to", "change x", each frame of a glide). The pen extension keeps penDown in the
         * sprite's custom state; it draws nothing here (no renderer). "erase all" empties the drawing. A dot (pen
         * down without moving) is not a line.
         */
        const sprite = rt.targets.find(function (t) { return !t.isStage; });
        if (sprite && sprite.on) {
            sprite.on("TARGET_MOVED", function (t, oldX, oldY) {
                const pen = t.getCustomState && t.getCustomState("Scratch.pen");
                if (pen && pen.penDown && (oldX !== t.x || oldY !== t.y)) result.pen.push([oldX, oldY, t.x, t.y]);
            });
        }
        if (p.pen_clear) {
            const clear = p.pen_clear;
            p.pen_clear = function (args, util) { result.pen.length = 0; return clear(args, util); };
        }
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
    }).catch(failed);

    function failed(e) {
        result.status = "error";
        result.message = e && e.message ? e.message : String(e);
        return finish();
    }
    function finish() {
        result.seconds = Math.round(now) / 1000;
        if (!rt) return result;
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
/*
 * The blocks without positions and comments, and the variables and lists (a variable made or deleted is a change,
 * also when no block uses it), in a stable order - two programs are the same when this is.
 */
function programKey(program) {
    if (!program) return "";
    const blocks = program.blocks || {};
    const clean = {};
    Object.keys(blocks).sort().forEach(function (id) {
        const b = blocks[id];
        if (Array.isArray(b)) { clean[id] = b.slice(0, 3); return; }        // a top-level variable / list reporter
        clean[id] = { o: b.opcode, n: b.next, p: b.parent, i: b.inputs, f: b.fields, s: !!b.shadow, m: b.mutation || null };
    });
    function byId(a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; }
    const vars = (program.variables || []).map(function (v) { return [v.id, v.name, String(v.value)]; }).sort(byId);
    const lists = (program.lists || []).map(function (l) { return [l.id, l.name, (l.items || []).map(String)]; }).sort(byId);
    return JSON.stringify({ b: clean, v: vars, l: lists });
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
 *   observe: { say: true, vars: [names], lists: [names], pen: false, caseSensitive: false }   - pen: the drawing
 *   mistakes: [{ program, message: { he, ar, en }, score }]       - teacher mistake programs (score 0..100 or null)
 */
const TEXT = {
    en: {
        passed: "Passed {p} of {n} tests.", allPassed: "Correct - all {n} tests passed.", noScript: "The program has no script that starts with the green flag.",
        test: "Test", hiddenFailed: "A hidden test failed.", timeout: "The program did not stop.", noAnswer: "The program asked more questions than the test answers.",
        error: "The program could not run: {m}", expectedSay: "Expected the sprite to say: {e}", gotSay: "Your program said: {g}", nothing: "(nothing)",
        expectedVar: "Expected {v} = {e}; it is {g}.", expectedList: "Expected the list {v} = [{e}]; it is [{g}].",
        traceCorrect: "Correct.", traceWrong: "{p} of {n} answers are correct.", traceSay: "What the sprite says", traceVar: "The value of {v}", traceList: "The list {v}",
        reference: "The correct program:", correctAnswer: "The correct answer:", empty: "No answer was given.",
        drawingCount: "The drawing: {e} lines were expected; your program drew {g}.", drawingDiffers: "The drawing is not the expected one.",
        drawingRight: "{m} of the {e} expected lines are drawn as expected.", more: "... and {n} more",
        yourDrawing: "Your drawing:", refDrawing: "The correct drawing:"
    },
    he: {
        passed: "עברו {p} מתוך {n} בדיקות.", allPassed: "נכון - כל {n} הבדיקות עברו.", noScript: "אין בתוכנית תסריט שמתחיל בדגל הירוק.",
        test: "בדיקה", hiddenFailed: "בדיקה נסתרת נכשלה.", timeout: "התוכנית לא נעצרה.", noAnswer: "התוכנית שאלה יותר שאלות מהתשובות שבבדיקה.",
        error: "לא ניתן להריץ את התוכנית: {m}", expectedSay: "הדמות הייתה צריכה לומר: {e}", gotSay: "התוכנית שלך אמרה: {g}", nothing: "(כלום)",
        expectedVar: "היה צריך להיות {v} = {e}; הערך הוא {g}.", expectedList: "הרשימה {v} הייתה צריכה להיות [{e}]; היא [{g}].",
        traceCorrect: "נכון.", traceWrong: "{p} מתוך {n} תשובות נכונות.", traceSay: "מה הדמות אומרת", traceVar: "הערך של {v}", traceList: "הרשימה {v}",
        reference: "התוכנית הנכונה:", correctAnswer: "התשובה הנכונה:", empty: "לא ניתנה תשובה.",
        drawingCount: "הציור: היו צריכים להיות {e} קווים; התוכנית שלך ציירה {g}.", drawingDiffers: "הציור אינו הציור הנדרש.",
        drawingRight: "{m} מתוך {e} הקווים הנדרשים צוירו כנדרש.", more: "... ועוד {n}",
        yourDrawing: "הציור שלך:", refDrawing: "הציור הנכון:"
    },
    ar: {
        passed: "نجح {p} من {n} اختبارات.", allPassed: "صحيح - نجحت جميع الاختبارات ({n}).", noScript: "لا يوجد في البرنامج نص برمجي يبدأ بالعلم الأخضر.",
        test: "اختبار", hiddenFailed: "فشل اختبار مخفي.", timeout: "البرنامج لم يتوقف.", noAnswer: "طرح البرنامج أسئلة أكثر من الإجابات في الاختبار.",
        error: "تعذّر تشغيل البرنامج: {m}", expectedSay: "كان يجب أن يقول الكائن: {e}", gotSay: "قال برنامجك: {g}", nothing: "(لا شيء)",
        expectedVar: "كان يجب أن يكون {v} = {e}؛ القيمة {g}.", expectedList: "كان يجب أن تكون القائمة {v} = [{e}]؛ هي [{g}].",
        traceCorrect: "صحيح.", traceWrong: "{p} من {n} إجابات صحيحة.", traceSay: "ماذا يقول الكائن", traceVar: "قيمة {v}", traceList: "القائمة {v}",
        reference: "البرنامج الصحيح:", correctAnswer: "الإجابة الصحيحة:", empty: "لم تُعطَ إجابة.",
        drawingCount: "الرسم: كان يجب رسم {e} خطوط؛ رسم برنامجك {g}.", drawingDiffers: "الرسم ليس الرسم المطلوب.",
        drawingRight: "رُسم {m} من {e} الخطوط المطلوبة كما يجب.", more: "... و{n} أخرى",
        yourDrawing: "رسمك:", refDrawing: "الرسم الصحيح:"
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

/* ============================================================
   THE DRAWING - the pen's lines as a set of segments
   ============================================================ */
/*
 * The same drawing however it was drawn: lines on one straight line that touch or overlap are one line (ten "move 10"
 * = one "move 100"; a line drawn twice = once), and a line has no direction (A-B = B-A). The result: segments
 * [x1, y1, x2, y2] with the smaller point first, sorted - in any order of drawing the same list.
 */
const SAME_POINT = 0.5;                        // two drawings are the same when their ends are this close (pixels)
function mergeSegments(raw) {
    const groups = {};
    (raw || []).forEach(function (s) {
        const dx = s[2] - s[0], dy = s[3] - s[1], len = Math.sqrt(dx * dx + dy * dy);
        if (!(len > 1e-6)) return;                                   // a dot
        let ux = dx / len, uy = dy / len;
        if (ux < -1e-9 || (Math.abs(ux) <= 1e-9 && uy < 0)) { ux = -ux; uy = -uy; }
        /* the line: its direction (an angle, -90..90 degrees) and its distance from (0, 0) */
        const key = Math.round(Math.atan2(uy, ux) * 1e4) + "|" + Math.round((-uy * s[0] + ux * s[1]) * 100);
        const g = groups[key] || (groups[key] = { ux: ux, uy: uy, parts: [] });
        const a = { t: g.ux * s[0] + g.uy * s[1], x: s[0], y: s[1] }, b = { t: g.ux * s[2] + g.uy * s[3], x: s[2], y: s[3] };
        g.parts.push(a.t <= b.t ? [a, b] : [b, a]);
    });
    const out = [];
    Object.keys(groups).forEach(function (k) {
        const parts = groups[k].parts.sort(function (p, q) { return p[0].t - q[0].t; });
        let cur = null;
        parts.forEach(function (p) {
            if (cur && p[0].t <= cur[1].t + 0.01) { if (p[1].t > cur[1].t) cur[1] = p[1]; return; }
            if (cur) out.push(cur);
            cur = [p[0], p[1]];
        });
        if (cur) out.push(cur);
    });
    function r(v) { const x = Math.round(v * 1000) / 1000; return x === 0 ? 0 : x; }
    return out.map(function (p) {
        const s = [r(p[0].x), r(p[0].y), r(p[1].x), r(p[1].y)];
        return (s[0] < s[2] || (s[0] === s[2] && s[1] <= s[3])) ? s : [s[2], s[3], s[0], s[1]];
    }).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]; });
}
function samePoint(ax, ay, bx, by) { return Math.abs(ax - bx) <= SAME_POINT && Math.abs(ay - by) <= SAME_POINT; }
function sameSegment(a, b) {
    return (samePoint(a[0], a[1], b[0], b[1]) && samePoint(a[2], a[3], b[2], b[3])) ||
        (samePoint(a[0], a[1], b[2], b[3]) && samePoint(a[2], a[3], b[0], b[1]));
}
/* two merged drawings: which lines of each have no partner in the other */
function compareDrawings(exp, got) {
    exp = exp || []; got = got || [];
    const used = got.map(function () { return false; });
    const missing = [];
    exp.forEach(function (e) {
        const i = got.findIndex(function (g, k) { return !used[k] && sameSegment(e, g); });
        if (i >= 0) used[i] = true; else missing.push(e);
    });
    return { missing: missing, extra: got.filter(function (g, k) { return !used[k]; }) };
}
function sameDrawing(a, b) {
    const d = compareDrawings(a, b);
    return !d.missing.length && !d.extra.length;
}
/* a line as people read it: (0, 0) - (100, 0); isolated left-to-right inside Hebrew / Arabic text */
function segmentText(s) {
    function n(v) { const x = Math.round(v * 100) / 100; return String(x === 0 ? 0 : x); }
    return "⁦(" + n(s[0]) + ", " + n(s[1]) + ") – (" + n(s[2]) + ", " + n(s[3]) + ")⁩";
}

/*
 * A drawing as an SVG image (text: no DOM needed). Scratch's coordinates: x to the right, y up. The view fits the
 * drawing and the starting point (0, 0), with a margin of one grid square, on whole grid squares.
 *   opts: { grid: true, axes: true, width: 360 (px), size, color, title, fit: [segments] }
 * size (px): instead of width - the picture fits a size x size square, so a tall drawing is not taller than size.
 * fit: more lines the view must hold (not drawn) - two pictures side by side on the same scale and place.
 * The same picture in the builder (the question's text, "Copy SVG") and for the student.
 */
function niceStep(span) {
    const raw = Math.max(span / 10, 1);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
function drawingSvg(segments, opts) {
    opts = opts || {};
    const grid = opts.grid !== false, axes = opts.axes !== false;
    const segs = segments || [];
    let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
    segs.concat(opts.fit || []).forEach(function (s) {
        x0 = Math.min(x0, s[0], s[2]); x1 = Math.max(x1, s[0], s[2]);
        y0 = Math.min(y0, s[1], s[3]); y1 = Math.max(y1, s[1], s[3]);
    });
    if (x1 - x0 < 1e-6 && y1 - y0 < 1e-6) { x0 = -100; x1 = 100; y0 = -100; y1 = 100; }
    const step = niceStep(Math.max(x1 - x0, y1 - y0));
    x0 = (Math.floor(x0 / step) - 1) * step; x1 = (Math.ceil(x1 / step) + 1) * step;
    y0 = (Math.floor(y0 / step) - 1) * step; y1 = (Math.ceil(y1 / step) + 1) * step;
    const w = x1 - x0, h = y1 - y0;
    /* size: the picture fits a size x size square (its longer side is size); else width, the height in proportion */
    const width = opts.size > 0 ? Math.round(w >= h ? opts.size : opts.size * w / h) : (opts.width || 360);
    const height = Math.round(width * h / w);
    const u = w / width;                                   // one pixel in drawing units
    function n(v) { const r = Math.round(v * 100) / 100; return String(r === 0 ? 0 : r); }
    const out = [];
    out.push("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"" + width + "\" height=\"" + height + "\" viewBox=\"" +
        n(x0) + " " + n(-y1) + " " + n(w) + " " + n(h) + "\" style=\"background:#fff;direction:ltr\">");
    if (opts.title) out.push("<title>" + String(opts.title).replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</title>");
    if (grid) {
        const g = [];
        for (let x = x0; x <= x1 + 1e-9; x += step) g.push("M" + n(x) + " " + n(-y1) + "V" + n(-y0));
        for (let y = y0; y <= y1 + 1e-9; y += step) g.push("M" + n(x0) + " " + n(-y) + "H" + n(x1));
        out.push("<path d=\"" + g.join("") + "\" stroke=\"#dde3ea\" stroke-width=\"" + n(u) + "\" fill=\"none\"/>");
    }
    if (axes) {
        /* a number every 1, 2, 5 or 10 grid squares: at least ~30 px apart, so a small picture's numbers do not overlap */
        const fs = 11 * u, perStep = step / u;
        const every = [1, 2, 5, 10, 20, 50].find(function (k) { return k * perStep >= 30; }) || 100;
        out.push("<path d=\"M" + n(x0) + " 0H" + n(x1) + "M0 " + n(-y1) + "V" + n(-y0) + "\" stroke=\"#8a96a3\" stroke-width=\"" + n(1.2 * u) + "\" fill=\"none\"/>");
        const t = [];
        /* the numbers on round values (multiples of every * step), never at 0 or on the picture's edge */
        const skip = function (v) { return Math.abs(v) < 1e-9 || Math.round(v / step) % every !== 0; };
        for (let x = x0 + step; x < x1 - 1e-9; x += step) {
            if (skip(x)) continue;
            t.push("<text x=\"" + n(x) + "\" y=\"" + n(fs * 1.15) + "\" text-anchor=\"middle\">" + n(x) + "</text>");
        }
        for (let y = y0 + step; y < y1 - 1e-9; y += step) {
            if (skip(y)) continue;
            t.push("<text x=\"" + n(-3 * u) + "\" y=\"" + n(-y + fs * 0.35) + "\" text-anchor=\"end\">" + n(y) + "</text>");
        }
        t.push("<text x=\"" + n(x1 - 3 * u) + "\" y=\"" + n(-3 * u) + "\" text-anchor=\"end\" font-style=\"italic\">x</text>");
        t.push("<text x=\"" + n(4 * u) + "\" y=\"" + n(-y1 + fs) + "\" font-style=\"italic\">y</text>");
        out.push("<g font-family=\"Arial,sans-serif\" font-size=\"" + n(fs) + "\" fill=\"#5b6876\">" + t.join("") + "</g>");
    }
    if (segs.length) {
        out.push("<path d=\"" + segs.map(function (s) { return "M" + n(s[0]) + " " + n(-s[1]) + "L" + n(s[2]) + " " + n(-s[3]); }).join("") +
            "\" stroke=\"" + (opts.color || "#2f5fd0") + "\" stroke-width=\"" + n(2.5 * u) + "\" stroke-linecap=\"round\" fill=\"none\"/>");
    }
    out.push("</svg>");
    return out.join("");
}

/* what a test observes of a run: the say log (say / think, not the questions), chosen variables and lists, the drawing */
function observed(run, observe) {
    observe = observe || { say: true };
    const o = { status: run.status, message: run.message };
    if (observe.say !== false) o.say = run.say.filter(function (s) { return s.type !== "ask"; }).map(function (s) { return s.text; });
    if (observe.pen) o.pen = mergeSegments(run.pen);
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
    if (a.pen || b.pen) { if (!sameDrawing(a.pen, b.pen)) return false; }
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
    if (exp.pen || got.pen) {
        const d = compareDrawings(exp.pen, got.pen);
        /* counts only: a list of coordinates does not help (and a moved or turned drawing would list every line) */
        if (d.missing.length || d.extra.length) {
            const e = (exp.pen || []).length, g = (got.pen || []).length;
            lines.push(tr(lang, e === g ? "drawingDiffers" : "drawingCount", { e: e, g: g }));
            lines.push(tr(lang, "drawingRight", { m: e - d.missing.length, e: e }));
        }
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

/*
 * DEBUG: true writes the steps of a question (the edits, the grading, what is saved in the inputs) to the console,
 * prefixed [ScratchQ]. Off by default. Set ScratchQ.DEBUG = true in the console, or "debug": true in a question's
 * configuration (the builder's "Console logs" option). Errors are written to the console in any case.
 */
function log() {
    if (!ScratchQ.DEBUG || !global.console) return;
    console.log.apply(console, ["[ScratchQ]"].concat(Array.prototype.slice.call(arguments)));
}

const ScratchQ = {
    version: VERSION,
    DEBUG: false,
    log: log,
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
    Drawing: { merge: mergeSegments, compare: compareDrawings, same: sameDrawing, segmentText: segmentText, svg: drawingSvg, SAME_POINT: SAME_POINT },
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
