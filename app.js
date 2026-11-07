import { TYPES, TYPES_TEEN, LETTER_NOTES, LETTER_ACTIONS } from "./data.js";
import { LEVELS, gradeText, scoreAnswers, buildClaudeRequest, parseClaudeResponse } from "./ai.js";

// ─────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────
const SDK_PATH = "./vendor/anthropic-sdk-1.3.0.js";
const KEY_STORAGE = "mbti-claude-key"; // 선생님 API 키만 sessionStorage에 임시 보관 (학생 데이터는 절대 저장하지 않음)
const QR_SECONDS = 180; // QR을 보여 주는 시간. 지나면 자동 삭제
const QR_MAX_URL = 2600; // QR 하나에 안정적으로 담을 수 있는 주소 길이
const IDLE_WIPE_MS = 5 * 60 * 1000; // 5분 동안 아무 조작이 없으면 자동 삭제

// ─────────────────────────────────────────────
// 상태 (메모리에만 존재)
// ─────────────────────────────────────────────
let state = freshState();
function freshState() {
  return { name: "", level: "elem", grade: "", date: "", answers: [], index: 0, result: null, ai: null };
}

const isTeen = () => state.level !== "elem";
const qs = () => LEVELS[state.level].questions;
const gradeLabel = () => gradeText(state.level, state.grade);

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
// 시작 화면: 페이지 넘김 (버튼 · 점 · 키보드 · 스와이프)
// ─────────────────────────────────────────────
const slideEls = [...document.querySelectorAll("#slides .slide")];
let slideIdx = 0;
function goSlide(i) {
  slideIdx = Math.max(0, Math.min(slideEls.length - 1, i));
  $("slides-track").style.transform = `translateX(${-slideIdx * 100}%)`;
  slideEls.forEach((el, k) => {
    el.classList.toggle("current", k === slideIdx);
    el.inert = k !== slideIdx; // 보이지 않는 페이지는 Tab 이동에서 제외
  });
  document.querySelectorAll("#slide-dots button").forEach((d, k) => d.classList.toggle("on", k === slideIdx));
  $("slide-prev").disabled = slideIdx === 0;
  $("slide-next").disabled = slideIdx === slideEls.length - 1;
}
document.querySelectorAll("[data-go]").forEach((el) => el.addEventListener("click", () => goSlide(+el.dataset.go)));
$("slide-prev").addEventListener("click", () => goSlide(slideIdx - 1));
$("slide-next").addEventListener("click", () => goSlide(slideIdx + 1));
document.addEventListener("keydown", (e) => {
  if (!$("screen-start").classList.contains("active") || document.querySelector("dialog[open]")) return;
  if (e.target.matches("input, textarea")) return;
  if (e.key === "ArrowRight" || e.key === "PageDown") goSlide(slideIdx + 1);
  if (e.key === "ArrowLeft" || e.key === "PageUp") goSlide(slideIdx - 1);
});
(() => {
  const track = $("slides-track");
  let x0 = null, y0 = 0, dx = 0, horizontal = null;
  $("slides").addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || e.target.closest("input, button, label")) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; horizontal = null;
  });
  window.addEventListener("pointermove", (e) => {
    if (x0 === null) return;
    dx = e.clientX - x0;
    if (horizontal === null && (Math.abs(dx) > 8 || Math.abs(e.clientY - y0) > 8)) horizontal = Math.abs(dx) > Math.abs(e.clientY - y0);
    if (!horizontal) return;
    track.classList.add("dragging");
    track.style.transform = `translateX(calc(${-slideIdx * 100}% + ${dx}px))`;
  });
  const end = () => {
    if (x0 === null) return;
    track.classList.remove("dragging");
    if (horizontal && Math.abs(dx) > 60) goSlide(slideIdx + (dx < 0 ? 1 : -1));
    else goSlide(slideIdx);
    x0 = null;
  };
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
})();
goSlide(0);

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

// 리눅스 서버에서 실행 중이고 서버에 API 키가 설정돼 있으면, 브라우저에 키를 넣을 필요가 없어요
let serverAI = false;
let publicBase = ""; // 서버의 PUBLIC_URL (QR 주소의 앞부분)

