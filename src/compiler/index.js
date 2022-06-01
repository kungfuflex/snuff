"use strict";
const ln = (v) => (
  console.log(require("util").inspect(v, { colors: true })), v
);

const BN = require("bn.js");
const parser = require("../parser");
const ops = require("emasm/lib/ops");
const {
  encodePush,
  leftZeroPadToByteLength,
  coerceToBN,
} = require("emasm/util");

const addToBack = (ary, chars) => (ary[ary.length - 1] += chars);

const findEntryPoint = (ast, entryMacro) =>
  ast.body.find((v) => v.name === entryMacro);

const computeMacroSymbol = (ast, i) =>
  ast.name +
  (ast.params.length ? "<" + ast.params.join(",") + ">" : "") +
  (i === undefined ? "" : "[" + String(i) + "]");

const computeNewPath = (oldPath, addPath) =>
  oldPath ? oldPath + "::" + addPath : addPath;

const evaluateTemplateArgument = (
  { argument: templateArgumentAst, path: templatePath },
  path,
  state,
  iMap
) => {
  if (templateArgumentAst.type === "MacroCallExpression")
    templateArgumentAst.type = "Identifier";
  switch (templateArgumentAst.type) {
    case "Identifier":
    case "TemplateMacro":
      const segmentPath = state.reservedJumps[templateArgumentAst.name]
        ? templateArgumentAst.name
        : (templatePath ? templatePath + "::" : "") + templateArgumentAst.name;
      const upscope = (state.scopes[templatePath] || {})[
        templateArgumentAst.name
      ];
      if (state.macroNames[templateArgumentAst.name])
        return Object.assign(templateArgumentAst, {
          type: "MacroCallExpression",
          arguments: evaluateTemplateArguments(
            (templateArgumentAst.arguments || []).map((argument) => ({
              argument,
              path: templatePath,
            })),
            templatePath,
            state
          ),
          path: templatePath,
        });

      if (upscope) {
        const lastToken = upscope.path && pathTokensFromBack(upscope.path);
        return upscope;
      }
      return {
        type: "JumpLabel",
        path: segmentPath,
        constexpr: true,
        seen: false,
        size: 2,
      };
    case "HexLiteral":
    case "DecimalLiteral":
      const value = coerceToBN(templateArgumentAst.value);
      return {
        type: "Literal",
        value,
        constexpr: true,
        size: value.byteLength() || 1,
      };
    case "CodeSizeExpression":
      const node = findEntryPoint(state.ast, templateArgumentAst.argument.name);
      iMap[node.name] = iMap[node.name] || 0;
      const symbol = computeMacroSymbol(node, iMap[node.name]);
      const { segmentOrder, current, contractPath } = state;
      const fullPath = computeNewPath(path, symbol);
      state.segmentOrder = state.subcompiles[fullPath] = [fullPath];
      state.labels[fullPath] = {
        size: 0,
        value: 0,
        code: [""],
      };
      state.current = fullPath;
      state.contractPath = fullPath;
      assembleMacro(
        node,
        state.ast,
        templateArgumentAst.argument.arguments.map((argument) => ({
          argument,
          path,
        })),
        fullPath,
        state
      );
      state.current = current;
      state.segmentOrder = segmentOrder;
      state.contractPath = contractPath;
      return {
        type: "CodeSizeExpression",
        seen: false,
        path: fullPath,
        constexpr: true,
        size: 2,
      };
    case "TableStartExpression":
      if (!state.jumpTables) state.jumpTables = [];
      if (!state.jumpTableMap) state.jumpTableMap = {};
      if (!state.jumpTableMap[templateArgumentAst.argument.name]) {
        state.jumpTables.push(templateArgumentAst.argument.name);
        state.jumpTableMap[templateArgumentAst.argument.name] = {
          tablestart: {
            size: 2,
            constexpr: true,
            name: templateArgumentAst.argument.name,
            type: "TableStartExpression",
            seen: false,
          },
          tablesize: {
            size: 2,
            constexpr: true,
            name: templateArgumentAst.argument.name,
            type: "TableSizeExpression",
            seen: false,
          },
        };
      }
      return state.jumpTableMap[templateArgumentAst.argument.name].tablesize;

    case "TableSizeExpression":
      if (!state.jumpTables) state.jumpTables = [];
      if (!state.jumpTableMap) state.jumpTableMap = {};
      if (!state.jumpTableMap[templateArgumentAst.argument.name]) {
        state.jumpTables.push(templateArgumentAst.argument.name);
        state.jumpTableMap[templateArgumentAst.argument.name] = {
          tablestart: {
            size: 2,
            constexpr: true,
            name: templateArgumentAst.argument.name,
            type: "TableStartExpression",
            seen: false,
          },
          tablesize: {
            size: 2,
            name: templateArgumentAst.argument.name,
            type: "TableSizeExpression",
            seen: false,
          },
        };
      }
      return state.jumpTableMap[templateArgumentAst.argument.name].tablestart;
    case "BinaryExpression":
      return {
        type: "BinaryExpression",
        operator: templateArgumentAst.operator,
        constexpr: true,
        left: evaluateTemplateArgument(
          {
            argument: templateArgumentAst.left,
            path: templatePath,
          },
          path,
          state
        ),
        right: evaluateTemplateArgument(
          {
            argument: templateArgumentAst.right,
            path: templatePath,
          },
          path,
          state
        ),
      };
    case "TemplateExpression":
      return evaluateTemplateArgument(
        {
          argument: templateArgumentAst.expression,
          path: templatePath,
        },
        path,
        state
      );
  }
};

