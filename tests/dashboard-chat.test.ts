import assert from "node:assert/strict";
import * as nodeFs from "node:fs/promises";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ChatService, placeholderReply, type ChatMessage, type ChatThreadDocument, type ChatThreadSummary } from "../src/dashboard/chat.js";
import { NotFoundError, ValidationError } from "../src/dashboard/errors.js";
import type { StoreFileSystem } from "../src/dashboard/store.js";
import { withServer, withTempDir } from "./dashboard-helpers.js";

function open(directory: string, fs?: StoreFileSystem): ChatService {
  return new ChatService(join(directory, "chat"), fs ? { fs } : {});
}

test("chat: Main always exists; threads can be created, listed, renamed and deleted", async () => {
  await withTempDir(async (directory) => {
    const chat = open(directory);
    assert.deepEqual((await chat.listThreads()).map((thread) => [thread.id, thread.name, thread.main, thread.messageCount]), [["main", "Main", true, 0]]);
    const ideas = await chat.createThread({ name: "  Holiday ideas  " });
    assert.equal(ideas.name, "Holiday ideas", "names are trimmed");
    assert.equal(ideas.main, false);
    await chat.createThread({ name: "Work" });
    assert.deepEqual((await chat.listThreads()).map((thread) => thread.name), ["Main", "Holiday ideas", "Work"]);
    assert.equal((await chat.renameThread(ideas.id, { name: "Trips" })).name, "Trips");
    assert.equal((await open(directory).listThreads()).find((thread) => thread.id === ideas.id)?.name, "Trips", "rename persists across reopen");
    await chat.deleteThread(ideas.id);
    assert.deepEqual((await chat.listThreads()).map((thread) => thread.name), ["Main", "Work"]);
    await assert.rejects(chat.listMessages(ideas.id), NotFoundError);
  });
});

test("chat: the Main thread cannot be deleted or renamed", async () => {
  await withTempDir(async (directory) => {
    const chat = open(directory);
    await assert.rejects(chat.deleteThread("main"), /Main thread cannot be deleted/);
    await assert.rejects(chat.renameThread("main", { name: "Other" }), /Main thread cannot be renamed/);
    assert.equal((await chat.listThreads())[0]?.name, "Main");
  });
});

test("chat: posting stores the trimmed user message and the placeholder reply, in order", async () => {
  await withTempDir(async (directory) => {
    const chat = open(directory);
    const first = await chat.postMessage("main", { text: "  Hello\\nthere  " });
    assert.deepEqual([first.message.role, first.message.text], ["user", "Hello\\nthere"]);
    assert.deepEqual([first.reply.role, first.reply.text], ["assistant", placeholderReply]);
    assert.equal(placeholderReply, "Chat is not connected to a model yet.");
    await chat.postMessage("main", { text: "Second" });
    const messages = await open(directory).listMessages("main");
    assert.deepEqual(messages.map((message) => [message.role, message.text]), [
      ["user", "Hello\\nthere"], ["assistant", placeholderReply], ["user", "Second"], ["assistant", placeholderReply]
    ]);
    assert.deepEqual(messages.slice(0, 2).map((message) => message.id), [first.message.id, first.reply.id]);
    assert.equal((await chat.listThreads())[0]?.messageCount, 4);
    const other = await chat.createThread({ name: "Other" });
    await chat.postMessage(other.id, { text: "Separate" });
    assert.equal((await chat.listMessages(other.id)).length, 2);
    assert.equal((await chat.listMessages("main")).length, 4, "threads do not share messages");
  });
});

test("chat: validation — names 1 to 40 characters, text 1 to 2000 after trimming, no unknown fields", async () => {
  await withTempDir(async (directory) => {
    const chat = open(directory);
    await assert.rejects(chat.createThread({ name: "   " }), /name must be 1 to 40 characters/);
    await assert.rejects(chat.createThread({ name: "x".repeat(41) }), /name must be 1 to 40 characters/);
    await assert.rejects(chat.createThread({ name: 7 }), /name must be a string/);
    await assert.rejects(chat.createThread({ name: "ok", colour: "red" }), /Unknown field/);
    assert.equal((await chat.createThread({ name: "x".repeat(40) })).name.length, 40);
    await assert.rejects(chat.postMessage("main", { text: "   " }), /text must not be empty/);
    await assert.rejects(chat.postMessage("main", { text: "x".repeat(2_001) }), /at most 2000 characters/);
    await assert.rejects(chat.postMessage("main", {}), ValidationError);
    assert.equal((await chat.postMessage("main", { text: ` ${"x".repeat(2_000)} ` })).message.text.length, 2_000, "trimmed length is what counts");
    assert.equal((await chat.listMessages("main")).length, 2, "rejected messages were not stored");
  });
});

