#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/rehearse-release-baseline-cutover.sh \
    --fixture-repository <path> \
    --old-state <path> \
    --old-runtime <path> \
    --expected-candidate-commit <commit> \
    --expected-old-source-commit <commit> \
    --expected-old-manifest-sha256 <sha256> \
    --expected-current-runtime-sha256 <sha256> \
    [--current-runtime <path>]

Rehearse the prerelease state reconciliation, archive, fresh baseline
initialization, and both recovery boundaries in a disposable repository.

The fixture repository must be the clean Candidate checkout and contain the
pre-merge commit. The old state must contain one linked, published Change
that can be reset for reconciliation. The old runtime must contain dist,
package.json, source-commit.txt, and runtime-SHA256SUMS.

The command writes detailed transient observations under /tmp and emits one
compact pass/fail JSON summary on stdout. It never mutates the supplied
fixture repository, old state, or old runtime.
EOF
}

FIXTURE_REPOSITORY=""
OLD_STATE=""
OLD_RUNTIME=""
EXPECTED_CANDIDATE_COMMIT=""
EXPECTED_OLD_SOURCE_COMMIT=""
EXPECTED_OLD_MANIFEST_SHA256=""
EXPECTED_CURRENT_RUNTIME_SHA256=""
SOURCE_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CURRENT_RUNTIME="$SOURCE_ROOT/dist/main.js"

while (($# > 0)); do
  case "$1" in
    --fixture-repository)
      FIXTURE_REPOSITORY=${2:-}
      shift 2
      ;;
    --old-state)
      OLD_STATE=${2:-}
      shift 2
      ;;
    --old-runtime)
      OLD_RUNTIME=${2:-}
      shift 2
      ;;
    --current-runtime)
      CURRENT_RUNTIME=${2:-}
      shift 2
      ;;
    --expected-candidate-commit)
      EXPECTED_CANDIDATE_COMMIT=${2:-}
      shift 2
      ;;
    --expected-old-source-commit)
      EXPECTED_OLD_SOURCE_COMMIT=${2:-}
      shift 2
      ;;
    --expected-old-manifest-sha256)
      EXPECTED_OLD_MANIFEST_SHA256=${2:-}
      shift 2
      ;;
    --expected-current-runtime-sha256)
      EXPECTED_CURRENT_RUNTIME_SHA256=${2:-}
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'error: unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$FIXTURE_REPOSITORY" || -z "$OLD_STATE" || -z "$OLD_RUNTIME" || -z "$EXPECTED_CANDIDATE_COMMIT" || -z "$EXPECTED_OLD_SOURCE_COMMIT" || -z "$EXPECTED_OLD_MANIFEST_SHA256" || -z "$EXPECTED_CURRENT_RUNTIME_SHA256" ]]; then
  printf 'error: all expected identity arguments and input paths are required\n' >&2
  usage >&2
  exit 2
fi

FIXTURE_REPOSITORY=$(realpath "$FIXTURE_REPOSITORY")
OLD_STATE=$(realpath "$OLD_STATE")
OLD_RUNTIME=$(realpath "$OLD_RUNTIME")
CURRENT_RUNTIME=$(realpath "$CURRENT_RUNTIME")

git -C "$FIXTURE_REPOSITORY" rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  printf 'error: fixture repository is not a Git worktree: %s\n' "$FIXTURE_REPOSITORY" >&2
  exit 2
}
[[ -f "$OLD_STATE/state.sqlite" ]] || {
  printf 'error: old state does not contain state.sqlite: %s\n' "$OLD_STATE" >&2
  exit 2
}
for required in dist/main.js package.json source-commit.txt runtime-SHA256SUMS; do
  [[ -f "$OLD_RUNTIME/$required" ]] || {
    printf 'error: old runtime does not contain %s: %s\n' "$required" "$OLD_RUNTIME" >&2
    exit 2
  }
done
[[ -f "$CURRENT_RUNTIME" ]] || {
  printf 'error: current runtime does not exist: %s\n' "$CURRENT_RUNTIME" >&2
  exit 2
}

