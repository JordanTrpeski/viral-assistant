export type ObjectiveType = "build" | "analyze" | "research";
export type RefinementAction = "PROCEED" | "OWNER_INPUT_REQUIRED";

export const clarityThreshold = 0.6;
export const maxRefinementIterations = 3;

export interface AnswerAssessment { questionId: string; question: string; answer: string; clarity: number }
export interface RefinementResult {
  action: RefinementAction;
  objectiveType: ObjectiveType | null;
  questions: string[];
  answers: AnswerAssessment[];
  iteration: number;
}
export interface ObjectiveClarification { needsRefinement: boolean; objectiveType: ObjectiveType | null; questions: string[] }

interface RefinementQuestion {
  id: string;
  text: string;
  subject: RegExp;   // identifies this question from the question text
  concrete: RegExp;  // a concrete, high-clarity answer (specific engine/unit/value)
  category?: RegExp; // a weak/partial answer (a category with no specifics)
}

// Objective-type triggers. "implement"/"add" are deliberately excluded — they name already-scoped work.
const buildTrigger = /\b(build|create|make|design|develop|scaffold)\b/i;
const analyzeTrigger = /\b(analy[sz]e|assess|evaluate|review)\b/i;
const researchTrigger = /\b(research|investigate|explore|study up on)\b/i;

const concreteSpec = /\b(function|method|class|module|component|endpoint|route|cli command|returns?|takes?|accepts?|inputs?|outputs?|parameters?|arguments?|array|string|number|boolean|object|json|yaml|schema|signature|field|column|table|regex|sum|average|count|sort|filter|parse|validate|given|when|then)\b/gi;

const voiceDomain = /\b(voice|speech|audio|stt|tts|microphone|spoken|dictation|transcri)/i;
const learningDomain = /\b(learn|learning|tutor|lesson|course|language|flashcard|quiz|vocabulary|grammar)/i;

const VAGUE = /\b(something|somehow|good|nice|best|great|whatever|any|some|stuff|things?|tbd|idk|not sure|maybe|dunno|etc|later)\b/i;
const CLOUD_LOCAL = /\b(cloud|local|offline|online|hosted|self[- ]?hosted|api|standard|basic|simple|default)\b/i;

const voiceQuestions: RefinementQuestion[] = [
  { id: "stt", text: "Which speech-to-text (STT) engine or approach should it use?", subject: /\bstt\b|speech[- ]?to[- ]?text/i, concrete: /\b(whisper|vosk|deepgram|kaldi|wav2vec|assemblyai|google speech|azure speech|web speech api)\b/i, category: CLOUD_LOCAL },
  { id: "tts", text: "Which text-to-speech (TTS) engine or voice should it use?", subject: /\btts\b|text[- ]?to[- ]?speech/i, concrete: /\b(piper|coqui|espeak|festival|elevenlabs|azure tts|google tts|say)\b/i, category: CLOUD_LOCAL },
  { id: "sampleRate", text: "What audio sample rate and format are required?", subject: /sample[- ]?rate|audio (sample|rate|format)/i, concrete: /\b(\d{1,3}\s?khz|\d{3,6}\s?hz|mono|stereo|pcm|wav|opus|flac)\b/i, category: /\b(cd quality|standard|high|low)\b/i },
  { id: "timeout", text: "What silence/response timeout should end a turn?", subject: /timeout|silence/i, concrete: /\b\d+\s?(ms|s|sec|secs|seconds|minute|minutes)\b/i, category: /\b(short|long|quick|brief)\b/i },
  { id: "interrupt", text: "Should the user be able to interrupt (barge-in) during playback?", subject: /interrupt|barge/i, concrete: /\b(yes|no|true|false|barge[- ]?in|interrupt(s|ing|ible)?|enabled?|disabled?|allow|disallow)\b/i, category: /\b(maybe|optional)\b/i }
];

