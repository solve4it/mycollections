#!/usr/bin/env node
/**
 * Runs `astro build` and fails if it warned about anything (#339).
 *
 * This package keeps producing bugs of one shape: the docs build says something
 * is wrong and carries on. #286 shipped links without rewriting them, #294 published a page
 * that failed to render as an empty body, #295 never copied the assets, #331
 * skipped Markdown in a subdirectory — all with `astro build` exiting 0. Each was
 * answered with a check that turns the silence into a failure.
 *
 * Two `[WARN] [content]` lines had been printed on every build since the site
 * existed, which works directly against that: they teach every reader, and every
 * future session, to skim past the exact prefix a real content problem arrives
 * under. Both causes are fixed; this is what keeps them fixed. A build whose
 * output is clean stays clean only if something notices when it stops being.
 *
 * The build's own output is streamed through untouched — this reads it on the
 * way past rather than replacing it, so nothing is hidden and a failure here is
 * always shown alongside what caused it.
 *
 * If Astro or Starlight starts warning about something legitimate, this turns
 * red. That is the intent: the warning gets read and either fixed or deliberately
 * accounted for, rather than joining the scenery.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** SGR color sequences, which a build attached to a TTY writes around the level tag. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escapes is the point
const ANSI = /\[[0-9;]*m/g;

/**
 * The warning lines in a build log, as they were printed.
 *
 * Matched on the literal `[WARN]` level tag rather than the word, so a path or a
 * doc title containing "WARNING" is not a build failure. It is deliberately not
 * anchored to the start of the line: Astro writes its build tree and its warnings
 * to the same stream and they interleave, which is how the 404 warning arrived
 * welded onto the end of `  ├─ /404.html`.
 *
 * @param {string} output combined stdout and stderr from the build
 * @returns {string[]} the offending lines, uncolored input returned as given
 */
export function findWarnings(output) {
  return output.split("\n").filter((line) => line.replace(ANSI, "").includes("[WARN]"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const astro = resolve(packageRoot, "node_modules/.bin/astro");
  const child = spawn(astro, ["build", ...process.argv.slice(2)], {
    cwd: packageRoot,
    stdio: ["inherit", "pipe", "pipe"],
  });

  let captured = "";
  for (const [stream, sink] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      captured += chunk;
      sink.write(chunk);
    });
  }

  const code = await new Promise((done, fail) => {
    child.on("error", fail);
    child.on("close", done);
  });
  // `exitCode` rather than `exit()`, so everything written above is flushed
  // before the process ends.
  if (code !== 0) {
    process.exitCode = code ?? 1;
  } else {
    const warnings = findWarnings(captured);
    if (warnings.length > 0) {
      console.error(`\n[build] astro build warned ${warnings.length} time(s), which this package treats as a failure:`);
      for (const line of warnings) console.error(`  ${line.trim()}`);
      console.error("  → fix the cause, or decide deliberately to accept it and say so where it is");
      console.error("    accepted. Filtering the line out of the output is not the fix (#339).");
      process.exitCode = 1;
    }
  }
}
