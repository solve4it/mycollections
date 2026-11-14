import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  openerCommand,
  removeStaleRedirectFiles,
  shouldAutoOpen,
  waitForOrigin,
  writeRedirectFile,
} from "./open-browser.js";

describe("shouldAutoOpen (#241)", () => {
  const firstRun = { created: true, pairingEnabled: true, env: {} };

  it("opens on the start that created the token file, when pairing is on", () => {
    expect(shouldAutoOpen(firstRun)).toBe(true);
  });

  it("does not open on an ordinary restart, which keeps the token the browser already has", () => {
    expect(shouldAutoOpen({ ...firstRun, created: false })).toBe(false);
  });

  it("does not open where pairing is off (production, a non-loopback bind, :memory:)", () => {
    expect(shouldAutoOpen({ ...firstRun, pairingEnabled: false })).toBe(false);
  });

  it.each(["true", "1", "yes"])("does not open under CI=%s", (value) => {
    expect(shouldAutoOpen({ ...firstRun, env: { CI: value } })).toBe(false);
  });

  it.each(["", "false", "0"])("still opens when CI is %j, which is not set to anything true", (value) => {
    expect(shouldAutoOpen({ ...firstRun, env: { CI: value } })).toBe(true);
  });

  it.each(["none", "NONE", " none "])(
    "honours BROWSER=%j, the opt-out create-react-app and xdg tools share",
    (value) => {
      expect(shouldAutoOpen({ ...firstRun, env: { BROWSER: value } })).toBe(false);
    },
  );
});

describe("openerCommand", () => {
  it.each([
    ["darwin", "open", ["/data/pair.html"]],
    ["linux", "xdg-open", ["/data/pair.html"]],
    ["freebsd", "xdg-open", ["/data/pair.html"]],
    ["win32", "explorer.exe", ["/data/pair.html"]],
  ] as const)("on %s runs %s with the file as one argument, never through a shell", (platform, command, args) => {
    expect(openerCommand(platform, "/data/pair.html")).toEqual({ command, args });
  });
});

describe("writeRedirectFile", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "open-browser-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const link = `http://localhost:5173/setup#pair=${"a".repeat(43)}`;

  it("writes a page only the owner can read, so the code never sits in a browser's argv", () => {
    const path = writeRedirectFile(dir, link);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(path.startsWith(join(dir, "pair-"))).toBe(true);
    expect(path.endsWith(".html")).toBe(true);
  });

  it("sends the browser on to the pairing link", () => {
    const html = readFileSync(writeRedirectFile(dir, link), "utf8");
    expect(html).toContain(`<meta http-equiv="refresh" content="0;url=${link}">`);
    expect(html).toContain(`<a href="${link}">`);
  });

  it("escapes the link for HTML, so nothing in it can close the attribute", () => {
    const html = readFileSync(writeRedirectFile(dir, `http://localhost:5173/setup#pair="><script>`), "utf8");
    expect(html).not.toContain('"><script>');
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("sweeps redirect pages a previous run left behind, and nothing else", () => {
    writeRedirectFile(dir, link);
    writeFileSync(join(dir, "app.db"), "");
    writeFileSync(join(dir, "api-token"), "");
    writeFileSync(join(dir, "pair-notes.txt"), "");
    removeStaleRedirectFiles(dir);
    expect(readdirSync(dir).sort()).toEqual(["api-token", "app.db", "pair-notes.txt"]);
  });

  it("names each file freshly, so two starts never write the same one", () => {
    writeRedirectFile(dir, link);
    writeRedirectFile(dir, link);
    expect(readdirSync(dir)).toHaveLength(2);
  });
});

describe("waitForOrigin", () => {
  const instant = { intervalMs: 1, sleep: () => Promise.resolve() };

  it("resolves true as soon as the web server answers — under `pnpm dev` it can start after the API", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("connection refused"))
      .mockRejectedValueOnce(new TypeError("connection refused"))
      .mockResolvedValue(new Response("ok"));
    await expect(waitForOrigin("http://localhost:5173", { ...instant, fetch, timeoutMs: 1000 })).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenCalledWith("http://localhost:5173", expect.objectContaining({ method: "HEAD" }));
  });

  it("counts any HTTP answer as up, even an error status", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    await expect(waitForOrigin("http://localhost:5173", { ...instant, fetch, timeoutMs: 1000 })).resolves.toBe(true);
  });

  it("gives up and resolves false when nothing ever answers", async () => {
    let now = 0;
    const fetch = vi.fn().mockRejectedValue(new TypeError("connection refused"));
    const result = await waitForOrigin("http://localhost:5173", {
      fetch,
      timeoutMs: 100,
      intervalMs: 10,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    expect(result).toBe(false);
    expect(fetch.mock.calls.length).toBeGreaterThan(1);
  });
});
