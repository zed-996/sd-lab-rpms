# RPMS SRS implementation and verification traceability

**Source baseline:** `T081.pdf` (SRS v1.0 and its later design, workflow, interface and implementation sections), plus the user's pasted implementation request. The PDF is the requirements source; the pasted request adds explicit prototype extensions for PI-managed View Only/Contributor access, funding-source selection separate from funding confirmation, and coordinator milestone completion submissions.

## Verification key and current environment

- **Service test** means behavior was exercised by the local Node test suite against the application's existing domain services.
- **Code reviewed** means an implementation path exists and was inspected, but there is no dedicated automated assertion for that exact requirement.
- **Live DB verified** means a real MySQL request path was exercised in this local environment. **Pending DB** means that specific feature still needs direct database integration coverage.
- MySQL 8.4.13 is installed; `npm run db:migrate` completed; `/api/health` returned MySQL storage; Priya's login/session and project/milestone reads succeeded. A deadline sweep followed by a state write also succeeded after correcting MySQL date conversion. The milestone status control was verified in the browser as Priya, but the sample M3 status was left unchanged. The MySQL service can be started with `brew services start mysql@8.4`.
- No automated browser or load test was run. Run `npm test` for automated checks. The limited live integration results above do not verify every DB-backed requirement. Unversioned HTML, CSS and JavaScript are served without browser caching so the local app does not keep stale UI behavior after code updates.

## Implementation map

| Area | Location |
|---|---|
| Existing UI, navigation, form and detail screens | `index.html`, `js/app.js`, `js/views.js`, `js/views2.js`, `js/ui.js`, `css/styles.css` |
| Business rules, transitions, validation, notifications and audit events | `js/services.js` |
| MySQL-backed browser API adapter and server mode | `js/api-client.js`, `js/runtime-mode.js`, `js/store.js` |
| REST endpoints, authentication, authorization, file handling, reports and scheduled deadline sweep | `server/index.js`, `server/security.js`, `server/domain.js` |
| Schema, migration, SQL mapping and demo seed | `server/schema.sql`, `server/migrate.js`, `server/repository.js`, `server/database.js` |
| Verification | `test/rpms.test.js`, `package.json` |
| Setup and operational limitations | `README.md` |

## Functional requirements (FR)

