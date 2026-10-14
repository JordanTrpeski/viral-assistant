import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { NotFoundError, ValidationError } from "./errors.js";
import type { FinanceService } from "./finance.js";
import { localIsoDate, type IsoDate } from "./shared/dates.js";
import { sumCents } from "./shared/money.js";
import { JsonDocumentStore, type StoreFileSystem } from "./store.js";
import {
  isObject, optionalText, rejectUnknownFields, requireArray, requireDate, requireObject, requirePositiveCents,
  requirePositiveInteger, requireText
} from "./validation.js";

export interface ListItem {
  id: string;
  name: string;
  quantity: number;
  /** Price per unit in cents; null until known. Required for bought items when completing a trip. */
  unitPriceCents: number | null;
  bought: boolean;
  addedAt: string;
}

export interface TemplateItem {
  name: string;
  quantity: number;
}

export interface Template {
  id: string;
  name: string;
  items: TemplateItem[];
}

export interface PriceEntry {
  id: string;
  item: string;
  /** Case- and space-insensitive item key that groups history across spellings. */
  key: string;
  date: IsoDate;
  unitPriceCents: number;
  /** The trip that recorded this price, or null for a manually added price. */
  tripId: string | null;
  createdAt: string;
}

export interface TripItem {
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineCents: number;
}

export interface Trip {
  id: string;
  date: IsoDate;
  store: string;
  items: TripItem[];
  totalCents: number;
  /** The Finance expense written for this trip; null if it was deleted in Finance. */
  transactionId: string | null;
  completedAt: string;
}

export interface GroceriesDocument {
  schemaVersion: 1;
  items: ListItem[];
  templates: Template[];
  prices: PriceEntry[];
  trips: Trip[];
}

export interface PriceWatchEntry {
  item: string;
  key: string;
  previousCents: number;
  previousDate: IsoDate;
  latestCents: number;
  latestDate: IsoDate;
  changeCents: number;
  /** Change relative to the previous price, in percent with one decimal. */
  changePercent: number;
}

export interface PriceHistory {
  items: { item: string; key: string; entries: PriceEntry[] }[];
  watch: PriceWatchEntry[];
}

/**
 * The connector Groceries uses to write to Finance. Groceries never touches finance.json directly; it only
 * creates, edits and removes the single expense that represents each completed trip.
 */
export interface FinancePort {
  createGroceryExpense(input: { amountCents: number; date: IsoDate; note: string }): Promise<string>;
  updateGroceryExpense(id: string, input: { amountCents: number; date: IsoDate; note: string }): Promise<void>;
  deleteGroceryExpense(id: string): Promise<void>;
}

/** Finds the Groceries category (id "groceries", or a Flexible category named Groceries). */
export function financePortFor(finance: FinanceService): FinancePort {
  const categoryId = async (): Promise<string> => {
    const categories = await finance.listCategories();
    const category = categories.find((candidate) => candidate.id === "groceries" && candidate.kind === "flexible")
      ?? categories.find((candidate) => candidate.name.toLowerCase() === "groceries" && candidate.kind === "flexible");
    if (!category) throw new ValidationError("Completing a trip needs a Flexible category named Groceries; add it under Finance > Categories");
    return category.id;
  };
  return {
    async createGroceryExpense(input) {
      return (await finance.createTransaction({ categoryId: await categoryId(), source: "groceries", ...input })).id;
    },
    async updateGroceryExpense(id, input) {
      await finance.updateTransaction(id, input);
    },
    async deleteGroceryExpense(id) {
      await finance.deleteTransaction(id);
    }
  };
}

export function emptyGroceriesDocument(): GroceriesDocument {
  return { schemaVersion: 1, items: [], templates: [], prices: [], trips: [] };
}

export function itemKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function lineCents(quantity: number, unitPriceCents: number): number {
  return quantity * unitPriceCents;
}

/** Trip total in cents: the sum of quantity × unit price for every line. */
export function tripTotalCents(items: readonly { quantity: number; unitPriceCents: number }[]): number {
  return sumCents(items.map((item) => lineCents(item.quantity, item.unitPriceCents)));
}