function refreshStatus() {
  const s = $("ai-status");
  const on = serverAI || !!apiKey;
  s.textContent = serverAI ? "AI 맞춤 해설 · 서버" : apiKey ? "AI 맞춤 해설" : "기본 해설";
  s.classList.toggle("on", on);
  $("btn-teacher").hidden = serverAI;
}
refreshStatus();
fetch("./api/config", { cache: "no-store" })
  .then((r) => (r.ok ? r.json() : null))
  .then((c) => {
    if (!c) return;
    if (typeof c.publicUrl === "string" && /^https?:\/\//.test(c.publicUrl)) publicBase = c.publicUrl;
    if (c.ai === true) { serverAI = true; refreshStatus(); }
  })
  .catch(() => { /* 정적 호스팅(GitHub Pages)에서는 서버 API가 없어요 */ });

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
  if ($("screen-start").classList.contains("active")) return goSlide(0);
  if (state.result && !confirm("결과를 삭제하고 처음 화면으로 돌아갈까요?")) return;
  wipe(!!state.result);
});

// ─────────────────────────────────────────────
// 시작
// ─────────────────────────────────────────────
function renderGrades() {
  const level = document.querySelector('input[name="level"]:checked')?.value || "elem";
  const L = LEVELS[level];
  const seg = $("grade-seg");
  seg.classList.toggle("cols-3", L.grades === 3);
  seg.innerHTML = Array.from({ length: L.grades }, (_, i) =>
    `<label><input type="radio" name="grade" value="${i + 1}" /><span>${i + 1}학년</span></label>`).join("");
  $("level-hint").textContent = L.hint;
}
document.querySelectorAll('input[name="level"]').forEach((r) => r.addEventListener("change", renderGrades));
renderGrades();

$("start-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const level = document.querySelector('input[name="level"]:checked')?.value || "elem";
  const grade = document.querySelector('input[name="grade"]:checked')?.value || "";
  if (!grade) return toast("학년을 골라 주세요.");
  state = freshState();
  state.level = level;
  state.grade = grade;
  state.date = todayCode();
  state.answers = new Array(qs().length).fill(null);
  show("quiz");
  renderQuestion();
});

// ─────────────────────────────────────────────
// 질문
// ─────────────────────────────────────────────
function renderQuestion() {
  const i = state.index;
  const Q = qs();
  const q = Q[i];
  $("q-count").textContent = `질문 ${i + 1} / ${Q.length}`;
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
  $("progress-fill").style.width = `${(i / Q.length) * 100}%`;
}

