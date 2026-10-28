# RPMS — Research Project Management System

The existing vanilla JavaScript application now runs against a Node.js API and MySQL. The current page layout and styling are retained. MySQL is the durable source of record for accounts, proposals, projects, team access, milestones, deliverables, funding, documents, notifications, reviews and audit history.

## Run locally

Requirements: Node.js 20 or later and MySQL 8.0.16 or later. The MySQL account needs permission to create the database, tables and triggers during the first migration. On this development Mac, MySQL 8.4 is installed through Homebrew; start it with the service command below.

```sh
npm install
brew services start mysql@8.4
export RPMS_DB_HOST=127.0.0.1
export RPMS_DB_PORT=3306
export RPMS_DB_NAME=rpms
export RPMS_DB_USER=root
npm run db:migrate
npm start
```

If your local MySQL root account has a password, set `RPMS_DB_PASSWORD` before migration and startup. Homebrew may keep the service running after login; run the service command again if MySQL is stopped.

Open <http://127.0.0.1:8080>. The server also applies the idempotent schema and seeds demonstration accounts on first startup if the database has no users. All six demonstration accounts use `demo123` on a newly seeded database. Uploaded files are stored in `server/uploads/`; keep that folder with the database backups.

For production, set `NODE_ENV=production`, use a dedicated MySQL account and password, set `RPMS_JWT_SECRET` to at least 32 random characters, and serve the app behind HTTPS. Enable database TLS with `RPMS_DB_SSL=1` when supported by the MySQL endpoint. The server binds to `127.0.0.1` by default. Do not use the demonstration accounts in production.

## Existing demo accounts

| Role | Email |
|---|---|
| Principal Investigator | `priya.sharma@lnmiit.ac.in` |
| Research Committee Approver | `rajesh.gupta@lnmiit.ac.in` |
| Research Coordinator | `kavita.rao@lnmiit.ac.in` |
| Funding Agency Representative | `dst.rep@serb.gov.in` |
| System Administrator | `admin@lnmiit.ac.in` |
| Institutional Auditor | `auditor@lnmiit.ac.in` |

## What is implemented

- Server-backed login, logout, registration, role checks, 30-minute sliding sessions, hashed password storage and single-use password reset tokens.
- PI proposal drafts and submissions, plus coordinator-assisted draft preparation; source selection, custom “Other” funding, supporting file uploads, and a dated milestone plan that becomes the project plan after approval.
- PI-managed project membership with View Only and Contributor access, and a designated PI retained on each project.
- Milestone status and evidence submissions, approver decisions, deliverables, deadline notifications and project lifecycle changes.
- Multiple project funding sources with separate authorization caps and sanction totals, disbursements, utilization entries, balance summaries and budget alerts.
- Project and proposal document upload, category, version history and permission-checked download. Uploaded file contents live on the server filesystem; their metadata and associations live in MySQL.
- Role-filtered notifications, project/funding reports, CSV export and append-only review and audit records.
- MySQL schema and seed migration in `server/schema.sql`, persistence mapping in `server/repository.js`, API and request authorization in `server/index.js`, and domain operations reused from `js/services.js`.

## Tests and traceability

Run `npm test` for the available automated checks. The complete requirement mapping, implementation locations, verification status and known limitations are in [`docs/requirements-traceability.md`](docs/requirements-traceability.md).

For the full setup walkthrough, architecture overview, demo accounts and user workflows, see [`docs/project-explanation.md`](docs/project-explanation.md).

## Current limitations

- Local MySQL 8.4 is installed; schema migration and the PI login/session/project/milestone reads have been verified against it. Start MySQL with `brew services start mysql@8.4` before using the app. The full feature set, document upload/download path, permission matrix, failure rollback and load behavior still need broader integration tests.
- Records stored in an older browser's local storage are not automatically imported into MySQL.
- SMTP delivery is a “Could Have” in the SRS and is not configured. In-app notifications work; the prototype password recovery flow returns a reset link to the requester instead of emailing it.
- External funding authority is recorded by an authorized RPMS coordinator or funding representative; there is no external agency verification integration or payment gateway.
- The current repository adapter loads and writes the application state inside a serialized transaction. That keeps this prototype consistent but needs targeted database queries before a high-volume deployment.
- Availability targets, browser matrix coverage and mobile layout behavior need deployment-level verification.
