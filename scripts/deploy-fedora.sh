#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

APP_USER="${APP_USER:-sadgirlplayer}"
APP_GROUP="${APP_GROUP:-${APP_USER}}"
INSTALL_DIR="${INSTALL_DIR:-/opt/sadgirlplayer}"
ENV_DIR="${ENV_DIR:-/etc/sadgirlplayer}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
NODE_BIN="${NODE_BIN:-/usr/bin/node}"
NPM_BIN="${NPM_BIN:-/usr/bin/npm}"
FIREWALL_OPEN_PORTS="${FIREWALL_OPEN_PORTS:-7070/tcp 7777/tcp}"
SKIP_FIREWALL="${SKIP_FIREWALL:-0}"
SKIP_START="${SKIP_START:-0}"
SYNC_SOURCE="${SYNC_SOURCE:-1}"

SERVICE_PREFIX="sadgirlplayer"
BOT_SERVICE="${SERVICE_PREFIX}-bot.service"
MEMORY_SERVICE="${SERVICE_PREFIX}-memory.service"
RAG_SERVICE="${SERVICE_PREFIX}-rag.service"

log() {
  printf '[deploy-fedora] %s\n' "$*"
}

fail() {
  printf '[deploy-fedora] ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    fail 'Run this script as root or with sudo.'
  fi
}

require_repo_files() {
  [[ -f "${REPO_ROOT}/package.json" ]] || fail "package.json not found under ${REPO_ROOT}"
  [[ -f "${REPO_ROOT}/requirements.txt" ]] || fail "requirements.txt not found under ${REPO_ROOT}"
  [[ -f "${REPO_ROOT}/src/index.js" ]] || fail "src/index.js not found under ${REPO_ROOT}"
  [[ -f "${REPO_ROOT}/python/chatbot_memory_service_vector.py" ]] || fail 'Vector memory service is missing.'
  [[ -f "${REPO_ROOT}/python/chatbot_rag_service.py" ]] || fail 'RAG service is missing.'
}

show_usage() {
  cat <<EOF
Usage: sudo bash scripts/deploy-fedora.sh [options]

Options:
  --app-user NAME        Service user name. Default: ${APP_USER}
  --install-dir PATH     Install target. Default: ${INSTALL_DIR}
  --env-dir PATH         Environment file directory. Default: ${ENV_DIR}
  --python-bin PATH      Python executable. Default: ${PYTHON_BIN}
  --node-bin PATH        Node executable. Default: ${NODE_BIN}
  --npm-bin PATH         NPM executable. Default: ${NPM_BIN}
  --skip-firewall        Do not modify firewalld rules.
  --skip-start           Install units but do not enable or start them.
  --no-sync              Do not rsync repo contents into install dir.
  --help                 Show this help text.

Behavior:
  - Exposes only 7070/tcp and 7777/tcp through firewalld by default.
  - Recommends mixed bind values without overwriting existing env values.
  - Keeps memory and RAG services local-only unless you change runtime.env yourself.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --app-user)
        APP_USER="$2"
        APP_GROUP="$2"
        shift 2
        ;;
      --install-dir)
        INSTALL_DIR="$2"
        shift 2
        ;;
      --env-dir)
        ENV_DIR="$2"
        shift 2
        ;;
      --python-bin)
        PYTHON_BIN="$2"
        shift 2
        ;;
      --node-bin)
        NODE_BIN="$2"
        shift 2
        ;;
      --npm-bin)
        NPM_BIN="$2"
        shift 2
        ;;
      --skip-firewall)
        SKIP_FIREWALL=1
        shift
        ;;
      --skip-start)
        SKIP_START=1
        shift
        ;;
      --no-sync)
        SYNC_SOURCE=0
        shift
        ;;
      --help)
        show_usage
        exit 0
        ;;
      *)
        fail "Unknown option: $1"
        ;;
    esac
  done
}

install_packages() {
  log 'Installing Fedora packages.'
  dnf install -y \
    git \
    rsync \
    sqlite \
    nodejs \
    npm \
    python3 \
    python3-pip \
    python3-virtualenv \
    python3-devel \
    gcc \
    gcc-c++ \
    make \
    firewalld
}