function validateGroceriesDocument(value: unknown): GroceriesDocument {
  if (!isObject(value) || value.schemaVersion !== 1) throw new Error("groceries data must be an object with schemaVersion 1");
  for (const field of ["items", "templates", "prices", "trips"] as const) {
    if (!Array.isArray(value[field])) throw new Error(`groceries data must contain a ${field} array`);
  }
  const list = (value.items as unknown[]).map((raw, index) => {
    if (!isObject(raw) || typeof raw.id !== "string" || typeof raw.bought !== "boolean" || typeof raw.addedAt !== "string") throw new Error(`items[${index}] is malformed`);
    return {
      id: raw.id, name: requireText(raw.name, `items[${index}].name`), quantity: requirePositiveInteger(raw.quantity, `items[${index}].quantity`),
      unitPriceCents: raw.unitPriceCents === null ? null : requirePositiveCents(raw.unitPriceCents, `items[${index}].unitPriceCents`), bought: raw.bought, addedAt: raw.addedAt
    };
  });
  const templates = (value.templates as unknown[]).map((raw, index) => {
    if (!isObject(raw) || typeof raw.id !== "string") throw new Error(`templates[${index}] is malformed`);
    return { id: raw.id, name: requireText(raw.name, `templates[${index}].name`), items: templateItems(raw.items, `templates[${index}].items`) };
  });
  const prices = (value.prices as unknown[]).map((raw, index) => {
    if (!isObject(raw) || typeof raw.id !== "string" || typeof raw.createdAt !== "string" || (raw.tripId !== null && typeof raw.tripId !== "string")) throw new Error(`prices[${index}] is malformed`);
    const item = requireText(raw.item, `prices[${index}].item`);
    return { id: raw.id, item, key: itemKey(item), date: requireDate(raw.date), unitPriceCents: requirePositiveCents(raw.unitPriceCents, `prices[${index}].unitPriceCents`), tripId: raw.tripId, createdAt: raw.createdAt };
  });
  const trips = (value.trips as unknown[]).map((raw, index) => {
    if (!isObject(raw) || typeof raw.id !== "string" || typeof raw.completedAt !== "string" || (raw.transactionId !== null && typeof raw.transactionId !== "string")) throw new Error(`trips[${index}] is malformed`);
    const items = tripItems(raw.items, `trips[${index}].items`);
    return { id: raw.id, date: requireDate(raw.date), store: optionalText(raw.store, "store", 100), items, totalCents: tripTotalCents(items), transactionId: raw.transactionId, completedAt: raw.completedAt };
  });
  return { schemaVersion: 1, items: list, templates, prices, trips };
}

function templateItems(value: unknown, field: string): TemplateItem[] {
  return requireArray(value, field).map((raw, index) => {
    const item = requireObject(raw, `${field}[${index}]`);
    rejectUnknownFields(item, ["name", "quantity"]);
    return { name: requireText(item.name, `${field}[${index}].name`, 100), quantity: item.quantity === undefined ? 1 : requirePositiveInteger(item.quantity, `${field}[${index}].quantity`) };
  });
}

function tripItems(value: unknown, field: string): TripItem[] {
  const items = requireArray(value, field).map((raw, index) => {
    const item = requireObject(raw, `${field}[${index}]`);
    rejectUnknownFields(item, ["name", "quantity", "unitPriceCents", "lineCents"]);
    const quantity = requirePositiveInteger(item.quantity, `${field}[${index}].quantity`);
    const unitPriceCents = requirePositiveCents(item.unitPriceCents, `${field}[${index}].unitPriceCents`);
    return { name: requireText(item.name, `${field}[${index}].name`, 100), quantity, unitPriceCents, lineCents: lineCents(quantity, unitPriceCents) };
  });
  if (!items.length) throw new ValidationError(`${field} must contain at least one item`);
  return items;
}

function find<T extends { id: string }>(list: T[], id: string, kind: string): T {
  const found = list.find((candidate) => candidate.id === id);
  if (!found) throw new NotFoundError(kind, id);
  return found;
}

function tripNote(store: string): string {
  return store ? `Groceries trip — ${store}` : "Groceries trip";
}

function latestPrice(document: GroceriesDocument, name: string): number | null {
  const key = itemKey(name);
  const entries = document.prices.filter((entry) => entry.key === key).sort((left, right) => left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt));
  return entries.at(-1)?.unitPriceCents ?? null;
}