| ID | Implementation and verification status |
|---|---|
| FR-001 User login | `server/index.js` verifies salted scrypt password hashes, checks active account state and issues a JWT backed by a stored session. `server/security.js`; hash/JWT unit tests pass; Priya's browser login/session was verified against MySQL. **Live DB verified for PI login; full role/session matrix pending.** |
| FR-002 Authentication failure | Login returns one generic invalid-credentials message; it does not disclose whether the account or password was wrong. `server/index.js`. **Code reviewed; DB integration pending.** |
| FR-003 Logout | Logout revokes the stored session and records an audit event. `server/index.js`. **Code reviewed; DB integration pending.** |
| FR-004 Role-based access | Role checks are applied by domain services and API handlers; administrators can create users, change roles and deactivate accounts. `js/services.js`, `server/index.js`, `server/schema.sql`. Registration persists the user row before creating its FK-backed session in the same transaction; unit regression and isolated MySQL registration/session smoke tests pass. Restart an existing server process to load the fix. |
| FR-005 Create proposal | PI may create their own draft; a Research Coordinator may prepare one for an active PI through Proposal Drafts, while only the PI can submit it. `js/views.js`, `js/views2.js`, `js/services.js`, `js/api-client.js`; coordinator/PI authorization tests and API draft-ID-to-submit regression test pass. |
| FR-006 Proposal information | Form and persistence cover title, abstract, domain, dates, PI/investigator details, budget, funding source/custom Other, milestone plan, expected deliverables and uploaded supporting documents. `js/views.js`, `server/repository.js`, `server/index.js`. **Code reviewed; SQL/file integration pending.** |
| FR-007 Save draft | PI-owned draft editing and Coordinator assistance for Drafts are implemented; identity/status fields are allowlisted. `js/services.js`, `js/views2.js`, `js/api-client.js`, `server/repository.js`; PI protection, coordinator assignment, and API save/submit ID flow tests pass. |
| FR-008 Submit proposal | Submission validates mandatory data and dates, sets Under Review and timestamp, records audit, and notifies approvers. `js/services.js`; approval-flow service test exercises setup. **DB/API integration pending.** |
| FR-009 Approve proposal | Approver or administrator can decide only an Under Review proposal; review decision and approver are persisted append-only. Project begins Pending Funding. `js/services.js`, `server/repository.js`; service test covers approval. **DB integration pending.** |
| FR-010 Reject proposal | Rejection requires comments; PI receives a linked notification and review history is retained. `js/services.js`, `server/repository.js`. **Code reviewed; dedicated rejection test and DB integration pending.** |
| FR-011 Activate project | Proposal approval alone does not activate. A separate valid funding allocation moves Pending Funding to Active; activation is audited. `js/services.js`; service test verifies no activation before funding and activation after allocation. **DB integration pending.** |
| FR-012 Withdraw proposal | Owning PI may withdraw Under Review proposal before decision; other states/actors are rejected. `js/services.js`. **Code reviewed; DB integration pending.** |
| FR-013 Project listing/search | Existing project listing includes authorized projects and search fields for title, PI, domain, status and date. `js/views2.js`. **Code reviewed; browser verification pending.** |
| FR-014 Project filtering | Project filters include relevant status, domain, funding source and date fields. `js/views2.js`. **Code reviewed; browser verification pending.** |
| FR-015 Project details/status | Project detail shows PI, timeline, domain, proposal link when authorized, funding, milestones, deliverables and documents; lifecycle changes are server-validated. `js/views2.js`, `js/services.js`. **Code reviewed; API/DB integration pending.** |
| FR-016 Define milestone | Approved milestones are created from the submitted dated proposal plan and expected deliverables; proposal validation checks target dates. `js/services.js`. The submitted plan is immutable after approval by explicit user instruction. **Partial against the broad SRS wording that allows PI/coordinator to define milestones later; see decisions below.** |
| FR-017 Update milestone status | PI/coordinator or assigned Contributor may move a milestone between Not Started and In Progress; overdue is calculated, and completion requires review. On Hold/Completed projects block changes. `js/services.js`, `js/views2.js`; service transition test and Priya's browser control/authorization path verified. The live sample M3 was not modified. |
| FR-018 Submit completion | PI and, by explicit extension, Research Coordinator can submit only an In Progress milestone on an Active project with uploaded evidence. `js/services.js`, `server/index.js`, `js/api-client.js`; service test rejects missing evidence and accepts attached evidence. **Real file/DB path pending.** |
| FR-019 Review completion | Approver may approve to Completed or request revision with mandatory comments, returning it to In Progress. Decisions are recorded and PI notified. `js/services.js`, `js/views2.js`. **Code reviewed; dedicated revision test and DB integration pending.** |
| FR-020 Record deliverable | Milestone detail exposes add/update actions for PI/coordinator/Contributor; dates/status and completed-date validation are enforced. `js/services.js`, `js/views2.js`, `server/schema.sql`. **Code reviewed; DB integration pending.** |
| FR-021 View milestones/deliverables | Authorized project and milestone pages show milestone definition, status, expected/recorded deliverables, evidence and review outcome. `js/views2.js`; project and milestone pages verified in browser against MySQL as Priya. **Other roles and evidence uploads still pending.** |
| FR-022 Record allocation | Authorized coordinator/funding role records source authorization cap separately from each sanctioned amount and schedule; source-level caps and multiple records are supported. `js/services.js`, `js/views2.js`, `server/schema.sql`; multiple source/cap service test passes. **DB integration pending.** |
| FR-023 Record utilization | Coordinator records a source-linked category, description, positive amount and valid date; requires an allocation. `js/services.js`, `server/schema.sql`; successful source-linked utilization service test passes. **DB integration pending.** |
| FR-024 Funding summary | UI and report show proposed, authorized/sanctioned, disbursed/received, utilized and remaining values separately. `js/views2.js`, `js/services.js`, `server/repository.js`. **Code reviewed; SQL integration pending.** |
| FR-025 Budget alert | Utilization at or above 80% creates deduplicated approaching/over-budget notifications; page shows utilization. `js/services.js`, `js/ui.js`. **Code reviewed; dedicated threshold test and DB integration pending.** |
| FR-026 Upload/categorize documents | Authenticated upload stores binary content under `server/uploads/`, metadata and category in MySQL, and links to proposal/project/milestone. Type, size, association and role are checked. `server/index.js`, `js/api-client.js`. **Multipart parser unit test passes; file/DB integration pending.** |
| FR-027 View/download documents | Download endpoint requires a valid session and visible project/proposal association; View Only members may view permitted project documents. `server/index.js`. **Code reviewed; download authorization against MySQL pending.** |
| FR-028 Document versioning | Matching filenames within their parent project/proposal receive an incremented version; previous rows/files are retained. `server/index.js`, `server/schema.sql`. **Code reviewed; persistence pending DB.** |
| FR-029 Proposal notifications | Submission, approval, rejection and revision create linked in-app notifications for committee/PI as applicable. `js/services.js`; proposal approval path is exercised. **DB integration pending; no email delivery.** |
| FR-030 Deadline/review notifications | Approvers are notified on new completion submissions; investigators/coordinators receive deduplicated due/overdue alerts. Startup schedules an hourly sweep and sessions also refresh alerts. `js/services.js`, `server/index.js`; deadline dedupe/recipient test passes. **Live scheduler pending DB/runtime.** |
| FR-031 Project/funding notifications | Project status changes and funding allocations/disbursements notify PI, team, coordinators and acting user with linked project. `js/services.js`. **Code reviewed; dedicated notification test and DB integration pending.** |
| FR-032 Reports | Role-guarded report and CSV export include project/status/timeline, milestone and deliverable completion, funding source/sanction/disbursement/utilization/balance. `server/index.js`, `js/views2.js`; role guard/CSV escaping test passes. **DB integration pending.** |
| FR-033 Dashboards | Existing PI dashboard and admin system summary remain; role-appropriate menu/report entries are exposed. `js/views.js`, `js/app.js`; PI dashboard manually verified against MySQL. **Admin view and other role dashboards still pending.** |