const learningQuestions: RefinementQuestion[] = [
  { id: "level", text: "What proficiency level(s) should it target (beginner, intermediate, advanced)?", subject: /proficiency|level/i, concrete: /\b(beginner|intermediate|advanced|a1|a2|b1|b2|c1|c2|novice|fluent)\b/i, category: /\b(basic|casual)\b/i },
  { id: "content", text: "What content or skills should it cover (vocabulary, grammar, conversation, listening)?", subject: /content|skills|cover/i, concrete: /\b(vocabulary|grammar|conversation|listening|reading|writing|speaking|pronunciation)\b/i },
  { id: "lformat", text: "What format and platform should it use (web, mobile, or CLI; lessons, flashcards, or quizzes)?", subject: /format|platform/i, concrete: /\b(web|mobile|ios|android|cli|desktop|flashcards?|quiz(zes)?|lessons?|spaced repetition)\b/i }
];

const genericBuildQuestions: RefinementQuestion[] = [
  { id: "scope", text: "What is the intended scope and level of detail (prototype, MVP, or production)?", subject: /scope|level of detail/i, concrete: /\b(prototype|mvp|production|proof of concept|poc|full)\b/i },
  { id: "tech", text: "Any technology, language, or framework preference?", subject: /technolog|language|framework/i, concrete: /\b(typescript|javascript|python|react|node|rust|go|java|svelte|vue|next\.?js|c\+\+|c#|swift|kotlin)\b/i, category: CLOUD_LOCAL },
  { id: "timeline", text: "Is there a timeline or deadline to plan around?", subject: /timeline|deadline/i, concrete: /\b(\d+\s?(day|days|week|weeks|month|months|hour|hours)|asap|by (monday|tuesday|wednesday|thursday|friday|next))\b/i },
  { id: "output", text: "What output format or deliverable is expected?", subject: /output|deliverable/i, concrete: /\b(cli|web app|library|api|report|json|binary|package|npm|docker|website|script)\b/i }
];

const analyzeQuestions: RefinementQuestion[] = [
  { id: "dataSource", text: "What is the data source or input to analyze?", subject: /data source|input to analyze/i, concrete: /\b(csv|json|database|sql|api|spreadsheet|logs?|file|dataset|excel)\b/i },
  { id: "aoutput", text: "What output format should the analysis produce?", subject: /output format/i, concrete: /\b(report|chart|graph|summary|json|csv|dashboard|table)\b/i },
  { id: "aconstraints", text: "Are there constraints, filters, or a time range to apply?", subject: /constraint|filter|time range/i, concrete: /\b(last \d+|between|since|filter|only|top \d+|\d{4})\b/i }
];

const researchQuestions: RefinementQuestion[] = [
  { id: "rtopic", text: "What specific topic or question should the research focus on?", subject: /topic or question|focus on/i, concrete: /[a-z]{4,}\s+[a-z]{4,}/i },
  { id: "rdepth", text: "How deep should the research go (a quick overview or a thorough report)?", subject: /how deep|depth/i, concrete: /\b(quick|overview|thorough|deep|comprehensive|brief|shallow|detailed)\b/i },
  { id: "rformat", text: "What output format is expected (summary, report, or annotated links)?", subject: /output format is expected/i, concrete: /\b(summary|report|annotated links|bullet|table|slides|memo)\b/i },
  { id: "rconstraints", text: "Any constraints (sources, recency, or scope) to respect?", subject: /constraints \(sources/i, concrete: /\b(recent|since \d{4}|peer[- ]?reviewed|academic|primary sources|last \d+)\b/i }
];

const allQuestions = [...voiceQuestions, ...learningQuestions, ...genericBuildQuestions, ...analyzeQuestions, ...researchQuestions];

function scoreAnswer(question: RefinementQuestion, answer: string): number {
  const text = answer.toLowerCase();
  if (question.concrete.test(text)) return 0.9;
  if (question.category?.test(text)) return 0.3;
  if (VAGUE.test(text)) return 0.1;
  return 0.2;
}

function fragments(objective: string): string[] {
  return objective.split(/[,;.\n]|\band\b/i).map((part) => part.trim()).filter(Boolean);
}

/**
 * Iterative, deterministic objective refinement. Detects embedded answers, validates their clarity,
 * and asks follow-ups only for vague or missing answers — capped at maxRefinementIterations per thread.
 */
export class ObjectiveRefiner {
  private readonly iterations = new Map<string, number>();

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

  private domain(objective: string): string {
    if (voiceDomain.test(objective)) return "voice";
    if (learningDomain.test(objective)) return "learning";
    return "generic";
  }

  private questionSet(type: ObjectiveType, objective: string): RefinementQuestion[] {
    if (type === "analyze") return analyzeQuestions;
    if (type === "research") return researchQuestions;
    if (voiceDomain.test(objective)) return voiceQuestions;
    if (learningDomain.test(objective)) return learningQuestions;
    return genericBuildQuestions;
  }

  /** Clarity score in [0,1] for an answer to a question (identified by its text). */
  validateAnswer(questionText: string, answerText: string): number {
    const answer = answerText.trim();
    if (!answer) return 0;
    const question = allQuestions.find((candidate) => candidate.subject.test(questionText));
    if (question) return scoreAnswer(question, answer);
    const text = answer.toLowerCase();
    if (VAGUE.test(text)) return 0.1;
    if (/\d/.test(answer) || /\b[A-Z][a-zA-Z]{2,}\b/.test(answer)) return 0.7;
    return 0.3;
  }

  /** Extracts attempted answers embedded in the objective, keyed by question id. */
  extractAnswers(objective: string): Map<string, string> {
    const type = this.type(objective);
    const answers = new Map<string, string>();
    if (!type) return answers;
    const parts = fragments(objective);
    for (const question of this.questionSet(type, objective)) {
      const fragment = parts.find((part) => question.subject.test(part) || question.concrete.test(part));
      if (fragment) answers.set(question.id, fragment);
    }
    return answers;
  }

  private evaluate(objective: string): { type: ObjectiveType | null; unclear: RefinementQuestion[]; answers: AnswerAssessment[] } {
    const type = this.type(objective);
    if (!type) return { type: null, unclear: [], answers: [] };
    // A concrete specification is already clear enough to execute — never gate it.
    if (this.isSpecific(objective)) return { type, unclear: [], answers: [] };
    const set = this.questionSet(type, objective);
    const found = this.extractAnswers(objective);
    const unclear: RefinementQuestion[] = [];
    const answers: AnswerAssessment[] = [];
    for (const question of set) {
      const answer = found.get(question.id);
      const clarity = answer ? scoreAnswer(question, answer) : 0;
      if (answer) answers.push({ questionId: question.id, question: question.text, answer, clarity });
      if (clarity < clarityThreshold) unclear.push(question);
    }
    return { type, unclear, answers };
  }

  refine(rawObjective: string): RefinementResult {
    const objective = rawObjective.trim();
    const { type, unclear, answers } = this.evaluate(objective);
    if (!type || unclear.length === 0) {
      const key = type ? `${type}:${this.domain(objective)}` : "";
      return { action: "PROCEED", objectiveType: type, questions: [], answers, iteration: this.iterations.get(key) ?? 0 };
    }
    const key = `${type}:${this.domain(objective)}`;
    const iteration = (this.iterations.get(key) ?? 0) + 1;
    this.iterations.set(key, iteration);
    if (iteration > maxRefinementIterations) {
      return { action: "PROCEED", objectiveType: type, questions: [], answers, iteration };
    }
    return { action: "OWNER_INPUT_REQUIRED", objectiveType: type, questions: unclear.map((question) => question.text), answers, iteration };
  }

  /** Stateless single-shot view (does not advance the iteration counter). */
  clarify(rawObjective: string): ObjectiveClarification {
    const { type, unclear } = this.evaluate(rawObjective.trim());
    return { needsRefinement: Boolean(type) && unclear.length > 0, objectiveType: type, questions: unclear.map((question) => question.text) };
  }
}