const evaluateTemplateArguments = (templateArgumentsAst, path, state, iMap) =>
  templateArgumentsAst.map((templateArgumentAst) =>
    evaluateTemplateArgument(templateArgumentAst, path, state, iMap)
  );

const pathTokensFromBack = (s, n = 0) => {
  const split = s.split("::");
  return split[split.length - (1 + n)];
};

const getCurrentSegment = (state) => state.labels[state.current].code;

const addBytes = (state, bytes) => addToBack(getCurrentSegment(state), bytes);

const popNamespace = (s) => {
  const split = s.split("::");
  split.pop();
  return split.join("::");
};

const assembleNonLabel = (ast, path, state, iMap) => {
  let node, fullName, fullPath;
  if (ast.type === "MacroIdentifier") {
    if (state.macroNames[ast.name]) ast.type = "MacroCallExpression";
  }
  switch (ast.type) {
    case "MacroCallExpression":
      if (!state.macroNames[ast.name])
        return assembleNonLabel(
          ln(state.scopes)[ln(path)][ln(ast.name)],
          popNamespace(path),
          state,
          iMap
        );
      node = findEntryPoint(state.ast, ast.name);
      iMap[node.name] = iMap[node.name] || 0;
      fullName = computeMacroSymbol(node, iMap[node.name]);
      iMap[node.name]++;
      fullPath = (path ? path + "::" : "") + fullName;
      assembleMacro(
        node,
        state.ast,
        (ast.arguments || []).map((argument) => ({
          argument,
          path,
        })),
        fullPath,
        state
      );
      return state;
    case "InstructionExpression":
      addBytes(state, ops[ast.token]);
      state.bytesIn += 1;
      return state;
    default:
      const result = evaluateTemplateArgument(
        {
          path: path,
          argument: ast,
        },
        path,
        state,
        ast
      );
      if (result.size !== undefined) state.bytesIn += result.size + 1;
      else state.bytesIn += 33;
      state.labels[state.current].code.push(result);
      state.labels[state.current].code.push("");
      return state;
  }
};

const initialSegmentSymbol = Symbol("@snuff/initial-segment");

const assembleSegment = (ast, path, state, iMap) =>
  ast.body.reduce((state, v) => assembleNonLabel(v, path, state, iMap), state);

const zipObject = (keys, values) =>
  keys.reduce((r, v, i) => {
    r[v] = values[i];
    return r;
  }, {});

const assembleMacro = (
  ast,
  entireAst,
  templateArguments = [],
  path = "",
  state = {},
  reservedJumps,
  macroNames,
  jumpTableNames
) => {
  const iMap = {};
  if (reservedJumps) state.reservedJumps = reservedJumps;
  if (!state.current) {
    state.ast = entireAst;
    state.macroNames = macroNames;
    state.jumpTableNames = jumpTableNames;
    state.current = initialSegmentSymbol;
    state.labels = {};
    state.subcompiles = {};
    state.contractPath = "";
    state.scopes = {};
    state.labels[state.current] = {
      code: [""],
      size: 0,
      value: 0,
    };
    state.segmentOrder = [initialSegmentSymbol];
    state.bytesIn = 0;
  }
  const evaledTemplateArguments = evaluateTemplateArguments(
    templateArguments,
    path,
    state,
    iMap
  );
  if (path)
    state.scopes[path] = Object.assign(
      state.scopes[path] || zipObject(ast.params, evaledTemplateArguments)
    );
  return ast.body.reduce((state, v) => {
    switch (v.type) {
      case "SegmentStatement":
        const realPath = state.reservedJumps[v.label]
          ? v.label
          : path + (path ? "::" : "") + v.label;
        state.segmentOrder.push(realPath);
        state.current = realPath;
        state.labels[realPath] = {
          type: "segment",
          value: state.bytesIn,
          code: ["5b"],
          size: 2,
        };
        state.bytesIn++;
        return assembleSegment(v, path, state, iMap);
      default:
        return assembleNonLabel(v, path, state, iMap);
    }
  }, state);
};

