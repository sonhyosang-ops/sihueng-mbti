// 브라우저(app.js)와 리눅스 서버(server.js)가 함께 쓰는 모듈
// 채점 · 입력 검사 · Claude 요청(프롬프트·스키마) 만들기. DOM이나 개인정보는 다루지 않아요.
import { DIMENSIONS, QUESTIONS, QUESTIONS_TEEN, TYPES, TYPES_TEEN } from "./data.js";

export const MODEL = "claude-opus-5-5";

// 학교급별 설정: 초등은 12문항·A4 1장, 중·고등은 16문항·A4 2장 상세 결과
export const LEVELS = {
  elem: { name: "초등학교", short: "초등", grades: 6, questions: QUESTIONS, hint: "12문항 · 결과지 A4 1장" },
  middle: { name: "중학교", short: "중", grades: 3, questions: QUESTIONS_TEEN, hint: "16문항 · 상세 결과지 A4 2장" },
  high: { name: "고등학교", short: "고", grades: 3, questions: QUESTIONS_TEEN, hint: "16문항 · 상세 결과지 A4 2장" },
};

// 학교급 · 학년 · 답이 올바른지 검사 (서버는 이것만 받아요)
export function validInput(level, grade, answers) {
  const L = LEVELS[level];
  if (!L) return false;
  const g = Number(grade);
  if (!Number.isInteger(g) || g < 1 || g > L.grades) return false;
  return Array.isArray(answers) && answers.length === L.questions.length && answers.every((x) => x === "a" || x === "b");
}

export const gradeText = (level, grade) => `${LEVELS[level].name} ${grade}학년`;

// ─────────────────────────────────────────────
// 채점 — 지표별 문항 수(3 또는 4)에 맞춰 계산
// 동점(2:2)이면 그 지표의 첫 문항 답을 따르고 'balanced'로 표시
// ─────────────────────────────────────────────
export function scoreAnswers(level, answers) {
  const Q = LEVELS[level].questions;
  const dims = DIMENSIONS.map((d) => {
    let left = 0, right = 0, first = null;
    Q.forEach((q, i) => {
      if (q.dim !== d.key) return;
      if (first === null) first = answers[i];
      answers[i] === "a" ? left++ : right++;
    });
    const n = left + right;
    const balanced = left === right;
    const pick = balanced ? (first === "a" ? d.left : d.right) : left > right ? d.left : d.right;
    const win = Math.max(left, right);
    const strength = balanced ? "균형" : win === n ? "뚜렷" : "조금 더";
    return { ...d, leftCount: left, rightCount: right, n, pick, balanced, strength, pct: Math.round((win / n) * 100) };
  });
  return { type: dims.map((d) => d.pick).join(""), dims };
}

// ─────────────────────────────────────────────
// Claude API — 학생 이름은 보내지 않아요
// ─────────────────────────────────────────────
export const SCHEMA_ELEM = {
  type: "object",
  properties: {
    nickname: { type: "string" },
    summary: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    growth: { type: "array", items: { type: "string" } },
    study: { type: "string" },
    friend: { type: "string" },
    cheer: { type: "string" },
  },
  required: ["nickname", "summary", "strengths", "growth", "study", "friend", "cheer"],
  additionalProperties: false,
};

export const SCHEMA_TEEN = {
  type: "object",
  properties: {
    nickname: { type: "string" },
    summary: { type: "string" },
    dimNotes: {
      type: "object",
      properties: { EI: { type: "string" }, SN: { type: "string" }, TF: { type: "string" }, JP: { type: "string" } },
      required: ["EI", "SN", "TF", "JP"],
      additionalProperties: false,
    },
    strengths: { type: "array", items: { type: "string" } },
    growth: { type: "array", items: { type: "string" } },
    study: { type: "string" },
    relation: { type: "string" },
    stress: { type: "string" },
    explore: { type: "array", items: { type: "string" } },
    actions: { type: "array", items: { type: "string" } },
    cheer: { type: "string" },
  },
  required: ["nickname", "summary", "dimNotes", "strengths", "growth", "study", "relation", "stress", "explore", "actions", "cheer"],
  additionalProperties: false,
};

const COMMON_RULES = `- 학생이 실제로 고른 답을 근거로 들어서, 이 학생만을 위한 해설처럼 느껴지게 써.
- 성격 유형은 정답이나 꼬리표가 아니라 나를 알아가는 도구라는 관점을 지켜. 단점은 '성장 포인트'로 긍정적으로 바꿔 말해.
- 다른 유형을 깎아내리거나, 진로·능력을 단정하는 말은 쓰지 마.
- 이모지는 쓰지 마(결과지 디자인에 이미 들어 있어).`;

