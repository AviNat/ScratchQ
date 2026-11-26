/*
 * Copyright (c) 2026 Avi Nathan. All rights reserved.
 * No part of this file may be copied, modified or distributed without the written permission of the copyright holder.
 */
/*
 * ScratchQ.Editor - the Scratch block editor (scratch-blocks 2.x, Apache-2.0) for a ScratchQ program. Browser only.
 *
 * Works as the Scratch editor does: an editing VM holds the program; the VM gives the workspace its XML
 * ("workspaceUpdate"), and the workspace's events keep the VM's blocks in step (vm.blockListener). getProgram()
 * reads the program back from the VM (vm.toJSON - the .sb3 format).
 *
 *   const SB = await import(ScratchQ.Editor.SCRATCH_BLOCKS_URL);
 *   const ed = await ScratchQ.Editor.create(element, { ScratchBlocks: SB, program, palette, readOnly, onChange,
 *                                                     locks, lockMenu, enforceLocks, onLocksChange, height, zoom });
 *   ed.getProgram(); ed.setProgram(p, locks); ed.setPalette(palette); ed.getLocks(); ed.dispose();
 *
 * locks (see LOCKS below): lockMenu - the builder marks them (right-click menu, dashed outline); enforceLocks - the
 * student cannot break them.
 *
 * palette: { blocks: [opcode, ..] } - the blocks the palette shows, in the categories below; "VARIABLES" /
 * "LISTS" in the list stand for the whole Variables category (Scratch's own, with its "Make a Variable" button).
 * None: every block of the v1 language (SCRATCH-DESIGN.md section 4).
 *
 * Needs scratchq.js (ScratchQ) and the Scratch VM (global VirtualMachine) loaded before it.
 */
