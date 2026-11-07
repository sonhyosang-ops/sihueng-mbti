# 성격 탐험 — 학생용 간이 MBTI

학교급에 맞춘 문항으로 성격 유형을 알아보고, **결과지를 QR 코드로 학생 휴대폰에 바로 전달**하는 웹앱입니다.

👉 **바로 가기: https://sonhyosang-ops.github.io/sihueng-mbti/**

## 학교급별 구성
| 학교급 | 문항 | 결과지 |
|---|---|---|
| 초등학교 (1~6학년) | 지표별 3문항, 총 12문항 | A4 1장: 유형·별명·네 가지 방향·강점·성장 팁·공부법·친구 관계·응원·다짐 |
| 중·고등학교 (1~3학년) | 지표별 4문항, 총 16문항 | A4 2장: 지표별 비율과 해석(균형 표시 포함)·강점 4·성장 포인트 3·공부 전략·관계와 소통·스트레스 대처·관심 가져 볼 분야·이번 주 실천 과제·응원·다짐과 목표 |

중·고등학생은 지표별 4문항이라 2:2 동점이 나올 수 있어요. 이때는 그 지표의 첫 문항 답을 따르고, 결과지에 '균형 50%'로 표시합니다.

## 사용 흐름
1. **교실 화면(선생님 기기)**: 소개 → 네 가지 방향 → 학교·학년 선택을 페이지 넘김으로 진행하고 질문에 답합니다.
2. 결과 화면에 **QR 코드**가 나타납니다. QR을 누르면 크게 볼 수 있어요.
3. **학생 휴대폰**: 카메라로 QR을 찍으면 결과지가 열리고, **PDF로 저장** 또는 **이미지로 저장**할 수 있어요. 이름은 원하면 휴대폰에서만 넣을 수 있어요.
4. 교실 화면은 "다음 친구"를 누르거나 3분이 지나면 결과가 자동으로 지워집니다.

## 개인정보 보호
- **이름 등 개인정보를 받지 않습니다.** 교실 화면에서는 학교급·학년·답만 다룹니다.
- **서버가 없고, 아무것도 저장하지 않습니다.** 결과는 QR 주소의 `#` 뒤에 압축되어 담기는데, `#` 뒤의 내용은 브라우저가 서버로 보내지 않아 GitHub Pages에도 기록되지 않습니다.
- 학생 휴대폰에서 결과를 연 즉시 주소창·방문 기록에서 결과 정보를 지웁니다.
- 휴대폰에서 넣는 이름은 그 화면의 결과지에만 들어가고 어디에도 전송·저장되지 않습니다.
- 교실 기기에는 결과가 남지 않습니다(브라우저 저장소 미사용). 5분 동안 조작이 없어도 자동으로 지워집니다.
- AI 해설을 켠 경우 Claude API에는 학교급·학년·답만 전송되고, 이름은 전송되지 않습니다. (리눅스 서버로 실행하면 서버를 거쳐 전송)

## 실행 방법은 두 가지예요

| | GitHub Pages (지금 주소) | 리눅스 서버 (학교 서버 등) |
|---|---|---|
| 설치 | 필요 없음 | Node.js 18+ 또는 Docker |
| Claude API 키 | 선생님이 브라우저에 입력 | **서버에만 보관** (브라우저에 키가 가지 않음) |
| AI 요청 | 브라우저 → Claude | 브라우저 → 서버 → Claude (서버가 프롬프트를 직접 만들어 키 악용 불가) |

## 리눅스 서버에서 실행하기

### 방법 1. systemd 서비스로 설치 (Ubuntu·Debian·Rocky 등)
Node.js 18 이상이 필요해요.
```bash
git clone https://github.com/sonhyosang-ops/sihueng-mbti.git
cd sihueng-mbti
sudo bash deploy/install.sh          # /opt/sihueng-mbti 에 설치하고 서비스 등록
sudo nano /etc/sihueng-mbti.env      # API 키와 PUBLIC_URL 입력
sudo systemctl restart sihueng-mbti
```
- 접속: `http://<서버 IP>:8080/`
- 상태 확인: `systemctl status sihueng-mbti` · 오류 확인: `journalctl -u sihueng-mbti`
- 업데이트: `git pull` 후 `sudo bash deploy/install.sh` (설정 파일은 그대로 유지돼요)

### 방법 2. Docker
```bash
git clone https://github.com/sonhyosang-ops/sihueng-mbti.git
cd sihueng-mbti
cp deploy/sihueng-mbti.env.example .env   # API 키와 PUBLIC_URL 입력
docker compose up -d --build
```

