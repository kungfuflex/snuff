"use strict";

const fs = require("fs");
const compiler = require("./");
const parser = require("../parser");
const path = require("path");
const flattener = require("../flattener");
const ln = (v) => (console.log(v), v);

const contract = compiler(
  {
    body: flattener(path.join("huff_modules", "hypervisor.huff")),
  },
  "INITIALIZE_HYPERVISOR"
);

console.log(contract);
