# RPMS Project Guide

## 1. What the project does

RPMS is a Research Project Management System prototype. It helps an institute manage research proposals from preparation and review through project funding, milestones, deliverables, documents, notifications, reports, and audit history.

The application keeps its existing HTML, CSS, and vanilla JavaScript interface. A Node.js API handles sign-in and business operations, and MySQL stores the persistent application data. Uploaded document contents are stored in `server/uploads/`; their metadata and project relationships are stored in MySQL.

## 2. Technology and structure

| Part | Technology | Responsibility |
|---|---|---|
| User interface | HTML, CSS, vanilla JavaScript | Login, dashboards, forms, project and milestone pages |
| API server | Node.js built-in HTTP server | Authentication, authorization, validation, uploads, reports, and API responses |
| Business rules | Existing JavaScript service layer | Proposal, project, funding, milestone, deliverable, team, and notification workflows |
| Database | MySQL with `mysql2` | Persistent users, projects, milestones, funding, documents, sessions, notifications, reviews, and audit records |
| File storage | Local `server/uploads/` directory | Uploaded document contents |

The main directories and files are:

- `index.html` — application shell and frontend script/style references.
- `css/styles.css` — existing layout, colors, typography, and responsive styling.
- `js/app.js` — routes, session handling, and screen rendering.
- `js/views.js`, `js/views2.js` — dashboard, proposal, project, funding, and milestone screens.
- `js/services.js` — domain workflows, validation, permissions, state transitions, notifications, and audit events.
- `js/api-client.js` — sends browser operations to the local API.
- `server/index.js` — HTTP API, authentication, authorization, document endpoints, and deadline sweep.
- `server/domain.js` — maps API commands to existing business services.
- `server/repository.js` — loads and saves application records in MySQL.
- `server/schema.sql` — tables, indexes, constraints, and triggers.
- `server/migrate.js` — creates the schema and initializes seed data.
- `test/rpms.test.js` — automated tests.
- `docs/requirements-traceability.md` — SRS requirement mapping, verification notes, and known limitations.

## 3. Run the project on this Mac

Open Terminal and move to the project directory:

```sh
cd /Users/adi/Documents/sd-lab-rpms
```

Start MySQL if it is stopped, install the Node packages, and prepare the database:

```sh
brew services start mysql@8.4
npm install
export RPMS_DB_HOST=127.0.0.1
export RPMS_DB_PORT=3306
export RPMS_DB_NAME=rpms
export RPMS_DB_USER=root
npm run db:migrate
```

If your MySQL `root` account has a password, set it in the same terminal before migrating or starting the app:

```sh
export RPMS_DB_PASSWORD='your-local-mysql-password'
```

Start RPMS:

```sh
npm start
```

Keep that Terminal window open while using the app. Open **http://127.0.0.1:8080** in the browser. Use the server address; opening `index.html` as a `file://` page bypasses the API and cannot sign in to MySQL.

There is no separate frontend build step or `npm run build` script. The Node server serves the HTML, CSS, and JavaScript files directly.

### Start it again later

Start MySQL and RPMS in Terminal:

```sh
cd /Users/adi/Documents/sd-lab-rpms
brew services start mysql@8.4
npm start
```

If the browser reports that port 8080 is already in use, an RPMS server is already running. Use the existing `http://127.0.0.1:8080` page, or stop the earlier server with **Ctrl+C** in the Terminal where it was started before starting another one.

To stop RPMS, press **Ctrl+C** in its Terminal. MySQL runs separately; to stop it as well, run:

```sh
brew services stop mysql@8.4
```

## 4. Demo sign-in accounts

On a newly initialized demo database, each account uses the password `demo123`:

| Role | Email |
|---|---|
| Principal Investigator | `priya.sharma@lnmiit.ac.in` |
| Research Committee Approver | `rajesh.gupta@lnmiit.ac.in` |
| Research Coordinator | `kavita.rao@lnmiit.ac.in` |
| Funding Agency Representative | `dst.rep@serb.gov.in` |
| System Administrator | `admin@lnmiit.ac.in` |
| Institutional Auditor | `auditor@lnmiit.ac.in` |

These credentials are for the local demonstration only. Do not use them in a deployed or production system.

## 5. Main user workflows

### Proposal and project

1. A PI prepares and saves a proposal draft.
2. A PI submits the proposal for committee review. A coordinator may help prepare a draft for a PI.
3. An approver approves or rejects the proposal. Rejections require comments.
4. Approval creates a project awaiting funding confirmation.
5. An authorized funding representative or coordinator records a valid funding allocation. The project becomes Active when funding is confirmed.

### Milestone progress and completion

1. Open a project and select a milestone.
2. While the project is Active, the project PI, a coordinator, or an assigned Contributor can change the milestone between **Not Started** and **In Progress** using **Update status** and **Save status**.
3. For completion, the investigator adds evidence and submits the milestone for review.
4. An approver either marks it **Completed** or requests a revision. A revision returns the milestone to **In Progress**.

The PI can view M3 for **Smart Grid Load Analytics** at `#/milestone/MS-303`. Its sample status remains Not Started until someone saves a change.

### Documents, funding, and notifications

- Documents are uploaded with a category and associated with a proposal, project, or milestone. The server keeps previous versions when a matching document name is uploaded again.
- Funding allocations, disbursements, and utilization are tracked separately so project totals and alerts can be calculated.
- Notifications are available in the application. Deadline checks run when the server starts and refresh during active sessions, with a scheduled hourly sweep while the server remains running.

## 6. Test and database commands

Run the automated test suite:

```sh
npm test
```

Prepare or update the MySQL schema and seed data:

```sh
npm run db:migrate
```

The migration is idempotent for the current schema. Seed demo data is initialized when the database does not already contain users. It does not import data from an older browser `localStorage` copy.

## 7. Operational notes

- Keep the MySQL database and `server/uploads/` backed up together so document records and file contents stay aligned.
- Local development defaults to a MySQL account named `root` with no password. Configure `RPMS_DB_USER` and `RPMS_DB_PASSWORD` to match your MySQL installation when needed.
- For deployment, configure a dedicated MySQL user, a random `RPMS_JWT_SECRET` of at least 32 characters, HTTPS, and database TLS where supported. Do not deploy demo credentials.
- Email delivery is not configured. Password recovery is a local prototype flow that returns a reset link rather than emailing it.
- The repository currently saves a serialized application state under a database write lock. It is suitable for this prototype; high-volume deployment needs targeted queries and load testing.
- Browser compatibility, availability targets, mobile behavior, full role-by-role integration, and document upload/download failure paths still need broader release testing. See `docs/requirements-traceability.md` for requirement-level status.
