// Just the Node built-ins the API uses (the app itself is typed for the browser).
declare module "node:fs/promises" { export function readFile(path: string, encoding: "utf8"): Promise<string>; }
declare module "node:path" { export function join(...parts: string[]): string; }
declare module "node:child_process" { export function execSync(cmd: string): unknown; }
