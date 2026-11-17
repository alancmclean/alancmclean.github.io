#!/usr/bin/env node
// Local-only bridge. Existing Git authentication is used by Git, never returned to the browser.
import http from "node:http";
import { readFile, writeFile, mkdtemp, rm, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDocument } from "../runtime/model.mjs";
const exec = promisify(execFile);
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const REPO = "alancmclean/alancmclean.github.io";
const expectedRemote = `https://github.com/${REPO}.git`;
const json = (res, status, value) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
};
const defaultGit = async (args, cwd) => {
  const { stdout } = await exec("git", args, {
    cwd,
    timeout: 120000,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
  });
  return stdout.trim();
};
export function createBridge({ repoRoot = ROOT, git = defaultGit } = {}) {
  const plans = new Map(),
    session = randomBytes(32).toString("hex");
  let origin = "";
  async function metadata() {
    const remote = await git(["remote", "get-url", "origin"], repoRoot);
    if (remote !== expectedRemote)
      throw Error(
        "This bridge only saves to the configured Alan McLean repository",
      );
    const head = await git(["rev-parse", "HEAD"], repoRoot);
    if (!/^[a-f0-9]{40}$/.test(head)) throw Error("Invalid repository HEAD");
    const dirty = await git(
      ["status", "--porcelain", "--untracked-files=no"],
      repoRoot,
    );
    if (dirty)
      throw Error(
        "Commit tracked implementation changes before saving a data review",
      );
    return { head };
  }
  async function body(req) {
    let data = "";
    for await (const part of req) {
      data += part;
      if (Buffer.byteLength(data) > 1600000) throw Error("Request too large");
    }
    return JSON.parse(data);
  }
  function authorize(req) {
    if (
      req.headers.origin !== origin ||
      req.headers["content-type"] !== "application/json"
    )
      throw Error("Same-origin JSON request required");
    if (
      req.headers["sec-fetch-site"] &&
      req.headers["sec-fetch-site"] !== "same-origin"
    )
      throw Error("Cross-site requests are not allowed");
    const cookie = req.headers.cookie || "";
    if (
      !cookie
        .split(";")
        .map((s) => s.trim())
        .includes("portfolio_session=" + session)
    )
      throw Error("Open the local editor to start a session");
  }
  async function executeSave(plan) {
    const dir = await mkdtemp(path.join(tmpdir(), "portfolio-review-"));
    let attached = false,
      commit;
    try {
      await git(["worktree", "add", "--detach", dir, plan.head], repoRoot);
      attached = true;
      await writeFile(
        path.join(dir, "portfolio/presentation.json"),
        JSON.stringify(plan.document, null, 2) + "\n",
      );
      await git(["add", "--", "portfolio/presentation.json"], dir);
      const diff = await git(["diff", "--cached", "--name-only"], dir);
      if (!diff)
        return {
          message: "No presentation data changed. No branch was pushed.",
          reviewURL: null,
        };
      if (diff !== "portfolio/presentation.json")
        throw Error("Unexpected file in save transaction");
      await git(
        [
          "-c",
          "core.hooksPath=/dev/null",
          "commit",
          "-m",
          `Update presentation data (revision ${plan.document.revision})`,
        ],
        dir,
      );
      commit = await git(["rev-parse", "HEAD"], dir);
      plan.commit = commit;
      try {
        await git(
          ["push", "origin", `${commit}:refs/heads/${plan.branch}`],
          dir,
        );
      } catch {
        // A network failure may happen after the push. Inspect the exact branch; never retry automatically.
        let remote;
        try {
          remote = await git(
            ["ls-remote", "origin", `refs/heads/${plan.branch}`],
            repoRoot,
          );
        } catch {
          throw Error(
            `Push outcome uncertain. Check ${plan.branch} for ${commit}; do not repeat the save.`,
          );
        }
        if (!remote.startsWith(commit + "\t"))
          throw Error(
            `Push failed. Commit ${commit} was prepared; no automatic retry. Inspect ${plan.branch} before retrying.`,
          );
      }
      return {
        message: `Saved ${commit.slice(0, 7)} to ${plan.branch}. No merge or deployment was requested.`,
        commit,
        branch: plan.branch,
        reviewURL: `https://github.com/${REPO}/compare/gh-pages...${plan.branch}?expand=1`,
      };
    } finally {
      if (attached)
        await git(["worktree", "remove", "--force", dir], repoRoot).catch(
          () => {},
        );
      await rm(dir, { recursive: true, force: true });
    }
  }
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host)
        return json(res, 403, { error: "Host not allowed" });
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith("/__portfolio/")) {
        if (url.pathname === "/__portfolio/status" && req.method === "GET") {
          try {
            await metadata();
            return json(res, 200, {
              service: "portfolio-local-bridge-v1",
              canSave: true,
            });
          } catch (e) {
            return json(res, 200, {
              service: "portfolio-local-bridge-v1",
              canSave: false,
              reason: e.message,
            });
          }
        }
        if (req.method !== "POST")
          return json(res, 405, { error: "POST required" });
        try {
          authorize(req);
        } catch (e) {
          return json(res, 403, { error: e.message });
        }
        const data = await body(req);
        if (url.pathname === "/__portfolio/prepare") {
          if (Object.keys(data).join() !== "document")
            throw Error("Only presentation data may be saved");
          validateDocument(data.document);
          const { head } = await metadata();
          for (const [id, plan] of plans)
            if (Date.now() - plan.created > 600000 && !plan.promise)
              plans.delete(id);
          if (plans.size >= 30)
            throw Error("Too many save plans; restart the bridge");
          const id = randomBytes(16).toString("hex"),
            branch =
              "review/portfolio-data-" + Date.now() + "-" + id.slice(0, 6);
          plans.set(id, {
            document: data.document,
            head,
            branch,
            created: Date.now(),
          });
          return json(res, 200, {
            planId: id,
            branch,
            summary: `${data.document.slides.length} slides · revision ${data.document.revision}. Only portfolio/presentation.json will change. Target: ${branch}.`,
          });
        }
        if (url.pathname === "/__portfolio/save") {
          if (
            Object.keys(data).sort().join() !== "confirmedPublic,planId" ||
            data.confirmedPublic !== true
          )
            throw Error("Explicit public-content confirmation required");
          const plan = plans.get(data.planId);
          if (!plan) throw Error("Unknown save plan");
          if (!plan.promise) {
            if (Date.now() - plan.created > 600000)
              throw Error("Save plan expired; prepare again");
            const meta = await metadata();
            if (meta.head !== plan.head)
              throw Error("Repository changed; prepare a fresh save");
            plan.promise = executeSave(plan).then(
              (value) => ({ ok: true, value }),
              (e) => ({ ok: false, error: e.message }),
            );
          }
          const result = await plan.promise;
          return json(
            res,
            result.ok ? 200 : 409,
            result.ok ? result.value : { error: result.error },
          );
        }
        return json(res, 404, { error: "Unknown endpoint" });
      }
      if (!["GET", "HEAD"].includes(req.method))
        return json(res, 405, { error: "Read only" });
      const pathname = decodeURIComponent(url.pathname);
      if (!pathname.startsWith("/portfolio/") || pathname.includes("\\"))
        return json(res, 404, {
          error: "Only portfolio preview files are served",
        });
      let relative = pathname.slice(1);
      if (relative.endsWith("/")) relative += "index.html";
      if (
        relative.split("/").some((p) => p.startsWith(".")) ||
        relative.startsWith("portfolio/tools/") ||
        relative.startsWith("portfolio/tests/") ||
        relative.endsWith("package.json")
      )
        return json(res, 404, { error: "Not a preview file" });
      const full = await realpath(path.join(repoRoot, relative));
      if (!full.startsWith(path.join(repoRoot, "portfolio") + path.sep))
        return json(res, 403, { error: "Path outside preview" });
      const ext = path.extname(full),
        types = {
          ".html": "text/html",
          ".css": "text/css",
          ".mjs": "text/javascript",
          ".js": "text/javascript",
          ".json": "application/json",
          ".svg": "image/svg+xml",
        };
      if (!types[ext])
        return json(res, 404, { error: "Unsupported preview file" });
      const content = await readFile(full);
      const headers = {
        "Content-Type": types[ext],
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
      };
      if (relative === "portfolio/editor/index.html")
        headers["Set-Cookie"] =
          `portfolio_session=${session}; HttpOnly; SameSite=Strict; Path=/__portfolio/`;
      res.writeHead(200, headers);
      res.end(req.method === "HEAD" ? undefined : content);
    } catch (e) {
      json(res, e.code === "ENOENT" ? 404 : 400, { error: e.message });
    }
  });
  return {
    server,
    listen: async (port = 8787) => {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
      });
      origin = `http://127.0.0.1:${server.address().port}`;
      return origin;
    },
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const bridge = createBridge();
  const origin = await bridge.listen(
    Number(process.env.PORTFOLIO_PORT || 8787),
  );
  console.log(
    `Portfolio preview: ${origin}/portfolio/\nLocal editor: ${origin}/portfolio/editor/\nSave uses existing Git authentication and only creates new review branches. Ctrl+C to stop.`,
  );
}