ensure_service_account() {
  if ! getent group "${APP_GROUP}" >/dev/null; then
    log "Creating group ${APP_GROUP}."
    groupadd --system "${APP_GROUP}"
  fi

  if ! id -u "${APP_USER}" >/dev/null 2>&1; then
    log "Creating user ${APP_USER}."
    useradd --system --gid "${APP_GROUP}" --home-dir "${INSTALL_DIR}" --create-home --shell /sbin/nologin "${APP_USER}"
  fi
}

prepare_directories() {
  log 'Preparing install and env directories.'
  install -d -m 0755 -o "${APP_USER}" -g "${APP_GROUP}" "${INSTALL_DIR}"
  install -d -m 0750 -o root -g "${APP_GROUP}" "${ENV_DIR}"
}

sync_repository() {
  if [[ "${SYNC_SOURCE}" -ne 1 ]]; then
    log 'Skipping repository sync.'
    return
  fi

  log "Syncing repository into ${INSTALL_DIR}."
  rsync -a --delete \
    --exclude 'node_modules/' \
    --exclude '.venv/' \
    --exclude '.venv-fedora/' \
    --exclude '.pytest_cache/' \
    --exclude 'data/*.sqlite3' \
    --exclude 'data/*.sqlite3-shm' \
    --exclude 'data/*.sqlite3-wal' \
    --exclude 'data/chroma-db/' \
    --exclude 'data/chatbot-memory.json' \
    --exclude 'data/memories-backup.json' \
    --exclude 'data/guild-config.json' \
    --exclude '.env' \
    "${REPO_ROOT}/" "${INSTALL_DIR}/"

  chown -R "${APP_USER}:${APP_GROUP}" "${INSTALL_DIR}"
}

install_node_dependencies() {
  log 'Installing Node dependencies with npm ci.'
  sudo -u "${APP_USER}" -- bash -lc "cd '${INSTALL_DIR}' && '${NPM_BIN}' ci"
}

install_python_dependencies() {
  local venv_dir
  venv_dir="${INSTALL_DIR}/.venv-fedora"

  log "Creating Python virtual environment at ${venv_dir}."
  sudo -u "${APP_USER}" -- "${PYTHON_BIN}" -m venv "${venv_dir}"
  sudo -u "${APP_USER}" -- "${venv_dir}/bin/pip" install --upgrade pip setuptools wheel
  sudo -u "${APP_USER}" -- "${venv_dir}/bin/pip" install -r "${INSTALL_DIR}/requirements.txt"
}

ensure_runtime_env() {
  local runtime_env runtime_recommended
  runtime_env="${ENV_DIR}/runtime.env"
  runtime_recommended="${ENV_DIR}/runtime.recommended.env"

  if [[ ! -f "${runtime_env}" ]]; then
    if [[ -f "${REPO_ROOT}/.env" ]]; then
      log "Creating ${runtime_env} from the current repo .env file."
      install -m 0640 -o root -g "${APP_GROUP}" "${REPO_ROOT}/.env" "${runtime_env}"
    else
      log "Creating ${runtime_env} from .env.example."
      install -m 0640 -o root -g "${APP_GROUP}" "${REPO_ROOT}/.env.example" "${runtime_env}"
    fi
  else
    log "Leaving existing ${runtime_env} untouched."
  fi

  cat > "${runtime_recommended}" <<EOF
# Recommended mixed-bind values for Fedora deployment behind a firewall.
# Review and merge these into ${runtime_env} if they match your intent.

# Public app ports
LEADERBOARD_SERVER_HOST=0.0.0.0
LEADERBOARD_SERVER_PORT=7070
WEB_PANEL_HOST=127.0.0.1
WEB_PANEL_PORT=7777

# Internal-only AI services
CHATBOT_MEMORY_SERVICE_HOST=127.0.0.1
CHATBOT_MEMORY_SERVICE_PORT=8765
RAG_SERVICE_HOST=127.0.0.1
RAG_SERVICE_PORT=8764

# Production reminder
WEB_PANEL_SECURE_COOKIES=true
EOF
  chown root:"${APP_GROUP}" "${runtime_recommended}"
  chmod 0640 "${runtime_recommended}"
}

