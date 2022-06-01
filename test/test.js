"use strict";

const compiler = require("../src/compiler");
const parser = require("../src/parser");
const path = require("path");
const fs = require("fs");
const ethers = require('ethers');
const provider = new ethers.providers.JsonRpcProvider('http://localhost:8545');
const call = async (method, params = []) => await provider.send(method, params);
const emasm = require("emasm");
const makeConstructor = require("emasm/macros/make-constructor");
const { stripHexPrefix, addHexPrefix } = require("ethereumjs-util");
describe("contract compilation", async () => {
  const src = fs.readFileSync(path.join(__dirname, "sample.snuff"), "utf8");
  const signer = provider.getSigner(0);
  const from = await signer.getAddress();
  const contract = addHexPrefix(compiler(parser(src), "RUN_CODE"));
  const { contractAddress } = (await signer.sendTransaction({
    data: emasm(makeConstructor(["bytes:contract", [contract]]))
  })).wait();
  console.log(
    await provider.call({
        to: contractAddress,
        data: "0x00",
      })
  );
});
