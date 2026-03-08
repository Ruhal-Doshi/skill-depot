import chalk from "chalk";

export function info(message: string): void {
    console.log(chalk.blue("ℹ"), message);
}

export function success(message: string): void {
    console.log(chalk.green("✓"), message);
}

export function warn(message: string): void {
    console.log(chalk.yellow("⚠"), message);
}

export function error(message: string): void {
    console.log(chalk.red("✗"), message);
}

export function heading(message: string): void {
    console.log();
    console.log(chalk.bold.cyan(`── ${message} ${"─".repeat(Math.max(0, 50 - message.length))}`));
}

export function dim(message: string): void {
    console.log(chalk.dim(message));
}

export function skillEntry(name: string, scope: string, description?: string): void {
    const scopeLabel =
        scope === "global"
            ? chalk.magenta("[global]")
            : chalk.cyan("[project]");
    const desc = description ? chalk.dim(` — ${description}`) : "";
    console.log(`  ${scopeLabel} ${chalk.white(name)}${desc}`);
}
