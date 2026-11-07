#!/usr/bin/env bash
# 성격 탐험 — 리눅스 서버 설치 스크립트 (systemd)
# 사용법: 저장소 폴더에서  sudo bash deploy/install.sh
set -euo pipefail

APP_DIR=/opt/sihueng-mbti
ENV_FILE=/etc/sihueng-mbti.env
SERVICE=sihueng-mbti
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "관리자 권한이 필요해요:  sudo bash deploy/install.sh" >&2
  exit 1
fi

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "Node.js가 없어요. Node.js 18 이상을 먼저 설치해 주세요." >&2
  echo "  예) Ubuntu/Debian: sudo apt install nodejs npm   (버전이 18 미만이면 https://nodejs.org 참고)" >&2
  exit 1
fi
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 18 이상이 필요해요 (현재 $("$NODE_BIN" -v))." >&2
  exit 1
fi

echo "1/5 전용 사용자 만들기"
id -u "$SERVICE" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE"

echo "2/5 앱 파일 복사 → $APP_DIR"
mkdir -p "$APP_DIR"
for f in index.html style.css app.js ai.js data.js server.js package.json package-lock.json; do
  install -m 0644 "$SRC_DIR/$f" "$APP_DIR/$f"
done
rm -rf "$APP_DIR/vendor"
cp -r "$SRC_DIR/vendor" "$APP_DIR/vendor"

echo "3/5 의존성 설치 (npm ci)"
(cd "$APP_DIR" && npm ci --omit=dev --no-fund --no-audit --loglevel=error)
chown -R root:root "$APP_DIR"
chmod -R a+rX "$APP_DIR"

echo "4/5 설정 파일 → $ENV_FILE"
if [ ! -f "$ENV_FILE" ]; then
  install -m 0600 -o root -g root "$SRC_DIR/deploy/sihueng-mbti.env.example" "$ENV_FILE"
  echo "    새 설정 파일을 만들었어요. API 키와 PUBLIC_URL을 넣어 주세요:  sudo nano $ENV_FILE"
else
  echo "    기존 설정 파일을 그대로 써요."
fi

echo "5/5 서비스 등록 및 시작"
PORT="$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2)"
if [ ! -d /run/systemd/system ]; then
  echo "    이 서버는 systemd로 실행되지 않아요. 아래 명령으로 직접 실행하세요:"
  echo "    sudo sh -c 'set -a; . $ENV_FILE; exec runuser -u $SERVICE -- $NODE_BIN $APP_DIR/server.js'"
  exit 0
fi
sed "s#__NODE__#$NODE_BIN#" "$SRC_DIR/deploy/sihueng-mbti.service" > "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"
sleep 1
systemctl --no-pager --lines=5 status "$SERVICE" || true

echo
echo "설치 완료! 브라우저에서  http://<서버 IP>:${PORT:-8080}/  로 접속하세요."
echo "설정을 바꾼 뒤에는:  sudo systemctl restart $SERVICE"
