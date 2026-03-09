import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { createSkillDepotServer } from "./mcp/server.js";
import { isDaemonRunning, startDaemon, stopDaemon } from "./utils/daemon.js";
import { VERSION } from "./utils/version.js";
import * as log from "./utils/logger.js";
import path from "node:path";

const program = new Command();

program
    .name("skill-depot")
    .description(
        "RAG-based skill retrieval system for AI agents. Scalable long-term storage with semantic search via MCP."
    )
    .version(VERSION);

// ─── init ──────────────────────────────────────────────────
program
    .command("init")
    .description("Initialize skill-depot with auto-discovery of existing agent skills")
    .option("--auto", "Non-interactive mode — import all discovered skills")
    .action(async (options) => {
        try {
            await initCommand({ auto: options.auto });
        } catch (err) {
            log.error(`Init failed: ${(err as Error).message}`);
            process.exit(1);
        }
    });

// ─── serve ─────────────────────────────────────────────────
program
    .command("serve")
    .description("Start the MCP server in foreground (stdio)")
    .action(async () => {
        try {
            const { start } = createSkillDepotServer();
            await start();
        } catch (err) {
            log.error(`Server failed: ${(err as Error).message}`);
            process.exit(1);
        }
    });

// ─── start ─────────────────────────────────────────────────
program
    .command("start")
    .description("Start skill-depot as a background daemon")
    .action(async () => {
        const { running } = await isDaemonRunning();
        if (running) {
            log.warn("skill-depot daemon is already running");
            return;
        }

        const scriptPath = new URL(import.meta.url).pathname;
        const { pid } = await startDaemon([scriptPath, "serve"]);
        log.success(`skill-depot daemon started (PID: ${pid})`);
    });

// ─── stop ──────────────────────────────────────────────────
program
    .command("stop")
    .description("Stop the skill-depot daemon")
    .action(async () => {
        const stopped = await stopDaemon();
        if (stopped) {
            log.success("skill-depot daemon stopped");
        } else {
            log.warn("No running daemon found");
        }
    });

// ─── status ────────────────────────────────────────────────
program
    .command("status")
    .description("Check if the skill-depot daemon is running")
    .action(async () => {
        const { running, pid } = await isDaemonRunning();
        if (running) {
            log.success(`skill-depot daemon is running (PID: ${pid})`);
        } else {
            log.info("skill-depot daemon is not running");
        }
    });

// ─── restart ───────────────────────────────────────────────
program
    .command("restart")
    .description("Restart the skill-depot daemon")
    .action(async () => {
        await stopDaemon();
        const scriptPath = new URL(import.meta.url).pathname;
        const { pid } = await startDaemon([scriptPath, "serve"]);
        log.success(`skill-depot daemon restarted (PID: ${pid})`);
    });

// ─── add ───────────────────────────────────────────────────
program
    .command("add <file>")
    .description("Add a skill file to skill-depot")
    .option("--global", "Add as a global skill (default: project)")
    .action(async (file, options) => {
        const { addCommand } = await import("./commands/add.js");
        await addCommand(file, { global: options.global });
    });

// ─── remove ────────────────────────────────────────────────
program
    .command("remove <name>")
    .description("Remove a skill from skill-depot")
    .action(async (name) => {
        const { removeCommand } = await import("./commands/remove.js");
        await removeCommand(name);
    });

// ─── list ──────────────────────────────────────────────────
program
    .command("list")
    .description("List all indexed skills")
    .option("--global", "Show only global skills")
    .option("--project", "Show only project skills")
    .action(async (options) => {
        const { listCommand } = await import("./commands/list.js");
        const scope = options.global ? "global" : options.project ? "project" : "all";
        await listCommand(scope);
    });

// ─── search ────────────────────────────────────────────────
program
    .command("search <query>")
    .description("Search for skills")
    .option("-n, --top <number>", "Number of results", "5")
    .action(async (query, options) => {
        const { searchCommand } = await import("./commands/search.js");
        await searchCommand(query, parseInt(options.top, 10));
    });

// ─── reindex ───────────────────────────────────────────────
program
    .command("reindex")
    .description("Rebuild the search index")
    .option("--global", "Reindex only global skills")
    .option("--project", "Reindex only project skills")
    .action(async (options) => {
        const { reindexCommand } = await import("./commands/reindex.js");
        const scope = options.global ? "global" : options.project ? "project" : "all";
        await reindexCommand(scope);
    });

// ─── doctor ────────────────────────────────────────────────
program
    .command("doctor")
    .description("Check skill-depot health and fix issues")
    .action(async () => {
        const { doctorCommand } = await import("./commands/doctor.js");
        await doctorCommand();
    });

program.parse();