## Business rules (BR)

| ID | Implementation and verification status |
|---|---|
| BR-001 Authenticated/authorized investigator creates/submits | Active PI owns/submits; Coordinator may prepare a draft for a selected active PI; only owning PI submits. Other system roles are rejected. `server/index.js`, `server/domain.js`, `js/services.js`; role/ownership tests pass. **API integration pending.** |
| BR-002 Required details before submission | `ProposalService.validate` checks mandatory content, budget, dates, custom Other and milestone plan. `js/services.js`. **Code reviewed; negative submission test pending.** |
| BR-003 At least one investigator | Project always has its designated PI; soft-revoked team members do not replace/remove it. `js/services.js`, `server/repository.js`; service test covers shared access. **DB constraint/integration pending.** |
| BR-004 Designated PI | Project PI is copied from the approved proposal, persisted as owner membership and cannot be removed by team management. `js/services.js`, `server/repository.js`. **Code reviewed; DB integration pending.** |
| BR-005 Authorized reviewer/admin decides | `ProposalService.decide` allows Approver/Admin; API actor comes from validated session. `js/services.js`, `server/index.js`. **Code reviewed; API integration pending.** |
| BR-006 Rejection reason | Reject decision requires non-empty comments. `js/services.js`. **Code reviewed; dedicated negative test pending.** |
| BR-007 Active only after approved proposal | Allocation requires approved proposal; approval creates Pending Funding; first allocation activates. Service test passes. **DB integration pending.** |
| BR-008 Project start and completion dates | Proposal requires both dates; DB project columns are non-null. `js/services.js`, `server/schema.sql`. **Code reviewed; DB integration pending.** |
| BR-009 End after start | Exact ISO date validation and SQL CHECK. `js/services.js`, `server/schema.sql`. **Code reviewed; DB integration pending.** |
| BR-010 Funding linked to valid source; multiple permitted | Funding catalog and FK; allocation uses valid option or explicit custom Other. `server/repository.js`, `server/schema.sql`, `js/services.js`; multiple source path test passes. **DB constraint pending.** |
| BR-011 Approved funding within authorization | Allocation captures the source's authorized cap separately and rejects aggregate sanctions above it; SQL CHECK prevents approved > authorized and received > approved. `js/services.js`, `js/views2.js`, `server/schema.sql`; cap test passes. **DB constraint pending.** |
| BR-012 Milestone date not before project start | Proposal milestone plan is validated against proposed start; deliverable target dates also checked. `js/services.js`. **Code reviewed; date-edge test pending.** |
| BR-013 Completion requires information | Evidence upload and remarks/submission state required before review; approver sets completion date. `js/services.js`; missing-evidence service test passes. **File/DB integration pending.** |
| BR-014 Deliverable has valid project/milestone | Milestones and deliverables carry project/milestone IDs with SQL foreign keys. `js/services.js`, `server/schema.sql`. **DB integration pending.** |
| BR-015 Completed deliverable has date | Deliverable update validation requires valid submission date when status is Completed. `js/services.js`. **Code reviewed; dedicated negative test pending.** |
| BR-016 Project documents restricted | Backend permits project PI, assigned Contributors and Admin; proposal documents require owning PI or Admin. `server/index.js`; upload authorization is server-side. **API integration pending.** |
| BR-017 Uploader/time retained | Document rows include uploader and upload timestamp; stored files are linked by server-generated reference. `server/schema.sql`, `server/index.js`. **DB/file integration pending.** |
| BR-018 Completed project history retained | Projects and children are retained; completion transitions do not delete records. `server/schema.sql`, `js/services.js`. **DB integration pending.** |
| BR-019 Only admin changes roles/deactivates | Admin service checks system administrator role; account changes audited. `js/services.js`, `server/index.js`. **Code reviewed; DB integration pending.** |
| BR-020 Deactivated user blocked; records retained | Session authentication checks active flag; deactivation revokes sessions; records use retained user rows. `server/index.js`, `server/schema.sql`. **Code reviewed; DB integration pending.** |
| BR-021 Lifecycle transitions cannot skip stages | Proposal Draft → Under Review → Approved/Rejected; project Approved → Pending Funding → Active; active/hold/complete/terminate transitions are constrained. `js/services.js`. **Service approval path tested; other edges pending.** |
| BR-022 Only authorized roles change project status | PI owner, coordinator or Admin status handler; View Only is blocked; transition reason required where appropriate. `js/services.js`, `server/index.js`. **Code reviewed; API integration pending.** |
| BR-023 Important actions audited | Proposal/review, funding, status, role/account, membership and document actions create audit records; SQL triggers make audit/review rows append-only. `js/services.js`, `server/index.js`, `server/schema.sql`. **Trigger behavior pending MySQL.** |
| BR-024 Record access follows role and membership | Server filters state, checks API commands and document downloads; View Only DTO omits financial information and service tests reject mutation. `server/index.js`, `js/services.js`; View Only test passes. **API integration pending.** |