function systemPromptElem(grade) {
  return `너는 초등학생을 위한 성격 유형(MBTI) 결과지를 쓰는 다정한 상담 선생님이야.
독자는 초등학교 ${grade}학년 학생이고, 결과지는 A4 한 장 분량이고, 학생이 자기 휴대폰으로 내려받아 간직해.

글쓰기 원칙:
- 초등학생이 바로 이해할 쉬운 낱말로, 따뜻한 "~해요" 말투로 써. 학생을 부를 때는 "너"라고 해.
${COMMON_RULES}

분량(인쇄 칸에 맞춰야 하니 꼭 지켜):
- nickname: 동물이나 사물에 빗댄 귀여운 별명, 공백 포함 18자 이내
- summary: 3문장, 공백 포함 150자 이내
- strengths: 정확히 3개, 각 22자 이내
- growth: 정확히 2개, 각 38자 이내
- study: 1~2문장, 70자 이내 (이 학생에게 맞는 공부 방법)
- friend: 1~2문장, 70자 이내 (친구 관계 팁)
- cheer: 1~2문장, 55자 이내 (응원 한마디)`;
}

function systemPromptTeen(gradeText) {
  return `너는 청소년 진로·상담 선생님이고, 성격 유형(MBTI) 간이 검사의 상세 결과지를 써.
독자는 ${gradeText} 학생이고, 결과지는 A4 두 장 분량이고, 학생이 자기 휴대폰으로 내려받아 간직해. 스스로를 이해하고 생활에 적용할 수 있게 구체적으로 써.

글쓰기 원칙:
- 청소년이 존중받는다고 느끼는 자연스러운 "~해요" 말투로 써. 유치한 표현은 피하고, 학생을 부르는 호칭(너, 당신)은 쓰지 마.
- 각 지표의 점수가 '뚜렷'인지 '조금 더'인지 '균형'인지 반영해서 해석해. '균형'인 지표는 두 성향을 모두 가진 것으로 설명해.
- explore는 직업을 정해 주는 게 아니라 관심 가져 볼 만한 '분야' 이름이야.
${COMMON_RULES}

분량(인쇄 칸에 맞춰야 하니 꼭 지켜):
- nickname: 성격을 잘 드러내는 별명, 공백 포함 16자 이내
- summary: 4~5문장, 공백 포함 260자 이내
- dimNotes: EI·SN·TF·JP 각각 1~2문장, 75자 이내 (그 지표에서 이 학생의 모습)
- strengths: 정확히 4개, 각 24자 이내
- growth: 정확히 3개, 각 45자 이내
- study: 2~3문장, 130자 이내 (이 학생에게 맞는 공부 전략)
- relation: 2문장, 110자 이내 (친구·관계·소통)
- stress: 2문장, 110자 이내 (스트레스를 받는 상황과 회복 방법)
- explore: 정확히 4개, 각 10자 이내 (관심 가져 볼 분야)
- actions: 정확히 3개, 각 50자 이내 (이번 주에 바로 해 볼 수 있는 구체적 행동)
- cheer: 1~2문장, 60자 이내 (응원 한마디)`;
}

function userPrompt(level, answers, type, dims, nickname) {
  const Q = LEVELS[level].questions;
  const scoreLines = dims
    .map((d) => `- ${d.left}(${d.leftName}) ${d.leftCount} : ${d.rightCount} ${d.right}(${d.rightName}) → ${d.pick}, ${d.strength}`)
    .join("\n");
  const answerLines = Q.map((q, i) => `${i + 1}. ${q.q} → ${q[answers[i]].text}`).join("\n");
  return `결과 유형: ${type}
기본 별명(참고용, 더 어울리게 바꿔도 돼): ${nickname}

지표별 점수(각 ${dims[0].n}문항):
${scoreLines}

학생이 고른 답:
${answerLines}

위 내용을 바탕으로 결과지 문구를 JSON으로 작성해 줘.`;
}


// Claude Messages API 요청 본문 만들기 — 학교급·학년·답만으로 만들고 이름은 없어요
export function buildClaudeRequest(level, grade, answers) {
  const teen = level !== "elem";
  const { type, dims } = scoreAnswers(level, answers);
  const nickname = (teen ? TYPES_TEEN : TYPES)[type].nickname;
  return {
    model: MODEL,
    max_tokens: 12000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: teen ? SCHEMA_TEEN : SCHEMA_ELEM } },
    system: teen ? systemPromptTeen(gradeText(level, grade)) : systemPromptElem(grade),
    messages: [{ role: "user", content: userPrompt(level, answers, type, dims, nickname) }],
  };
}

// Claude 응답에서 결과 JSON 꺼내기 (거절·잘림이면 오류)
export function parseClaudeResponse(response) {
  if (response.stop_reason === "refusal") throw new Error("refusal");
  if (response.stop_reason === "max_tokens") throw new Error("max_tokens");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}