### 방법 3. 바로 실행 (테스트용)
```bash
npm ci --omit=dev
ANTHROPIC_API_KEY=sk-ant-... PUBLIC_URL=http://192.168.0.10:8080/ npm start
```

### 설정 (`/etc/sihueng-mbti.env` 또는 `.env`)
| 이름 | 설명 | 기본값 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API 키. 비워 두면 기본 해설로 동작 | (없음) |
| `PUBLIC_URL` | **학생 휴대폰이 접속할 주소** (QR에 들어감). 예: `http://192.168.0.10:8080/` | 선생님이 접속한 주소 |
| `PORT` / `HOST` | 서버 포트 / 주소 | `8080` / `0.0.0.0` |
| `RATE_LIMIT` | 한 기기가 10분 동안 보낼 수 있는 AI 요청 수 | `30` |
| `TRUST_PROXY` | nginx 등 프록시 뒤에서 실행할 때 `1` | `0` |

> **중요:** 학생 휴대폰이 서버에 접속할 수 있어야 QR로 결과를 받을 수 있어요. 휴대폰과 서버가 같은 와이파이(교내망)에 있거나 서버가 인터넷에 공개돼 있어야 해요. 선생님 PC에서 `localhost`로 접속하면 QR 주소가 휴대폰에서 열리지 않으니 `PUBLIC_URL`을 꼭 설정하세요.

### HTTPS (선택, 권장)
`deploy/nginx.conf.example` 을 참고해 nginx로 HTTPS를 붙이세요. HTTPS에서는 아이폰에서 '이미지로 저장' 시 사진 앱 저장 메뉴가 바로 떠요.

### 서버의 개인정보 보호
- 서버는 학교급·학년·답만 받고, **아무것도 저장하지 않으며 요청 내용을 로그로 남기지 않아요.** (오류가 나면 오류 종류만 기록)
- 학생 결과는 QR 주소의 `#` 뒤에 담겨 휴대폰으로 바로 전달되고, 서버로는 전송되지 않아요.
- 앱 파일 외의 파일(server.js, 설정 등)은 웹에서 보이지 않고, 보안 헤더(CSP 등)를 적용해요.
- systemd 서비스는 전용 사용자·읽기 전용 파일 시스템으로 실행돼요.

## Claude AI 맞춤 해설 (GitHub Pages에서)
상단 "선생님 설정"에 Claude API 키를 넣으면 학생이 고른 답을 바탕으로 해설을 써 줍니다(`claude-opus-5-5`). 키가 없거나 연결이 실패하면 내장된 16유형 기본 해설로 결과지를 만듭니다. 리눅스 서버에서 실행하면서 서버에 키를 설정하면 이 메뉴는 숨겨져요.

정적 사이트라 API 키는 브라우저에서 직접 Claude API로 전송됩니다. 키는 그 탭의 sessionStorage에만 임시 보관되고 탭을 닫으면 사라집니다. 사용 한도를 낮게 설정한 수업용 키를 권장하며, 공용 PC에서는 수업 후 키를 지워 주세요.

## GitHub Pages 배포
`main` 브랜치에 푸시하면 `.github/workflows/deploy-pages.yml` 이 웹앱 파일만 모아 자동 배포합니다. (Settings → Pages → Source: GitHub Actions)

## 파일
- `index.html`, `style.css`, `app.js` — 화면과 동작
- `ai.js` — 채점·입력 검사·Claude 요청 만들기 (브라우저와 서버가 함께 사용)
- `server.js`, `package.json` — 리눅스 서버 (정적 파일 + `/api/analyze`)
- `deploy/` — systemd 서비스, 설치 스크립트, 설정 예시, nginx 예시
- `Dockerfile`, `docker-compose.yml` — Docker 실행
- `data.js` — 문항(초등 12 · 중고등 16)과 16유형 기본 해설(초등용·중고등용)
- `vendor/pretendard/` — Pretendard 글꼴 (SIL OFL 1.1)
- `vendor/qr-pack.js` — QR 코드 생성(qrcode 1.5.4) + 압축(fflate 0.8.2)
- `vendor/export-pack.js` — PDF·이미지 저장(html2canvas 1.4.1, jsPDF 4.2.1)
- `vendor/anthropic-sdk-1.3.0.js` — 공식 Anthropic TypeScript SDK 브라우저 번들
