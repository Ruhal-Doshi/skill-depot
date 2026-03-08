import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { getGlobalPaths } from "../core/storage.js";

/**
 * Write the daemon PID to disk
 */
export async function writePid(pid: number): Promise<void> {
    const { daemonPidPath } = getGlobalPaths();
    await fs.writeFile(daemonPidPath, String(pid), "utf-8");
}

/**
 * Read the daemon PID from disk
 */
export async function readPid(): Promise<number | null> {
    const { daemonPidPath } = getGlobalPaths();

    if (!existsSync(daemonPidPath)) return null;

    try {
        const content = await fs.readFile(daemonPidPath, "utf-8");
        const pid = parseInt(content.trim(), 10);
        return isNaN(pid) ? null : pid;
    } catch {
        return null;
    }
}

/**
 * Remove the PID file
 */
export async function removePid(): Promise<void> {
    const { daemonPidPath } = getGlobalPaths();
    try {
        await fs.unlink(daemonPidPath);
    } catch {
        // Ignore if file doesn't exist
    }
}

/**
 * Check if a process with the given PID is running
 */
export function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0); // Signal 0 = check existence only
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if the daemon is running
 */
export async function isDaemonRunning(): Promise<{
    running: boolean;
    pid: number | null;
}> {
    const pid = await readPid();
    if (pid === null) return { running: false, pid: null };

    const running = isProcessRunning(pid);
    if (!running) {
        // Stale PID file — clean up
        await removePid();
        return { running: false, pid: null };
    }

    return { running: true, pid };
}

/**
 * Start the daemon as a detached background process
 */
export async function startDaemon(
    args: string[]
): Promise<{ pid: number }> {
    const child = spawn(process.execPath, args, {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, SKILL_DEPOT_DAEMON: "1" },
    });

    child.unref();

    const pid = child.pid!;
    await writePid(pid);
    return { pid };
}

/**
 * Stop the daemon
 */
export async function stopDaemon(): Promise<boolean> {
    const { running, pid } = await isDaemonRunning();
    if (!running || pid === null) return false;

    try {
        process.kill(pid, "SIGTERM");
        await removePid();
        return true;
    } catch {
        return false;
    }
}
