import { DIMENSIONS, QUESTIONS, TYPES } from "./data.js";

// ─────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────
const MODEL = "claude-opus-5-5";
const SDK_PATH = "./vendor/anthropic-sdk-1.3.0.js";
const KEY_STORAGE = "mbti-claude-key"; // 선생님 API 키만 sessionStorage에 임시 보관 (학생 데이터는 절대 저장하지 않음)
const AFTER_PRINT_SECONDS = 20;
const IDLE_WIPE_MS = 5 * 60 * 1000; // 5분 동안 아무 조작이 없으면 자동 삭제

// ─────────────────────────────────────────────
// 상태 (메모리에만 존재)
// ─────────────────────────────────────────────
let state = freshState();
function freshState() {
  return { name: "", grade: "", answers: new Array(QUESTIONS.length).fill(null), index: 0, result: null };
}

const $ = (id) => document.getElementById(id);
const screens = ["start", "quiz", "loading", "result"];

function show(name) {
  for (const s of screens) $(`screen-${s}`).classList.toggle("active", s === name);
  document.body.classList.toggle("in-quiz", name === "quiz");
  window.scrollTo({ top: 0, behavior: "instant" });
}

function toast(msg, ms = 3200) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), ms);
}

// ─────────────────────────────────────────────
// 시작 화면 연출: 스크롤 등장 · 유형 글자 바뀜
// ─────────────────────────────────────────────
const io = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" })
  : null;
function armReveal() {
  document.querySelectorAll(".reveal").forEach((el) => (io ? io.observe(el) : el.classList.add("in")));
}
armReveal();

const TYPE_CYCLE = ["ENFP", "ISTJ", "INFP", "ESTJ", "INTP", "ESFJ", "ENTJ", "ISFP", "INFJ", "ESTP", "ISTP", "ENFJ", "ISFJ", "ENTP", "INTJ", "ESFP"];
let cycleIdx = 0;
setInterval(() => {
  const el = $("hero-type");
  if (!$("screen-start").classList.contains("active") || document.hidden) return;
  el.classList.add("swap");
  setTimeout(() => {
    cycleIdx = (cycleIdx + 1) % TYPE_CYCLE.length;
    el.textContent = TYPE_CYCLE[cycleIdx];
    el.classList.remove("swap");
  }, 500);
}, 2600);

// ─────────────────────────────────────────────
// 선생님 설정 (API 키)
// ─────────────────────────────────────────────
function safeGet(k) { try { return sessionStorage.getItem(k) || ""; } catch { return ""; } }
function safeSet(k, v) { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch { /* 저장 불가 환경은 메모리만 사용 */ } }
let apiKey = safeGet(KEY_STORAGE);

function refreshStatus() {
  const s = $("ai-status");
  s.textContent = apiKey ? "AI 맞춤 해설" : "기본 해설";
  s.classList.toggle("on", !!apiKey);
}
refreshStatus();

$("btn-teacher").addEventListener("click", () => $("dlg-teacher").showModal());
$("btn-key-save").addEventListener("click", () => {
  const v = $("in-key").value.trim();
  if (!v) return toast("API 키를 입력해 주세요.");
  apiKey = v;
  safeSet(KEY_STORAGE, v);
  $("in-key").value = "";
  refreshStatus();
  $("dlg-teacher").close();
  toast("AI 맞춤 해설을 사용합니다.");
});
$("btn-key-clear").addEventListener("click", () => {
  apiKey = "";
  safeSet(KEY_STORAGE, "");
  $("in-key").value = "";
  refreshStatus();
  toast("API 키를 지웠습니다.");
});

$("nav-home").addEventListener("click", () => {
  if ($("screen-start").classList.contains("active")) return window.scrollTo({ top: 0, behavior: "smooth" });
  if (state.result && !confirm("결과를 삭제하고 처음 화면으로 돌아갈까요?")) return;
  wipe(!!state.result);
});

// ─────────────────────────────────────────────
// 시작
// ─────────────────────────────────────────────
$("start-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("in-name").value.trim();
  const grade = document.querySelector('input[name="grade"]:checked')?.value || "";
  if (!name) { $("in-name").focus(); return toast("이름을 적어 주세요."); }
  if (!grade) return toast("학년을 골라 주세요.");
  state = freshState();
  state.name = name;
  state.grade = grade;
  show("quiz");
  renderQuestion();
});