(function (global) {
"use strict";

const ScratchQ = global.ScratchQ;
if (!ScratchQ) throw new Error("scratchq-editor.js needs scratchq.js");

const SCRATCH_BLOCKS_VERSION = "2.2.16";
const SCRATCH_BLOCKS_URL = "https://cdn.jsdelivr.net/npm/scratch-blocks@" + SCRATCH_BLOCKS_VERSION + "/dist/main.mjs";
const MEDIA_URL = "https://cdn.jsdelivr.net/npm/scratch-blocks@" + SCRATCH_BLOCKS_VERSION + "/media/";

/* ============================================================
   THE BLOCKS OF THE LANGUAGE (v1 + the ones planned next), by category, with the palette's default inputs
   ============================================================ */
/* shadows: [input, shadow type, default] ; fields: [field, value] */
const CATEGORIES = [
    { id: "motion", name: "Motion", colour: "#4C97FF", secondary: "#3373CC", blocks: [] },
    { id: "looks", name: "Looks", colour: "#9966FF", secondary: "#774DCB", blocks: [
        ["looks_sayforsecs", [["MESSAGE", "text", "Hello!"], ["SECS", "math_number", "2"]]],
        ["looks_say", [["MESSAGE", "text", "Hello!"]]],
        ["looks_thinkforsecs", [["MESSAGE", "text", "Hmm..."], ["SECS", "math_number", "2"]]],
        ["looks_think", [["MESSAGE", "text", "Hmm..."]]]] },
    { id: "events", name: "Events", colour: "#FFBF00", secondary: "#CC9900", blocks: [
        ["event_whenflagclicked", []]] },
    { id: "control", name: "Control", colour: "#FFAB19", secondary: "#CF8B17", blocks: [
        ["control_wait", [["DURATION", "math_positive_number", "1"]]],
        ["control_repeat", [["TIMES", "math_whole_number", "10"]]],
        ["control_forever", []],
        ["control_if", []],
        ["control_if_else", []],
        ["control_repeat_until", []],
        ["control_stop", [], [["STOP_OPTION", "all"]], '<mutation hasnext="false"></mutation>']] },
    { id: "sensing", name: "Sensing", colour: "#5CB1D6", secondary: "#2E8EB8", blocks: [
        ["sensing_askandwait", [["QUESTION", "text", "What's your name?"]]],
        ["sensing_answer", []]] },
    { id: "operators", name: "Operators", colour: "#59C059", secondary: "#389438", blocks: [
        ["operator_add", [["NUM1", "math_number", ""], ["NUM2", "math_number", ""]]],
        ["operator_subtract", [["NUM1", "math_number", ""], ["NUM2", "math_number", ""]]],
        ["operator_multiply", [["NUM1", "math_number", ""], ["NUM2", "math_number", ""]]],
        ["operator_divide", [["NUM1", "math_number", ""], ["NUM2", "math_number", ""]]],
        ["operator_random", [["FROM", "math_number", "1"], ["TO", "math_number", "10"]]],
        ["operator_gt", [["OPERAND1", "text", ""], ["OPERAND2", "text", "50"]]],
        ["operator_lt", [["OPERAND1", "text", ""], ["OPERAND2", "text", "50"]]],
        ["operator_equals", [["OPERAND1", "text", ""], ["OPERAND2", "text", "50"]]],
        ["operator_and", []],
        ["operator_or", []],
        ["operator_not", []],
        ["operator_join", [["STRING1", "text", "apple "], ["STRING2", "text", "banana"]]],
        ["operator_letter_of", [["LETTER", "math_whole_number", "1"], ["STRING", "text", "apple"]]],
        ["operator_length", [["STRING", "text", "apple"]]],
        ["operator_contains", [["STRING1", "text", "apple"], ["STRING2", "text", "a"]]],
        ["operator_mod", [["NUM1", "math_number", ""], ["NUM2", "math_number", ""]]],
        ["operator_round", [["NUM", "math_number", ""]]],
        ["operator_mathop", [["NUM", "math_number", ""]], [["OPERATOR", "abs"]]]] },
    { id: "variables", name: "Variables", colour: "#FF8C1A", secondary: "#DB6E00", custom: "VARIABLE", blocks: [] }
];
const ALL_BLOCKS = [];
CATEGORIES.forEach(function (c) { c.blocks.forEach(function (b) { ALL_BLOCKS.push(b[0]); }); });
ALL_BLOCKS.push("VARIABLES");

function escXml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const SHADOW_FIELD = { text: "TEXT", math_number: "NUM", math_positive_number: "NUM", math_whole_number: "NUM", math_integer: "NUM" };

function blockXml(def) {
    const type = def[0], shadows = def[1] || [], fields = def[2] || [], mutation = def[3] || "";
    let x = '<block type="' + type + '">' + mutation;
    fields.forEach(function (f) { x += '<field name="' + f[0] + '">' + escXml(f[1]) + "</field>"; });
    shadows.forEach(function (s) {
        x += '<value name="' + s[0] + '"><shadow type="' + s[1] + '"><field name="' + SHADOW_FIELD[s[1]] + '">' + escXml(s[2]) +
            "</field></shadow></value>";
    });
    return x + "</block>";
}

/* the palette's XML: only the chosen blocks, in Scratch's category order; empty categories are left out */
function toolboxXml(palette) {
    const chosen = {};
    ((palette && palette.blocks) || ALL_BLOCKS).forEach(function (b) { chosen[b] = true; });
    let xml = '<xml style="display: none">';
    CATEGORIES.forEach(function (c) {
        const head = '<category name="' + c.name + '" id="' + c.id + '" colour="' + c.colour + '" secondaryColour="' + c.secondary + '"';
        if (c.custom) {
            if (chosen.VARIABLES) xml += head + ' custom="' + c.custom + '"></category>';
            return;
        }
        const blocks = c.blocks.filter(function (b) { return chosen[b[0]]; });
        if (!blocks.length) return;
        xml += head + ">" + blocks.map(blockXml).join("") + "</category>";
    });
    return xml + "</xml>";
}

/* ============================================================
   THE PROGRAM <-> THE EDITING VM
   ============================================================ */
/* the program from a VM: the stage's (global) and the sprite's variables and lists, the sprite's blocks */
function programFromVm(vm) {
    const json = JSON.parse(vm.toJSON());
    const program = ScratchQ.emptyProgram();
    const stage = json.targets.find(function (t) { return t.isStage; }) || {};
    const sprite = json.targets.find(function (t) { return !t.isStage; }) || {};
    [stage, sprite].forEach(function (t) {
        Object.keys(t.variables || {}).forEach(function (id) {
            program.variables.push({ id: id, name: t.variables[id][0], value: t.variables[id][1] });
        });
        Object.keys(t.lists || {}).forEach(function (id) {
            program.lists.push({ id: id, name: t.lists[id][0], items: (t.lists[id][1] || []).slice() });
        });
    });
    program.blocks = sprite.blocks || {};
    return program;
}

/*
 * The block colours: scratch-blocks sets each block's style by its category ("colours_looks" -> style "looks"); the
 * host supplies a theme with those styles, as the Scratch GUI does. Scratch 3's standard colours
 * (primary, secondary, tertiary, quaternary).
 */
const STYLE_COLOURS = {
    motion: ["#4C97FF", "#4280D7", "#3373CC"], looks: ["#9966FF", "#855CD6", "#774DCB"],
    sounds: ["#CF63CF", "#C94FC9", "#BD42BD"], control: ["#FFAB19", "#EC9C13", "#CF8B17"],
    event: ["#FFBF00", "#E6AC00", "#CC9900"], sensing: ["#5CB1D6", "#47A8D1", "#2E8EB8"],
    pen: ["#0FBD8C", "#0DA57A", "#0B8E69"], operators: ["#59C059", "#46B946", "#389438"],
    data: ["#FF8C1A", "#FF8000", "#DB6E00"], data_lists: ["#FF661A", "#FF5500", "#E64D00"],
    more: ["#FF6680", "#FF4D6A", "#FF3355"], textField: ["#FFFFFF", "#FFFFFF", "#FFFFFF", "#575E75"]
};
let theme = null;
function scratchTheme(SB) {
    if (theme) return theme;
    const blockStyles = {};
    Object.keys(STYLE_COLOURS).forEach(function (k) {
        const c = STYLE_COLOURS[k];
        blockStyles[k] = { colourPrimary: c[0], colourSecondary: c[1], colourTertiary: c[2], colourQuaternary: c[3] || c[2] };
    });
    /* no base theme: Blockly's Classic styles have no tertiary colour, and scratch-blocks derives a "selected"
       style from it for every style (renderer/constants.ts) - "Invalid colour: undefined" */
    theme = SB.Theme.defineTheme("scratchq", {
        name: "scratchq",
        blockStyles: blockStyles,
        componentStyles: { workspaceBackgroundColour: "#F9F9F9", toolboxBackgroundColour: "#FFFFFF", flyoutBackgroundColour: "#F9F9F9",
            scrollbarColour: "#CECDCE", insertionMarkerColour: "#000000", insertionMarkerOpacity: 0.2 },
        fontStyle: { family: '"Helvetica Neue", Helvetica, Arial, sans-serif', weight: "500", size: 12 }
    });
    return theme;
}

/* ============================================================
   LOCKS - the starting program's blocks the student may not move / edit (the builder's Didactics tab)
   ============================================================ */
/*
 * locks: { <block id>: "block" | "fields" }. "block": not moved, not deleted, and kept in its script; "fields": that
 * and its values not edited. Blockly's own flags stop a direct drag or delete of the block, but a drag of an unlocked
 * block above it carries it along, and deleting a parent deletes it. So the rule is checked after every change: each
 * locked block still exists and is still in the script it started in (its root block) - else the change is undone.
 * Putting a new block between locked ones is allowed (that is how a gap is filled).
 */
let lockCss = false;
function addLockCss() {
    if (lockCss) return;
    lockCss = true;
    const s = document.createElement("style");
    s.textContent = ".sq-lock-mark > .blocklyPath{stroke:#2b2b2b!important;stroke-width:2.5px!important;stroke-dasharray:6 3}" +
        ".sq-lock-mark.sq-lock-fields > .blocklyPath{stroke:#b42318!important}";
    document.head.appendChild(s);
}

let promptReady = false;
let lockMenuReady = false;
function registerLockMenu(SB) {
    if (lockMenuReady) return;
    lockMenuReady = true;
    const reg = SB.ContextMenuRegistry.registry;
    function item(id, text, weight, action, show) {
        reg.register({
            id: id, weight: weight, scopeType: SB.ContextMenuRegistry.ScopeType.BLOCK,
            displayText: text,
            preconditionFn: function (scope) {
                const b = scope.block, ed = b && b.workspace && b.workspace.scratchqEditor;
                if (!ed || !ed.lockMenu || b.isShadow() || b.isInFlyout) return "hidden";
                return show(ed, b) ? "enabled" : "hidden";
            },
            callback: function (scope) { const b = scope.block; action(b.workspace.scratchqEditor, b); }
        });
    }
    item("scratchq_lock", "🔒 Lock (cannot be moved or deleted)", 100, function (ed, b) { ed.setLock([b.id], "block"); },
        function (ed, b) { return ed.locks[b.id] !== "block"; });
    item("scratchq_lock_fields", "🔒 Lock with its values (nothing can be changed)", 101, function (ed, b) { ed.setLock([b.id], "fields"); },
        function (ed, b) { return ed.locks[b.id] !== "fields"; });
    item("scratchq_lock_script", "🔒 Lock the whole script with its values", 102, function (ed, b) {
        ed.setLock(b.getRootBlock().getDescendants(false).filter(function (d) { return !d.isShadow(); }).map(function (d) { return d.id; }), "fields");
    }, function () { return true; });
    item("scratchq_unlock", "🔓 Unlock", 103, function (ed, b) { ed.setLock([b.id], null); },
        function (ed, b) { return !!ed.locks[b.id]; });
    item("scratchq_unlock_script", "🔓 Unlock the whole script", 104, function (ed, b) {
        ed.setLock(b.getRootBlock().getDescendants(false).map(function (d) { return d.id; }), null);
    }, function (ed, b) { return b.getRootBlock().getDescendants(false).some(function (d) { return ed.locks[d.id]; }); });
}

/*
 * opts: { ScratchBlocks (the module), program, palette, readOnly, onChange(program), zoom, height }
 * Returns a promise of { workspace, vm, getProgram, setProgram, setPalette, dispose }.
 */
function create(element, opts) {
    opts = opts || {};
    const SB = opts.ScratchBlocks || global.ScratchBlocks;
    if (!SB) return Promise.reject(new Error("ScratchQ.Editor: scratch-blocks is not loaded"));
    const VM = global.VirtualMachine;
    if (!VM) return Promise.reject(new Error("ScratchQ.Editor: the Scratch VM is not loaded"));

    SB.ScratchMsgs.setLocale("en");                                      // the blocks are in English (decided)
    if (!document.getElementById("scratchq-editor-css")) {
        /* the palette's checkboxes show a reporter on the stage (a monitor) - there is no stage here */
        const css = document.createElement("style");
        css.id = "scratchq-editor-css";
        /* "Make a Variable" / "Make a List": the classic theme leaves white text on a white button - Scratch's look */
        css.textContent = ".blocklyFlyoutCheckbox{display:none}" +
            ".blocklyFlyoutButton .blocklyFlyoutButtonBackground{fill:#fff;stroke:#c6c6c6;stroke-width:1px}" +
            ".blocklyFlyoutButton:hover .blocklyFlyoutButtonBackground{fill:#e9eef2}" +
            ".blocklyFlyoutButton text{fill:#575e75 !important}" +
            ".blocklyFlyoutButtonShadow{display:none}" +
            ".blocklyFlyoutButton{cursor:pointer}";
        document.head.appendChild(css);
    }
    if (!promptReady && SB.ScratchVariables.setPromptHandler) {
        /* "Make a Variable": the browser's prompt (the builder); the type/options arguments are ignored */
        SB.ScratchVariables.setPromptHandler(function (message, defaultValue, callback) {
            callback(global.prompt(message, defaultValue));
        });
        promptReady = true;
    }

    element.textContent = "";
    element.dir = "ltr";                                                 // LTR blocks also inside an RTL page
    const host = document.createElement("div");
    host.style.cssText = "position:relative;width:100%;height:" + (opts.height || 480) + "px";
    element.appendChild(host);

    const readOnly = opts.readOnly === true;
    const workspace = SB.inject(host, {
        media: MEDIA_URL,
        theme: scratchTheme(SB),
        toolbox: readOnly ? undefined : toolboxXml(opts.palette),
        readOnly: readOnly,
        rtl: false,
        trashcan: false,
        sounds: false,
        comments: !readOnly,
        zoom: { controls: true, wheel: true, startScale: opts.zoom || 0.675 },
        grid: { spacing: 40, length: 2, colour: "#ddd" },
        move: { scrollbars: true, drag: true, wheel: false },
        scratchTheme: "classic"
    });
    if (!readOnly) workspace.registerToolboxCategoryCallback("VARIABLE", SB.ScratchVariables.getVariablesCategory);

    const vm = new VM();
    let loading = false, changeTimer = null, undoing = false;

    /* the locks: lockMenu (the builder) shows them and edits them; enforceLocks (the student) applies them */
    const lockMenu = opts.lockMenu === true, enforce = opts.enforceLocks === true && !readOnly;
    let locks = Object.assign({}, opts.locks || {});
    let lockRoots = {};                                  // locked block id -> the root block id it must stay under
    if (lockMenu) { addLockCss(); registerLockMenu(SB); }

    function applyLocks() {
        lockRoots = {};
        workspace.getAllBlocks(false).forEach(function (b) {
            if (b.isShadow()) return;
            const lock = locks[b.id] || null;
            if (lockMenu) {
                const root = b.getSvgRoot && b.getSvgRoot();
                if (root) {
                    root.classList.toggle("sq-lock-mark", !!lock);
                    root.classList.toggle("sq-lock-fields", lock === "fields");
                }
            }
            if (lock) lockRoots[b.id] = b.getRootBlock().id;
            if (!enforce) return;
            b.setMovable(!lock);
            b.setDeletable(!lock);
            const editable = lock !== "fields";
            b.setEditable(editable);
            b.getChildren(false).forEach(function (c) { if (c.isShadow()) c.setEditable(editable); });
        });
    }
    function locksBroken() {
        return Object.keys(lockRoots).some(function (id) {
            const b = workspace.getBlockById(id);
            return !b || b.getRootBlock().id !== lockRoots[id];
        });
    }

    /* the VM's XML of the editing target -> the workspace (as the Scratch GUI does) */
    vm.on("workspaceUpdate", function (data) {
        loading = true;
        try {
            const dom = SB.utils.xml.textToDom(data.xml);
            SB.clearWorkspaceAndLoadFromXml(dom, workspace);
            applyLocks();
            workspace.scrollCenter && workspace.scrollCenter();
        } finally {
            /* Blockly fires the load's events a moment later (a timeout): they are not a change by the user */
            setTimeout(function () {
                loading = false;
                workspace.clearUndo && workspace.clearUndo();
                lastKey = ScratchQ.programKey(programFromVm(vm));
                refreshPalette();
                if (loadDone) { const done = loadDone; loadDone = null; done(); }
            }, 0);
        }
    });
    /*
     * A change is reported only when the program differs from the last one (its blocks, not their positions): after a
     * load Blockly still moves blocks apart (bumps) once they are drawn, which is no change of the program. Moving a
     * script alone is therefore not reported; its new position is saved with the next real change.
     */
    let lastKey = null;
    let loadDone = null;                                 // resolves setProgram once the load is over
    /*
     * The Variables category is made from the workspace's variables (set / change / ... appear only when there is a
     * variable). scratch-blocks draws the palette once and does not redraw it by itself (the Scratch GUI calls
     * forceRerender): after a load and after a variable is made, renamed or deleted.
     */
    let paletteTimer = null;
    function refreshPalette() {
        if (readOnly) return;
        clearTimeout(paletteTimer);
        paletteTimer = setTimeout(function () {
            const tb = workspace.getToolbox && workspace.getToolbox();
            if (!tb || workspace.isDisposed && workspace.isDisposed()) return;
            if (typeof tb.forceRerender === "function") tb.forceRerender();
            else if (typeof tb.refreshSelection === "function") tb.refreshSelection();
        }, 0);
    }
    const VAR_EVENTS = { var_create: true, var_rename: true, var_delete: true };
    workspace.addChangeListener(function (e) { if (VAR_EVENTS[e.type]) refreshPalette(); });
    workspace.addChangeListener(vm.blockListener);
    const flyout = workspace.getFlyout && workspace.getFlyout();
    if (flyout && flyout.getWorkspace) flyout.getWorkspace().addChangeListener(vm.flyoutBlockListener);
    workspace.addChangeListener(function (e) {
        if (loading || e.isUiEvent) return;
        if (enforce && !undoing && locksBroken()) {
            /* after the event group (the whole drag / delete) is finished: undo it */
            undoing = true;
            setTimeout(function () {
                try { while (locksBroken() && workspace.getUndoStack().length) workspace.undo(false); }
                finally { undoing = false; }
            }, 0);
            return;
        }
        if (typeof opts.onChange !== "function") return;
        clearTimeout(changeTimer);
        changeTimer = setTimeout(function () {
            if (undoing || loading) return;
            const p = programFromVm(vm), key = ScratchQ.programKey(p);
            if (key === lastKey) return;
            lastKey = key;
            opts.onChange(p);
        }, 150);
    });

    /* resolves when the workspace shows the program and its load events are over (an edit after it is the user's) */
    function setProgram(program) {
        return vm.loadProject(ScratchQ.toProject(program || ScratchQ.emptyProgram(), {})).then(function () {
            return new Promise(function (resolve) {
                loadDone = resolve;
                const sprite = vm.runtime.targets.find(function (t) { return !t.isStage; });
                if (sprite) vm.setEditingTarget(sprite.id);
                /* the VM gives the workspace its XML on that; if it did not (nothing to show), do not wait */
                setTimeout(function () { if (loadDone === resolve) { loadDone = null; loading = false; resolve(); } }, 1000);
            });
        });
    }

    const api = {
        workspace: workspace,
        vm: vm,
        lockMenu: lockMenu,
        get locks() { return locks; },
        getProgram: function () { return programFromVm(vm); },
        /* the locks of the blocks that still exist (a lock on a deleted block is dropped) */
        getLocks: function () {
            const out = {};
            Object.keys(locks).forEach(function (id) { if (workspace.getBlockById(id)) out[id] = locks[id]; });
            return out;
        },
        setLock: function (ids, lock) {
            ids.forEach(function (id) { if (lock) locks[id] = lock; else delete locks[id]; });
            applyLocks();
            if (typeof opts.onLocksChange === "function") opts.onLocksChange(api.getLocks());
        },
        setLocks: function (l) { locks = Object.assign({}, l || {}); applyLocks(); },
        setProgram: function (program, newLocks) {
            if (newLocks !== undefined) locks = Object.assign({}, newLocks || {});
            return setProgram(program);
        },
        setPalette: function (palette) { if (!readOnly) { workspace.updateToolbox(toolboxXml(palette)); refreshPalette(); } },
        resize: function () { SB.svgResize(workspace); },
        dispose: function () { clearTimeout(changeTimer); clearTimeout(paletteTimer); workspace.dispose(); element.textContent = ""; }
    };
    workspace.scratchqEditor = api;
    return setProgram(opts.program).then(function () { return api; });
}

ScratchQ.Editor = {
    SCRATCH_BLOCKS_URL: SCRATCH_BLOCKS_URL,
    CATEGORIES: CATEGORIES,
    ALL_BLOCKS: ALL_BLOCKS,
    toolboxXml: toolboxXml,
    programFromVm: programFromVm,
    create: create
};
})(typeof window !== "undefined" ? window : this);
