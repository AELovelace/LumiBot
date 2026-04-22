#!/usr/bin/env bash

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/sadgirlplayer}"
ENV_DIR="${ENV_DIR:-/etc/sadgirlplayer}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/sadgirlplayer}"
PYTHON_VENV_DIR="${PYTHON_VENV_DIR:-${INSTALL_DIR}/.venv-fedora}"
APP_USER="${APP_USER:-sadgirlplayer}"
NPM_BIN="${NPM_BIN:-/usr/bin/npm}"
GIT_BIN="${GIT_BIN:-/usr/bin/git}"
SQLITE3_BIN="${SQLITE3_BIN:-/usr/bin/sqlite3}"
UPDATE_REMOTE="${UPDATE_REMOTE:-origin}"
UPDATE_BRANCH="${UPDATE_BRANCH:-}"

SERVICE_PREFIX="${SERVICE_PREFIX:-sadgirlplayer}"
BOT_SERVICE="${SERVICE_PREFIX}-bot.service"
MEMORY_SERVICE="${SERVICE_PREFIX}-memory.service"
RAG_SERVICE="${SERVICE_PREFIX}-rag.service"
SERVICES=("${BOT_SERVICE}" "${MEMORY_SERVICE}" "${RAG_SERVICE}")

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
WORK_DIR=""
SERVICES_WERE_STOPPED=0

log() {
  printf '[ops-fedora] %s\n' "$*"
}

fail() {
  printf '[ops-fedora] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
Usage: sudo bash scripts/ops-fedora.sh <command>

Commands:
  backup   Stop services briefly, create a consistent backup set, then restart.
  update   Backup first, then git pull, reinstall deps, and restart services.
  status   Show service state and recent listeners for deployed ports.

Environment overrides:
  INSTALL_DIR, ENV_DIR, BACKUP_ROOT, PYTHON_VENV_DIR, APP_USER, NPM_BIN, GIT_BIN,
  SQLITE3_BIN, SERVICE_PREFIX, UPDATE_REMOTE, UPDATE_BRANCH
EOF
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    fail 'Run this script as root or with sudo.'
  fi
}

require_paths() {
  [[ -d "${INSTALL_DIR}" ]] || fail "Install directory not found: ${INSTALL_DIR}"
  [[ -f "${INSTALL_DIR}/package.json" ]] || fail "package.json not found under ${INSTALL_DIR}"
  [[ -f "${INSTALL_DIR}/requirements.txt" ]] || fail "requirements.txt not found under ${INSTALL_DIR}"
  [[ -x "${PYTHON_VENV_DIR}/bin/pip" ]] || fail "Python venv pip missing under ${PYTHON_VENV_DIR}"
}

run_as_app_user() {
  runuser -u "${APP_USER}" -- bash -lc "$1"
}

resolve_update_branch() {
  local detected

  if [[ -n "${UPDATE_BRANCH}" ]]; then
    echo "${UPDATE_BRANCH}"
    return
  fi

  detected="$(run_as_app_user "cd '${INSTALL_DIR}' && '${GIT_BIN}' symbolic-ref --quiet --short HEAD" 2>/dev/null || true)"
  if [[ -n "${detected}" ]]; then
    echo "${detected}"
    return
  fi

  detected="$(run_as_app_user "cd '${INSTALL_DIR}' && '${GIT_BIN}' symbolic-ref --quiet --short refs/remotes/${UPDATE_REMOTE}/HEAD" 2>/dev/null || true)"
  if [[ -n "${detected}" ]]; then
    echo "${detected##${UPDATE_REMOTE}/}"
    return
  fi

  echo "main"
}

start_services() {
  log 'Starting production services.'
  systemctl start "${SERVICES[@]}"
}

stop_services() {
  log 'Stopping production services for a consistent backup.'
  systemctl stop "${SERVICES[@]}"
  SERVICES_WERE_STOPPED=1
}

restart_services() {
  log 'Restarting production services.'
  systemctl restart "${SERVICES[@]}"
  SERVICES_WERE_STOPPED=0
}

cleanup() {
  local exit_code
  exit_code=$?

  if [[ "${SERVICES_WERE_STOPPED}" -eq 1 ]]; then
    log 'Cleanup restarting services after interruption.'
    systemctl start "${SERVICES[@]}" || true
  fi

  exit "${exit_code}"
}

prepare_backup_workspace() {
  WORK_DIR="${BACKUP_ROOT}/${TIMESTAMP}"
  mkdir -p "${WORK_DIR}/sqlite" "${WORK_DIR}/snapshots"
}

backup_sqlite_file() {
  local source_file backup_file
  source_file="$1"

  if [[ ! -f "${source_file}" ]]; then
    return
  fi

  backup_file="${WORK_DIR}/sqlite/$(basename "${source_file}")"

  if [[ -x "${SQLITE3_BIN}" ]]; then
    "${SQLITE3_BIN}" "${source_file}" ".backup '${backup_file}'"
  else
    cp -a "${source_file}" "${backup_file}"
  fi
}