// ─────────────────────────────────────────────
// 질문
// ─────────────────────────────────────────────
function renderQuestion() {
  const i = state.index;
  const q = QUESTIONS[i];
  $("q-count").textContent = `질문 ${i + 1} / ${QUESTIONS.length}`;
  $("q-text").textContent = q.q;
  const choices = document.querySelector(".choices");
  choices.classList.remove("locked");
  for (const side of ["a", "b"]) {
    const btn = $(`choice-${side}`);
    btn.querySelector(".choice-text").textContent = q[side].text;
    btn.classList.toggle("picked", state.answers[i] === side);
    btn.disabled = false;
  }
  for (const el of [$("q-text"), choices]) {
    el.classList.remove("enter");
    void el.offsetWidth; // 애니메이션 재시작
    el.classList.add("enter");
  }
  $("progress-fill").style.width = `${(i / QUESTIONS.length) * 100}%`;
}

function choose(side) {
  const i = state.index;
  state.answers[i] = side;
  $("choice-a").classList.toggle("picked", side === "a");
  $("choice-b").classList.toggle("picked", side === "b");
  document.querySelector(".choices").classList.add("locked");
  $("choice-a").disabled = $("choice-b").disabled = true;
  setTimeout(() => {
    if (i < QUESTIONS.length - 1) {
      state.index++;
      renderQuestion();
    } else {
      $("progress-fill").style.width = "100%";
      finish();
    }
  }, 380);
}

$("choice-a").addEventListener("click", () => choose("a"));
$("choice-b").addEventListener("click", () => choose("b"));
$("btn-back").addEventListener("click", () => {
  if (state.index === 0) { wipe(false); return; }
  state.index--;
  renderQuestion();
});
document.addEventListener("keydown", (e) => {
  if (!$("screen-quiz").classList.contains("active") || $("choice-a").disabled) return;
  const k = e.key.toLowerCase();
  if (k === "1" || k === "a") choose("a");
  if (k === "2" || k === "b") choose("b");
});

// ─────────────────────────────────────────────
// 채점
// ─────────────────────────────────────────────
function score() {
  const dims = DIMENSIONS.map((d) => {
    let left = 0, right = 0;
    QUESTIONS.forEach((q, i) => {
      if (q.dim !== d.key) return;
      state.answers[i] === "a" ? left++ : right++;
    });
    return { ...d, leftCount: left, rightCount: right, pick: left > right ? d.left : d.right };
  });
  return { type: dims.map((d) => d.pick).join(""), dims };
}

// ─────────────────────────────────────────────
// Claude API — 학생 이름은 보내지 않아요
// ─────────────────────────────────────────────
const RESULT_SCHEMA = {
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

function systemPrompt(grade) {
  return `너는 초등학생을 위한 성격 유형(MBTI) 결과지를 쓰는 다정한 상담 선생님이야.
독자는 초등학교 ${grade}학년 학생이고, 결과지는 A4 한 장에 인쇄되어 집에 가져가.

글쓰기 원칙:
- 초등학생이 바로 이해할 쉬운 낱말로, 따뜻한 "~해요" 말투로 써. 학생을 부를 때는 "너"라고 해.
- 학생이 실제로 고른 답을 근거로 들어서, 이 학생만을 위한 해설처럼 느껴지게 써.
- 성격 유형은 정답이나 꼬리표가 아니라 나를 알아가는 도구라는 관점을 지켜. 단점은 '성장 포인트'로 긍정적으로 바꿔 말해.
- 다른 유형을 깎아내리거나, 진로·능력을 단정하는 말은 쓰지 마.
- 이모지는 쓰지 마(결과지 디자인에 이미 들어 있어).

분량(인쇄 칸에 맞춰야 하니 꼭 지켜):
- nickname: 동물이나 사물에 빗댄 귀여운 별명, 공백 포함 18자 이내
- summary: 3문장, 공백 포함 150자 이내
- strengths: 정확히 3개, 각 22자 이내
- growth: 정확히 2개, 각 38자 이내
- study: 1~2문장, 70자 이내 (이 학생에게 맞는 공부 방법)
- friend: 1~2문장, 70자 이내 (친구 관계 팁)
- cheer: 1~2문장, 55자 이내 (응원 한마디)`;
}

function userPrompt(type, dims) {
  const base = TYPES[type];
  const scoreLines = dims
    .map((d) => `- ${d.left}(${d.leftName}) ${d.leftCount} : ${d.rightCount} ${d.right}(${d.rightName})`)
    .join("\n");
  const answerLines = QUESTIONS.map((q, i) => `${i + 1}. ${q.q} → ${q[state.answers[i]].text}`).join("\n");
  return `결과 유형: ${type}
기본 별명(참고용, 더 어울리게 바꿔도 돼): ${base.nickname}

지표별 점수(각 3문항):
${scoreLines}

학생이 고른 답:
${answerLines}

위 내용을 바탕으로 결과지 문구를 JSON으로 작성해 줘.`;
}

async function askClaude(type, dims) {
  const { default: Anthropic } = await import(SDK_PATH);
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, timeout: 90_000, maxRetries: 1 });
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: RESULT_SCHEMA } },
    system: systemPrompt(state.grade),
    messages: [{ role: "user", content: userPrompt(type, dims) }],
  });
  if (response.stop_reason === "refusal") throw new Error("refusal");
  if (response.stop_reason === "max_tokens") throw new Error("max_tokens");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