## Non-functional requirements (NFR)

| ID | Implementation and verification status |
|---|---|
| NFR-001 Normal response time | **Unverified.** Full-state reads/writes under one advisory lock may be slow with larger datasets; no performance test. |
| NFR-002 Common updates/uploads without noticeable delay | **Unverified / risk.** Upload cap and persistence path exist, but DB/file path cannot run here; existing UI adapter uses synchronous XHR for JSON operations. |
| NFR-003 Expected concurrency | **Partial.** MySQL pool and serialized write lock protect consistency; no concurrency/load test, and a global lock limits throughput. |
| NFR-004 Authentication required | API routes except health require validated user/session; document and report routes also authenticate. `server/index.js`. **Code reviewed; API integration pending.** |
| NFR-005 Passwords hashed | Server uses salted scrypt, stores only hash and uses timing-safe comparison; hashes are stripped from user DTOs. Password-hash test passes. |
| NFR-006 Server-side role control | Actor resolved from JWT and DB session; domain operations enforce roles. `server/index.js`, `js/services.js`. **Service/API integration pending.** |
| NFR-007 Authorized record scope | Project visibility, proposal access, filtered state and file download checks implemented; View Only behavior test passes. **API integration pending.** |
| NFR-008 Session expiry | Stored JWT-backed session expires after 30 minutes and `/auth/session` refreshes expiry. `server/security.js`, `server/index.js`; token expiry unit test passes. **DB session integration pending.** |
| NFR-009 Consistent interface | Existing navigation, CSS and components retained; only Reports and missing controls were added. `js/app.js`, `js/views*.js`, `css/styles.css`. **No browser visual regression test.** |
| NFR-010 Clear errors | Domain validation returns actionable messages; API translates common failures to 4xx responses. `js/services.js`, `server/index.js`. **Code reviewed.** |
| NFR-011 Minimal interaction | Existing page flows reused. **Partially verified:** current synchronous XHR can block the page during server calls; no browser usability test. |
| NFR-012 Reliable record retention | MySQL InnoDB schema, transaction-backed writes and filesystem document storage implemented. **Pending live MySQL/file integration and backup test.** |
| NFR-013 Failed operation consistency | Writes are transactional; uploaded files are removed when metadata persistence fails. `server/index.js`. **Code reviewed; failure injection not run.** |
| NFR-014 Historical information preserved | Soft removal of project membership, retained user rows, project status history, reviews, audit and document versions. `server/schema.sql`, `server/repository.js`. **DB integration pending.** |
| NFR-015 Availability during institute hours | **Deployment limitation.** No hosted service or uptime monitoring/maintenance configuration in the checkout. |
| NFR-016 Modular architecture | Existing browser UI/service/store split retained; API, domain, repository, DB and security modules added. **Code reviewed.** |
| NFR-017 Version control | Changes are in the existing Git repository. No commit/remote publication was requested or performed. |
| NFR-018 Documentation alongside changes | `README.md` and this traceability matrix updated. |
| NFR-019 Scale without redesign | Normalized indexed tables exist, but repository loads and serializes a full state snapshot and takes one global write lock. **Partial; optimize before scale, no load test.** |
| NFR-020 Modern browsers | Plain HTML/CSS/JavaScript preserved. **Compatibility matrix not tested.** |
| NFR-021 Desktop/mobile usability | Existing responsive stylesheet preserved. **No viewport/browser test run.** |
| NFR-022 Personal/project privacy | API filters projects, proposals, notifications and documents by role/membership and scopes user contact DTOs; View Only financial details are removed. **Service test passes for View Only privacy; API/DB integration pending.** |
| NFR-023 Sensitive funding privacy | Funding fields hidden from View Only DTO and sensitive fields not included in user DTO. **Service test passes; other role cases/code reviewed.** |
| NFR-024 Actor/time audit | Audit rows store actor, action, target and timestamp; status history and reviews persist separately. `server/schema.sql`, `server/repository.js`. **DB integration pending.** |
| NFR-025 Audit read-only | Audit visible to Admin/Auditor; DB triggers reject update/delete. Trigger execution and read route need MySQL verification. |

