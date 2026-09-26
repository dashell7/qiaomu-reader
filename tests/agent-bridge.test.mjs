import assert from "node:assert/strict";
import test from "node:test";
import { readerSnapshot, shouldUseAgent } from "../src/agent-bridge.js";
import { clipText, contextProvider, findAgent, notifyContextChanged } from "../src/qiaomu-context.js";

const epub = { path: "Books/思考快与慢.epub", basename: "思考快与慢", extension: "epub" };
const pdf = { path: "Papers/attention.pdf", basename: "attention", extension: "pdf" };

test("automatic routing keeps a working built-in AI and falls back to Qiaomu Agent", () => {
  assert.equal(shouldUseAgent("auto", { builtinReady: true, agentAvailable: true }), false);
  assert.equal(shouldUseAgent("auto", { builtinReady: false, agentAvailable: true }), true);
  assert.equal(shouldUseAgent(undefined, { builtinReady: false, agentAvailable: true }), true);
  assert.equal(shouldUseAgent("agent", { builtinReady: true, agentAvailable: true }), true);
  assert.equal(shouldUseAgent("builtin", { builtinReady: false, agentAvailable: true }), false);
  assert.equal(shouldUseAgent("agent", { builtinReady: false, agentAvailable: false }), false);
});

test("a selection carries the current page as surrounding text", () => {
  const snapshot = readerSnapshot("qiaomu-reader-english",
    { kind: "selection", text: " 系统一 ", page: "第 3 章", bookFile: epub },
    { kind: "page", text: "整页内容", page: "第 3 章" });
  assert.deepEqual(snapshot, {
    sourceId: "qiaomu-reader-english", sourceName: "Qiaomu Reader English", kind: "book", title: "思考快与慢", path: "Books/思考快与慢.epub",
    location: "第 3 章", text: "整页内容", truncated: undefined, selection: { text: "系统一", location: "第 3 章" },
  });
});

test("a condensed PDF is marked and books without text still identify themselves", () => {
  const document = readerSnapshot("qiaomu-reader-english", { kind: "document", text: "摘要", page: "12 页", truncated: true, bookFile: pdf });
  assert.equal(document.kind, "document");
  assert.equal(document.truncated, true);
  const cover = readerSnapshot("qiaomu-reader-english", { bookFile: epub });
  assert.equal(cover.title, "思考快与慢");
  assert.equal(cover.text, undefined);
  assert.equal(readerSnapshot("qiaomu-reader-english", null), null);
  assert.equal(readerSnapshot("qiaomu-reader-english", { kind: "page", text: "x" }), null);
});

test("long page text is clipped to the protocol limit", () => {
  const snapshot = readerSnapshot("qiaomu-reader-english", { kind: "page", text: "字".repeat(70_000), bookFile: epub });
  assert.ok(snapshot.text.length <= 60_000);
  assert.equal(snapshot.truncated, true);
  assert.deepEqual(clipText(" 短 ", 10), { text: "短", truncated: false });
});

test("only a compatible, enabled Qiaomu Agent is found", () => {
  const ask = async () => {};
  const app = (api) => ({ plugins: { plugins: { "qiaomu-agent": { api } } } });
  assert.equal(findAgent(app({ protocol: "qiaomu-agent", version: 1, ask })).ask, ask);
  assert.equal(findAgent(app({ protocol: "qiaomu-agent", version: 2, ask })), null);
  assert.equal(findAgent(app(undefined)), null);
  assert.equal(findAgent({}), null);
  assert.deepEqual(Object.keys(contextProvider(() => null)), ["protocol", "version", "snapshot"]);
  const events = [];
  notifyContextChanged({ workspace: { trigger: (...args) => events.push(args) } }, "qiaomu-reader-english");
  assert.deepEqual(events, [["qiaomu-context:changed", "qiaomu-reader-english"]]);
  notifyContextChanged(null, "x");
});