// AI 응답을 기본 해설과 합쳐서 빈칸·이상값이 없게 정리
function mergeResult(base, ai) {
  const str = (v, fb, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fb);
  const list = (v, fb, n, max) => {
    const arr = Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, max)) : [];
    return arr.length >= n ? arr.slice(0, n) : fb;
  };
  if (!ai) return { ...base, ai: false };
  return {
    emoji: base.emoji,
    nickname: str(ai.nickname, base.nickname, 24),
    summary: str(ai.summary, base.summary, 220),
    strengths: list(ai.strengths, base.strengths, 3, 34),
    growth: list(ai.growth, base.growth, 2, 56),
    study: str(ai.study, base.study, 110),
    friend: str(ai.friend, base.friend, 110),
    cheer: str(ai.cheer, base.cheer, 90),
    ai: true,
  };
}


const LOADING_MSGS = [
  "답변을 하나씩 살펴보는 중",
  "나만의 강점을 찾는 중",
  "어울리는 별명을 고르는 중",
  "결과지를 정리하는 중",
];

async function finish() {
  const { type, dims } = score();
  show("loading");
  let m = 0;
  $("loading-msg").textContent = LOADING_MSGS[0];
  const ticker = setInterval(() => { m = (m + 1) % LOADING_MSGS.length; $("loading-msg").textContent = LOADING_MSGS[m]; }, 1800);

  const base = TYPES[type];
  let ai = null;
  if (apiKey) {
    try {
      ai = await askClaude(type, dims);
    } catch (err) {
      console.warn("Claude API 호출 실패, 기본 해설을 사용합니다:", err);
      toast("AI 연결이 원활하지 않아 기본 해설로 만들었어요.", 4500);
    }
  } else {
    await new Promise((r) => setTimeout(r, 1600));
  }
  clearInterval(ticker);

  state.result = { type, dims, content: mergeResult(base, ai) };
  renderResult();
  show("result");
  requestAnimationFrame(fitAndScale);
}

// ─────────────────────────────────────────────
// 결과지 (A4)
// ─────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

function dimRow(d) {
  const leftWin = d.pick === d.left;
  const segs = [0, 1, 2].map((k) => `<i class="${k < d.leftCount ? "on" : ""}"></i>`).join("");
  return `
    <div class="d-row" style="--c:${d.color}">
      <div class="d-end ${leftWin ? "win" : ""}"><b>${d.left}</b><small>${d.leftName}</small></div>
      <div class="d-track">${segs}</div>
      <div class="d-end right ${leftWin ? "" : "win"}"><small>${d.rightName}</small><b>${d.right}</b></div>
      <p class="d-desc">${esc(leftWin ? d.leftDesc : d.rightDesc)}</p>
    </div>`;
}

function renderResult() {
  const { type, dims, content: c } = state.result;
  $("result-eyebrow").textContent = `${state.name}의 성격 유형`;
  $("result-type").textContent = type;
  $("result-nick").textContent = c.nickname;

  $("sheet-scale").innerHTML = `
  <article class="sheet" id="sheet">
    <div class="sheet-inner" id="sheet-inner">
      <header class="sh-top">
        <p class="sh-brand">성격 탐험 리포트<small>12문항 간이 성격 유형 검사</small></p>
        <dl class="sh-meta">
          <div><dt>이름</dt><dd>${esc(state.name)}</dd></div>
          <div><dt>학년</dt><dd>${esc(state.grade)}학년</dd></div>
          <div><dt>날짜</dt><dd>${today()}</dd></div>
        </dl>
      </header>

      <section class="sh-hero">
        <div>
          <p class="sh-eyebrow">나의 성격 유형</p>
          <p class="sh-type">${dims.map((d) => `<span style="--c:${d.color}">${d.pick}</span>`).join("")}</p>
          <p class="sh-nick">${esc(c.nickname)}</p>
        </div>
        <div class="sh-mark"><span>${c.emoji}</span></div>
      </section>
      <p class="sh-summary">${esc(c.summary)}</p>

      <section class="sh-dims">
        <p class="sh-label">네 가지 방향</p>
        <div class="sh-dim-grid">${dims.map(dimRow).join("")}</div>
      </section>

      <div class="sh-grid">
        <section class="sh-cell" style="--accent:var(--c-ei)">
          <h3><em>01</em>나의 강점</h3>
          <ul>${c.strengths.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
        </section>
        <section class="sh-cell" style="--accent:var(--c-sn)">
          <h3><em>02</em>이렇게 하면 더 멋져요</h3>
          <ul>${c.growth.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
        </section>
        <section class="sh-cell" style="--accent:var(--c-tf)">
          <h3><em>03</em>나에게 맞는 공부법</h3>
          <p>${esc(c.study)}</p>
        </section>
        <section class="sh-cell" style="--accent:var(--c-jp)">
          <h3><em>04</em>친구와 함께할 때</h3>
          <p>${esc(c.friend)}</p>
        </section>
      </div>

      <section class="sh-cheer">
        <p class="sh-label">응원 한마디</p>
        <p>${esc(c.cheer)}</p>
      </section>

      <section class="sh-promise">
        <p class="sh-label">나의 다짐</p>
        <div class="sh-lines"><i></i><i></i></div>
      </section>

      <footer class="sh-foot">
        <span>성격 유형은 정답이 아니라 나를 알아가는 하나의 지도예요. 사람은 자라면서 얼마든지 달라질 수 있어요.</span>
        <span>${c.ai ? "AI 맞춤 해설 · " : ""}저장되지 않음</span>
      </footer>
    </div>
  </article>`;
}