/** History grouped per item (oldest first) and a watch list of items whose latest price differs from the one before. */
export function priceHistory(document: GroceriesDocument): PriceHistory {
  const groups = new Map<string, PriceEntry[]>();
  for (const entry of document.prices) groups.set(entry.key, [...(groups.get(entry.key) ?? []), entry]);
  const items = [...groups.entries()].map(([key, entries]) => {
    const sorted = entries.sort((left, right) => left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt));
    return { item: sorted.at(-1)!.item, key, entries: sorted };
  }).sort((left, right) => left.item.localeCompare(right.item));
  const watch: PriceWatchEntry[] = [];
  for (const group of items) {
    const latest = group.entries.at(-1)!;
    const previous = group.entries.at(-2);
    if (!previous || previous.unitPriceCents === latest.unitPriceCents) continue;
    const changeCents = latest.unitPriceCents - previous.unitPriceCents;
    watch.push({
      item: group.item, key: group.key, previousCents: previous.unitPriceCents, previousDate: previous.date, latestCents: latest.unitPriceCents,
      latestDate: latest.date, changeCents, changePercent: Math.round((changeCents * 1_000) / previous.unitPriceCents) / 10
    });
  }
  return { items, watch: watch.sort((left, right) => Math.abs(right.changePercent) - Math.abs(left.changePercent)) };
}

export interface GroceriesServiceOptions {
  clock?: () => Date;
  fs?: StoreFileSystem;
}

/** Owns `.viral/dashboard/groceries.json`: shopping list, templates, price history and completed trips. */
export class GroceriesService {
  private readonly clock: () => Date;

  constructor(readonly store: JsonDocumentStore<GroceriesDocument>, private readonly finance: FinancePort, clock: () => Date = () => new Date()) {
    this.clock = clock;
  }

  static open(directory: string, finance: FinancePort, options: GroceriesServiceOptions = {}): GroceriesService {
    return new GroceriesService(new JsonDocumentStore(join(directory, "groceries.json"), validateGroceriesDocument, emptyGroceriesDocument, options.fs), finance, options.clock);
  }

  private now(): string {
    return this.clock().toISOString();
  }

  // Shopping list

  async listItems(): Promise<ListItem[]> {
    return (await this.store.read()).items;
  }

  /** New items default to the latest known price for that item, if any. */
  async addItem(body: unknown): Promise<ListItem> {
    const input = requireObject(body);
    rejectUnknownFields(input, ["name", "quantity", "unitPriceCents"]);
    const name = requireText(input.name, "name", 100);
    const quantity = input.quantity === undefined ? 1 : requirePositiveInteger(input.quantity, "quantity");
    const explicitPrice = input.unitPriceCents === undefined || input.unitPriceCents === null ? undefined : requirePositiveCents(input.unitPriceCents, "unitPriceCents");
    return this.store.update((document) => {
      const item: ListItem = { id: randomUUID(), name, quantity, unitPriceCents: explicitPrice ?? latestPrice(document, name), bought: false, addedAt: this.now() };
      document.items.push(item);
      return item;
    });
  }

  async updateItem(id: string, body: unknown): Promise<ListItem> {
    const input = requireObject(body);
    rejectUnknownFields(input, ["name", "quantity", "unitPriceCents", "bought"]);
    const name = input.name === undefined ? undefined : requireText(input.name, "name", 100);
    const quantity = input.quantity === undefined ? undefined : requirePositiveInteger(input.quantity, "quantity");
    const unitPriceCents = input.unitPriceCents === undefined ? undefined : input.unitPriceCents === null ? null : requirePositiveCents(input.unitPriceCents, "unitPriceCents");
    if (input.bought !== undefined && typeof input.bought !== "boolean") throw new ValidationError("bought must be true or false");
    return this.store.update((document) => {
      const item = find(document.items, id, "shopping list item");
      if (name !== undefined) item.name = name;
      if (quantity !== undefined) item.quantity = quantity;
      if (unitPriceCents !== undefined) item.unitPriceCents = unitPriceCents;
      if (typeof input.bought === "boolean") item.bought = input.bought;
      return item;
    });
  }

  async deleteItem(id: string): Promise<void> {
    await this.store.update((document) => {
      find(document.items, id, "shopping list item");
      document.items = document.items.filter((item) => item.id !== id);
    });
  }