ROOT=$(mktemp -d /tmp/by-release-baseline-rehearsal.XXXXXX)
DETAILS=$(mktemp -d /tmp/by-release-baseline-observations.XXXXXX)
FAKE_BIN=$(mktemp -d /tmp/by-release-baseline-fake-bin.XXXXXX)
OLD_RUNTIME_COPY=$(mktemp -d /tmp/by-release-baseline-old-runtime.XXXXXX)
STEP=setup

on_exit() {
  local status=$?
  if ((status != 0)); then
    printf '{"outcome":"failed","step":"%s"}\n' "$STEP"
    printf 'Detailed transient observations: %s\n' "$DETAILS" >&2
  fi
}
trap on_exit EXIT

log_event() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$DETAILS/sequence.log"
}

STEP=runtime_identity_verification
SOURCE_COMMIT=$(git -C "$SOURCE_ROOT" rev-parse HEAD)
FIXTURE_COMMIT=$(git -C "$FIXTURE_REPOSITORY" rev-parse HEAD)
if [[ "$SOURCE_COMMIT" != "$EXPECTED_CANDIDATE_COMMIT" || "$FIXTURE_COMMIT" != "$EXPECTED_CANDIDATE_COMMIT" ]]; then
  printf 'error: Candidate checkout does not match expected commit %s\n' "$EXPECTED_CANDIDATE_COMMIT" >&2
  exit 1
fi
git -C "$SOURCE_ROOT" diff --quiet HEAD --
git -C "$SOURCE_ROOT" diff --cached --quiet HEAD --
git -C "$FIXTURE_REPOSITORY" diff --quiet HEAD --
git -C "$FIXTURE_REPOSITORY" diff --cached --quiet HEAD --
git -C "$SOURCE_ROOT" merge-base --is-ancestor "$EXPECTED_OLD_SOURCE_COMMIT" "$EXPECTED_CANDIDATE_COMMIT"

OBSERVED_OLD_SOURCE_COMMIT=$(<"$OLD_RUNTIME/source-commit.txt")
OBSERVED_OLD_MANIFEST_SHA256=$(sha256sum "$OLD_RUNTIME/runtime-SHA256SUMS" | cut -d' ' -f1)
OBSERVED_OLD_ENTRYPOINT_SHA256=$(sha256sum "$OLD_RUNTIME/dist/main.js" | cut -d' ' -f1)
OBSERVED_CURRENT_RUNTIME_SHA256=$(sha256sum "$CURRENT_RUNTIME" | cut -d' ' -f1)
if [[ "$OBSERVED_OLD_SOURCE_COMMIT" != "$EXPECTED_OLD_SOURCE_COMMIT" ]]; then
  printf 'error: old runtime source commit differs from the expected pre-merge commit\n' >&2
  exit 1
fi
if [[ "$OBSERVED_OLD_MANIFEST_SHA256" != "$EXPECTED_OLD_MANIFEST_SHA256" ]]; then
  printf 'error: old runtime manifest SHA-256 differs from the expected identity\n' >&2
  exit 1
fi
if [[ "$OBSERVED_CURRENT_RUNTIME_SHA256" != "$EXPECTED_CURRENT_RUNTIME_SHA256" ]]; then
  printf 'error: current runtime SHA-256 differs from the expected Candidate runtime\n' >&2
  exit 1
fi
cut -d' ' -f3- "$OLD_RUNTIME/runtime-SHA256SUMS" | sort > "$DETAILS/manifest-runtime-files.txt"
(
  cd "$OLD_RUNTIME"
  {
    find dist -type f -printf '%p\n'
    printf '%s\n' package.json source-commit.txt
  } | sort
) > "$DETAILS/observed-runtime-files.txt"
if ! cmp -s "$DETAILS/manifest-runtime-files.txt" "$DETAILS/observed-runtime-files.txt"; then
  printf 'error: old runtime manifest does not cover the exact runtime inventory\n' >&2
  exit 1
fi
log_event exact_runtime_identities_verified

