"use strict";

const compiler = require("./");
const parser = require("../parser");
const path = require("path");
const fs = require("fs");
const rpcCall = require("kool-makerpccall");
const call = (method, params = []) =>
  rpcCall("http://localhost:8545", method, params);
const emasm = require("emasm");
const makeConstructor = require("emasm/macros/make-constructor");
const { stripHexPrefix, addHexPrefix } = require("ethereumjs-util");
const abi = require("web3-eth-abi");
const encodeFunctionCall = abi.encodeFunctionCall.bind(abi);
(async () => {
  const src = fs.readFileSync(
    path.join(__dirname, "sample-template-macro.snuff"),
    "utf8"
  );
  const [from] = await call("eth_accounts");
  const contract = addHexPrefix(compiler(parser(src), "RUN_CODE"));
  console.log(contract);
  const { contractAddress } = await call("eth_getTransactionReceipt", [
    await call("eth_sendTransaction", [
      {
        from,
        data: emasm(makeConstructor(["bytes:contract", [contract]])),
        gas: 6e6,
        gasPrice: 1,
      },
    ]),
  ]);
  console.log(await call("eth_getCode", [contractAddress, "latest"]));
  console.log(
    await call("eth_call", [
      {
        to: contractAddress,
        data: "0x0",
      },
    ])
  );
})().catch((err) => console.error(err.stack));
