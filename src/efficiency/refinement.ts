export type ObjectiveType = "build" | "analyze" | "research";

export interface ObjectiveClarification {
  needsRefinement: boolean;
  objectiveType: ObjectiveType | null;
  questions: string[];
}

// Objective-type triggers. Note: "implement"/"add" are deliberately excluded — they routinely name a
// concrete, already-scoped development task ("Implement the governor") that must flow straight through.
const buildTrigger = /\b(build|create|make|design|develop|scaffold)\b/i;
const analyzeTrigger = /\b(analy[sz]e|assess|evaluate|review)\b/i;
const researchTrigger = /\b(research|investigate|explore|study up on)\b/i;

// Concrete specification tokens. Two or more distinct matches mean the objective already states enough
// detail (inputs, outputs, signature, tech) that clarifying questions would be noise.
const concreteSpec = /\b(function|method|class|module|component|endpoint|route|cli command|returns?|takes?|accepts?|inputs?|outputs?|parameters?|arguments?|array|string|number|boolean|object|json|yaml|schema|signature|field|column|table|regex|sum|average|count|sort|filter|parse|validate|given|when|then)\b/gi;

// Domain detectors that swap the generic template for questions that actually matter for that domain.
const voiceDomain = /\b(voice|speech|audio|stt|tts|microphone|spoken|dictation|transcri)/i;
const learningDomain = /\b(learn|learning|tutor|lesson|course|language|flashcard|quiz|vocabulary|grammar)/i;

const voiceQuestions = [
  "Which speech-to-text (STT) engine or approach should it use?",
  "Which text-to-speech (TTS) engine or voice should it use?",
  "What audio sample rate and format are required?",
  "What silence/response timeout should end a turn?",
  "Should the user be able to interrupt (barge-in) during playback?"
];

const learningQuestions = [
  "What proficiency level(s) should it target (beginner, intermediate, advanced)?",
  "What content or skills should it cover (vocabulary, grammar, conversation, listening)?",
  "What format and platform should it use (web, mobile, or CLI; lessons, flashcards, or quizzes)?"
];

const genericBuildQuestions = [
  "What is the intended scope and level of detail (prototype, MVP, or production)?",
  "Any technology, language, or framework preference?",
  "Is there a timeline or deadline to plan around?",
  "What output format or deliverable is expected?"
];

const analyzeQuestions = [
  "What is the data source or input to analyze?",
  "What output format should the analysis produce?",
  "Are there constraints, filters, or a time range to apply?"
];

const researchQuestions = [
  "What specific topic or question should the research focus on?",
  "How deep should the research go (a quick overview or a thorough report)?",
  "What output format is expected (summary, report, or annotated links)?",
  "Any constraints (sources, recency, or scope) to respect?"
];

/**
 * Decides whether an objective is specific enough to execute, or whether Viral should ask the owner
 * clarifying questions first. Deterministic and model-free: it inspects only the objective text.
 */
export class ObjectiveRefiner {
  private type(objective: string): ObjectiveType | null {
    if (buildTrigger.test(objective)) return "build";
    if (analyzeTrigger.test(objective)) return "analyze";
    if (researchTrigger.test(objective)) return "research";
    return null;
  }

  private isSpecific(objective: string): boolean {
    const matches = objective.match(concreteSpec) ?? [];
    return new Set(matches.map((token) => token.toLowerCase())).size >= 2;
  }

  private questionsFor(type: ObjectiveType, objective: string): string[] {
    if (type === "analyze") return analyzeQuestions;
    if (type === "research") return researchQuestions;
    if (voiceDomain.test(objective)) return voiceQuestions;
    if (learningDomain.test(objective)) return learningQuestions;
    return genericBuildQuestions;
  }

  clarify(rawObjective: string): ObjectiveClarification {
    const objective = rawObjective.trim();
    const type = objective ? this.type(objective) : null;
    if (!type || this.isSpecific(objective)) return { needsRefinement: false, objectiveType: type, questions: [] };
    const questions = this.questionsFor(type, objective);
    return { needsRefinement: questions.length > 0, objectiveType: type, questions };
  }
}