rmdir "$ROOT"
git clone --quiet --no-hardlinks "$FIXTURE_REPOSITORY" "$ROOT"
git -C "$ROOT" checkout --quiet --detach "$EXPECTED_CANDIDATE_COMMIT"
mkdir -p "$OLD_RUNTIME_COPY/dist"
cp -a "$OLD_RUNTIME/dist/." "$OLD_RUNTIME_COPY/dist/"
cp "$OLD_RUNTIME/package.json" "$OLD_RUNTIME/source-commit.txt" "$OLD_RUNTIME/runtime-SHA256SUMS" "$OLD_RUNTIME_COPY/"
rm -rf "$ROOT/.git"/but-why*
mkdir -p "$ROOT/.git/but-why"
cp -a "$OLD_STATE/." "$ROOT/.git/but-why/"

mapfile -t CHANGE_FACTS < <(
  python3 - "$ROOT/.git/but-why/state.sqlite" <<'PY'
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as connection:
    rows = connection.execute(
        """
        SELECT c.id, c.branch_ref, c.publication_owner, c.publication_repo,
               c.publication_base_branch, c.publication_head_branch,
               c.publication_expected_head_sha, c.publication_pr_number,
               i.id_prefix
        FROM changes c
        CROSS JOIN shared_state_identity i
        JOIN task_change_links l ON l.change_id = c.id
        WHERE c.publication_pr_number IS NOT NULL
        """
    ).fetchall()
if len(rows) != 1:
    raise SystemExit("old state must contain exactly one linked published Change")
for value in rows[0]:
    if value is None:
        raise SystemExit("published Change fixture is missing reconciliation data")
    print(value)
PY
)
CHANGE_INTEGER=${CHANGE_FACTS[0]}
CHANGE_BRANCH_REF=${CHANGE_FACTS[1]}
PUBLICATION_OWNER=${CHANGE_FACTS[2]}
PUBLICATION_REPOSITORY=${CHANGE_FACTS[3]}
BASE_BRANCH=${CHANGE_FACTS[4]}
HEAD_BRANCH=${CHANGE_FACTS[5]}
PULL_REQUEST_NUMBER=${CHANGE_FACTS[7]}
ID_PREFIX=${CHANGE_FACTS[8]}
EXPECTED_HEAD_SHA=$EXPECTED_CANDIDATE_COMMIT
CHANGE_ID="${ID_PREFIX}-C${CHANGE_INTEGER}"
CHANGE_BRANCH=${CHANGE_BRANCH_REF#refs/heads/}
WORKTREE="${ROOT}-worktrees/but-why/${CHANGE_ID}"

git -C "$ROOT" branch -f "$BASE_BRANCH" "$EXPECTED_CANDIDATE_COMMIT"
git -C "$ROOT" update-ref "refs/remotes/origin/$BASE_BRANCH" "$EXPECTED_CANDIDATE_COMMIT"
STEP=merged_repo_config_verification
MERGED_COMMIT=$(git -C "$ROOT" rev-parse "refs/heads/${BASE_BRANCH}^{commit}")
if [[ "$MERGED_COMMIT" != "$EXPECTED_CANDIDATE_COMMIT" ]]; then
  printf 'error: merged fixture commit differs from the exact Candidate\n' >&2
  exit 1
fi
git -C "$ROOT" show "$MERGED_COMMIT:.but-why/config.json" > "$DETAILS/merged-repo-config.json"
if ! cmp -s "$DETAILS/merged-repo-config.json" "$ROOT/.but-why/config.json"; then
  printf 'error: fixture Repo Config differs from merged commit %s\n' "$MERGED_COMMIT" >&2
  exit 1
fi
COMMITTED_ID_PREFIX=$(python3 - "$DETAILS/merged-repo-config.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    config = json.load(source)
id_prefix = config.get("idPrefix")
if not isinstance(id_prefix, str) or not id_prefix:
    raise SystemExit("merged Repo Config does not contain a valid idPrefix")
print(id_prefix)
PY
)
if [[ "$COMMITTED_ID_PREFIX" != "$ID_PREFIX" ]]; then
  printf 'error: merged Repo Config idPrefix %s differs from old state idPrefix %s\n' "$COMMITTED_ID_PREFIX" "$ID_PREFIX" >&2
  exit 1
fi
mapfile -t REVIEWER_INSTRUCTION_FILES < <(
  python3 - "$DETAILS/merged-repo-config.json" <<'PY'
import json
import pathlib
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    config = json.load(source)
reviewers = config.get("reviewers", {})
if not isinstance(reviewers, dict):
    raise SystemExit("merged Repo Config reviewers must be an object")
paths = []
for name, reviewer in reviewers.items():
    if not isinstance(reviewer, dict):
        raise SystemExit(f"reviewer {name} must be an object")
    path = reviewer.get("instructionsFile")
    if not isinstance(path, str) or not path:
        raise SystemExit(f"reviewer {name} has no instructionsFile")
    candidate = pathlib.PurePosixPath(path)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise SystemExit(f"reviewer {name} instructionsFile is not repository-relative")
    paths.append(path)
for path in sorted(set(paths)):
    print(path)
PY
)
for reviewer_file in "${REVIEWER_INSTRUCTION_FILES[@]}"; do
  git -C "$ROOT" cat-file -e "$MERGED_COMMIT:$reviewer_file"
done
log_event merged_repo_config_and_reviewer_files_verified

mkdir -p "$(dirname "$WORKTREE")"
git -C "$ROOT" branch "$CHANGE_BRANCH" "$EXPECTED_HEAD_SHA"
git -C "$ROOT" worktree add "$WORKTREE" "$CHANGE_BRANCH" > "$DETAILS/worktree-create.txt"
python3 - "$ROOT/.git/but-why/state.sqlite" "$ROOT/.git" "$WORKTREE" "$CHANGE_INTEGER" "$EXPECTED_HEAD_SHA" "$EXPECTED_OLD_SOURCE_COMMIT" <<'PY'
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as connection:
    change_id = int(sys.argv[4])
    task = connection.execute(
        "SELECT task_id FROM task_change_links WHERE change_id = ?", (change_id,)
    ).fetchone()
    if task is None:
        raise SystemExit("published Change is not linked to a Task")
    connection.execute(
        "UPDATE shared_state_identity SET common_directory = ? WHERE id = 1",
        (sys.argv[2],),
    )
    connection.execute(
        "UPDATE tasks SET state = 'todo', cancel_reason = NULL WHERE id = ?",
        (task[0],),
    )
    connection.execute(
        """
        UPDATE changes
        SET repository_common_directory = ?, worktree_path = ?, state = 'open',
            close_reason = NULL, closed_at = NULL, cleanup_state = 'complete',
            cleanup_blocking_reason = NULL, publication_expected_head_sha = ?,
            starting_commit = ?
        WHERE id = ?
        """,
        (sys.argv[2], sys.argv[3], sys.argv[5], sys.argv[6], change_id),
    )
PY

python3 - "$FAKE_BIN/pull-request.json" "$PUBLICATION_OWNER" "$PUBLICATION_REPOSITORY" "$PULL_REQUEST_NUMBER" "$BASE_BRANCH" "$HEAD_BRANCH" "$EXPECTED_HEAD_SHA" <<'PY'
import json
import sys

path, owner, repository, number, base, head, sha = sys.argv[1:]
with open(path, "w", encoding="utf-8") as output:
    json.dump(
        {
            "number": int(number),
            "html_url": f"https://github.com/{owner}/{repository}/pull/{number}",
            "state": "closed",
            "merged": True,
            "base": {"ref": base, "repo": {"owner": {"login": owner}, "name": repository}},
            "head": {"ref": head, "sha": sha},
        },
        output,
        separators=(",", ":"),
    )
PY
python3 - "$FAKE_BIN/graphql.json" "$BASE_BRANCH" <<'PY'
import json
import sys

with open(sys.argv[1], "w", encoding="utf-8") as output:
    json.dump(
        {
            "data": {
                "repository": {
                    "id": "R_release_baseline_rehearsal",
                    "defaultBranchRef": {"name": sys.argv[2]},
                    "ref": None,
                }
            }
        },
        output,
        separators=(",", ":"),
    )
PY
cat > "$FAKE_BIN/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *graphql*) cat "$GH_FAKE_GRAPHQL_RESPONSE" ;;
  *pulls/*) cat "$GH_FAKE_PULL_REQUEST_RESPONSE" ;;
  *) printf 'unexpected gh arguments: %s\n' "$*" >&2; exit 2 ;;
esac
GH
chmod +x "$FAKE_BIN/gh"

STEP=old_runtime_verification
(
  cd "$OLD_RUNTIME_COPY"
  sha256sum -c runtime-SHA256SUMS
) > "$DETAILS/old-runtime-verification.txt"
sha256sum "$OLD_RUNTIME_COPY/dist/main.js" "$OLD_RUNTIME_COPY/runtime-SHA256SUMS" > "$DETAILS/old-runtime-identities.txt"
log_event old_runtime_verified

STEP=old_runtime_reconciliation
set +e
(
  cd "$ROOT"
  PATH="$FAKE_BIN:$PATH" \
    GH_FAKE_GRAPHQL_RESPONSE="$FAKE_BIN/graphql.json" \
    GH_FAKE_PULL_REQUEST_RESPONSE="$FAKE_BIN/pull-request.json" \
    BUT_WHY_EXECUTABLE_PATH="$OLD_RUNTIME_COPY/dist/main.js" \
    BUT_WHY_SOURCE_TRUSTED_ROOT="$ROOT" \
    node "$OLD_RUNTIME_COPY/dist/main.js" change reconcile "$CHANGE_ID"
) > "$DETAILS/reconciliation.json" 2> "$DETAILS/reconciliation.stderr"
RECONCILIATION_STATUS=$?
set -e
printf '%s\n' "$RECONCILIATION_STATUS" > "$DETAILS/reconciliation.status"
[[ "$RECONCILIATION_STATUS" -eq 0 ]]
[[ ! -e "$WORKTREE" ]]
git -C "$ROOT" worktree list --porcelain > "$DETAILS/worktrees-after-reconciliation.txt"
! rg -F "$WORKTREE" "$DETAILS/worktrees-after-reconciliation.txt"
if git -C "$ROOT" show-ref --verify --quiet "$CHANGE_BRANCH_REF"; then
  printf 'error: managed Repository Branch remains after reconciliation: %s\n' "$CHANGE_BRANCH_REF" >&2
  exit 1
fi
python3 - "$ROOT/.git/but-why/state.sqlite" "$CHANGE_INTEGER" <<'PY' > "$DETAILS/reconciled-state.json"
import json
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as connection:
    change_id = int(sys.argv[2])
    change = connection.execute(
        "SELECT state, close_reason, cleanup_state FROM changes WHERE id = ?",
        (change_id,),
    ).fetchone()
    task = connection.execute(
        """
        SELECT t.state FROM tasks t
        JOIN task_change_links l ON l.task_id = t.id
        WHERE l.change_id = ?
        """,
        (change_id,),
    ).fetchone()
    assert change == ("closed", "completed", "complete"), change
    assert task == ("done",), task
    print(json.dumps({"change": change, "task": task}, separators=(",", ":")))
PY
log_event old_runtime_reconciliation_completed

STEP=archive_verification
ARCHIVE="$ROOT/.git/but-why-prerelease-archive"
mkdir -p "$ARCHIVE/repository/.but-why" "$ARCHIVE/old-runtime"
cp -a "$ROOT/.git/but-why" "$ARCHIVE/git-common-but-why"
cp "$DETAILS/merged-repo-config.json" "$ARCHIVE/repository/.but-why/config.json"
for reviewer_file in "${REVIEWER_INSTRUCTION_FILES[@]}"; do
  mkdir -p "$ARCHIVE/repository/$(dirname "$reviewer_file")"
  git -C "$ROOT" show "$MERGED_COMMIT:$reviewer_file" > "$ARCHIVE/repository/$reviewer_file"
done
cp -a "$OLD_RUNTIME_COPY/dist" "$ARCHIVE/old-runtime/dist"
cp "$OLD_RUNTIME_COPY/package.json" "$ARCHIVE/old-runtime/package.json"
cp "$OLD_RUNTIME_COPY/source-commit.txt" "$ARCHIVE/old-runtime/source-commit.txt"
cp "$OLD_RUNTIME_COPY/runtime-SHA256SUMS" "$ARCHIVE/old-runtime/runtime-SHA256SUMS"
cp "$DETAILS/reconciliation.json" "$ARCHIVE/reconciliation-output.json"
cat > "$ARCHIVE/archive-metadata.txt" <<EOF
archive_time_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
repository_common_directory=$ROOT/.git
id_prefix=$ID_PREFIX
old_runtime_entrypoint=old-runtime/dist/main.js
old_runtime_source_commit=$(cat "$OLD_RUNTIME_COPY/source-commit.txt")
old_runtime_entrypoint_sha256=$(sha256sum "$OLD_RUNTIME_COPY/dist/main.js" | cut -d' ' -f1)
old_runtime_manifest_sha256=$(sha256sum "$OLD_RUNTIME_COPY/runtime-SHA256SUMS" | cut -d' ' -f1)
merged_candidate_commit=$MERGED_COMMIT
current_runtime_sha256=$OBSERVED_CURRENT_RUNTIME_SHA256
EOF
cat > "$ARCHIVE/INSPECTING.md" <<'EOF'
# Inspecting this prerelease archive

Use an isolated copy of the original repository at the archived Git Common Directory identity.
Copy `git-common-but-why` into that copy's Git Common Directory as `but-why`.
From `old-runtime`, run `sha256sum -c runtime-SHA256SUMS` before opening the state.
Invoke the archived runtime directly with `node <archive>/old-runtime/dist/main.js`.
Set `BUT_WHY_EXECUTABLE_PATH` to that same `dist/main.js` file and `BUT_WHY_SOURCE_TRUSTED_ROOT` to the isolated canonical main checkout.
Do not invoke `bin/by` or open this state with the release-baseline executable.
EOF
(
  cd "$ARCHIVE"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
  sha256sum -c SHA256SUMS
) > "$DETAILS/archive-initial-verification.txt"
rm -rf "$OLD_RUNTIME_COPY"
[[ ! -e "$OLD_RUNTIME_COPY" ]]
log_event complete_archive_verified_and_external_bundle_removed

STEP=fresh_initialization
rm -rf "$ROOT/.git/but-why"
mkdir -p "$ROOT/.git/but-why"
(
  cd "$ROOT"
  BUT_WHY_EXECUTABLE_PATH="$CURRENT_RUNTIME" BUT_WHY_SOURCE_TRUSTED_ROOT="$ROOT" \
    node "$CURRENT_RUNTIME" init --id-prefix "$ID_PREFIX"
) > "$DETAILS/fresh-initialization.json" 2> "$DETAILS/fresh-initialization.stderr"
python3 - "$ROOT/.git/but-why/state.sqlite" "$ROOT/.git" "$ID_PREFIX" <<'PY' > "$DETAILS/fresh-state.json"
import json
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as connection:
    tables = [
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'effect_sql_migrations'"
        )
    ]
    migrations = [
        row[0]
        for row in connection.execute(
            "SELECT migration_id FROM effect_sql_migrations ORDER BY migration_id"
        )
    ]
    identity = connection.execute(
        "SELECT common_directory, id_prefix FROM shared_state_identity WHERE id = 1"
    ).fetchone()
    task_count = connection.execute("SELECT count(*) FROM tasks").fetchone()[0]
    change_count = connection.execute("SELECT count(*) FROM changes").fetchone()[0]
    assert len(tables) == 18, tables
    assert migrations == [1], migrations
    assert identity == (sys.argv[2], sys.argv[3]), identity
    assert task_count == 0, task_count
    assert change_count == 0, change_count
    print(json.dumps({"productTableCount": len(tables), "migrationIds": migrations, "identity": identity}, separators=(",", ":")))
PY
(
  cd "$ROOT"
  BUT_WHY_EXECUTABLE_PATH="$CURRENT_RUNTIME" BUT_WHY_SOURCE_TRUSTED_ROOT="$ROOT" \
    node "$CURRENT_RUNTIME" task list
) > "$DETAILS/fresh-read.json" 2> "$DETAILS/fresh-read.stderr"
log_event fresh_baseline_initialized_and_verified

STEP=before_new_work_recovery
python3 - "$ROOT/.git/but-why/state.sqlite" <<'PY'
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as connection:
    connection.execute(
        "INSERT INTO effect_sql_migrations(migration_id, name) VALUES (99, 'unknown_forward_migration')"
    )
PY
set +e
(
  cd "$ROOT"
  BUT_WHY_EXECUTABLE_PATH="$CURRENT_RUNTIME" BUT_WHY_SOURCE_TRUSTED_ROOT="$ROOT" \
    node "$CURRENT_RUNTIME" task list
) > "$DETAILS/before-new-work-failure.json" 2> "$DETAILS/before-new-work-failure.stderr"
BEFORE_NEW_WORK_STATUS=$?
set -e
[[ "$BEFORE_NEW_WORK_STATUS" -eq 1 ]]
python3 - "$ROOT/.git/but-why/state.sqlite" <<'PY' > "$DETAILS/before-new-work-state.json"
import json
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as connection:
    migrations = [row[0] for row in connection.execute("SELECT migration_id FROM effect_sql_migrations ORDER BY migration_id")]
    task_count = connection.execute("SELECT count(*) FROM tasks").fetchone()[0]
    change_count = connection.execute("SELECT count(*) FROM changes").fetchone()[0]
    assert migrations == [1, 99], migrations
    assert task_count == 0, task_count
    assert change_count == 0, change_count
    print(json.dumps({"migrationIds": migrations, "taskCount": task_count, "changeCount": change_count}, separators=(",", ":")))
PY
rm -rf "$ROOT/.git/but-why"
cp -a "$ARCHIVE/git-common-but-why" "$ROOT/.git/but-why"
(
  cd "$ARCHIVE/old-runtime"
  sha256sum -c runtime-SHA256SUMS
) > "$DETAILS/archived-runtime-verification.txt"
(
  cd "$ROOT"
  BUT_WHY_EXECUTABLE_PATH="$ARCHIVE/old-runtime/dist/main.js" BUT_WHY_SOURCE_TRUSTED_ROOT="$ROOT" \
    node "$ARCHIVE/old-runtime/dist/main.js" change show "$CHANGE_ID"
) > "$DETAILS/restored-old-state.json" 2> "$DETAILS/restored-old-state.stderr"
log_event complete_old_state_restored_with_archived_runtime

STEP=after_new_work_recovery
rm -rf "$ROOT/.git/but-why"
mkdir -p "$ROOT/.git/but-why"
(
  cd "$ROOT"
  BUT_WHY_EXECUTABLE_PATH="$CURRENT_RUNTIME" BUT_WHY_SOURCE_TRUSTED_ROOT="$ROOT" \
    node "$CURRENT_RUNTIME" init --id-prefix "$ID_PREFIX"
) > "$DETAILS/fresh-reinitialization.json" 2> "$DETAILS/fresh-reinitialization.stderr"
printf '%s\n' 'Exercise forward repair after release-baseline initialization.' > "$DETAILS/post-cutover-task.txt"
(
  cd "$ROOT"
  BUT_WHY_EXECUTABLE_PATH="$CURRENT_RUNTIME" BUT_WHY_SOURCE_TRUSTED_ROOT="$ROOT" \
    node "$CURRENT_RUNTIME" task create --title 'Post-cutover recovery task' --file "$DETAILS/post-cutover-task.txt"
) > "$DETAILS/new-work-create.json" 2> "$DETAILS/new-work-create.stderr"
python3 - "$ROOT/.git/but-why/state.sqlite" <<'PY'
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as connection:
    connection.execute(
        "UPDATE shared_state_identity SET common_directory = '/incorrect/common-directory' WHERE id = 1"
    )
PY
set +e
(
  cd "$ROOT"
  BUT_WHY_EXECUTABLE_PATH="$CURRENT_RUNTIME" BUT_WHY_SOURCE_TRUSTED_ROOT="$ROOT" \
    node "$CURRENT_RUNTIME" task list
) > "$DETAILS/after-new-work-failure.json" 2> "$DETAILS/after-new-work-failure.stderr"
AFTER_NEW_WORK_STATUS=$?
set -e
[[ "$AFTER_NEW_WORK_STATUS" -eq 1 ]]
python3 - "$ROOT/.git/but-why/state.sqlite" "$ROOT/.git" <<'PY'
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as connection:
    task_count = connection.execute("SELECT count(*) FROM tasks").fetchone()[0]
    migrations = [row[0] for row in connection.execute("SELECT migration_id FROM effect_sql_migrations ORDER BY migration_id")]
    assert task_count == 1, task_count
    assert migrations == [1], migrations
    connection.execute(
        "UPDATE shared_state_identity SET common_directory = ? WHERE id = 1",
        (sys.argv[2],),
    )
PY
(
  cd "$ROOT"
  BUT_WHY_EXECUTABLE_PATH="$CURRENT_RUNTIME" BUT_WHY_SOURCE_TRUSTED_ROOT="$ROOT" \
    node "$CURRENT_RUNTIME" task show "${ID_PREFIX}-1"
) > "$DETAILS/forward-repair-read.json" 2> "$DETAILS/forward-repair-read.stderr"
python3 - "$ROOT/.git/but-why/state.sqlite" "$ROOT/.git" "$ID_PREFIX" <<'PY' > "$DETAILS/final-active-state.json"
import json
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as connection:
    tables = [
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'effect_sql_migrations'"
        )
    ]
    migrations = [row[0] for row in connection.execute("SELECT migration_id FROM effect_sql_migrations ORDER BY migration_id")]
    identity = connection.execute("SELECT common_directory, id_prefix FROM shared_state_identity WHERE id = 1").fetchone()
    tasks = connection.execute("SELECT id, title, state FROM tasks ORDER BY id").fetchall()
    change_count = connection.execute("SELECT count(*) FROM changes").fetchone()[0]
    assert len(tables) == 18, tables
    assert migrations == [1], migrations
    assert identity == (sys.argv[2], sys.argv[3]), identity
    assert len(tasks) == 1, tasks
    assert change_count == 0, change_count
    print(json.dumps({"productTableCount": len(tables), "migrationIds": migrations, "identity": identity, "tasks": tasks, "changeCount": change_count}, separators=(",", ":")))
PY
log_event new_state_repaired_forward_and_verified

STEP=final_archive_verification
(
  cd "$ARCHIVE"
  sha256sum -c SHA256SUMS
) > "$DETAILS/archive-final-verification.txt"
find "$ROOT/.git" -maxdepth 1 -type d -name '*archive*' -printf '%f\n' | sort > "$DETAILS/archive-directories.txt"
[[ "$(wc -l < "$DETAILS/archive-directories.txt")" -eq 1 ]]
log_event final_archive_verified

trap - EXIT
python3 - "$EXPECTED_CANDIDATE_COMMIT" "$EXPECTED_OLD_SOURCE_COMMIT" "$OBSERVED_OLD_MANIFEST_SHA256" "$OBSERVED_OLD_ENTRYPOINT_SHA256" "$OBSERVED_CURRENT_RUNTIME_SHA256" <<'PY'
import json
import sys

candidate, pre_merge, old_manifest, old_entrypoint, current_runtime = sys.argv[1:]
print(
    json.dumps(
        {
            "outcome": "passed",
            "candidateCommit": candidate,
            "preMergeCommit": pre_merge,
            "oldRuntimeManifestSha256": old_manifest,
            "oldRuntimeEntrypointSha256": old_entrypoint,
            "currentRuntimeSha256": current_runtime,
            "runtimeManifestInventory": "passed",
            "mergedRepoConfig": "passed",
            "oldBundleReconciliation": "passed",
            "managedBranchCleanup": "passed",
            "archive": "passed",
            "freshInitialization": "passed",
            "beforeNewWorkRecovery": "passed",
            "afterNewWorkRecovery": "passed",
        },
        separators=(",", ":"),
    )
)
PY
printf 'Detailed transient observations: %s\n' "$DETAILS" >&2