## Use cases (UC)

| ID | Use case | Implementation and status |
|---|---|---|
| UC-001 | Login | `server/index.js`, `server/security.js`; password/JWT unit tests pass; DB-backed login pending. |
| UC-002 | Manage users and roles | Admin user/role/active services and Users page; code reviewed, DB integration pending. |
| UC-003 | Create/save proposal draft | Existing PI editor plus coordinator Proposal Drafts assistance; PI/Coordinator draft tests pass and PI submission remains enforced. |
| UC-004 | Submit proposal | Required-field/date validation, Under Review timestamp, audit and committee notifications; API draft-ID-to-submit regression test passes; DB integration pending. |
| UC-005 | Approve/reject proposal | Approver/Admin queue and reason-required decisions; approval path and funding deferral service test pass; reject/revision DB path pending. |
| UC-006 | Withdraw proposal | Owning PI may withdraw only Under Review; code reviewed, dedicated test pending. |
| UC-007 | Browse/search/filter projects | Existing project list/filter screen, API sends authorized rows; browser behavior not tested. |
| UC-008 | View project details/status | Permission-checked detail route and lifecycle controls; code reviewed, API integration pending. |
| UC-009 | Define milestone | Approved dated milestone plan copied from proposal. Post-approval plan editing intentionally disallowed by user instruction; see decision. |
| UC-010 | Update milestone status | PI/coordinator/Contributor actions, overdue derived, completion protected by review; service path reviewed. |
| UC-011 | Submit milestone completion | PI plus explicit Coordinator extension; evidence required. Missing evidence and service completion path tests pass; real file flow pending. |
| UC-012 | Approve milestone completion | Approver-only approve/revision actions, comments on revision, linked history/notification; code reviewed, integration pending. |
| UC-013 | Record funding allocation | Coordinator/Funding role and source-linked schedule; multiple-source service test passes; MySQL pending. |
| UC-014 | Record fund utilization | Coordinator role, source link, positive/date/category/description checks, balance and threshold alert; valid-path service test passes. |
| UC-015 | Upload/categorize document | Existing proposal/project upload forms call protected upload endpoint; multipart parser test passes; file/DB integration pending. |
| UC-016 | Document version tracking | Same-parent filename version count and historical rows; code reviewed, DB integration pending. |
| UC-017 | Send notifications | In-app notifications stored and recipient-filtered; deadline de-duplication test passes; scheduler runtime pending. |
| UC-018 | View funding summary | Funding role can access project financial summary and report; code reviewed, DB integration pending. |
| UC-019 | Audit project/funding records | Auditor is read-only, may view authorized project/funding/report/audit records; code reviewed, authorization integration pending. |
| UC-020 | Reports and dashboards | Reports page and CSV for authorized office roles; report guard/CSV escaping test passes; DB integration pending. |

## User stories (US)

| ID | Story intent | Implementation and status |
|---|---|---|
| US-001 | PI securely logs in | Satisfied in server design; DB login integration pending. |
| US-002 | PI saves draft | Satisfied by PI-owned draft API; domain authorization test passes. |
| US-003 | PI submits proposal | Satisfied by validated workflow and notifications; DB integration pending. |
| US-004 | PI views proposal status | Proposal dashboard/read page; code reviewed, browser test pending. |
| US-005 | PI withdraws before decision | Service supports Under Review withdrawal; dedicated test pending. |
| US-006 | Coordinator records utilization | Source-linked utilization and balance; valid path test passes. |
| US-007 | Coordinator generates funding reports | Reports UI/API/CSV role guard; service-level report test passes. |
| US-008 | Approver reviews proposal with feedback | Queue/decision comments and audit; code reviewed, reject test pending. |
| US-009 | Approver reviews milestone completion | Evidence, approval/revision, comments and status transition; main service path tested. |
| US-010 | Admin manages roles | Users page/API plus audit; code reviewed, DB integration pending. |
| US-011 | Funding representative tracks milestones | Role can see project progress/report; code reviewed, browser/API integration pending. |
| US-012 | Auditor reads audit log | Read-only audit UI and server filtering; code reviewed, DB integration pending. |
| US-013 | PI receives deadline alerts | Hourly server sweep and session refresh, linked in-app alert; dedupe/recipient test passes; live scheduler pending. |
| US-014 | PI uploads/manages documents | Existing repository UI, upload/download/version paths; parser test passes, live file/DB flow pending. |

