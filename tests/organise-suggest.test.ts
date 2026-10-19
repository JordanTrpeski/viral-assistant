import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundError } from "../src/dashboard/errors.js";
import type { OrganiseItem } from "../src/dashboard/organise/model.js";
import { detectDate, emptyRules, leadingVerb, suggestionsFor, type Suggestion } from "../src/dashboard/organise/suggest.js";
import { withServer, withTempDir } from "./dashboard-helpers.js";
import { openOrganise } from "./organise-helpers.js";

// 2026-10-14 is a Wednesday.
const today = "2026-10-14";
const all = emptyRules().datePatterns;

test("date signal alone: ISO, d Mon, Mon d, weekday, today, tomorrow, on the Nth", () => {
  const cases: [string, string, string][] = [
    ["dentist 2026-10-20", "iso", "2026-10-20"],
    ["dentist 20 Oct", "d_mon", "2026-10-20"],
    ["dentist 1st October", "d_mon", "2027-10-01"],
    ["dentist Oct 20", "mon_d", "2026-10-20"],
    ["party December 3rd", "mon_d", "2026-12-03"],
    ["dentist friday", "weekday", "2026-10-16"],
    ["Wednesday standup", "weekday", "2026-10-14"],
    ["haircut today", "today", "2026-10-14"],
    ["haircut tomorrow", "tomorrow", "2026-10-15"],
    ["rent on the 3rd", "on_the_nth", "2026-11-03"],
    ["rent on the 31st", "on_the_nth", "2026-10-31"]
  ];
  for (const [text, pattern, date] of cases) assert.deepEqual(detectDate(text, today, all), { pattern, date }, text);
  assert.equal(detectDate("rent on the 31st", "2026-11-05", all)?.date, "2026-12-31", "skips a month without that day");
  assert.equal(detectDate("dentist friday", today, { ...all, weekday: false }), null, "a pattern can be turned off");
  assert.equal(detectDate("call mum", today, all), null);
  const reminder = suggestionsFor(inbox("dentist friday"), emptyRules(), today);
  assert.deepEqual(reminder, [{ type: "reminder", pattern: "date:weekday", label: "Reminder on 2026-10-16", date: "2026-10-16" }]);
});

function inbox(title: string, id = title): OrganiseItem {
  return { id, type: "inbox", title, date: null, prepare_by: null, recurrence: null, interval_days: null, category: null, project_id: null, status: null, priority: null, notes: "", links: [], list_id: null, checklist: null, recurrence_anchor: null, created_at: "", updated_at: "", done_at: null };
}

test("verb signal alone, both signals, and no signal", () => {
  assert.equal(leadingVerb("Buy, stamps", emptyRules().verbs), "buy");
  assert.equal(leadingVerb("please buy stamps", emptyRules().verbs), null, "the verb must be the first word");
  assert.deepEqual(suggestionsFor(inbox("buy stamps"), emptyRules(), today), [{ type: "task", pattern: "verb:buy", label: "Task", date: null }]);
  assert.deepEqual(suggestionsFor(inbox("call mum friday"), emptyRules(), today).map((suggestion: Suggestion) => [suggestion.type, suggestion.pattern]),
    [["reminder", "date:weekday"], ["task", "verb:call"]], "both: reminder first, task as the second option");
  assert.deepEqual(suggestionsFor(inbox("a random thought about lamps"), emptyRules(), today), []);
  assert.deepEqual(suggestionsFor({ ...inbox("buy stamps"), type: "task" }, emptyRules(), today), [], "only inbox items get suggestions");
});

test("accept records a count and returns the pre-fill, but never applies anything", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory, today);
    const item = await organise.addToInbox({ text: "call mum friday" });
    const accepted = await organise.acceptSuggestion(item.id, { pattern: "date:weekday" });
    assert.deepEqual(accepted, { item_id: item.id, type: "reminder", prefill: { date: "2026-10-16" } });
    const unchanged = await organise.getItem(item.id);
    assert.deepEqual([unchanged.type, unchanged.date, unchanged.updated_at], ["inbox", null, item.updated_at], "the item is untouched");
    assert.equal((await organise.getRules()).patterns["date:weekday"]?.accepts, 1);
    await assert.rejects(organise.acceptSuggestion(item.id, { pattern: "verb:buy" }), /No verb:buy suggestion is showing/);
    await assert.rejects(organise.acceptSuggestion(item.id, { pattern: "whatever" }), /pattern must look like/);
    await assert.rejects(organise.acceptSuggestion("missing", { pattern: "verb:call" }), NotFoundError);
  });
});