function choose(side) {
  const i = state.index;
  const Q = qs();
  state.answers[i] = side;
  $("choice-a").classList.toggle("picked", side === "a");
  $("choice-b").classList.toggle("picked", side === "b");
  document.querySelector(".choices").classList.add("locked");
  $("choice-a").disabled = $("choice-b").disabled = true;
  setTimeout(() => {
    if (i < Q.length - 1) {
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
// Claude 해설 받기
// - 리눅스 서버로 실행 중이면: 서버(/api/analyze)가 서버에 보관된 키로 대신 요청해요 (브라우저에 키 없음)
// - GitHub Pages처럼 서버가 없으면: 선생님이 입력한 키로 브라우저에서 직접 요청해요
// 어느 쪽이든 보내는 건 학교급·학년·답뿐이고 이름은 없어요.
// ─────────────────────────────────────────────
const score = () => scoreAnswers(state.level, state.answers);

async function askClaude() {
  if (serverAI) {
    const res = await fetch("./api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ level: state.level, grade: Number(state.grade), answers: state.answers }),
    });
    if (!res.ok) throw new Error(`server ${res.status}`);
    return res.json();
  }
  const { default: Anthropic } = await import(SDK_PATH);
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, timeout: 120_000, maxRetries: 1 });
  return parseClaudeResponse(await client.beta.messages.create(buildClaudeRequest(state.level, state.grade, state.answers)));
}

// 받침에 따라 '과/와' 고르기
const gwa = (word) => { const c = word.charCodeAt(word.length - 1) - 0xac00; return c >= 0 && c % 28 ? "과" : "와"; };

// 기본 해설 만들기
function baseContent(type, dims) {
  const elem = TYPES[type];
  if (!isTeen()) return { ...elem };
  const t = TYPES_TEEN[type];
  const dimNotes = {};
  for (const d of dims) {
    dimNotes[d.key] = d.balanced
      ? `${d.leftName}${gwa(d.leftName)} ${d.rightName} 성향을 고르게 가지고 있어요. 상황에 따라 두 모습이 모두 나타나요.`
      : LETTER_NOTES[d.pick];
  }
  const pickOf = (k) => dims.find((d) => d.key === k).pick;
  return { emoji: elem.emoji, ...t, dimNotes, actions: ["EI", "TF", "JP"].map((k) => LETTER_ACTIONS[pickOf(k)]) };
}

// AI 응답을 기본 해설과 합쳐서 빈칸·이상값이 없게 정리
function mergeResult(base, ai) {
  if (!ai) return { ...base, ai: false };
  const str = (v, fb, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fb);
  const list = (v, fb, n, max) => {
    const arr = Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, max)) : [];
    return arr.length >= n ? arr.slice(0, n) : fb;
  };
  if (!isTeen()) {
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
  const notes = {};
  for (const k of ["EI", "SN", "TF", "JP"]) notes[k] = str(ai.dimNotes?.[k], base.dimNotes[k], 110);
  return {
    emoji: base.emoji,
    nickname: str(ai.nickname, base.nickname, 22),
    summary: str(ai.summary, base.summary, 340),
    dimNotes: notes,
    strengths: list(ai.strengths, base.strengths, 4, 36),
    growth: list(ai.growth, base.growth, 3, 64),
    study: str(ai.study, base.study, 180),
    relation: str(ai.relation, base.relation, 150),
    stress: str(ai.stress, base.stress, 150),
    explore: list(ai.explore, base.explore, 4, 14),
    actions: list(ai.actions, base.actions, 3, 70),
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

  const base = baseContent(type, dims);
  let ai = null;
  if (serverAI || apiKey) {
    try {
      ai = await askClaude();
    } catch (err) {
      console.warn("Claude API 호출 실패, 기본 해설을 사용합니다:", err);
      toast("AI 연결이 원활하지 않아 기본 해설로 만들었어요.", 4500);
    }
  } else {
    await new Promise((r) => setTimeout(r, 1600));
  }
  clearInterval(ticker);

  state.ai = ai;
  state.result = { type, dims, content: mergeResult(base, ai) };
  renderResult();
  show("result");
  requestAnimationFrame(fitAndScale);
  showQR();
}

// ─────────────────────────────────────────────
// 결과지 (A4)
// ─────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function todayCode() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
function today() {
  const c = /^\d{8}$/.test(state.date) ? state.date : todayCode();
  return `${c.slice(0, 4)}. ${+c.slice(4, 6)}. ${+c.slice(6, 8)}.`;
}

const segs = (d) => Array.from({ length: d.n }, (_, k) => `<i class="${k < d.leftCount ? "on" : ""}"></i>`).join("");
const typeLetters = (dims) => dims.map((d) => `<span style="--c:${d.color}">${d.pick}</span>`).join("");
const ul = (arr) => `<ul>${arr.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`;

function sheetHeader(gradeText) {
  return `
      <header class="sh-top">
        <p class="sh-brand">성격 탐험 리포트<small>${qs().length}문항 간이 성격 유형 검사</small></p>
        <dl class="sh-meta">
          <div class="${state.name ? "" : "blank"}"><dt>이름</dt><dd>${esc(state.name)}</dd></div>
          <div><dt>학년</dt><dd>${esc(gradeText)}</dd></div>
          <div><dt>날짜</dt><dd>${today()}</dd></div>
        </dl>
      </header>`;
}

function sheetHero(type, dims, c) {
  return `
      <section class="sh-hero">
        <div>
          <p class="sh-eyebrow">나의 성격 유형</p>
          <p class="sh-type">${typeLetters(dims)}</p>
          <p class="sh-nick">${esc(c.nickname)}</p>
        </div>
        <div class="sh-mark"><span>${c.emoji}</span></div>
      </section>
      <p class="sh-summary">${esc(c.summary)}</p>`;
}

const FOOT_NOTE = "성격 유형은 정답이 아니라 나를 알아가는 하나의 지도예요. 사람은 자라면서 얼마든지 달라질 수 있어요.";

function dimRowElem(d) {
  const leftWin = d.pick === d.left;
  return `
    <div class="d-row" style="--c:${d.color}">
      <div class="d-end ${leftWin ? "win" : ""}"><b>${d.left}</b><small>${d.leftName}</small></div>
      <div class="d-track">${segs(d)}</div>
      <div class="d-end right ${leftWin ? "" : "win"}"><small>${d.rightName}</small><b>${d.right}</b></div>
      <p class="d-desc">${esc(leftWin ? d.leftDesc : d.rightDesc)}</p>
    </div>`;
}

function sheetElem(type, dims, c) {
  return `
  <article class="sheet">
    <div class="sheet-inner">
      ${sheetHeader(`${state.grade}학년`)}
      ${sheetHero(type, dims, c)}
      <section class="sh-dims">
        <p class="sh-label">네 가지 방향</p>
        <div class="sh-dim-grid">${dims.map(dimRowElem).join("")}</div>
      </section>
      <div class="sh-grid">
        <section class="sh-cell" style="--accent:var(--c-ei)"><h3><em>01</em>나의 강점</h3>${ul(c.strengths)}</section>
        <section class="sh-cell" style="--accent:var(--c-sn)"><h3><em>02</em>이렇게 하면 더 멋져요</h3>${ul(c.growth)}</section>
        <section class="sh-cell" style="--accent:var(--c-tf)"><h3><em>03</em>나에게 맞는 공부법</h3><p>${esc(c.study)}</p></section>
        <section class="sh-cell" style="--accent:var(--c-jp)"><h3><em>04</em>친구와 함께할 때</h3><p>${esc(c.friend)}</p></section>
      </div>
      <section class="sh-cheer"><p class="sh-label">응원 한마디</p><p>${esc(c.cheer)}</p></section>
      <section class="sh-promise"><p class="sh-label">나의 다짐</p><div class="sh-lines"><i></i><i></i></div></section>
      <footer class="sh-foot"><span>${FOOT_NOTE}</span><span>${c.ai ? "AI 맞춤 해설 · " : ""}저장되지 않음</span></footer>
    </div>
  </article>`;
}

function dimRowTeen(d, note) {
  const leftWin = d.pick === d.left;
  const pct = d.balanced ? `<span class="t-pct bal">균형 50%</span>` : `<span class="t-pct">${d.pick} ${d.pct}%</span>`;
  return `
    <div class="t-row" style="--c:${d.color};--n:${d.n}">
      <div class="d-end ${leftWin && !d.balanced ? "win" : ""}"><b>${d.left}</b><small>${d.leftName}</small></div>
      <div class="d-track">${segs(d)}</div>
      <div class="d-end right ${!leftWin && !d.balanced ? "win" : ""}"><small>${d.rightName}</small><b>${d.right}</b></div>
      ${pct}
      <p class="t-note">${esc(note)}</p>
    </div>`;
}

function sheetsTeen(type, dims, c) {
  const g = gradeLabel();
  return `
  <article class="sheet">
    <div class="sheet-inner">
      ${sheetHeader(g)}
      ${sheetHero(type, dims, c)}
      <section class="sh-dims-teen">
        <p class="sh-label">네 가지 방향 자세히 보기</p>
        <div class="t-rows">${dims.map((d) => dimRowTeen(d, c.dimNotes[d.key])).join("")}</div>
      </section>
      <div class="sh-two">
        <section class="sh-cell" style="--accent:var(--c-ei)"><h3><em>01</em>나의 강점</h3>${ul(c.strengths)}</section>
        <section class="sh-cell" style="--accent:var(--c-sn)"><h3><em>02</em>성장 포인트</h3>${ul(c.growth)}</section>
      </div>
      <footer class="sh-foot"><span>${FOOT_NOTE}</span><span class="sh-page">1 / 2</span></footer>
    </div>
  </article>
  <article class="sheet">
    <div class="sheet-inner">
      <header class="sh-top mini">
        <p class="sh-brand">성격 탐험 리포트<small>${state.name ? `${esc(state.name)} · ` : ""}${esc(g)} · ${type}</small></p>
        <span class="sh-page">2 / 2</span>
      </header>
      <div class="sh-two">
        <section class="sh-cell" style="--accent:var(--c-tf)"><h3><em>03</em>나에게 맞는 공부 전략</h3><p>${esc(c.study)}</p></section>
        <section class="sh-cell" style="--accent:var(--c-ei)"><h3><em>04</em>관계와 소통</h3><p>${esc(c.relation)}</p></section>
        <section class="sh-cell" style="--accent:var(--c-jp)"><h3><em>05</em>스트레스를 받을 때</h3><p>${esc(c.stress)}</p></section>
        <section class="sh-cell" style="--accent:var(--c-sn)"><h3><em>06</em>관심 가져 볼 분야</h3>
          <div class="sh-chips">${c.explore.map((x) => `<span>${esc(x)}</span>`).join("")}</div>
          <p class="sh-chip-note">진로를 정하는 기준이 아니라 탐색을 시작하는 출발점이에요.</p>
        </section>
      </div>
      <section class="sh-actions">
        <p class="sh-label">이번 주 실천 과제</p>
        <ol>${c.actions.map((a) => `<li><span>${esc(a)}<i class="sh-check"></i></span></li>`).join("")}</ol>
      </section>
      <section class="sh-cheer"><p class="sh-label">응원 한마디</p><p>${esc(c.cheer)}</p></section>
      <section class="sh-promise"><p class="sh-label">나의 다짐과 목표</p><div class="sh-lines three"><i></i><i></i><i></i></div></section>
      <footer class="sh-foot"><span>${FOOT_NOTE}</span><span>${c.ai ? "AI 맞춤 해설 · " : ""}저장되지 않음</span></footer>
    </div>
  </article>`;
}

function renderResult() {
  const { type, dims, content: c } = state.result;
  $("result-eyebrow").textContent = viewerMode ? "나의 성격 탐험 결과" : "나의 성격 유형";
  $("result-type").textContent = type;
  $("result-nick").textContent = c.nickname;
  $("stage-note").textContent = `A4 ${isTeen() ? "2장" : "1장"} 분량의 결과지예요. 이 결과는 내 휴대폰 안에서만 만들어지고, 어디에도 저장되거나 전송되지 않아요.`;
  $("sheet-scale").innerHTML = isTeen() ? sheetsTeen(type, dims, c) : sheetElem(type, dims, c);
  sheetIdx = 0;
  $("sheet-pager").hidden = !isTeen();
  showSheetPage();
}

// 결과지 미리보기: 한 장씩 넘겨 보기 (인쇄는 모든 장)
let sheetIdx = 0;
function sheetEls() { return [...document.querySelectorAll("#sheet-scale .sheet")]; }
function showSheetPage() {
  const pages = sheetEls();
  $("sheet-scale").classList.toggle("paged", pages.length > 1);
  pages.forEach((p, k) => p.classList.toggle("current", k === sheetIdx));
  $("sheet-count").textContent = `${sheetIdx + 1} / ${pages.length}`;
  $("sheet-prev").disabled = sheetIdx === 0;
  $("sheet-next").disabled = sheetIdx === pages.length - 1;
  scaleSheet();
}
$("sheet-prev").addEventListener("click", () => { sheetIdx = Math.max(0, sheetIdx - 1); showSheetPage(); });
$("sheet-next").addEventListener("click", () => { sheetIdx = Math.min(sheetEls().length - 1, sheetIdx + 1); showSheetPage(); });
document.addEventListener("keydown", (e) => {
  if (!$("screen-result").classList.contains("active") || document.querySelector("dialog[open]") || $("sheet-pager").hidden) return;
  if (e.key === "ArrowRight") $("sheet-next").click();
  if (e.key === "ArrowLeft") $("sheet-prev").click();
});

// 큰 글씨에서 시작해 A4 한 장을 넘치지 않을 때까지 조금씩 줄여요
function fitSheet() {
  const scaler = $("sheet-scale");
  const paged = scaler.classList.contains("paged");
  scaler.classList.remove("paged"); // 숨긴 장도 측정할 수 있게 잠시 모두 표시
  sheetEls().forEach((sheet) => {
    const inner = sheet.querySelector(".sheet-inner");
    sheet.classList.add("measuring");
    let size = 16;
    sheet.style.setProperty("--fs", `${size}px`);
    while (inner.scrollHeight > inner.clientHeight + 1 && size > 10) {
      size -= 0.25;
      sheet.style.setProperty("--fs", `${size}px`);
    }
    sheet.classList.remove("measuring");
  });
  if (paged) scaler.classList.add("paged");
}

// 미리보기 크기: 넓은 화면은 한 화면에 쏙 들어가게, 좁은 화면은 가로에 맞춰
function scaleSheet() {
  const wrap = $("sheet-wrap");
  const scaler = $("sheet-scale");
  const sheet = sheetEls().find((p) => p.classList.contains("current")) || sheetEls()[0];
  if (!sheet || !$("screen-result").classList.contains("active")) return;
  const w = sheet.offsetWidth;
  const h = sheet.offsetHeight;
  const fitHeight = matchMedia("(min-width: 1000px)").matches;
  if (!fitHeight) wrap.style.height = "";
  const scale = fitHeight ? Math.min(1, wrap.clientWidth / w, wrap.clientHeight / h) : Math.min(1, wrap.clientWidth / w);
  scaler.style.width = `${w}px`;
  scaler.style.transform = `translateX(${(wrap.clientWidth - w * scale) / 2}px) scale(${scale})`;
  if (!fitHeight) wrap.style.height = `${h * scale}px`;
}

async function fitAndScale() {
  try { await document.fonts.ready; } catch { /* 폰트 로딩 실패 시 기본 글꼴 사용 */ }
  fitSheet();
  scaleSheet();
}
window.addEventListener("resize", scaleSheet);

// ─────────────────────────────────────────────
// 결과 전달: QR 코드 (서버 없이, 주소의 # 뒤에 결과를 압축해 담아요)
// '#' 뒤의 내용은 브라우저가 서버로 보내지 않기 때문에 GitHub에도 기록되지 않아요.
// 담기는 내용: 학교급·학년·날짜·답(a/b)·AI 해설 문구. 이름 같은 개인정보는 없어요.
// ─────────────────────────────────────────────
const PACK_QR = "./vendor/qr-pack.js";
const PACK_EXPORT = "./vendor/export-pack.js";
const LEVEL_CODE = { elem: "e", middle: "m", high: "h" };
const CODE_LEVEL = { e: "elem", m: "middle", h: "high" };
const ELEM_KEYS = ["nickname", "summary", "strengths", "growth", "study", "friend", "cheer"];
const TEEN_KEYS = ["nickname", "summary", "dimNotes", "strengths", "growth", "study", "relation", "stress", "explore", "actions", "cheer"];
const DIM_KEYS = ["EI", "SN", "TF", "JP"];

function packAi(ai) {
  if (!ai) return null;
  const c = state.result.content; // 정리(검증)된 값만 담기
  return (isTeen() ? TEEN_KEYS : ELEM_KEYS).map((k) => (k === "dimNotes" ? DIM_KEYS.map((d) => c.dimNotes[d]) : c[k]));
}
function unpackAi(arr, teen) {
  if (!Array.isArray(arr)) return null;
  const keys = teen ? TEEN_KEYS : ELEM_KEYS;
  const o = {};
  keys.forEach((k, i) => {
    o[k] = k === "dimNotes" && Array.isArray(arr[i]) ? Object.fromEntries(DIM_KEYS.map((d, j) => [d, arr[i][j]])) : arr[i];
  });
  return o;
}

const b64u = {
  enc: (u8) => { let s = ""; for (const b of u8) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); },
  dec: (str) => { const s = atob(str.replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(s, (c) => c.charCodeAt(0)); },
};

async function buildShareUrl(withAi = true) {
  const { deflateSync, strToU8 } = await import(PACK_QR);
  const payload = [1, LEVEL_CODE[state.level], +state.grade, state.date, state.answers.join(""), withAi ? packAi(state.ai) : null];
  const data = b64u.enc(deflateSync(strToU8(JSON.stringify(payload)), { level: 9 }));
  return `${publicBase || location.origin + location.pathname}#r=${data}`;
}

let countdownTimer = null;
let qrUrl = "";

async function showQR() {
  try {
    const { QRCode } = await import(PACK_QR);
    qrUrl = await buildShareUrl(true);
    if (qrUrl.length > QR_MAX_URL) qrUrl = await buildShareUrl(false); // 너무 길면 기본 해설로
    if (!publicBase && /^(localhost|127\.|\[::1\])/.test(location.hostname)) {
      toast("지금 주소(localhost)는 휴대폰에서 열 수 없어요. 서버 IP 주소로 접속하거나 PUBLIC_URL을 설정해 주세요.", 8000);
    }
    await QRCode.toCanvas($("qr"), qrUrl, { errorCorrectionLevel: "L", margin: 2, width: 560, color: { dark: "#1d1d1f", light: "#ffffff" } });
  } catch (err) {
    console.error(err);
    toast("QR 코드를 만들지 못했어요. 다시 시도해 주세요.");
  }
  let left = QR_SECONDS;
  const tick = () => { $("countdown").textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`; };
  tick();
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => { left--; tick(); if (left <= 0) wipe(true); }, 1000);
}

$("qr-card").addEventListener("click", async () => {
  if (!qrUrl) return;
  const { QRCode } = await import(PACK_QR);
  await QRCode.toCanvas($("qr-big"), qrUrl, { errorCorrectionLevel: "L", margin: 2, width: 1000, color: { dark: "#1d1d1f", light: "#ffffff" } });
  $("dlg-qr").showModal();
});
$("btn-next").addEventListener("click", () => wipe(true));

// ─────────────────────────────────────────────
// 학생 휴대폰: QR로 열었을 때
// ─────────────────────────────────────────────
let viewerMode = false;

async function initViewer(hash) {
  viewerMode = true;
  document.body.classList.add("viewer");
  history.replaceState(null, "", location.pathname); // 주소창·방문 기록에 결과를 남기지 않기
  try {
    const { inflateSync, strFromU8 } = await import(PACK_QR);
    const p = JSON.parse(strFromU8(inflateSync(b64u.dec(hash))));
    const level = CODE_LEVEL[p[1]];
    if (p[0] !== 1 || !level) throw new Error("bad payload");
    state = freshState();
    state.level = level;
    const grade = Math.trunc(p[2]);
    if (!(grade >= 1 && grade <= LEVELS[level].grades)) throw new Error("bad grade");
    state.grade = String(grade);
    state.date = /^\d{8}$/.test(p[3]) ? p[3] : todayCode();
    const answers = String(p[4]).split("");
    if (answers.length !== qs().length || answers.some((x) => x !== "a" && x !== "b")) throw new Error("bad answers");
    state.answers = answers;
    const { type, dims } = score();
    const ai = unpackAi(p[5], isTeen());
    state.result = { type, dims, content: mergeResult(baseContent(type, dims), ai) };
    renderResult();
    show("result");
    requestAnimationFrame(fitAndScale);
  } catch (err) {
    console.error(err);
    viewerMode = false;
    document.body.classList.remove("viewer");
    toast("결과를 열지 못했어요. QR 코드를 다시 찍어 주세요.", 5000);
  }
}

// 이름은 이 휴대폰 화면에서만 결과지에 들어가요 (어디에도 전송·저장하지 않음)
let nameTimer = null;
$("in-name-view").addEventListener("input", (e) => {
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => {
    state.name = e.target.value.trim().slice(0, 10);
    const keep = sheetIdx;
    renderResult();
    sheetIdx = keep;
    showSheetPage();
    fitAndScale();
  }, 250);
});

async function renderCanvases() {
  const { html2canvas } = await import(PACK_EXPORT);
  try { await document.fonts.ready; } catch { /* 기본 글꼴 */ }
  fitSheet();
  const root = document.createElement("div");
  root.className = "export-root";
  sheetEls().forEach((el) => {
    const c = el.cloneNode(true);
    c.classList.remove("current");
    root.appendChild(c);
  });
  document.body.appendChild(root);
  try {
    const canvases = [];
    for (const el of root.children) canvases.push(await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", logging: false }));
    return canvases;
  } finally {
    root.remove();
  }
}

const fileBase = () => `MBTI-${state.result.type}`;

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function withBusy(btn, label, fn) {
  const old = btn.textContent;
  btn.setAttribute("aria-busy", "true");
  btn.textContent = label;
  try { await fn(); } catch (err) { console.error(err); toast("저장하지 못했어요. 다시 시도해 주세요."); } finally {
    btn.removeAttribute("aria-busy");
    btn.textContent = old;
  }
}

$("btn-pdf").addEventListener("click", (e) => withBusy(e.currentTarget, "만드는 중…", async () => {
  const { jsPDF } = await import(PACK_EXPORT);
  const canvases = await renderCanvases();
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  canvases.forEach((cv, i) => {
    if (i) doc.addPage();
    doc.addImage(cv.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297);
  });
  downloadBlob(doc.output("blob"), `${fileBase()}.pdf`);
  toast("PDF를 저장했어요.");
}));

$("btn-img").addEventListener("click", (e) => withBusy(e.currentTarget, "만드는 중…", async () => {
  const canvases = await renderCanvases();
  const blobs = await Promise.all(canvases.map((cv) => new Promise((r) => cv.toBlob(r, "image/png"))));
  const files = blobs.map((b, i) => new File([b], `${fileBase()}${blobs.length > 1 ? `-${i + 1}` : ""}.png`, { type: "image/png" }));
  // 휴대폰에서는 공유 시트로 열어 '이미지 저장'을 고를 수 있게
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files }); return; } catch (err) { if (err.name === "AbortError") return; }
  }
  files.forEach((f) => downloadBlob(f, f.name));
  toast("이미지를 저장했어요.");
}));

// 모든 학생 데이터 삭제
function wipe(withToast) {
  clearInterval(countdownTimer);
  if ($("dlg-qr").open) $("dlg-qr").close();
  qrUrl = "";
  for (const id of ["qr", "qr-big"]) { const c = $(id); c.width = c.height = 10; c.getContext("2d")?.clearRect(0, 0, 10, 10); }
  state = freshState();
  $("sheet-scale").innerHTML = "";
  $("sheet-scale").removeAttribute("style");
  $("sheet-wrap").removeAttribute("style");
  for (const id of ["result-eyebrow", "result-type", "result-nick", "q-text", "stage-note"]) $(id).textContent = "";
  $("start-form").reset();
  renderGrades();
  $("progress-fill").style.width = "0";
  $("sheet-pager").hidden = true;
  $("sheet-scale").className = "sheet-scale";
  show("start");
  goSlide(0);
  if (withToast) toast("결과를 삭제했어요. 다음 친구 차례예요.");
}

// 한동안 조작이 없으면 자동 삭제 (자리를 비운 사이 정보가 남지 않도록)
let idleTimer = null;
function bumpIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!viewerMode && !$("screen-start").classList.contains("active")) wipe(true);
  }, IDLE_WIPE_MS);
}
["pointerdown", "keydown", "scroll", "touchstart"].forEach((ev) => window.addEventListener(ev, bumpIdle, { passive: true }));
bumpIdle();

// QR로 들어온 경우: 결과 보기 모드
if (location.hash.startsWith("#r=")) initViewer(location.hash.slice(3));