## Acceptance criteria (AC)

| ID | Result and evidence |
|---|---|
| AC-01 authenticated PI submission | Server session/PI checks; **code reviewed, DB API integration pending.** |
| AC-02 proposal in Draft | Submit service checks Draft; **code reviewed.** |
| AC-03 mandatory proposal fields | `ProposalService.validate`; **code reviewed, negative submit test pending.** |
| AC-04 status becomes Under Review | Submit service transition; **code reviewed, DB integration pending.** |
| AC-05 submission timestamp recorded | Service and proposal column; **code reviewed, DB integration pending.** |
| AC-06 committee notification | Approver notification on submit; **code reviewed, DB integration pending.** |
| AC-07 investigator confirmation | PI notification on decision; submission UI provides result feedback; **code reviewed.** |
| AC-08 authorized approver | Session actor plus Approver/Admin check; **code reviewed, API integration pending.** |
| AC-09 proposal Under Review | Decision service checks state and returns conflict otherwise; **code reviewed.** |
| AC-10 complete proposal visible | Review screen shows proposal and documents; **code reviewed, browser/file integration pending.** |
| AC-11 approval sets Approved | Approval service and test fixture exercise transition; **service path tested, DB pending.** |
| AC-12 rejection reason required | Reject path requires comments; **code reviewed, negative test pending.** |
| AC-13 PI receives decision notice | Approval/rejection/revision notifications; **code reviewed, DB pending.** |
| AC-14 decision actor/time | Append-only review record stores reviewer/decision/comments/time; **DB pending.** |
| AC-15 authorized milestone approver | Approver role/project check; **code reviewed, API pending.** |
| AC-16 milestone Submitted for Review | Decision path checks state; **code reviewed.** |
| AC-17 evidence attached | Missing evidence rejected; test passes at service boundary. **Actual file-to-DB path pending.** |
| AC-18 approver sees details/deliverables | Milestone review page renders them; **code reviewed, browser test pending.** |
| AC-19 approval sets Completed | Service test passes. **DB integration pending.** |
| AC-20 revision returns In Progress with comments | Service implements transition and required comment; **code reviewed, dedicated test pending.** |
| AC-21 authorized Coordinator | Utilization service checks coordinator; **valid path tested, unauthorized case pending.** |
| AC-22 recorded allocation required | Service rejects absent/zero sanctioned record; **code reviewed, negative test pending.** |
| AC-23 required utilization fields | Positive amount, category, description, valid date checks; **code reviewed, partial valid path tested.** |
| AC-24 remaining balance updates | Funding totals recomputed; service test verifies utilization row/source, not SQL balance persistence. **DB pending.** |
| AC-25 threshold alert | 80%/100% notification logic exists; **code reviewed, threshold test pending.** |
| AC-26 project/source linkage | Service test verifies funding ID and source on utilization entry. **DB integration pending.** |

## Data and design specifications

| PDF entity/type | Implementation mapping | Status |
|---|---|---|
| User | `users`, `server/repository.js`; role, active flag, password hash, registration and last login | Migration/seed and Priya's stored login/session verified; account lifecycle and full role matrix pending. |
| Investigator Profile | `investigator_profiles`; department/contact/research interests | Schema/mapping present; MySQL unverified. |
| Research Project | `projects`; PI, dates, lifecycle, actual completion and details | Priya's owned project read through MySQL; lifecycle writes and negative cases pending. |
| Project Investigator | `project_investigators`; project role, access, assigned/removed timestamps and active flag | Schema/mapping present; service-level View Only path tested; MySQL unverified. |
| Project Proposal | `proposals`; PI, version, objectives/methodology/outcomes, submission/review data | Existing approved proposal read through the project page; new proposal persistence/review path pending. |
| Funding Source | `funding_sources`; catalog/custom funding identities and active flag | Schema/mapping present; MySQL unverified. |
| Project Funding | `project_funding`; proposed/authorized/approved/received amounts, status and schedule details | Seed allocation and project totals read through MySQL; funding write paths pending. |
| Milestone | `milestones`; target/completion, status, submission and review details | M1–M3 read through MySQL; status control verified for Priya; service transitions tested. Live status submission intentionally left unchanged. |
| Deliverable | `deliverables`; project/milestone, dates, status, submitter, remarks | Schema/mapping present; code reviewed; MySQL unverified. |
| Project Document | `project_documents` + filesystem payload; category, version, uploader, time, reference | Existing metadata read through MySQL; upload/download/version persistence pending. |
| Project Status History | `project_status_history`; old/new status, actor, time and reason | Schema/repository mapping present; MySQL unverified. |
| Notification | `notifications`; recipient, type, timestamp, message, read state and link | Priya's notification list and deadline refresh read through MySQL; mutation/delivery cases pending. |
| Audit Log | `audit_logs`; actor/action/target/time/remarks; append-only triggers | Schema/mapping present; SQL trigger behavior unverified. |
| Role (design entity) | `roles` and `users.role_key`; six SRS roles represented | Schema/mapping present; MySQL unverified. |
| Session (design entity) | `sessions`, signed JWT and 30-minute expiry/revocation | Priya's login and refreshed session verified against MySQL; expiry/revocation cases pending. |
| ReviewRecord (design entity) | `review_records`, append-only proposal/milestone review entries | Mapping present; MySQL unverified. |
| ProposalStatus / ProjectStatus / MilestoneStatus | SQL enums plus domain transition validation and derived overdue label | Code reviewed; only approval/milestone service paths partially tested. |
| ValidationResult / service/control classes | Domain service return objects and `server/domain.js` operation routing | Implemented through existing service pattern; code reviewed. |

