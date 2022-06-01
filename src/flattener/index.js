"use strict";

const fs = require("fs-extra");
const path = require("path");
const parser = require("../parser");

const sync = (filePath) => {
  const resolved = path.resolve(filePath);
  const { dir, base } = path.parse(resolved);
  return (function merge(importPath, fromPath, accumulated) {
    const realPath = path.resolve(dir, importPath);
    const { dir: newFromPath } = path.parse(realPath);
    const key = importPath;
    if (accumulated[key]) return [];
    accumulated[key] = true;
    const file = fs.readFileSync(realPath, "utf8");
    const parsed = parser(file);
    return parsed.body.reduce((r, v) => {
      if (v.type === "ImportStatement")
        return r.concat(merge(v.path, newFromPath, accumulated));
      return r.concat([v]);
    }, []);
  })(base, dir, {});
};

module.exports = sync;
