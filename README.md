# ScoreSpace

A small live competition judging app built with React, TypeScript, and DeepSpace.
An organizer creates a competition, adds competitors, authorizes existing users
as judges, and watches average scores update as judges submit.

## Using it

1. Open the dashboard and sign in with DeepSpace authentication.
2. Create a competition. Its creator is its organizer.
3. Add competitors and select existing ScoreSpace users in the Judges section.
   A user must have signed in to this app before appearing in the roster.
4. Organizers open management from their dashboard. Assigned judges go straight
   to `/competitions/:competitionId/judge`; opening the management URL directly
   redirects an authorized judge to that judging page.
5. Each judge, including the organizer, submits one finite score from 1 to 10
   per competitor. Accepted scores cannot be edited or deleted.
6. The organizer opens Live Results: arithmetic averages, score counts, ties,
   and unscored competitors update automatically. Other judges' raw scores and
   the results view are not available to assigned judges.

## Architecture and responsibility

The frontend lives in `src/pages/`. Generouted maps file names to routes;
`(app)` and `(protected)` are layout groups, not URL segments. The static landing
page mounts no auth or record providers. The app layout mounts
`DeepSpaceAuthProvider`, `RecordProvider`, and `RecordScope`. The protected layout
uses `AuthGate`; the dashboard also has an auth gate.

`worker.ts` assembles the Hono routes and `AppRecordRoom`. DeepSpace supplies
verified authentication, Durable Object SQLite record persistence, collection
permissions, WebSocket broadcasts, and synchronized `useQuery` state.
`src/constants.ts` gets the immutable app ID from the build and uses the shared
`app:<appId>` room. Display branding does not change that identity.

ScoreSpace supplies competition business rules: ownership checks, judge
assignments, validation, stable record IDs, immutable score policy, navigation,
and standings calculation. It uses no external integration API. The scaffold
contains other room bindings, but ScoreSpace does not use AI, presence, canvas,
collaborative documents, payments, or messaging.

| Collection | Meaning and access |
| --- | --- |
| `competitions` | Name; organizer is server-assigned `createdBy`. Owner or assigned team member can read. Members/admins can create; direct updates/deletes denied. |
| `competitors` | Name and immutable competition reference. Team-readable; only the authorized server action writes. |
| `team_members` | Judge assignment: `teamId` = competition ID, `UserId` = existing DeepSpace identity, `status` = active. Organizer-readable; only `addJudge` writes. |
| `scores` | Competitor/competition references and immutable value. `createdBy` identifies the judge; server-derived `organizerAccess` grants the organizer access to other judges' scores. Only `submitScore` writes. |

`useUsers()` supplies the existing roster for the picker. The UI uses names and
IDs, not emails or a globally readable full-users query. Existing SDK admin
roster privileges are unchanged. Competition organizer is a per-record business
role, distinct from the app-wide DeepSpace admin role.

## Authorization and duplicates

Collection permissions apply to queries, record gets, and broadcasts. Frontend
filters and redirects are only presentation. An unrelated user receives no
competition record, even with a guessed ID.

`src/server/action-routes.ts` verifies bearer authentication before dispatching
only explicitly registered actions. Action tools bypass collection RBAC, so:

- `addCompetitor` and `addJudge` load the competition and compare its `createdBy`
  with the verified caller before writing.
- `addJudge` validates the target's existing app-user record/role. Its primary
  key encodes the competition/user tuple, making repeated assignments idempotent.
- `submitScore` checks the competitor's parent, owner or persisted assignment,
  and finite numeric range. Caller identity and primary key never come from
  browser-supplied judge/record IDs.
- A score ID encodes `[verifiedUserId, competitorId]`. DeepSpace creation with
  an explicit ID is an upsert. Immutable fields allow identical retries but
  reject a different value, including concurrent submissions. A read-before-write
  duplicate check is not the concurrency boundary.
- Raw scores use collaborator permissions: author plus organizer. Owner-authored
  scores need no extra access list, preserving compatibility with older records.

DeepSpace 0.33.1 compatibility details are intentional: membership refresh reads
capitalized `UserId`; team SQL maps it to `col_userid`. A computed, read-only
competition ID (`_row_id`) makes parent team access work in both SQL queries and
broadcast checks without storing a second competition identity. Integration tests
cover both behaviors; recheck them when upgrading the SDK.

## Realtime and standings

Authorizing a judge persists a team record and prompts that user's existing
socket to resubscribe. Their open dashboard then receives the competition.

Score submission follows:

`verified action → authorization/validation → RecordRoom persistence → permitted
broadcast → useQuery changes → deriveStandings → React renders`