test("chat: unknown and malformed thread ids are not found and never touch other files", async () => {
  await withTempDir(async (directory) => {
    const chat = open(directory);
    const missing = "00000000-0000-4000-8000-000000000000";
    for (const id of [missing, "../finance/finance", "main.json", "MAIN"]) {
      await assert.rejects(chat.listMessages(id), NotFoundError, id);
      await assert.rejects(chat.postMessage(id, { text: "hi" }), NotFoundError, id);
      await assert.rejects(chat.renameThread(id, { name: "x" }), NotFoundError, id);
      await assert.rejects(chat.deleteThread(id), NotFoundError, id);
    }
  });
});

test("chat: thread files are written atomically, one per thread, and a failed write keeps the previous file", async () => {
  await withTempDir(async (directory) => {
    let failRename = false;
    const fs: StoreFileSystem = {
      readFile: nodeFs.readFile, writeFile: nodeFs.writeFile, mkdir: nodeFs.mkdir, unlink: nodeFs.unlink,
      rename: async (from, to) => { if (failRename) throw new Error("disk full"); await nodeFs.rename(from, to); }
    };
    const chat = open(directory, fs);
    await chat.listThreads();
    const work = await chat.createThread({ name: "Work" });
    await chat.postMessage(work.id, { text: "Kept" });
    assert.deepEqual((await readdir(join(directory, "chat"))).sort(), [`${work.id}.json`, "main.json"].sort());
    const saved = JSON.parse(await readFile(join(directory, "chat", `${work.id}.json`), "utf8")) as ChatThreadDocument;
    assert.deepEqual([saved.schemaVersion, saved.name, saved.messages.length], [1, "Work", 2]);
    failRename = true;
    await assert.rejects(chat.postMessage(work.id, { text: "Lost" }), /disk full/);
    assert.equal((await chat.listMessages(work.id)).length, 2, "in-memory thread unchanged");
    assert.equal((await open(directory).listMessages(work.id)).length, 2, "file on disk unchanged");
    assert.deepEqual((await readdir(join(directory, "chat"))).sort(), [`${work.id}.json`, "main.json"].sort(), "no temp file left behind");
    failRename = false;
    await chat.deleteThread(work.id);
    assert.deepEqual(await readdir(join(directory, "chat")), ["main.json"], "deleting a thread removes its file");
  });
});

test("routes: chat threads and messages over HTTP with 201/204/400/404", async () => {
  await withServer("2026-11-15", async ({ call, directory }) => {
    const threads = await call<ChatThreadSummary[]>("GET", "/api/chat/threads");
    assert.deepEqual([threads.status, threads.body.map((thread) => thread.id)], [200, ["main"]]);
    const created = await call<ChatThreadSummary>("POST", "/api/chat/threads", { name: "Plans" });
    assert.equal(created.status, 201);
    const renamed = await call<ChatThreadSummary>("PATCH", `/api/chat/threads/${created.body.id}`, { name: "Weekend plans" });
    assert.deepEqual([renamed.status, renamed.body.name], [200, "Weekend plans"]);
    const posted = await call<{ message: ChatMessage; reply: ChatMessage }>("POST", `/api/chat/threads/${created.body.id}/messages`, { text: "Hi" });
    assert.equal(posted.status, 201);
    assert.deepEqual([posted.body.message.text, posted.body.reply.text], ["Hi", "Chat is not connected to a model yet."]);
    const messages = await call<ChatMessage[]>("GET", `/api/chat/threads/${created.body.id}/messages`);
    assert.deepEqual(messages.body.map((message) => message.role), ["user", "assistant"]);

    const empty = await call<{ error: string }>("POST", "/api/chat/threads/main/messages", { text: "" });
    assert.equal(empty.status, 400);
    assert.match(empty.body.error, /text must not be empty/);
    assert.equal((await call("POST", "/api/chat/threads/main/messages", { text: "x".repeat(2_001) })).status, 400);
    assert.equal((await call("POST", "/api/chat/threads", { name: "" })).status, 400);
    assert.equal((await call("POST", "/api/chat/threads", { name: "y".repeat(41) })).status, 400);
    const mainDelete = await call<{ error: string }>("DELETE", "/api/chat/threads/main");
    assert.equal(mainDelete.status, 400);
    assert.match(mainDelete.body.error, /cannot be deleted/);
    assert.equal((await call("PATCH", "/api/chat/threads/main", { name: "Other" })).status, 400);
    assert.equal((await call("GET", "/api/chat/threads/00000000-0000-4000-8000-000000000000/messages")).status, 404);
    assert.equal((await call("POST", "/api/chat/threads/nope/messages", { text: "hi" })).status, 404);
    assert.equal((await call("PATCH", "/api/chat/threads/nope", { name: "x" })).status, 404);
    assert.equal((await call("DELETE", `/api/chat/threads/${created.body.id}`)).status, 204);
    assert.equal((await call("DELETE", `/api/chat/threads/${created.body.id}`)).status, 404);
    assert.deepEqual(await readdir(join(directory, "dashboard", "chat")), ["main.json"]);
  });
});