  // Templates

  async listTemplates(): Promise<Template[]> {
    return (await this.store.read()).templates;
  }

  async createTemplate(body: unknown): Promise<Template> {
    const input = requireObject(body);
    rejectUnknownFields(input, ["name", "items"]);
    const name = requireText(input.name, "name", 100);
    const items = input.items === undefined ? [] : templateItems(input.items, "items");
    return this.store.update((document) => {
      const template: Template = { id: randomUUID(), name, items };
      document.templates.push(template);
      return template;
    });
  }

  async updateTemplate(id: string, body: unknown): Promise<Template> {
    const input = requireObject(body);
    rejectUnknownFields(input, ["name", "items"]);
    const name = input.name === undefined ? undefined : requireText(input.name, "name", 100);
    const items = input.items === undefined ? undefined : templateItems(input.items, "items");
    return this.store.update((document) => {
      const template = find(document.templates, id, "template");
      if (name !== undefined) template.name = name;
      if (items !== undefined) template.items = items;
      return template;
    });
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.store.update((document) => {
      find(document.templates, id, "template");
      document.templates = document.templates.filter((template) => template.id !== id);
    });
  }

  /** Start: puts the template's items on the shopping list, skipping names already waiting there unbought. */
  async startTemplate(id: string): Promise<{ added: ListItem[]; skipped: string[] }> {
    return this.store.update((document) => {
      const template = find(document.templates, id, "template");
      const waiting = new Set(document.items.filter((item) => !item.bought).map((item) => itemKey(item.name)));
      const added: ListItem[] = [];
      const skipped: string[] = [];
      for (const entry of template.items) {
        if (waiting.has(itemKey(entry.name))) { skipped.push(entry.name); continue; }
        const item: ListItem = { id: randomUUID(), name: entry.name, quantity: entry.quantity, unitPriceCents: latestPrice(document, entry.name), bought: false, addedAt: this.now() };
        document.items.push(item);
        waiting.add(itemKey(entry.name));
        added.push(item);
      }
      return { added, skipped };
    });
  }

  // Prices

  async prices(): Promise<PriceHistory> {
    return priceHistory(await this.store.read());
  }

  async addPrice(body: unknown): Promise<PriceEntry> {
    const input = requireObject(body);
    rejectUnknownFields(input, ["item", "date", "unitPriceCents"]);
    const item = requireText(input.item, "item", 100);
    const date = input.date === undefined ? localIsoDate(this.clock()) : requireDate(input.date);
    const unitPriceCents = requirePositiveCents(input.unitPriceCents, "unitPriceCents");
    return this.store.update((document) => {
      const entry: PriceEntry = { id: randomUUID(), item, key: itemKey(item), date, unitPriceCents, tripId: null, createdAt: this.now() };
      document.prices.push(entry);
      return entry;
    });
  }

  async updatePrice(id: string, body: unknown): Promise<PriceEntry> {
    const input = requireObject(body);
    rejectUnknownFields(input, ["item", "date", "unitPriceCents"]);
    const item = input.item === undefined ? undefined : requireText(input.item, "item", 100);
    const date = input.date === undefined ? undefined : requireDate(input.date);
    const unitPriceCents = input.unitPriceCents === undefined ? undefined : requirePositiveCents(input.unitPriceCents, "unitPriceCents");
    return this.store.update((document) => {
      const entry = find(document.prices, id, "price entry");
      if (item !== undefined) { entry.item = item; entry.key = itemKey(item); }
      if (date !== undefined) entry.date = date;
      if (unitPriceCents !== undefined) entry.unitPriceCents = unitPriceCents;
      return entry;
    });
  }

  async deletePrice(id: string): Promise<void> {
    await this.store.update((document) => {
      find(document.prices, id, "price entry");
      document.prices = document.prices.filter((entry) => entry.id !== id);
    });
  }

  // Trips

  async listTrips(): Promise<Trip[]> {
    return (await this.store.read()).trips.sort((left, right) => right.date.localeCompare(left.date) || right.completedAt.localeCompare(left.completedAt));
  }

  async getTrip(id: string): Promise<Trip> {
    return find((await this.store.read()).trips, id, "trip");
  }

