#!/usr/bin/env node
import process from "node:process";

const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...args) => {
  const message = typeof warning === "string" ? warning : warning?.message;
  if (/SQLite is an experimental feature/i.test(String(message || ""))) {
    return undefined;
  }
  return originalEmitWarning(warning, ...args);
};

const { start } = await import("../src/server.js");
await start();