create_backup() {
  local snapshot_targets=()

  prepare_backup_workspace
  stop_services

  log "Saving SQLite databases under ${WORK_DIR}/sqlite."
  backup_sqlite_file "${INSTALL_DIR}/data/chatbot-memory.sqlite3"
  backup_sqlite_file "${INSTALL_DIR}/data/sadgirlcoin.sqlite3"
  backup_sqlite_file "${INSTALL_DIR}/data/cigarette-market.sqlite3"
  backup_sqlite_file "${INSTALL_DIR}/data/touhou-market.sqlite3"

  log 'Archiving data/chroma-db and runtime configuration.'
  [[ -d "${INSTALL_DIR}/data/chroma-db" ]] && snapshot_targets+=("data/chroma-db")
  [[ -f "${INSTALL_DIR}/data/chatbot-memory.json" ]] && snapshot_targets+=("data/chatbot-memory.json")
  [[ -f "${INSTALL_DIR}/data/memories-backup.json" ]] && snapshot_targets+=("data/memories-backup.json")
  [[ -f "${INSTALL_DIR}/data/guild-config.json" ]] && snapshot_targets+=("data/guild-config.json")
  [[ -f "${INSTALL_DIR}/data/leaderboard.html" ]] && snapshot_targets+=("data/leaderboard.html")

  if [[ "${#snapshot_targets[@]}" -gt 0 ]]; then
    tar -C "${INSTALL_DIR}" -czf "${WORK_DIR}/snapshots/data-files.tar.gz" "${snapshot_targets[@]}"
  fi

  if [[ -d "${ENV_DIR}" ]]; then
    tar -C "${ENV_DIR}" -czf "${WORK_DIR}/snapshots/env-files.tar.gz" .
  fi

  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    run_as_app_user "cd '${INSTALL_DIR}' && '${GIT_BIN}' rev-parse HEAD" > "${WORK_DIR}/git-revision.txt" 2>/dev/null || true
    run_as_app_user "cd '${INSTALL_DIR}' && '${GIT_BIN}' status --short" > "${WORK_DIR}/git-status.txt"
  fi

  start_services
  SERVICES_WERE_STOPPED=0
  log "Backup completed at ${WORK_DIR}."
}

run_update() {
  local branch

  create_backup

  [[ -d "${INSTALL_DIR}/.git" ]] || fail "${INSTALL_DIR} is not a git checkout; cannot run update."

  branch="$(resolve_update_branch)"

  log 'Fetching and fast-forwarding repository.'
  run_as_app_user "cd '${INSTALL_DIR}' && '${GIT_BIN}' fetch '${UPDATE_REMOTE}' --prune"

  if ! run_as_app_user "cd '${INSTALL_DIR}' && '${GIT_BIN}' rev-parse --verify HEAD >/dev/null 2>&1"; then
    log "No local HEAD found. Bootstrapping branch ${branch} from ${UPDATE_REMOTE}/${branch}."
    run_as_app_user "cd '${INSTALL_DIR}' && '${GIT_BIN}' checkout -B '${branch}' '${UPDATE_REMOTE}/${branch}'"
  fi

  if ! run_as_app_user "cd '${INSTALL_DIR}' && '${GIT_BIN}' rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1"; then
    run_as_app_user "cd '${INSTALL_DIR}' && '${GIT_BIN}' branch --set-upstream-to='${UPDATE_REMOTE}/${branch}' '${branch}'" || true
  fi

  run_as_app_user "cd '${INSTALL_DIR}' && '${GIT_BIN}' pull --ff-only '${UPDATE_REMOTE}' '${branch}'"

  log 'Installing Node dependencies.'
  run_as_app_user "cd '${INSTALL_DIR}' && '${NPM_BIN}' ci"

  log 'Installing pinned Python dependencies.'
  run_as_app_user "'${PYTHON_VENV_DIR}/bin/pip' install --upgrade pip setuptools wheel"
  run_as_app_user "'${PYTHON_VENV_DIR}/bin/pip' install -r '${INSTALL_DIR}/requirements.txt'"

  log 'Reloading and restarting services.'
  systemctl daemon-reload
  restart_services

  log 'Verifying service state after update.'
  systemctl is-active "${SERVICES[@]}"
}

show_status() {
  systemctl status --no-pager "${SERVICES[@]}"

  if command -v ss >/dev/null 2>&1; then
    ss -tulpn | grep -E ':(7070|7777|8764|8765)\b' || true
  fi
}

main() {
  trap cleanup EXIT
  require_root
  require_paths

  case "${1:-}" in
    backup)
      create_backup
      ;;
    update)
      run_update
      ;;
    status)
      show_status
      ;;
    ''|-h|--help)
      usage
      ;;
    *)
      fail "Unknown command: ${1}"
      ;;
  esac
}

main "$@"