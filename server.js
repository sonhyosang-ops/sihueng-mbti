// 성격 탐험 — 리눅스 서버용 실행 파일
//
// 하는 일
//  1) 웹앱 파일(index.html, app.js, vendor/… 등)을 보여 줘요.
//  2) /api/analyze: 학교급·학년·답만 받아서, 서버에 보관된 Claude API 키로 해설을 받아 돌려줘요.
//     프롬프트는 서버가 직접 만들기 때문에 이 키로 다른 내용을 요청할 수 없어요.
//
// 개인정보: 아무것도 저장하지 않고, 요청 내용(답·결과)을 로그로 남기지 않아요.
//
// 환경 변수 (deploy/sihueng-mbti.env.example 참고)
//  PORT, HOST, ANTHROPIC_API_KEY, PUBLIC_URL, RATE_LIMIT, TRUST_PROXY

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { validInput, buildClaudeRequest, parseClaudeResponse } from "./ai.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_URL_RAW = (process.env.PUBLIC_URL || "").trim(); // 휴대폰이 접속할 주소 (QR에 들어가요)
const PUBLIC_URL = PUBLIC_URL_RAW ? PUBLIC_URL_RAW.replace(/\/?$/, "/") : "";
const RATE_LIMIT = Number(process.env.RATE_LIMIT) || 30; // 한 기기(IP)당 10분에 AI 요청 수
const TRUST_PROXY = process.env.TRUST_PROXY === "1"; // nginx 같은 프록시 뒤에서 실행할 때만 1
const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

// 키는 환경 변수 ANTHROPIC_API_KEY에서 SDK가 읽어요
const client = HAS_KEY ? new Anthropic({ timeout: 120_000, maxRetries: 2 }) : null;

// 외부에 보여 줄 파일만 허용 (server.js, package.json, deploy/ 등은 보이지 않아요)
const PUBLIC_FILES = new Set(["index.html", "style.css", "app.js", "ai.js", "data.js"]);
const PUBLIC_DIRS = ["vendor/"];
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://api.anthropic.com",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; "),
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}
const sendJson = (res, status, obj) =>
  send(res, status, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });

// ── 요청 수 제한 (메모리에만, 10분마다 초기화) ──
const hits = new Map();
setInterval(() => hits.clear(), 10 * 60 * 1000).unref();
function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || "unknown";
}
function rateLimited(req) {
  const ip = clientIp(req);
  const n = (hits.get(ip) || 0) + 1;
  hits.set(ip, n);
  return n > RATE_LIMIT;
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size <= limit) chunks.push(c); // 넘치는 부분은 버리고 끝까지 읽기만 해요
    });
    req.on("end", () => (size > limit ? reject(Object.assign(new Error("too large"), { status: 413 })) : resolve(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", reject);
  });
}

async function handleAnalyze(req, res) {
  if (!client) return sendJson(res, 503, { error: "ai_disabled" });
  if (rateLimited(req)) return sendJson(res, 429, { error: "rate_limited" });
  let input;
  try {
    input = JSON.parse(await readBody(req));
  } catch (err) {
    return sendJson(res, err.status === 413 ? 413 : 400, { error: err.status === 413 ? "too_large" : "bad_request" });
  }
  const { level, grade, answers } = input || {};
  if (!validInput(level, grade, answers)) return sendJson(res, 400, { error: "bad_request" });
  try {
    const response = await client.beta.messages.create(buildClaudeRequest(level, Number(grade), answers));
    return sendJson(res, 200, parseClaudeResponse(response));
  } catch (err) {
    // 학생 답이나 결과는 로그에 남기지 않고, 오류 종류만 남겨요
    const kind = err instanceof Anthropic.APIError ? `API ${err.status ?? ""}` : err.message;
    console.error(`[analyze] 실패: ${kind}`);
    return sendJson(res, 502, { error: "upstream" });
  }
}

async function handleStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (rel === "") rel = "index.html";
  rel = normalize(rel).split(sep).join("/");
  const allowed = PUBLIC_FILES.has(rel) || PUBLIC_DIRS.some((d) => rel.startsWith(d) && !rel.includes(".."));
  const type = MIME[extname(rel)];
  if (!allowed || !type) return send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
  const file = join(ROOT, rel);
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not file");
    const body = await readFile(file);
    send(res, 200, req.method === "HEAD" ? undefined : body, {
      "Content-Type": type,
      "Content-Length": body.length,
      // 글꼴·라이브러리는 오래 캐시하고, 앱 파일은 매번 새로 확인
      "Cache-Control": rel.startsWith("vendor/") ? "public, max-age=604800" : "no-cache",
    });
  } catch {
    send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname === "/api/config" && req.method === "GET") return sendJson(res, 200, { ai: HAS_KEY, publicUrl: PUBLIC_URL || null });
    if (pathname === "/api/analyze" && req.method === "POST") return await handleAnalyze(req, res);
    if (pathname === "/healthz") return sendJson(res, 200, { ok: true });
    if (req.method === "GET" || req.method === "HEAD") return await handleStatic(req, res, pathname);
    send(res, 405, "Method not allowed", { "Content-Type": "text/plain; charset=utf-8", Allow: "GET, HEAD, POST" });
  } catch {
    if (!res.headersSent) send(res, 400, "Bad request", { "Content-Type": "text/plain; charset=utf-8" });
  }
});
server.requestTimeout = 150_000;

server.listen(PORT, HOST, () => {
  console.log(`성격 탐험 서버 실행 중: http://${HOST === "0.0.0.0" ? "<서버 주소>" : HOST}:${PORT}/`);
  console.log(`AI 맞춤 해설: ${HAS_KEY ? "켜짐 (서버 키 사용)" : "꺼짐 (ANTHROPIC_API_KEY 미설정 → 기본 해설)"}`);
  if (PUBLIC_URL) console.log(`QR 주소: ${PUBLIC_URL}`);
});

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
