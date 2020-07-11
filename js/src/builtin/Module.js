/* -*- Mode: javascript; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

function CallModuleResolveHook(module, specifier, expectedMinimumStatus)
{
    let requestedModule = HostResolveImportedModule(module, specifier);
    if (requestedModule.status < expectedMinimumStatus)
        ThrowInternalError(JSMSG_BAD_MODULE_STATUS);

    return requestedModule;
}

// 15.2.1.16.2 GetExportedNames(exportStarSet)
function ModuleGetExportedNames(exportStarSet = [])
{
    if (!IsObject(this) || !IsModule(this)) {
        return callFunction(CallModuleMethodIfWrapped, this, exportStarSet,
                            "ModuleGetExportedNames");
    }

    // Step 1
    let module = this;

    // Step 2
    if (callFunction(ArrayIncludes, exportStarSet, module))
        return [];

    // Step 3
    _DefineDataProperty(exportStarSet, exportStarSet.length, module);

    // Step 4
    let exportedNames = [];
    let namesCount = 0;

    // Step 5
    let localExportEntries = module.localExportEntries;
    for (let i = 0; i < localExportEntries.length; i++) {
        let e = localExportEntries[i];
        _DefineDataProperty(exportedNames, namesCount++, e.exportName);
    }

    // Step 6
    let indirectExportEntries = module.indirectExportEntries;
    for (let i = 0; i < indirectExportEntries.length; i++) {
        let e = indirectExportEntries[i];
        _DefineDataProperty(exportedNames, namesCount++, e.exportName);
    }

    // Step 7
    let starExportEntries = module.starExportEntries;
    for (let i = 0; i < starExportEntries.length; i++) {
        let e = starExportEntries[i];
        let requestedModule = CallModuleResolveHook(module, e.moduleRequest,
                                                    MODULE_STATUS_UNLINKED);
        let starNames = callFunction(requestedModule.getExportedNames, requestedModule,
                                     exportStarSet);
        for (let j = 0; j < starNames.length; j++) {
            let n = starNames[j];
            if (n !== "default" && !callFunction(ArrayIncludes, exportedNames, n))
                _DefineDataProperty(exportedNames, namesCount++, n);
        }
    }

    return exportedNames;
}

function ModuleSetStatus(module, newStatus)
{
    assert(newStatus >= MODULE_STATUS_UNLINKED &&
           newStatus <= MODULE_STATUS_EVALUATED_ERROR,
           "Bad new module status in ModuleSetStatus");

    // Note that under OOM conditions we can fail the module instantiation
    // process even after modules have been marked as instantiated.
    assert((module.status <= MODULE_STATUS_LINKED &&
            newStatus === MODULE_STATUS_UNLINKED) ||
           newStatus > module.status,
           "New module status inconsistent with current status");

    UnsafeSetReservedSlot(module, MODULE_OBJECT_STATUS_SLOT, newStatus);
}

// 15.2.1.16.3 ResolveExport(exportName, resolveSet)
//
// Returns an object describing the location of the resolved export or
// indicating a failure.
//
// On success this returns a resolved binding record: { module, bindingName }
//
// There are two failure cases:
//
//  - If no definition was found or the request is found to be circular, *null*
//    is returned.
//
//  - If the request is found to be ambiguous, the string `"ambiguous"` is
//    returned.
//
function ModuleResolveExport(exportName, resolveSet = [])
{
    if (!IsObject(this) || !IsModule(this)) {
        return callFunction(CallModuleMethodIfWrapped, this, exportName, resolveSet,
                            "ModuleResolveExport");
    }

    // Step 1
    let module = this;

    // Step 2
    for (let i = 0; i < resolveSet.length; i++) {
        let r = resolveSet[i];
        if (r.module === module && r.exportName === exportName) {
            // This is a circular import request.
            return null;
        }
    }

    // Step 3
    _DefineDataProperty(resolveSet, resolveSet.length, {module, exportName});

    // Step 4
    let localExportEntries = module.localExportEntries;
    for (let i = 0; i < localExportEntries.length; i++) {
        let e = localExportEntries[i];
        if (exportName === e.exportName)
            return {module, bindingName: e.localName};
    }

    // Step 5
    let indirectExportEntries = module.indirectExportEntries;
    for (let i = 0; i < indirectExportEntries.length; i++) {
        let e = indirectExportEntries[i];
        if (exportName === e.exportName) {
            let importedModule = CallModuleResolveHook(module, e.moduleRequest,
                                                       MODULE_STATUS_UNLINKED);
            return callFunction(importedModule.resolveExport, importedModule, e.importName,
                                resolveSet);
        }
    }

    // Step 6
    if (exportName === "default") {
        // A default export cannot be provided by an export *.
        return null;
    }

    // Step 7
    let starResolution = null;

    // Step 8
    let starExportEntries = module.starExportEntries;
    for (let i = 0; i < starExportEntries.length; i++) {
        let e = starExportEntries[i];
        let importedModule = CallModuleResolveHook(module, e.moduleRequest,
                                                   MODULE_STATUS_UNLINKED);
        let resolution = callFunction(importedModule.resolveExport, importedModule, exportName,
                                      resolveSet);
        if (resolution === "ambiguous")
            return resolution;
        if (resolution !== null) {
            if (starResolution === null) {
                starResolution = resolution;
            } else {
                if (resolution.module !== starResolution.module ||
                    resolution.bindingName !== starResolution.bindingName)
                {
                    return "ambiguous";
                }
            }
        }
    }

    // Step 9
    return starResolution;
}

function IsResolvedBinding(resolution)
{
    assert(resolution === "ambiguous" || typeof resolution === "object",
           "Bad module resolution result");
    return typeof resolution === "object" && resolution !== null;
}

// 15.2.1.18 GetModuleNamespace(module)
function GetModuleNamespace(module)
{
    // Step 1
    assert(IsObject(module) && IsModule(module), "GetModuleNamespace called with non-module");

    // Step 2
    assert(module.status !== MODULE_STATUS_UNLINKED,
           "Bad module state in GetModuleNamespace");

    // Step 3
    let namespace = module.namespace;

    // Step 4
    if (typeof namespace === "undefined") {
        let exportedNames = callFunction(module.getExportedNames, module);
        let unambiguousNames = [];
        for (let i = 0; i < exportedNames.length; i++) {
            let name = exportedNames[i];
            let resolution = callFunction(module.resolveExport, module, name);
            if (IsResolvedBinding(resolution))
                _DefineDataProperty(unambiguousNames, unambiguousNames.length, name);
        }
        namespace = ModuleNamespaceCreate(module, unambiguousNames);
    }

    // Step 5
    return namespace;
}

// 9.4.6.13 ModuleNamespaceCreate(module, exports)
function ModuleNamespaceCreate(module, exports)
{
    callFunction(ArraySort, exports);

    let ns = NewModuleNamespace(module, exports);

    // Pre-compute all bindings now rather than calling ResolveExport() on every
    // access.
    for (let i = 0; i < exports.length; i++) {
        let name = exports[i];
        let binding = callFunction(module.resolveExport, module, name);
        assert(IsResolvedBinding(binding), "Failed to resolve binding");
        AddModuleNamespaceBinding(ns, name, binding.module, binding.bindingName);
    }

    return ns;
}


function GetModuleEnvironment(module)
{
    assert(IsObject(module) && IsModule(module), "Non-module passed to GetModuleEnvironment");

    assert(module.status >= MODULE_STATUS_LINKING,
           "Attempt to access module environement before linking");

    let env = UnsafeGetReservedSlot(module, MODULE_OBJECT_ENVIRONMENT_SLOT);
    assert(IsObject(env) && IsModuleEnvironment(env),
           "Module environment slot contains unexpected value");

    return env;
}

function CountArrayValues(array, value)
{
    let count = 0;
    for (let i = 0; i < array.length; i++) {
        if (array[i] === value)
            count++;
    }
    return count;
}

function ArrayContains(array, value)
{
    for (let i = 0; i < array.length; i++) {
        if (array[i] === value)
            return true;
    }
    return false;
}

function HandleModuleInstantiationFailure(module)
{
    // Reset the module to the "unlinked" state. Don't reset the
    // environment slot as the environment object will be required by any
    // possible future instantiation attempt.
    ModuleSetStatus(module, MODULE_STATUS_UNLINKED);
    UnsafeSetReservedSlot(module, MODULE_OBJECT_DFS_INDEX_SLOT, undefined);
    UnsafeSetReservedSlot(module, MODULE_OBJECT_DFS_ANCESTOR_INDEX_SLOT, undefined);
}

// 15.2.1.16.4 ModuleInstantiate()
function ModuleInstantiate()
{
    if (!IsObject(this) || !IsModule(this))
        return callFunction(CallModuleMethodIfWrapped, this, "ModuleInstantiate");

    // Step 1
    let module = this;

    // Step 2
    if (module.status === MODULE_STATUS_LINKING ||
        module.status === MODULE_STATUS_EVALUATING)
    {
        ThrowInternalError(JSMSG_BAD_MODULE_STATUS);
    }

    // Step 3
    let stack = [];

    // Steps 4-5
    try {
        InnerModuleLinking(module, stack, 0);
    } catch (error) {
        for (let i = 0; i < stack.length; i++) {
            let m = stack[i];
            if (m.status === MODULE_STATUS_LINKING) {
                HandleModuleInstantiationFailure(m);
            }
        }

        // Handle OOM when appending to the stack or over-recursion errors.
        if (stack.length === 0 && module.status === MODULE_STATUS_LINKING) {
            HandleModuleInstantiationFailure(module);
        }

        assert(module.status !== MODULE_STATUS_LINKING,
               "Expected unlinked status after failed linking");

        throw error;
    }

    // Step 6
    assert(module.status === MODULE_STATUS_LINKED ||
           module.status === MODULE_STATUS_EVALUATED ||
           module.status === MODULE_STATUS_EVALUATED_ERROR,
           "Bad module status after successful linking");

    // Step 7
    assert(stack.length === 0,
           "Stack should be empty after successful linking");

    // Step 8
    return undefined;
}

// rev b012019fea18f29737a67c36911340a3e25bfc63
// https://tc39.es/ecma262/#sec-InnerModuleLinking
// 15.2.1.16.1.1 InnerModuleLinking ( module, stack, index )
function InnerModuleLinking(module, stack, index)
{
    // Step 1
    // TODO: Support module records other than Cyclic Module Records.
    // 1. If module is not a Cyclic Module Record, then
    //     a. Perform ? module.Link().
    //     b. Return index.

    // Step 2.a
    if (module.status === MODULE_STATUS_LINKING ||
        module.status === MODULE_STATUS_LINKED ||
        module.status === MODULE_STATUS_EVALUATED ||
        module.status === MODULE_STATUS_EVALUATED_ERROR)
    {
        return index;
    }

    // Step 3. Assert: module.[[Status]] is unlinked.
    if (module.status !== MODULE_STATUS_UNLINKED)
        ThrowInternalError(JSMSG_BAD_MODULE_STATUS);

    // Step 4. Set module.[[Status]] to linking.
    ModuleSetStatus(module, MODULE_STATUS_LINKING);

    // Step 5. Set module.[[DFSIndex]] to index.
    UnsafeSetReservedSlot(module, MODULE_OBJECT_DFS_INDEX_SLOT, index);
    // Step 6. Set module.[[DFSAncestorIndex]] to index.
    UnsafeSetReservedSlot(module, MODULE_OBJECT_DFS_ANCESTOR_INDEX_SLOT, index);
    // Step 7. Set index to index + 1.
    index++;

    // Step 8. Append module to stack.
    _DefineDataProperty(stack, stack.length, module);

		// Step 9. For each String required that is an element of module.[[RequestedModules]], do
    let requestedModules = module.requestedModules;
    for (let i = 0; i < requestedModules.length; i++) {
        // Step 9.a-9.b
        let required = requestedModules[i].moduleSpecifier;
        let requiredModule = CallModuleResolveHook(module, required, MODULE_STATUS_UNLINKED);

        index = InnerModuleLinking(requiredModule, stack, index);

        // TODO: Check if requiredModule is a Cyclic Module Record
        // Step 9.c.i
        assert(requiredModule.status === MODULE_STATUS_LINKING ||
               requiredModule.status === MODULE_STATUS_LINKED ||
               requiredModule.status === MODULE_STATUS_EVALUATED ||
               requiredModule.status === MODULE_STATUS_EVALUATED_ERROR,
               "Bad required module status after InnerModuleLinking");

        // Step 9.c.ii
        assert((requiredModule.status === MODULE_STATUS_LINKING) ===
               ArrayContains(stack, requiredModule),
              "Required module should be in the stack iff it is currently being instantiated");

        assert(typeof requiredModule.dfsIndex === "number", "Bad dfsIndex");
        assert(typeof requiredModule.dfsAncestorIndex === "number", "Bad dfsAncestorIndex");

        // Step 9.c.iii
        if (requiredModule.status === MODULE_STATUS_LINKING) {
            UnsafeSetReservedSlot(module, MODULE_OBJECT_DFS_ANCESTOR_INDEX_SLOT,
                                  std_Math_min(module.dfsAncestorIndex,
                                               requiredModule.dfsAncestorIndex));
        }
    }

    // Step 10
    callFunction(InitializeEnvironment, module);

    // Step 11
    assert(CountArrayValues(stack, module) === 1,
           "Current module should appear exactly once in the stack");
    // Step 12
    assert(module.dfsAncestorIndex <= module.dfsIndex,
           "Bad DFS ancestor index");

    // Step 13
    if (module.dfsAncestorIndex === module.dfsIndex) {
        let requiredModule;
        do {
            // 13.b.i-ii
            requiredModule = callFunction(std_Array_pop, stack);
            // TODO: 13.b.ii. Assert: requiredModule is a Cyclic Module Record.
            // Step 13.b.iv
            ModuleSetStatus(requiredModule, MODULE_STATUS_LINKED);
        } while (requiredModule !== module);
    }

    // Step 14
    return index;
}

// rev b012019fea18f29737a67c36911340a3e25bfc63
// https://tc39.es/ecma262/#sec-source-text-module-record-initialize-environment
// 15.2.1.17.4 InitializeEnvironment ( ) Concrete Method
function InitializeEnvironment()
{
    // Step 1
    let module = this;

    // Step 2-3
    let indirectExportEntries = module.indirectExportEntries;
    for (let i = 0; i < indirectExportEntries.length; i++) {
        let e = indirectExportEntries[i];
        let resolution = callFunction(module.resolveExport, module, e.exportName);
        if (!IsResolvedBinding(resolution)) {
            ThrowResolutionError(module, resolution, "indirectExport", e.exportName,
                                 e.lineNumber, e.columnNumber);
        }
    }

    // Omitting steps 4-5, for practical purposes it is impossible for a realm to be
    // undefined at this point.

    // Step 6-7
    // Note that we have already created the environment by this point.
    let env = GetModuleEnvironment(module);

    // Step 8
    let importEntries = module.importEntries;
    for (let i = 0; i < importEntries.length; i++) {
        let imp = importEntries[i];
        let importedModule = CallModuleResolveHook(module, imp.moduleRequest,
                                                   MODULE_STATUS_LINKING);
        // Step 8.c-8.d
        if (imp.importName === "*") {
            let namespace = GetModuleNamespace(importedModule);
            CreateNamespaceBinding(env, imp.localName, namespace);
        } else {
            let resolution = callFunction(importedModule.resolveExport, importedModule,
                                          imp.importName);
            if (!IsResolvedBinding(resolution)) {
                ThrowResolutionError(module, resolution, "import", imp.importName,
                                     imp.lineNumber, imp.columnNumber);
            }

            CreateImportBinding(env, imp.localName, resolution.module, resolution.bindingName);
        }
    }

    // Steps 9-15
    // Some of these do not need to happen for practical purposes. For steps 12-14, the bindings
    // that can be handled in a similar way to regulars scripts are done separately. Function
    // Declarations are special due to hoisting and are handled within this function.
    // See ModuleScope and ModuleEnvironmentObject for further details.

    // Step 14.a.iii is handled here.
    // In order to have the functions correctly hoisted we need to do this separately.
    InstantiateModuleFunctionDeclarations(module);
}

function ThrowResolutionError(module, resolution, kind, name, line, column)
{
    assert(module.status === MODULE_STATUS_LINKING,
           "Unexpected module status in ThrowResolutionError");

    assert(kind === "import" || kind === "indirectExport",
           "Unexpected kind in ThrowResolutionError");

    assert(line > 0,
           "Line number should be present for all imports and indirect exports");

    let ambiguous = resolution === "ambiguous";

    let errorNumber;
    if (kind === "import")
        errorNumber = ambiguous ? JSMSG_AMBIGUOUS_IMPORT : JSMSG_MISSING_IMPORT;
    else
        errorNumber = ambiguous ? JSMSG_AMBIGUOUS_INDIRECT_EXPORT : JSMSG_MISSING_INDIRECT_EXPORT;

    let message = GetErrorMessage(errorNumber) + ": " + name;
    let error = CreateModuleSyntaxError(module, line, column, message);
    throw error;
}

function GetModuleEvaluationError(module)
{
    assert(IsObject(module) && IsModule(module),
           "Non-module passed to GetModuleEvaluationError");
    assert(module.status === MODULE_STATUS_EVALUATED_ERROR,
           "Bad module status in GetModuleEvaluationError");
    return UnsafeGetReservedSlot(module, MODULE_OBJECT_EVALUATION_ERROR_SLOT);
}

function RecordModuleEvaluationError(module, error)
{
    // Set the module's EvaluationError slot to indicate a failed module
    // evaluation.

    assert(IsObject(module) && IsModule(module),
           "Non-module passed to RecordModuleEvaluationError");

    if (module.status === MODULE_STATUS_EVALUATED_ERROR) {
        // It would be nice to assert that |error| is the same as the one we
        // previously recorded, but that's not always true in the case of out of
        // memory and over-recursion errors.
        return;
    }

    ModuleSetStatus(module, MODULE_STATUS_EVALUATED_ERROR);
    UnsafeSetReservedSlot(module, MODULE_OBJECT_EVALUATION_ERROR_SLOT, error);
}

// 15.2.1.16.5 ModuleEvaluate()
function ModuleEvaluate()
{
    if (!IsObject(this) || !IsModule(this))
        return callFunction(CallModuleMethodIfWrapped, this, "ModuleEvaluate");

    // Step 1
    let module = this;

    // Step 2
    if (module.status !== MODULE_STATUS_LINKED &&
        module.status !== MODULE_STATUS_EVALUATED &&
        module.status !== MODULE_STATUS_EVALUATED_ERROR)
    {
        ThrowInternalError(JSMSG_BAD_MODULE_STATUS);
    }

    // Step 3
    let stack = [];

    // Steps 4-5
    try {
        InnerModuleEvaluation(module, stack, 0);
    } catch (error) {
        for (let i = 0; i < stack.length; i++) {
            let m = stack[i];
            assert(m.status === MODULE_STATUS_EVALUATING,
                   "Bad module status after failed evaluation");
            RecordModuleEvaluationError(m, error);
        }

        // Handle OOM when appending to the stack or over-recursion errors.
        if (stack.length === 0)
            RecordModuleEvaluationError(module, error);

        assert(module.status === MODULE_STATUS_EVALUATED_ERROR,
               "Bad module status after failed evaluation");

        throw error;
    }

    assert(module.status === MODULE_STATUS_EVALUATED,
           "Bad module status after successful evaluation");
    assert(stack.length === 0,
           "Stack should be empty after successful evaluation");

    return undefined;
}

// 15.2.1.16.5.1 InnerModuleEvaluation(module, stack, index)
function InnerModuleEvaluation(module, stack, index)
{
    // Step 1
    // TODO: Support module records other than source text module records.

    // Step 2
    if (module.status === MODULE_STATUS_EVALUATED_ERROR)
        throw GetModuleEvaluationError(module);

    if (module.status === MODULE_STATUS_EVALUATED)
        return index;

    // Step 3
    if (module.status === MODULE_STATUS_EVALUATING)
        return index;

    // Step 4
    assert(module.status === MODULE_STATUS_LINKED,
          "Bad module status in InnerModuleEvaluation");

    // Step 5
    ModuleSetStatus(module, MODULE_STATUS_EVALUATING);

    // Steps 6-8
    UnsafeSetReservedSlot(module, MODULE_OBJECT_DFS_INDEX_SLOT, index);
    UnsafeSetReservedSlot(module, MODULE_OBJECT_DFS_ANCESTOR_INDEX_SLOT, index);
    index++;

    // Step 9
    _DefineDataProperty(stack, stack.length, module);

    // Step 10
    let requestedModules = module.requestedModules;
    for (let i = 0; i < requestedModules.length; i++) {
        let required = requestedModules[i].moduleSpecifier;
        let requiredModule =
            CallModuleResolveHook(module, required, MODULE_STATUS_LINKED);

        index = InnerModuleEvaluation(requiredModule, stack, index);

        assert(requiredModule.status === MODULE_STATUS_EVALUATING ||
               requiredModule.status === MODULE_STATUS_EVALUATED,
              "Bad module status after InnerModuleEvaluation");

        assert((requiredModule.status === MODULE_STATUS_EVALUATING) ===
               ArrayContains(stack, requiredModule),
               "Required module should be in the stack iff it is currently being evaluated");

        assert(typeof requiredModule.dfsIndex === "number", "Bad dfsIndex");
        assert(typeof requiredModule.dfsAncestorIndex === "number", "Bad dfsAncestorIndex");

        if (requiredModule.status === MODULE_STATUS_EVALUATING) {
            UnsafeSetReservedSlot(module, MODULE_OBJECT_DFS_ANCESTOR_INDEX_SLOT,
                                  std_Math_min(module.dfsAncestorIndex,
                                               requiredModule.dfsAncestorIndex));
        }
    }

    // Step 11
    ExecuteModule(module);

    // Step 12
    assert(CountArrayValues(stack, module) === 1,
           "Current module should appear exactly once in the stack");

    // Step 13
    assert(module.dfsAncestorIndex <= module.dfsIndex,
           "Bad DFS ancestor index");

    // Step 14
    if (module.dfsAncestorIndex === module.dfsIndex) {
        let requiredModule;
        do {
            requiredModule = callFunction(std_Array_pop, stack);
            ModuleSetStatus(requiredModule, MODULE_STATUS_EVALUATED);
        } while (requiredModule !== module);
    }

    // Step 15
    return index;
}