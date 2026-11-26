/*
 * Test helper: a program from a compact nested description (instead of hand-written flat .sb3 blocks).
 *
 *   prog({ vars: { sum: 0 }, lists: { l: [1, 2] } },
 *        [ ["event_whenflagclicked"],
 *          ["data_setvariableto", { VALUE: 0 }, { VARIABLE: "sum" }],
 *          ["control_repeat", { TIMES: 5, SUBSTACK: [ ["data_changevariableby", { VALUE: 2 }, { VARIABLE: "sum" }] ] }],
 *          ["looks_say", { MESSAGE: ["operator_join", { STRING1: "sum=", STRING2: { v: "sum" } }] }] ])
 *
 * An input is a literal (number -> math_number, text -> text), { v: name } a variable, { l: name } a list, a block
 * array (a reporter), or - for SUBSTACK / SUBSTACK2 - an array of block arrays. A field naming a variable or a list
 * (VARIABLE, LIST) takes the name.
 */
(function (global) {
"use strict";

function prog(decl, ...scripts) {
    decl = decl || {};
    const program = { v: 1, variables: [], lists: [], blocks: {} };
    const varId = {}, listId = {};
    Object.keys(decl.vars || {}).forEach((n, i) => { varId[n] = "v" + i; program.variables.push({ id: varId[n], name: n, value: decl.vars[n] }); });
    Object.keys(decl.lists || {}).forEach((n, i) => { listId[n] = "l" + i; program.lists.push({ id: listId[n], name: n, items: decl.lists[n].slice() }); });
    let n = 0;
    const newId = () => "b" + (n += 1);

    function isStack(value) { return Array.isArray(value) && value.length > 0 && Array.isArray(value[0]); }

    function block(desc, parent) {
        const [opcode, inputs = {}, fields = {}] = desc;
        const id = newId();
        const b = { opcode, next: null, parent: parent || null, inputs: {}, fields: {}, shadow: false, topLevel: !parent };
        program.blocks[id] = b;
        Object.keys(fields).forEach(k => {
            const v = fields[k];
            if (k === "VARIABLE") b.fields[k] = [v, varId[v]];
            else if (k === "LIST") b.fields[k] = [v, listId[v]];
            else b.fields[k] = [v, null];
        });
        Object.keys(inputs).forEach(k => {
            const v = inputs[k];
            if (k.indexOf("SUBSTACK") === 0 || isStack(v)) { const first = stack(v, id); if (first) b.inputs[k] = [2, first]; return; }
            if (Array.isArray(v)) { b.inputs[k] = (k === "CONDITION") ? [2, block(v, id)] : [3, block(v, id), [10, ""]]; return; }
            if (v && typeof v === "object" && v.v !== undefined) { b.inputs[k] = [3, [12, v.v, varId[v.v]], [10, ""]]; return; }
            if (v && typeof v === "object" && v.l !== undefined) { b.inputs[k] = [3, [13, v.l, listId[v.l]], [10, ""]]; return; }
            b.inputs[k] = [1, typeof v === "number" ? [4, String(v)] : [10, String(v)]];
        });
        return id;
    }

    function stack(list, parent) {
        let first = null, prev = null;
        list.forEach(desc => {
            const id = block(desc, prev || parent);
            if (prev) program.blocks[prev].next = id; else first = id;
            prev = id;
        });
        return first;
    }

    scripts.forEach((s, i) => {
        const first = stack(s, null);
        program.blocks[first].topLevel = true;
        program.blocks[first].x = 0;
        program.blocks[first].y = i * 300;
    });
    return program;
}

global.prog = prog;
})(window);