The schema also includes supporting tables for disbursements, utilization entries, password resets and generated IDs. The migration executed successfully, including table/index/trigger creation. Individual FK, date/amount check, trigger rejection and rollback behavior still need explicit integration tests.

## Other project specifications

| Specification in the project documentation | Implementation mapping and status |
|---|---|
| User class 11.1 — Principal Investigator | PI dashboard, own proposals, project/team controls, milestones/deliverables, documents, funding view, notifications and project detail. `js/views.js`, `js/views2.js`; dashboard/project/milestone path partially verified; remaining PI actions need browser coverage. |
| User class 11.2 — Research Coordinator | Project/milestone progress, utilization, reports, notifications, proposal draft assistance; project document upload when assigned to the project as Contributor. `js/app.js`, `js/views2.js`, `js/services.js`; role paths code reviewed, DB/browser tests pending. |
| User class 11.3 — Research Committee/Approver | Proposal queue/decisions, milestone review/history and linked notifications. `js/views2.js`, `js/services.js`; service approval path tested, browser/API pending. |
| User class 11.4 — System Administrator | User creation/roles/deactivation, audit/activity, reports, notification management and review decisions. `js/views2.js`, `js/services.js`; code reviewed, DB integration pending. |
| User class 11.5 — Funding Agency Representative | Project/milestone and funding read views, allocations, disbursements and reports. `js/views2.js`, `js/services.js`; funding service tests pass, role-scoped API/DB pending. |
| User class 11.6 — Institutional Auditor | Read-only project/funding/report/audit views; mutation services do not grant audit role write access. `js/views2.js`, `js/services.js`, `server/index.js`; code reviewed, DB/API test pending. |
| System context and layered architecture | Preserved web UI and service patterns; added same-origin REST/API, domain operation routing, MySQL repository and file storage. `js/api-client.js`, `server/index.js`, `server/domain.js`, `server/repository.js`. **Core API/DB/login/page integration verified; remaining feature paths pending.** |
| Detailed UC-004 submit-proposal main/alternate flows | Validates mandatory fields, draft state, owner and date; under-review timestamp, notification and UI confirmation. Negative date and happy-path setup tests pass; DB/API pending. |
| Detailed UC-005 approve/reject main/alternate flows | Role/state checks, approval history, mandatory reject comments, pending-funding branch, stale state conflict and notifications. Approval/funding branch and missing-reason tests pass; stale DB concurrency/browser path pending. |
| Detailed UC-011 completion main/alternate flows | Requires Active project, In Progress milestone and evidence; stores evidence, queues for review, blocks Hold/Completed projects. Missing-evidence and review service tests pass; real upload/DB path pending. |
| Scenarios 1–3 and activity diagrams for UC-004/005/011 | The app follows the corresponding validated transitions and error paths. Scenario/activity diagram documents were not modified; no graphical workflow comparison test. |
| UML use-case and class design (Assignments 4–6) | Persistent entities, role enum, sessions, proposal/milestone services, validation results, reviews and audit are represented by MySQL tables plus the existing service layer. No separate UML source files were changed. |
| Class relationships and multiplicity | FKs represent project-to-PI, team, proposal, funding, milestones, deliverables, documents, reviews, notifications, sessions and audit actor relations. `server/schema.sql`; migration ran, individual relationship constraints need behavioral tests. |
| Component interfaces and REST boundary | API commands map to the existing service operations; reports/uploads/downloads/auth have explicit routes. Password hashes are excluded from DTOs. `server/domain.js`, `server/index.js`; API-to-DB integration pending. |
| Interface screen inventory/navigation | Existing login/dashboard/proposal/review/milestone/notifications surfaces retained; Reports and Coordinator Proposal Drafts added where absent. `js/app.js`, `js/views.js`, `js/views2.js`; PI login/dashboard/project/milestone screens manually verified. Full screen and viewport matrix remains untested. |
| Error handling and recovery table | Common invalid/unauthorized/conflict cases return 4xx errors; writes use transactions and failed uploads are removed. `server/index.js`, `js/services.js`; service tests cover several cases, DB failure injection pending. |
| Binary document storage/version rule | Files are stored under generated server-side names and referenced from MySQL metadata; version increments are per matching name and parent. `server/index.js`, `server/schema.sql`; live filesystem/DB verification pending. |
| SRS baseline, traceability, validation and MoSCoW scope | All numbered requirements are listed above; Must/Should/Could items are implemented where in-scope; Won't Have items remain excluded. README and this matrix are the maintained implementation docs. |