// 큰 글씨에서 시작해 A4 한 장을 넘치지 않을 때까지 조금씩 줄여요
function fitSheet() {
  const sheet = $("sheet");
  const inner = $("sheet-inner");
  if (!sheet || !inner) return;
  sheet.classList.add("measuring");
  let size = 16;
  sheet.style.setProperty("--fs", `${size}px`);
  while (inner.scrollHeight > inner.clientHeight + 1 && size > 10) {
    size -= 0.25;
    sheet.style.setProperty("--fs", `${size}px`);
  }
  sheet.classList.remove("measuring");
}

function scaleSheet() {
  const wrap = $("sheet-wrap");
  const scaler = $("sheet-scale");
  const sheet = $("sheet");
  if (!sheet) return;
  const w = sheet.offsetWidth;
  const h = sheet.offsetHeight;
  const scale = Math.min(1, wrap.clientWidth / w);
  scaler.style.transform = `scale(${scale})`;
  scaler.style.width = `${w}px`;
  wrap.style.height = `${h * scale}px`;
}

async function fitAndScale() {
  try { await document.fonts.ready; } catch { /* 폰트 로딩 실패 시 기본 글꼴 사용 */ }
  fitSheet();
  scaleSheet();
}
window.addEventListener("resize", scaleSheet);

// ─────────────────────────────────────────────
// 인쇄 → 삭제
// ─────────────────────────────────────────────
let countdownTimer = null;
let printing = false;

$("btn-print").addEventListener("click", () => {
  fitSheet();
  printing = true;
  window.print();
  // 대부분 브라우저는 print()가 대화상자가 닫힐 때까지 기다려요. afterprint가 없는 환경도 대비.
  setTimeout(() => { if (printing) afterPrint(); }, 300);
});
window.addEventListener("afterprint", () => { if (printing) afterPrint(); });

function afterPrint() {
  printing = false;
  if (!state.result) return;
  const dlg = $("dlg-after");
  if (dlg.open) return;
  dlg.showModal();
  let left = AFTER_PRINT_SECONDS;
  $("countdown").textContent = left;
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    left--;
    $("countdown").textContent = left;
    if (left <= 0) wipe(true);
  }, 1000);
}

$("btn-done").addEventListener("click", () => wipe(true));
$("btn-reprint").addEventListener("click", () => {
  clearInterval(countdownTimer);
  $("dlg-after").close();
  $("btn-print").click();
});
$("dlg-after").addEventListener("cancel", (e) => e.preventDefault()); // Esc로 닫혀 데이터가 남지 않도록
$("btn-reset").addEventListener("click", () => {
  if (confirm("결과를 삭제하고 처음 화면으로 돌아갈까요?")) wipe(true);
});

// 모든 학생 데이터 삭제
function wipe(withToast) {
  clearInterval(countdownTimer);
  if ($("dlg-after").open) $("dlg-after").close();
  state = freshState();
  $("sheet-scale").innerHTML = "";
  $("sheet-scale").removeAttribute("style");
  $("sheet-wrap").removeAttribute("style");
  for (const id of ["result-eyebrow", "result-type", "result-nick", "q-text"]) $(id).textContent = "";
  $("start-form").reset();
  $("progress-fill").style.width = "0";
  show("start");
  if (withToast) toast("결과를 삭제했어요. 다음 친구 차례예요.");
}

// 한동안 조작이 없으면 자동 삭제 (자리를 비운 사이 정보가 남지 않도록)
let idleTimer = null;
function bumpIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!$("screen-start").classList.contains("active")) wipe(true);
  }, IDLE_WIPE_MS);
}
["pointerdown", "keydown", "scroll", "touchstart"].forEach((ev) => window.addEventListener(ev, bumpIdle, { passive: true }));
bumpIdle();