const computeBinaryExpression = (left, right, operator, meta) => {
  const leftOperand =
    left.type === "BinaryExpression"
      ? computeBinaryExpression(left.left, left.right, left.operator, meta)
      : left.type === "Literal"
      ? new BN(left.value)
      : new BN(meta.labels[left.path || left.name].value);
  const rightOperand =
    right.type === "BinaryExpression"
      ? computeBinaryExpression(right.left, right.right, right.operator, meta)
      : right.type === "Literal"
      ? new BN(right.value)
      : new BN(meta.labels[right.path || right.name].value);
  switch (operator) {
    case "*":
      return leftOperand.mul(rightOperand);
    case "+":
      return leftOperand.add(rightOperand);
    case "<<":
      return leftOperand.shln(Number(rightOperand));
    case ">>":
      return leftOperand.shrn(Number(rightOperand));
  }
};

const compile = (ast, entryPoint) => {
  const jumpTables = ast.body
    .filter((v) => v.type === "JumpTableStatement")
    .map((v) => [v.name, v.labels]);

  const jumpTableMap = jumpTables.reduce((r, [name, labels]) => {
    r[name] = labels;
    return r;
  }, {});

  const reserved = jumpTables
    .reduce((r, [_, labels]) => r.concat(labels), [])
    .reduce((r, v) => {
      r[v] = true;
      return r;
    }, {});

  const macroNames = ast.body
    .filter((v) => v.type === "MacroStatement")
    .map((v) => v.name)
    .reduce((r, v) => {
      r[v] = true;
      return r;
    }, {});

  const meta = assembleMacro(
    findEntryPoint(ast, entryPoint),
    ast,
    [],
    "",
    {},
    reserved,
    macroNames,
    jumpTableMap
  );
  const codeSizes = {};
  const recalcOffsets = (segmentOrder, contractPath = "") => {
    let passed = 0;
    segmentOrder.forEach((v) => {
      const record = meta.labels[v];
      record.value = passed;
      if (record.code)
        record.code.forEach((partial) => {
          if (typeof partial === "string") passed += partial.length / 2;
          else if (partial.constexpr) {
            switch (partial.type) {
              case "CodeSizeExpression":
                passed += partial.size + 1;
                recalcOffsets(meta.subcompiles[partial.path], partial.path);
                break;
              case "BinaryExpression":
                if (!partial.size) partial.size = 0x20;
                passed += partial.size + 1;
                break;
              default:
                passed += partial.size + 1;
            }
          }
        });
      else passed += record.size;
    });
    codeSizes[contractPath] = passed;
  };
  const recalcValues = (segmentOrder) =>
    segmentOrder.forEach((v) => {
      const record = meta.labels[v];
      if (record.code)
        record.code.forEach((partial) => {
          if (typeof partial !== "string" && partial.constexpr) {
            switch (partial.type) {
              case "BinaryExpression":
                partial.value = computeBinaryExpression(
                  partial.left,
                  partial.right,
                  partial.operator,
                  meta
                );
                break;
              case "CodeSizeExpression":
                recalcValues(meta.subcompiles[partial.path]);
                partial.value = new BN(codeSizes[partial.path]);
                break;
              case "JumpLabel":
                partial.value = new BN(meta.labels[partial.path].value);
                break;
              case "TableStartExpression":
                partial.value = new BN(
                  meta.jumpTableMap[partial.name].tablestart
                );
                break;
              case "TableSizeExpression":
                partial.value = new BN(
                  meta.jumpTableMap[partial.name].tablesize
                );
                break;
            }
          }
        });
    });
  const clampSizes = (segmentOrder) => {
    let clamped = false;
    segmentOrder.forEach((v) => {
      const record = meta.labels[v];
      if (record.code)
        record.code.forEach((partial) => {
          if (typeof partial !== "string" && partial.constexpr) {
            let bn = new BN(partial.value);
            let length = bn.byteLength() || 1;
            if (length < partial.size) {
              clamped = true;
              partial.size = length;
            }
            if (partial.type === "CodeSizeExpression")
              clamped = clamped || clampSizes(meta.subcompiles[partial.path]);
          }
        });
    });
    return clamped;
  };
  if (meta.jumpTables)
    meta.jumpTables.forEach((name) => {
      const size = 0x20 * jumpTableMap[name].length;
      meta.segmentOrder.push(name);
      meta.labels[name] = {
        code: jumpTableMap[name].map((label) => ({
          type: "JumpLabel",
          constexpr: true,
          jumptable: 0x20,
          path: label,
          size: 2,
        })),
      };
      meta.bytesIn += size;
    });
  while (true) {
    recalcOffsets(meta.segmentOrder);
    recalcValues(meta.segmentOrder);
    if (!clampSizes(meta.segmentOrder)) break;
  }
  return (
    "0x" +
    meta.segmentOrder.reduce((r, v) => {
      const record = meta.labels[v];
      const { code } = record;
      return code.reduce((r, v) => {
        if (typeof v === "string") return r + v;
        if (!Object.keys(v).length) return r;
        if (v.jumptable)
          return r + leftZeroPadToByteLength(v.value, v.jumptable);
        return r + encodePush(v.value, v.size);
      }, r);
    }, "")
  );
};

module.exports = compile;
