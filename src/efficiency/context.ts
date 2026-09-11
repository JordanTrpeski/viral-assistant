import type { LocalBrain } from "../local/tasks.js";
import type { EfficiencyConfig, ContextPlan, ContextSection } from "./types.js";

type Compressor = Pick<LocalBrain, "selectRelevantContext">;
function boundedScore(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("context scores must be between 0 and 1");
  return value;
}
function validateSections(sections: ContextSection[]): void {
  if (new Set(sections.map((section) => section.id)).size !== sections.length) throw new Error("context section ids must be unique");
  for (const section of sections) if (!section.id.trim() || !section.content.trim()) throw new Error("context sections require non-empty id and content");
}
function block(section: ContextSection): string { return `## ${section.id}\n${section.content}\n`; }
function score(section: ContextSection): number {
  return boundedScore(section.authority) * 4 + boundedScore(section.relevance) * 3 + boundedScore(section.recency) * 2 + boundedScore(section.dependency) * 2;
}

export class EfficiencyContextPlanner {
  constructor(private readonly config: EfficiencyConfig, private readonly compressor?: Compressor) {}

  async plan(task: string, sections: ContextSection[]): Promise<ContextPlan> {
    if (!task.trim()) throw new Error("context task must be non-empty");
    validateSections(sections);
    const originalCharacters = sections.reduce((total, section) => total + section.content.length, 0);
    const mandatory = sections.filter((section) => section.mandatory);
    const optional = sections.filter((section) => !section.mandatory).sort((left, right) => score(right) - score(left) || left.content.length - right.content.length || left.id.localeCompare(right.id));
    const parts: string[] = [];
    const includedIds: string[] = [];
    for (const section of mandatory) { parts.push(block(section)); includedIds.push(section.id); }
    let packetCharacters = parts.join("\n").length;
    for (const section of optional) {
      const next = block(section);
      if (packetCharacters + next.length > this.config.initialContextCharacters) continue;
      parts.push(next); includedIds.push(section.id); packetCharacters = parts.join("\n").length;
    }
    const excludedIds = sections.map((section) => section.id).filter((id) => !includedIds.includes(id));
    const summarizedIds: string[] = [];
    const diagnostics: string[] = [];
    let usedLocalCompression = false;
    if (this.compressor && excludedIds.length > 0 && packetCharacters < this.config.initialContextCharacters) {
      const candidates = Object.fromEntries(sections.filter((section) => excludedIds.includes(section.id)).map((section) => [section.id, section.content]));
      const compressed = await this.compressor.selectRelevantContext(task, candidates);
      if (compressed.succeeded && compressed.value) {
        const selected = compressed.value.selectedKeys.filter((id) => excludedIds.includes(id));
        const summary = compressed.value.summary.trim();
        const summaryBlock = `## Local relevance summary (${selected.join(", ")})\n${summary}\n`;
        if (selected.length > 0 && summary && packetCharacters + summaryBlock.length <= this.config.initialContextCharacters) {
          parts.push(summaryBlock); summarizedIds.push(...selected); usedLocalCompression = true;
        }
      } else diagnostics.push(`Local context compression unavailable; deterministic selection retained. ${compressed.diagnostics.join(" ")}`.trim());
    }
    const content = parts.join("\n").slice(0, Math.max(this.config.maximumContextCharacters, parts.filter((_part, index) => index < mandatory.length).join("\n").length));
    packetCharacters = content.length;
    return {
      schemaVersion: 1, content, includedIds, excludedIds, summarizedIds, originalCharacters, packetCharacters,
      budgetCharacters: this.config.initialContextCharacters, overBudget: packetCharacters > this.config.maximumContextCharacters,
      usedLocalCompression, diagnostics
    };
  }

  retrieve(plan: ContextPlan, sections: ContextSection[], requestedIds: string[]): ContextPlan {
    validateSections(sections);
    const byId = new Map(sections.map((section) => [section.id, section]));
    const included = [...plan.includedIds];
    let content = plan.content;
    const diagnostics = [...plan.diagnostics];
    for (const id of [...new Set(requestedIds)]) {
      if (included.includes(id)) continue;
      const section = byId.get(id);
      if (!section) { diagnostics.push(`Requested context section not found: ${id}`); continue; }
      const next = `\n${block(section)}`;
      if (content.length + next.length > this.config.maximumContextCharacters) { diagnostics.push(`Maximum context budget prevented retrieval of: ${id}`); continue; }
      content += next; included.push(id);
    }
    return {
      ...plan, content, includedIds: included,
      excludedIds: sections.map((section) => section.id).filter((id) => !included.includes(id)),
      packetCharacters: content.length, budgetCharacters: this.config.maximumContextCharacters,
      overBudget: content.length > this.config.maximumContextCharacters, diagnostics
    };
  }
}
