# ops — the simple operator console

`ops.sh` is a friendly terminal wrapper around the **same engine the admin web
tool uses** (the npm scripts in `static/`). Use it when the admin UI feels like
too much and you just want to *see what's live, ship a release, or roll back*
with output you can read.

Run it from anywhere:

```bash
static/ops/ops.sh status
```

## Commands

| Command | What it does |
|---------|--------------|
| `status` | One screen: what's live, what's pending, next release number, is codes.json ready to tag. |
| `releases` | The release history + which release `rollback` would land on. |
| `diagnose` | Deeper health check: config, git sync, SSH to the Pi, pm2 service status, live site reachable. |
| `verify [code]` | Hit the live site and confirm a `/q/<code>` redirect works (picks a sample code if none given). |
| `tag <N>` | Freeze `release/N` from the current commit (refuses if codes.json is dirty or the tag exists). |
| `deploy <N>` | Build `release/N` and ship it to production, then auto-verify. Asks before shipping. |
| `rollback` | Step production back to the previous release, then auto-verify. Asks first. |
| `help` | The built-in help. |

## Safety

- `tag`, `deploy`, and `rollback` **always ask for confirmation** before doing
  anything that changes git or production.
- `deploy` and `rollback` **auto-run `verify`** afterward so you immediately see
  whether the live site is healthy.
- A failed deploy leaves production unchanged unless the `state` phase ran — the
  script tells you this.

## Dry run

```bash
OFFLINE=1 static/ops/ops.sh tag 99
```

`OFFLINE=1` makes the engine skip `git push`. **Note:** it does *not* mock the
Pi deploy itself — an offline `deploy`/`rollback` still SSHes to the Pi. Use it
to rehearse the **tag** step safely; clean up afterward with
`git tag -d release/<n>`.

## Relationship to the admin tool

You still **edit codes** (`codes.json`) in the admin web tool (`npm run admin`).
`ops.sh` covers the other half — the ship / observe / recover workflow — and
reads the same `release-state.json` the admin tool writes. They're consistent
because both call the same underlying npm scripts.

Full background: [../../DEPLOY.md](../../DEPLOY.md) and
[../runbooks/admin.md](../runbooks/admin.md).