UI success waits for server acceptance. Record lists come from synchronized
queries, not an optimistic duplicate list, polling, or a persisted leaderboard.
The judging query selects the current author's scores, including when that author
is also an organizer who is permitted to read others' scores.

`src/lib/standings.ts` groups scores by competitor, sorts values for deterministic
addition order, and calculates sum/count. Ranking uses unrounded JavaScript
numbers; exact equal values rank `1, 1, 3`. Unscored entries follow scored ones.
Integers display one decimal; other numbers retain their numeric representation.
Binary floating-point can produce long fractions or tiny differences between
mathematically equivalent decimal calculations; there is no decimal rounding rule.

## Local development

Use a Node version supported by `package.json` (for example Node 24) and npm 11.6+.

```sh
npm ci
npx deepspace auth whoami --json
# Only if signed out:
npx deepspace auth login
npm run dev
```

Open the local URL printed by the CLI. CLI developer login and browser user
sign-in are separate. `wrangler.toml` supplies the app identity and Durable Object
bindings. Do not replace the app ID or create another production configuration.

`.dev.vars` is a generated local cache, not a production configuration file.
It and `dist/` are ignored; never commit them. Manage secrets through
`npx deepspace secrets`, not source code. ScoreSpace requires no third-party keys.
DeepSpace supplies platform authentication/service bindings during deployment.

## Checks and manual verification

```sh
npm run type-check
npm run lint
npm run test:unit
npm run build
npx deepspace test run all --port 5187
git diff --check
```

Unit/integration tests include real installed RecordRoom + in-memory SQLite
permission, broadcast, and concurrency checks. Cloudflare sockets and platform
membership lookup are adapted/mocked; these are not full production-auth tests.
HTTP dispatcher tests use fake credentials and verify own-property dispatch.

Authenticated browser specs require configured DeepSpace test accounts. The
runner reports skips when none are available; skipped tests are not verification.
Inspect `npx deepspace test accounts --help` to configure accounts without putting
passwords in source or command arguments.

Manual two-user checklist (separate browser profiles):

- A creates a competition and competitor. B cannot open its detail/judging URLs.
- B leaves the dashboard open. A adds B as judge; B sees the competition without
  refresh and its link opens judging directly.
- B manually opens the detail URL: it redirects to judging. Back returns to the
  dashboard. B has no management controls and cannot open results.
- A submits 8, then leaves results open. B still has their own empty score form.
  B submits 9.5; A sees average 8.75 and count 2 without refresh.
- Reload: each judging page shows only that user's accepted score, with no editing
  form. Results persist. Use a third unrelated user to repeat privacy checks.
- Repeat at a narrow viewport and check keyboard access to forms/navigation.

## Deployment

`npx deepspace app source --json` reports the source authority;
`npx deepspace status --json` reports inference before the first release. This
checkout already has a GitHub origin, so the first deployment infers GitHub
source permanently. Preserve that existing remote. Under GitHub source,
`npx deepspace deploy` ships the current checkout (including uncommitted files);
it does not commit or push GitHub changes. Review the working tree before release
and commit/push separately using ordinary Git when ready.

For a separate checkout already using DeepSpace source, deploy instead requires
a clean committed branch. Do not switch source authorities or create another
app to work around a refusal. Production secrets come from the platform store,
not `.dev.vars`.

A successful deploy is not proof of signed-in behavior. Check the returned live
URL, static landing, dashboard sign-in, protected direct URLs, and the two-user
checklist above. Inspect `npx deepspace releases` and `npx deepspace logs` for
release/runtime evidence. Do not submit the exercise automatically.

## Limits and interview map

This is a small exercise: no invitations, judge removal, ownership transfer,
score editing/deletion, rounds, criteria, public results, or result finalization.
Adding revocation/transfer requires revisiting membership changes and score ACLs.
No large-competition pagination/scale guarantee is provided. Existing records
are not copied from local development into production by deploying code.

Highest-value files to understand:

- `src/schemas/`: owner metadata, team access, and private raw-score permissions.
- `src/actions/add-judge.ts`: owner check, target verification, stable assignment ID.
- `src/actions/submit-score.ts`: parent/assignment validation and immutable upsert.
- `src/server/action-routes.ts`: verified identity and privileged tool boundary.
- `src/lib/standings.ts`: pure averages, counts, deterministic ties.
- `src/lib/competition-navigation.ts` and competition pages: role-aware
  destinations after permission-filtered reads; routing never grants access.
- `src/pages/(app)/_layout.tsx` and `worker.ts`: providers, room scope, server wiring.

See `SUBMISSION.md` for an editable, explicit account of agent involvement and
personal-verification placeholders.
