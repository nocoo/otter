#!/usr/bin/env node
import { runMain } from "@nocoo/base-cli";
import { CLI_VERSION, main } from "./cli.js";
import { runWorkspaceCommand } from "./commands/workspace.js";

const status = await runWorkspaceCommand(process.argv.slice(2), CLI_VERSION);
if (status === undefined) runMain(main);
else process.exitCode = status;