write_systemd_units() {
  local runtime_env venv_dir
  runtime_env="${ENV_DIR}/runtime.env"
  venv_dir="${INSTALL_DIR}/.venv-fedora"

  log 'Writing systemd unit files.'

  cat > "${SYSTEMD_DIR}/${MEMORY_SERVICE}" <<EOF
[Unit]
Description=SadGirlPlayer vector memory service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=-${runtime_env}
ExecStart=${venv_dir}/bin/python ${INSTALL_DIR}/python/chatbot_memory_service_vector.py
Restart=on-failure
RestartSec=10
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

  cat > "${SYSTEMD_DIR}/${RAG_SERVICE}" <<EOF
[Unit]
Description=SadGirlPlayer RAG service
After=network-online.target ${MEMORY_SERVICE}
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=-${runtime_env}
ExecStart=${venv_dir}/bin/python ${INSTALL_DIR}/python/chatbot_rag_service.py
Restart=on-failure
RestartSec=10
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

  cat > "${SYSTEMD_DIR}/${BOT_SERVICE}" <<EOF
[Unit]
Description=SadGirlPlayer Discord bot
After=network-online.target ${MEMORY_SERVICE} ${RAG_SERVICE}
Wants=network-online.target ${MEMORY_SERVICE} ${RAG_SERVICE}

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=-${runtime_env}
ExecStart=${NPM_BIN} start
Restart=on-failure
RestartSec=10
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
}

configure_firewall() {
  local port

  if [[ "${SKIP_FIREWALL}" -eq 1 ]]; then
    log 'Skipping firewalld changes.'
    return
  fi

  if ! command -v firewall-cmd >/dev/null 2>&1; then
    log 'firewall-cmd not found; skipping firewall changes.'
    return
  fi

  log 'Enabling firewalld and opening configured public ports.'
  systemctl enable --now firewalld
  for port in ${FIREWALL_OPEN_PORTS}; do
    firewall-cmd --permanent --add-port="${port}"
    firewall-cmd --add-port="${port}"
  done
}

enable_services() {
  if [[ "${SKIP_START}" -eq 1 ]]; then
    log 'Skipping service enable/start.'
    return
  fi

  log 'Enabling and starting services.'
  systemctl enable --now "${MEMORY_SERVICE}" "${RAG_SERVICE}" "${BOT_SERVICE}"
}

run_verification() {
  log 'Running verification checks.'
  systemctl is-active "${MEMORY_SERVICE}"
  systemctl is-active "${RAG_SERVICE}"
  systemctl is-active "${BOT_SERVICE}"

  if command -v ss >/dev/null 2>&1; then
    ss -tulpn | grep -E ':(7070|7777|8764|8765)\b' || true
  fi

  if command -v firewall-cmd >/dev/null 2>&1; then
    firewall-cmd --list-ports || true
  fi
}

print_next_steps() {
  cat <<EOF

Deployment finished.

Files to review:
  Runtime env: ${ENV_DIR}/runtime.env
  Recommended env values: ${ENV_DIR}/runtime.recommended.env
  Services: ${SYSTEMD_DIR}/${BOT_SERVICE}, ${SYSTEMD_DIR}/${MEMORY_SERVICE}, ${SYSTEMD_DIR}/${RAG_SERVICE}

Useful commands:
  systemctl status ${BOT_SERVICE} ${MEMORY_SERVICE} ${RAG_SERVICE}
  journalctl -u ${BOT_SERVICE} -u ${MEMORY_SERVICE} -u ${RAG_SERVICE} -f
  ss -tulpn | grep -E ':(7070|7777|8764|8765)\\b'

Expected bind policy after you merge the recommended env values:
  0.0.0.0:7070  leaderboard
  0.0.0.0:7777  web panel
  127.0.0.1:8765 vector memory service
  127.0.0.1:8764 RAG service
EOF
}

main() {
  parse_args "$@"
  require_root
  require_repo_files
  install_packages
  ensure_service_account
  prepare_directories
  sync_repository
  install_node_dependencies
  install_python_dependencies
  ensure_runtime_env
  write_systemd_units
  configure_firewall
  enable_services
  run_verification
  print_next_steps
}

main "$@"