  /**
   * Completes a trip from the ticked items: writes exactly one Finance expense (category Groceries) for the total,
   * records each item's price, and removes the bought items from the list. If saving the trip fails after the
   * expense was written, the expense is removed again so Finance and Groceries never disagree.
   */
  async completeTrip(body: unknown): Promise<Trip> {
    const input = requireObject(body);
    rejectUnknownFields(input, ["date", "store"]);
    const date = input.date === undefined ? localIsoDate(this.clock()) : requireDate(input.date);
    const store = optionalText(input.store, "store", 100);
    const snapshot = await this.store.read();
    const bought = snapshot.items.filter((item) => item.bought);
    if (!bought.length) throw new ValidationError("Tick at least one bought item before completing a trip");
    const unpriced = bought.filter((item) => item.unitPriceCents === null).map((item) => item.name);
    if (unpriced.length) throw new ValidationError(`Set a price for: ${unpriced.join(", ")}`);
    const items: TripItem[] = bought.map((item) => ({ name: item.name, quantity: item.quantity, unitPriceCents: item.unitPriceCents!, lineCents: lineCents(item.quantity, item.unitPriceCents!) }));
    const totalCents = tripTotalCents(items);
    const boughtIds = new Set(bought.map((item) => item.id));
    const transactionId = await this.finance.createGroceryExpense({ amountCents: totalCents, date, note: tripNote(store) });
    try {
      return await this.store.update((document) => {
        if (document.items.filter((item) => item.bought).some((item) => !boughtIds.has(item.id)) || [...boughtIds].some((id) => !document.items.some((item) => item.id === id && item.bought))) {
          throw new ValidationError("The shopping list changed while completing the trip; try again");
        }
        const trip: Trip = { id: randomUUID(), date, store, items, totalCents, transactionId, completedAt: this.now() };
        document.trips.push(trip);
        for (const item of items) document.prices.push({ id: randomUUID(), item: item.name, key: itemKey(item.name), date, unitPriceCents: item.unitPriceCents, tripId: trip.id, createdAt: this.now() });
        document.items = document.items.filter((item) => !boughtIds.has(item.id));
        return trip;
      });
    } catch (error) {
      await this.finance.deleteGroceryExpense(transactionId).catch(() => undefined);
      throw error;
    }
  }

  /** Edits date, store or items; the linked Finance expense follows (amount, date and note). */
  async updateTrip(id: string, body: unknown): Promise<Trip> {
    const input = requireObject(body);
    rejectUnknownFields(input, ["date", "store", "items"]);
    const date = input.date === undefined ? undefined : requireDate(input.date);
    const store = input.store === undefined ? undefined : optionalText(input.store, "store", 100);
    const items = input.items === undefined ? undefined : tripItems(input.items, "items");
    const current = await this.getTrip(id);
    const next: Trip = { ...current, date: date ?? current.date, store: store ?? current.store, items: items ?? current.items };
    next.totalCents = tripTotalCents(next.items);
    let transactionId = current.transactionId;
    if (transactionId) {
      try { await this.finance.updateGroceryExpense(transactionId, { amountCents: next.totalCents, date: next.date, note: tripNote(next.store) }); }
      catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
        transactionId = null;
      }
    }
    return this.store.update((document) => {
      const trip = find(document.trips, id, "trip");
      Object.assign(trip, next, { transactionId });
      if (items !== undefined || date !== undefined) {
        document.prices = document.prices.filter((entry) => entry.tripId !== id);
        for (const item of trip.items) document.prices.push({ id: randomUUID(), item: item.name, key: itemKey(item.name), date: trip.date, unitPriceCents: item.unitPriceCents, tripId: id, createdAt: this.now() });
      }
      return trip;
    });
  }

  /** Deletes the trip, its recorded prices, and its Finance expense (if it still exists). */
  async deleteTrip(id: string): Promise<void> {
    const trip = await this.getTrip(id);
    if (trip.transactionId) {
      await this.finance.deleteGroceryExpense(trip.transactionId).catch((error: unknown) => {
        if (!(error instanceof NotFoundError)) throw error;
      });
    }
    await this.store.update((document) => {
      document.trips = document.trips.filter((candidate) => candidate.id !== id);
      document.prices = document.prices.filter((entry) => entry.tripId !== id);
    });
  }
}