### Lifecycle states and guarded transitions

| Record | Implemented states/transitions |
|---|---|
| Proposal | Draft → Under Review → Approved or Rejected; an approver may request revision back to Draft; PI may withdraw Under Review back to Draft. |
| Project | Proposal approval creates Pending Funding; confirmed allocation moves it to Active; Active ↔ On Hold, Active → Completed (all milestones complete), Active → Terminated, On Hold → Active or Terminated. |
| Milestone | Pending/Not Started → In Progress → Submitted for Review → Completed or, on revision, In Progress. Overdue is derived from target date and unfinished status, not a manually selectable completion status. |
| Deliverable | Pending/In Progress/Submitted/Completed; Completed requires a valid submission date. |

## Lifecycle, scope and interpretation decisions

1. **Proposal/funding activation conflict:** the UC-005 main postcondition says approval initiates an active project, while its alternate funding flow and BR-007 say activation waits for confirmed funding. The user's request explicitly requires independent funding confirmation. The consistent implemented sequence is `Draft → Under Review → Approved + Pending Funding → Active after a valid allocation`; tests cover the approval/pending and allocation/activation service paths.
2. **Status vocabulary differs between SRS sections:** FR-015 lists Proposed/Under Review/Approved/Active/On Hold/Completed/Terminated; later design enums are narrower. The implementation retains the broader project lifecycle and internal Pending Funding. Milestone Pending/Not Started, Submitted for Review, Revision Required and computed Overdue are likewise represented across SRS wording and design states.
3. **Approved milestone plan:** the broad FR-016 wording permits PI/coordinator milestone definition after approval, but the user's explicit instruction says the proposal plan is the approved plan and definitions/dates must not be silently changed. The implementation copies a detailed dated plan at project creation and does not provide post-approval definition editing. This is an intentional scope choice, not an unrecorded omission.
4. **Project team access:** View Only and Contributor are user-requested prototype extensions. View Only removes funding details and blocks mutation; Contributor adds project-scoped progress/document rights. System-wide roles remain separate.
5. **Coordinator completion submission:** coordinator submission is an explicit extension to FR-018's PI actor and follows the evidence, project-state and server authorization rules.
6. **Coordinator proposal assistance:** the SRS user-class section says coordinators assist with proposal preparation, while FR-008 assigns submission to the PI. Coordinators can create/edit Drafts for a selected active PI; server checks preserve that PI as owner and only the owner can submit. The SRS does not define a coordinator-to-PI assignment relation, so assistance is available to the Coordinator role across Draft proposals.
7. **Exclusions kept out of scope:** payment gateway, ERP/HR integration, native mobile application, AI funding suggestions, patent/IP tracking, peer-review/journal workflow, calendar integration, bulk uploads and email notification delivery. In-app notifications are implemented. External funding confirmation is entered by an authorized RPMS role rather than verified through an external agency connection.

## Tests run and remaining verification

`npm test` passes 21 tests: salted password hashing, JWT signature/expiry, MySQL DDL parser/trigger statement parsing, date serialization, registration user-before-session ordering, proposal API draft-ID-to-submit flow, consistent funding catalog IDs, multipart binary/name handling, PI draft authorization/field protection, coordinator draft assistance/PI-only submission, proposal date and rejection-reason validation, deferred activation and plan copying, deadline alert recipients/deduplication, multi-source funding/source cap/linkage, milestone Not Started ↔ In Progress and review transitions, evidence-required milestone review, View Only access/privacy, completed-deliverable date validation, report role guard/CSV escaping, API health/security headers, no-store browser script delivery, and a clear login error for file/offline server use.

`node --check` passed for every JavaScript file in the repository. MySQL migration, health, Priya login/session, ownership, project/milestone reads, deadline-sweep persistence, and registration plus authenticated-session creation were verified live. The registration check used and then removed a disposable database. The following remain **unverified as release verification**: all SQL constraint and rollback paths, full role/API permission matrix, binary upload/download/version storage, report queries, complete workflow coverage, browser compatibility/mobile layout, and availability/performance/concurrency. Existing browser `localStorage` data is not automatically imported into MySQL. SMTP and external funding integrations are intentionally excluded as documented above.