test("three dismissals in a row of one pattern mute it (for every item); an accept resets the run; unmute brings it back", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory, today);
    const items = await Promise.all(["buy milk", "buy eggs", "buy bread", "buy tea", "buy jam"].map((text) => organise.addToInbox({ text })));
    assert.deepEqual(await organise.dismissSuggestion(items[0]!.id, { pattern: "verb:buy" }), { pattern: "verb:buy", muted: false, consecutiveDismissals: 1 });
    const view = async (id: string): Promise<string[]> => (await organise.inbox()).items.find((item) => item.id === id)!.suggestions.map((suggestion) => suggestion.pattern);
    assert.deepEqual(await view(items[0]!.id), [], "the dismissed chip is hidden for that item");
    assert.deepEqual(await view(items[1]!.id), ["verb:buy"], "other items still show it");
    await organise.acceptSuggestion(items[1]!.id, { pattern: "verb:buy" });
    await organise.dismissSuggestion(items[1]!.id, { pattern: "verb:buy" });
    await organise.dismissSuggestion(items[2]!.id, { pattern: "verb:buy" });
    assert.equal((await organise.getRules()).muted.length, 0, "the accept reset the run, so two dismissals are not enough");
    const third = await organise.dismissSuggestion(items[3]!.id, { pattern: "verb:buy" });
    assert.deepEqual([third.muted, third.consecutiveDismissals], [true, 3]);
    assert.deepEqual(await view(items[4]!.id), [], "muted for every item, not just one text");
    assert.deepEqual((await organise.getRules()).muted, ["verb:buy"]);
    const other = await organise.addToInbox({ text: "call bank" });
    assert.deepEqual(await view(other.id), ["verb:call"], "muting is per pattern");
    await organise.unmutePattern("verb:buy");
    assert.deepEqual(await view(items[4]!.id), ["verb:buy"]);
    assert.equal((await organise.getRules()).patterns["verb:buy"]?.consecutiveDismissals, 0);
    await assert.rejects(organise.unmutePattern("verb:buy"), NotFoundError, "not muted any more");
  });
});

test("settings: edit the verb list and turn date patterns off", async () => {
  await withTempDir(async (directory) => {
    const organise = openOrganise(directory, today);
    const item = await organise.addToInbox({ text: "water plants friday" });
    const patterns = async (): Promise<string[]> => (await organise.inbox()).items.find((entry) => entry.id === item.id)!.suggestions.map((suggestion) => suggestion.pattern);
    assert.deepEqual(await patterns(), ["date:weekday"]);
    const updated = await organise.updateRules({ verbs: ["Water", "buy", "buy"], datePatterns: { weekday: false } });
    assert.deepEqual([updated.verbs, updated.datePatterns.weekday, updated.datePatterns.today], [["water", "buy"], false, true]);
    assert.deepEqual(await patterns(), ["verb:water"]);
    await assert.rejects(organise.updateRules({ verbs: ["two words"] }), /single word/);
    await assert.rejects(organise.updateRules({ datePatterns: { fortnight: true } }), /Unknown date pattern: fortnight/);
    await assert.rejects(organise.updateRules({ datePatterns: { today: "yes" } }), /must be true or false/);
    await assert.rejects(organise.updateRules({ colour: "red" }), /Unknown field/);
  });
});

test("routes: inbox with suggestions, accept, dismiss, unmute, rules", async () => {
  await withServer(today, async ({ call }) => {
    const item = (await call<OrganiseItem>("POST", "/api/organise/inbox", { text: "pay rent tomorrow" })).body;
    const inbox = (await call<{ items: (OrganiseItem & { suggestions: Suggestion[] })[] }>("GET", "/api/organise/inbox")).body;
    assert.deepEqual(inbox.items[0]!.suggestions.map((suggestion) => suggestion.pattern), ["date:tomorrow", "verb:pay"]);
    const accepted = await call<{ type: string; prefill: { date: string } }>("POST", `/api/organise/suggest/${item.id}/accept`, { pattern: "date:tomorrow" });
    assert.deepEqual([accepted.status, accepted.body.type, accepted.body.prefill.date], [200, "reminder", "2026-10-15"]);
    assert.equal((await call<OrganiseItem>("GET", `/api/organise/items/${item.id}`)).body.type, "inbox");
    for (let index = 0; index < 3; index += 1) {
      const next = (await call<OrganiseItem>("POST", "/api/organise/inbox", { text: `pay bill ${index}` })).body;
      assert.equal((await call("POST", `/api/organise/suggest/${next.id}/dismiss`, { pattern: "verb:pay" })).status, 200);
    }
    assert.deepEqual((await call<{ muted: string[] }>("GET", "/api/organise/rules")).body.muted, ["verb:pay"]);
    assert.equal((await call("POST", `/api/organise/suggest/${encodeURIComponent("verb:pay")}/unmute`, {})).status, 200);
    assert.equal((await call("POST", `/api/organise/suggest/${encodeURIComponent("verb:pay")}/unmute`, {})).status, 404);
    assert.equal((await call("POST", "/api/organise/suggest/missing/accept", { pattern: "verb:pay" })).status, 404);
    assert.equal((await call("PATCH", "/api/organise/rules", { verbs: "pay" })).status, 400);
  });
});
