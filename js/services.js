"use strict";
/* ==========================================================================
   RPMS prototype — application services (the "subsystems" from the SRS
   component-level design). Every operation enforces the business rules
   (BR-xxx) it realizes, and writes to the append-only audit log (BR-023,
   NFR-024/025) and the notification service (FR-029…FR-031).
   ========================================================================== */

function err(code, message, fields) {
  return { ok: false, code, message, fields };
}
function validISODate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))) return false;
  const d=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===value;
}

function audit(actorId, action, target, remarks) {
  DB.auditLog.unshift({
    id: nextId("log"),
    actor: actorId,
    action,
    target,
    time: nowISO(),
    remarks,
  });
}
function notify(recipientId, type, message, href) {
  DB.notifications.unshift({
    id: nextId("notf"),
    recipient: recipientId,
    type,
    message,
    href: href || '',
    created: nowISO(),
    read: false,
  });
}
function notifyFundingStakeholders(project, actorId, message){
  const team=(project.team||[]).filter(member=>member.access!=='View Only').map(member=>member.userId);
  const viewOnly=new Set((project.team||[]).filter(member=>member.access==='View Only').map(member=>member.userId));
  const coordinators=usersByRole('COORDINATOR').filter(user=>user.active&&!viewOnly.has(user.id)).map(user=>user.id);
  const recipients=[project.pi,...team,...coordinators,actorId]
    .filter((id,index,all)=>id&&all.indexOf(id)===index);
  recipients.forEach(id=>notify(id,'funding',message,`#/project/${project.id}`));
}
function refreshDeadlineNotifications(){
  let changed=false;
  DB.milestones.filter(m=>['In Progress','Not Started','Pending'].includes(m.status)).forEach(m=>{
    const project=findProject(m.projectId); if(!project || !['Active','Pending Funding'].includes(project.status)) return;
    const days=daysBetween(todayISO(),m.targetDate); if(days>7) return;
    const key=`milestone-deadline:${m.id}:${todayISO()}`;
    const recipients=[project.pi,...(project.team||[]).map(x=>x.userId),...usersByRole('COORDINATOR').filter(u=>u.active).map(u=>u.id)];
    recipients.filter((id,i,all)=>all.indexOf(id)===i).forEach(id=>{
      if(DB.notifications.some(n=>n.recipient===id&&n.key===key)) return;
      const msg=days<0?`Milestone ${m.code} (${m.name}) of ${project.title} is overdue by ${-days} day(s).`:`Milestone ${m.code} (${m.name}) of ${project.title} is due in ${days} day(s).`;
      notify(id,'deadline',msg,`#/milestone/${m.id}`); DB.notifications[0].key=key; changed=true;
    });
  });
  if(changed) saveDB();
}

/* Simulated password digest (NFR-005): deterministic obfuscation — NOT real crypto, prototype only. */
function fakeHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  return "sha-sim-" + h.toString(36) + "-" + s.length;
}

/* Cryptographically random, URL-safe reset token. The raw token is only ever
   placed in the simulated email; the store keeps its digest (NFR-005). */
function newResetToken() {
  try {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    let s = "";
    while (s.length < 48) s += Math.random().toString(36).slice(2);
    return s.slice(0, 48);
  }
}

const RESET_REQUEST_MESSAGE =
  "If an account exists for this email, a password reset link has been sent. The link expires in 30 minutes and can be used once.";

const VALID_ROLES = ["PI", "COORDINATOR", "APPROVER", "ADMIN", "FUNDING", "AUDITOR"];

/* ---------- UC-001 / FR-001…FR-004, NFR-008 — authentication ---------- */
const Auth = {
  login(email, password) {
    const user = DB.users.find(
      (u) =>
        u.email.toLowerCase() ===
        String(email || "")
          .trim()
          .toLowerCase(),
    );
    const passOk =
      user &&
      (user.passwordHash
        ? user.passwordHash === fakeHash(password) // self-registered account
        : password === DEMO_PASSWORD); // seeded demo account
    if (!user || !passOk)
      return err("UNAUTHORIZED", "Invalid email or password."); // FR-002: never reveal which field failed
    if (!user.active)
      return err(
        "FORBIDDEN",
        "Account deactivated. Contact the system administrator.",
      ); // BR-020
    const session = {
      token: "demo-" + Math.random().toString(36).slice(2),
      userId: user.id,
      issuedAt: nowISO(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    audit(user.id, "USER_LOGIN", user.id, "Signed in");
    saveDB();
    return { ok: true, user };
  },

  /* Self-registration (prototype): creates an active Principal Investigator account
     and signs the user in. Per the SRS (FR-004, BR-019, UC-002), roles other than PI
     are assigned only by the System Administrator. */
  register(data) {
    const name = String(data.name || "").trim();
    const email = String(data.email || "")
      .trim()
      .toLowerCase();
    const dept = String(data.dept || "").trim();
    const password = String(data.password || "");
    if (!name) return err("UNPROCESSABLE", "Enter your full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return err("UNPROCESSABLE", "Enter a valid email address.");
    if (DB.users.some((u) => u.email.toLowerCase() === email))
      return err(
        "CONFLICT",
        "An account with this email already exists. Try signing in instead.",
      );
    if (password.length < 6)
      return err("UNPROCESSABLE", "Password must be at least 6 characters long.");
    const user = {
      id: nextId("usr"),
      name,
      email,
      role: "PI",
      dept: dept || "—",
      active: true,
      passwordHash: fakeHash(password),
      registeredOn: todayISO(),
    };
    DB.users.push(user);
    audit(user.id, "USER_REGISTERED", user.id, "Self-registered as Principal Investigator");
    usersByRole("ADMIN").forEach((a) =>
      notify(
        a.id,
        "system",
        `New user registered: ${user.name} (${email}) joined as Principal Investigator.`,
      ),
    ); // FR-031
    const session = {
      token: "demo-" + Math.random().toString(36).slice(2),
      userId: user.id,
      issuedAt: nowISO(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    saveDB();
    return { ok: true, user };
  },

  requestPasswordReset(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
      return err('UNPROCESSABLE', 'Enter a valid email address.');
    const user = DB.users.find(u => u.email.toLowerCase() === normalized && u.active);
    if (!user) return { ok:true, token:null };
    DB.passwordResets = DB.passwordResets || [];
    const token = 'reset-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    DB.passwordResets = DB.passwordResets.filter(r => r.userId !== user.id);
    DB.passwordResets.push({ token, userId:user.id, expiresAt:Date.now() + 15 * 60 * 1000 });
    saveDB();
    return { ok:true, token };
  },
  passwordResetIsValid(token) {
    DB.passwordResets = DB.passwordResets || [];
    return DB.passwordResets.some(r => r.token === token && r.expiresAt > Date.now() &&
      DB.users.some(u => u.id === r.userId && u.active));
  },
  resetPassword(token, password) {
    password = String(password || '');
    if (password.length < 6) return err('UNPROCESSABLE', 'Password must be at least 6 characters long.');
    DB.passwordResets = DB.passwordResets || [];
    const reset = DB.passwordResets.find(r => r.token === token && r.expiresAt > Date.now());
    const user = reset && DB.users.find(u => u.id === reset.userId && u.active);
    if (!user) return err('UNAUTHORIZED', 'This password reset link is invalid or has expired.');
    user.passwordHash = fakeHash(password);
    DB.passwordResets = DB.passwordResets.filter(r => r.token !== token && r.userId !== user.id);
    audit(user.id, 'PASSWORD_RESET', user.id, 'Password changed using a reset link');
    saveDB();
    return { ok:true };
  },
  /* Returns a user, null, or {expired:true} when the session timed out. */
  current() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (!s) return null;
      if (Date.now() > s.expiresAt) {
        localStorage.removeItem(SESSION_KEY);
        return { expired: true };
      }
      s.expiresAt = Date.now() + SESSION_TTL_MS; // sliding expiry
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      const user=DB.users.find((u) => u.id === s.userId) || null;
      if(!user || !user.active){localStorage.removeItem(SESSION_KEY);return null;}
      return user;
    } catch (e) {
      return null;
    }
  },
  logout() {
    localStorage.removeItem(SESSION_KEY);
  },

  /* ---------- Self-service password reset (NFR-005, NFR-024, BR-020) ----------
     The SRS does not define a reset use case; this follows its security rules:
     the response never reveals whether an email is registered (same pattern as
     FR-002), links are single-use and expire, deactivated accounts are refused,
     and both request and completion are written to the append-only audit log. */
  requestPasswordReset(email) {
    const normalized = String(email || "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
      return err("UNPROCESSABLE", "Enter a valid email address."); // NFR-010
    const user = DB.users.find((u) => u.email.toLowerCase() === normalized);
    // BR-020: deactivated users cannot reset, but we still return the same
    // generic response so the account status is not disclosed.
    if (!user || !user.active)
      return { ok: true, message: RESET_REQUEST_MESSAGE };

    // Supersede any outstanding links so only the newest one works.
    DB.passwordResets.forEach((r) => {
      if (r.userId === user.id && !r.usedAt) {
        r.usedAt = nowISO();
        r.revoked = true;
      }
    });
    const token = newResetToken();
    const expiresAt = Date.now() + PASSWORD_RESET_TTL_MS;
    DB.passwordResets.unshift({
      id: nextId("rst"),
      userId: user.id,
      tokenHash: fakeHash(token),
      requestedAt: nowISO(),
      expiresAt,
      usedAt: null,
      revoked: false,
    });
    audit(
      user.id,
      "PASSWORD_RESET_REQUESTED",
      user.id,
      "Single-use password reset link issued",
    ); // NFR-024
    saveDB();
    // demoToken is shown in the simulated email preview only — never in a real system.
    return {
      ok: true,
      message: RESET_REQUEST_MESSAGE,
      demoToken: token,
      expiresAt,
      user: { id: user.id, email: user.email },
    };
  },

  checkResetToken(token) {
    const reset = DB.passwordResets.find(
      (r) => r.tokenHash === fakeHash(String(token || "")) && !r.usedAt,
    );
    if (!reset)
      return err(
        "INVALID_TOKEN",
        "This password reset link is invalid or has already been used.",
      );
    if (Date.now() > reset.expiresAt)
      return err(
        "INVALID_TOKEN",
        "This password reset link has expired. Request a new one.",
      );
    const user = DB.users.find((u) => u.id === reset.userId);
    if (!user || !user.active)
      return err("INVALID_TOKEN", "This password reset link is no longer valid."); // BR-020
    return { ok: true, user, reset };
  },

  resetPassword(token, newPassword) {
    const password = String(newPassword || "");
    const checked = Auth.checkResetToken(token);
    if (!checked.ok) return checked; // expired/reused/unknown token
    if (password.length < 6)
      return err("UNPROCESSABLE", "Password must be at least 6 characters long.");
    const user = checked.user;
    user.passwordHash = fakeHash(password); // NFR-005
    checked.reset.usedAt = nowISO();
    // Revoke every other outstanding link for this account.
    DB.passwordResets.forEach((r) => {
      if (r.userId === user.id && !r.usedAt) {
        r.usedAt = nowISO();
        r.revoked = true;
      }
    });
    // Invalidate the affected user's existing session (if this browser holds it).
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (s && s.userId === user.id) localStorage.removeItem(SESSION_KEY);
    } catch (e) {
      /* ignore malformed session */
    }
    audit(
      user.id,
      "PASSWORD_RESET",
      user.id,
      "Password changed via self-service reset",
    ); // NFR-024
    saveDB();
    return { ok: true, user };
  },
};

/* ---------- PI project visibility and owner-managed authorization ---------- */
function canViewProject(project, user){
  if(!project || !user || !user.active) return false;
  if(project.pi === user.id) return true;
  if((project.team || []).some(m => m.userId === user.id)) return true;
  // Research office and oversight roles retain their SRS-wide read access.
  return ['COORDINATOR','APPROVER','ADMIN','AUDITOR','FUNDING'].includes(user.role);
}
function projectAccess(project,user){
  if(!project || !user) return null;
  if(project.pi===user.id) return 'Owner';
  const member=(project.team||[]).find(m=>m.userId===user.id);
  return member ? member.access : null;
}
function canContributeProject(project,user){
  if(!canViewProject(project,user)) return false;
  if(project.pi===user.id) return true;
  const member=(project.team||[]).find(m=>m.userId===user.id);
  if(member) return member.access==='Contributor';
  return ['COORDINATOR','ADMIN'].includes(user.role);
}
function hasViewOnlyMembership(project,user){
  const member=(project&&project.team||[]).find(m=>m.userId===user.id);
  return !!member && member.access==='View Only';
}
const ProjectAccess = {
  grant(projectId, owner, userId, access){
    const project = findProject(projectId);
    if(!project) return err('NOT_FOUND','Project not found.');
    if(!owner.active || owner.role !== 'PI' || project.pi !== owner.id)
      return err('FORBIDDEN','Only the project PI can authorize access.');
    const member = DB.users.find(u => u.id === userId && u.active);
    if(!member) return err('UNPROCESSABLE','Select an active registered user.');
    if(member.id === project.pi) return err('CONFLICT','The designated PI already has project access.');
    if(!['View Only','Contributor'].includes(access)) return err('UNPROCESSABLE','Choose View Only or Contributor access.');
    project.team = project.team || [];
    if(project.team.some(m => m.userId === member.id)) return err('CONFLICT','This user is already on the project team.');
    project.team.push({userId:member.id, access, addedBy:owner.id, addedAt:nowISO()});
    audit(owner.id,'PROJECT_ACCESS_GRANTED',project.id,`${member.email} added as ${access}`);
    notify(member.id,'project',`You have ${access.toLowerCase()} access to ${project.title} (${project.id}).`,`#/project/${project.id}`);
    saveDB();
    return {ok:true};
  },
  update(projectId, owner, userId, access){
    const project=findProject(projectId);
    if(!project) return err('NOT_FOUND','Project not found.');
    if(!owner.active || owner.role!=='PI' || project.pi!==owner.id) return err('FORBIDDEN','Only the project PI can manage access.');
    if(!['View Only','Contributor'].includes(access)) return err('UNPROCESSABLE','Choose View Only or Contributor access.');
    const member=(project.team||[]).find(m=>m.userId===userId);
    if(!member) return err('NOT_FOUND','Project team member not found.');
    member.access=access; member.updatedAt=nowISO();
    audit(owner.id,'PROJECT_ACCESS_CHANGED',project.id,`${userById(userId).email} access changed to ${access}`);
    saveDB(); return {ok:true};
  },
  revoke(projectId, owner, userId){
    const project = findProject(projectId);
    if(!project) return err('NOT_FOUND','Project not found.');
    if(!owner.active || owner.role !== 'PI' || project.pi !== owner.id)
      return err('FORBIDDEN','Only the project PI can manage access.');
    if(userId===project.pi) return err('CONFLICT','The designated PI cannot be removed.');
    project.team = project.team || [];
    if(!project.team.some(m=>m.userId===userId)) return err('NOT_FOUND','Project team member not found.');
    project.team = project.team.filter(m => m.userId !== userId);
    audit(owner.id,'PROJECT_ACCESS_REVOKED',project.id,`Access revoked from ${userById(userId).email}`);
    saveDB();
    return {ok:true};
  }
};

const ProjectService = {
  updateStatus(projectId, caller, nextStatus, reason){
    const project=findProject(projectId);if(!project)return err('NOT_FOUND','Project not found.');
    if(hasViewOnlyMembership(project,caller))return err('FORBIDDEN','View Only project access cannot change project status.');
    if(!caller.active||!['PI','COORDINATOR','ADMIN'].includes(caller.role))return err('FORBIDDEN','Your role cannot change project status.');
    if(caller.role==='PI'&&project.pi!==caller.id)return err('FORBIDDEN','Only the project PI can change its status.');
    const allowed={Active:['On Hold','Completed','Terminated'],'On Hold':['Active','Terminated'],'Pending Funding':[]};
    if(!(allowed[project.status]||[]).includes(nextStatus))return err('CONFLICT',`Project status cannot change from ${project.status} to ${nextStatus}.`);
    if(['Completed','Terminated','On Hold'].includes(nextStatus)&&!String(reason||'').trim())return err('UNPROCESSABLE','Enter a reason for this project status change.');
    if(nextStatus==='Completed'&&DB.milestones.some(m=>m.projectId===project.id&&m.status!=='Completed'))return err('CONFLICT','Complete all milestones before completing the project.');
    const previous=project.status;project.status=nextStatus;
    if(nextStatus==='Completed')project.actualEndDate=todayISO();
    audit(caller.id,'PROJECT_STATUS_CHANGED',project.id,`${previous} → ${nextStatus}: ${String(reason||'').trim()}`);
    [project.pi,...(project.team||[]).map(m=>m.userId),...usersByRole('COORDINATOR').filter(u=>u.active).map(u=>u.id)].filter((id,i,a)=>a.indexOf(id)===i).forEach(id=>notify(id,'project',`Project ${project.title} (${project.id}) changed from ${previous} to ${nextStatus}.`,`#/project/${project.id}`));
    saveDB();return {ok:true,project};
  }
};

/* ---------- Proposal Management (UC-003/004/005/006) ---------- */
const ProposalService = {
  validate(p) {
    // BR-002, BR-008, BR-009
    const labels = [
      ["title", "Project title"],
      ["abstract", "Abstract"],
      ["objectives", "Objectives"],
      ["methodology", "Methodology"],
      ["expectedOutcomes", "Expected outcomes"],
      ["domain", "Research domain"],
      ["fundingSource", "Funding source"],
      ["expectedMilestones", "Expected milestones"],
      ["budget", "Budget (INR)"],
      ["startDate", "Proposed start date"],
      ["endDate", "Expected end date"],
    ];
    const missing = labels
      .filter(([k]) => {
        const v = p[k];
        return (
          v === null ||
          v === undefined ||
          v === "" ||
          (typeof v === "number" && !(v > 0))
        );
      })
      .map(([, l]) => l);
    if (
      !missing.includes("Proposed start date") &&
      !missing.includes("Expected end date") &&
      p.endDate <= p.startDate
    ) {
      missing.push("Expected end date must be after the start date");
    }
    if(p.fundingSource==='Other' && !String(p.fundingSourceOther||'').trim()) missing.push('Custom funding source');
    if(!DB.fundingSources.includes(p.fundingSource)) missing.push('Funding source');
    if(!missing.includes('Proposed start date') && !validISODate(p.startDate)) missing.push('Proposed start date');
    if(!missing.includes('Expected end date') && !validISODate(p.endDate)) missing.push('Expected end date');
    if(Array.isArray(p.milestonePlan)){
      const named=p.milestonePlan.filter(m=>String(m.name||'').trim());
      if(named.length!==p.milestonePlan.length) missing.push('Every milestone must have a title');
      named.forEach(m=>{
        if(!validISODate(m.targetDate)) missing.push(`Target date for milestone ${String(m.name).trim()}`);
        else if(validISODate(p.startDate)&&m.targetDate<p.startDate) missing.push(`Target date for milestone ${String(m.name).trim()} must be on or after project start`);
      });
    }
    return { ok: missing.length === 0, missing };
  },

  saveDraft(data, caller, existingId) {
    // FR-005…FR-007, BR-001
    if(!caller||!caller.active||!['PI','COORDINATOR'].includes(caller.role)) return err('FORBIDDEN','Only a Principal Investigator or Research Coordinator can prepare proposal drafts.');
    let p;
    if (existingId) {
      p = findProposal(existingId);
      if (!p) return err("NOT_FOUND", "Proposal not found.");
      if (caller.role==='PI'&&p.pi !== caller.id)
        return err(
          "FORBIDDEN",
          "Access denied: only the owning PI can edit this draft.",
        );
      if (p.status !== "Draft")
        return err("CONFLICT", "Only drafts can be edited.");
    } else {
      const piId=caller.role==='PI'?caller.id:String(data?.principalInvestigatorId||'');
      const principalInvestigator=DB.users.find(user=>user.id===piId&&user.role==='PI'&&user.active);
      if(!principalInvestigator)return err('UNPROCESSABLE','Select an active Principal Investigator for this draft.');
      p = {
        id: nextId("prop"),
        pi: principalInvestigator.id,
        status: "Draft",
        submissionDate: null,
        version: 1,
        documents: [],
        review: null,
      };
      DB.proposals.push(p);
      audit(caller.id, "PROPOSAL_CREATED", p.id,caller.role==='PI'?"New proposal draft created":`Research Coordinator prepared a draft for ${principalInvestigator.name}`);
    }
    const editable = ['title','abstract','objectives','methodology','expectedOutcomes','budget','domain','fundingSource','fundingSourceOther','startDate','endDate','expectedMilestones','milestonePlan','expectedDeliverables','investigatorDetails'];
    const clean = Object.fromEntries(editable.filter(key => Object.hasOwn(data||{},key)).map(key => [key, data[key]]));
    Object.assign(p, clean, { lastUpdated: nowISO() });
    if (p.budget === "") p.budget = null;
    saveDB();
    return { ok: true, id: p.id };
  },

  deleteDraft(id, caller) {
    if(!caller||!caller.active||!['PI','COORDINATOR'].includes(caller.role))
      return err('FORBIDDEN','Only an active Principal Investigator or Research Coordinator can delete a proposal draft.');
    const p=DB.proposals.find(proposal=>proposal.id===id);
    if(!p||p.deletedAt)return err('NOT_FOUND','Proposal draft not found.');
    if(p.status!=='Draft')return err('CONFLICT','Only proposal drafts can be deleted.');
    if(caller.role==='PI'&&p.pi!==caller.id)
      return err('FORBIDDEN','Access denied: only the owning PI can delete this draft.');
    p.deletedAt=nowISO();p.deletedBy=caller.id;
    audit(caller.id,'PROPOSAL_DRAFT_DELETED',p.id,'Draft deleted; proposal details and documents are retained for audit/history.');
    saveDB();
    return {ok:true,id:p.id};
  },

  submit(id, caller) {
    // UC-004, FR-008
    if(!caller||caller.role!=='PI') return err('FORBIDDEN','Only a Principal Investigator can submit a proposal.');
    const p = findProposal(id);
    if (!p) return err("NOT_FOUND", "Proposal not found.");
    if (p.pi !== caller.id)
      return err(
        "FORBIDDEN",
        "Access denied: only the owning PI can submit this draft.",
      ); // BR-001
    if (p.status !== "Draft")
      return err("CONFLICT", "Cannot submit: proposal is not in Draft status.");
    const v = this.validate(p);
    if (!v.ok)
      return err(
        "UNPROCESSABLE",
        "Submission rejected. Missing fields: " +
          v.missing.join(", ") +
          ". Proposal remains in Draft.",
        v.missing,
      ); // BR-002, NFR-010
    p.status = "Under Review";
    p.submissionDate = nowISO();
    p.lastUpdated = nowISO();
    p.review = null;
    audit(
      caller.id,
      "PROPOSAL_SUBMITTED",
      p.id,
      "Proposal submitted for committee review",
    );
    usersByRole("APPROVER").forEach((a) =>
      notify(
        a.id,
        "review",
        `New proposal ${p.id} (${p.title}) submitted for review.`, `#/review/${p.id}`,
      ),
    ); // UC-004 step 9
    saveDB();
    return { ok: true, proposal: p };
  },

  decide(id, approver, decision, comments, fundingConfirmed) {
    // UC-005, FR-009…FR-011
    if (!['APPROVER','ADMIN'].includes(approver.role))
      return err("FORBIDDEN", "Forbidden: your role cannot approve proposals."); // FR-004
    const p = findProposal(id);
    if (!p) return err("NOT_FOUND", "Proposal not found.");
    if (p.status !== "Under Review")
      return err(
        "CONFLICT",
        "This proposal is no longer Under Review. Refresh the queue.",
      );
    comments = (comments || "").trim();

    if (decision === "Rejected") {
      if (!comments)
        return err(
          "UNPROCESSABLE",
          "Reject blocked: comments are required when rejecting a proposal.",
        ); // BR-006
      p.status = "Rejected";
      p.review = {
        decision: "Rejected",
        reviewer: approver.id,
        reviewDate: nowISO(),
        comments,
      };
      audit(approver.id, "PROPOSAL_REJECTED", p.id, comments);
      notify(
        p.pi,
        "decision",
        `Proposal ${p.id} (${p.title}) was rejected. Reviewer comments: ${comments}`, `#/proposal/${p.id}`,
      ); // FR-029
      saveDB();
      return { ok: true, proposal: p };
    }

    if (decision === "Revision Required") {
      if (!comments) return err("UNPROCESSABLE", "Revision request requires comments.");
      p.status = "Draft";
      p.submissionDate = null;
      p.lastUpdated = nowISO();
      p.review = { decision:"Revision Required", reviewer:approver.id, reviewDate:nowISO(), comments };
      audit(approver.id, "PROPOSAL_REVISION_REQUESTED", p.id, comments);
      notify(p.pi, "revision", `Revisions were requested for proposal ${p.id} (${p.title}): ${comments}`, `#/proposal/${p.id}`);
      saveDB();
      return { ok:true, proposal:p };
    }

    if (decision === "Approved") {
      p.status = "Approved";
      p.review = {
        decision: "Approved",
        reviewer: approver.id,
        reviewDate: nowISO(),
        comments: comments || "—",
        fundingConfirmed: !!fundingConfirmed,
      };
      audit(
        approver.id,
        "PROPOSAL_APPROVED",
        p.id,
        fundingConfirmed
          ? "Approved; funding sanction confirmed"
          : "Approved; funding confirmation pending",
      );
      let project;
      // The committee decision never substitutes for a funding-agency allocation.
      project = createProject(p, "Pending Funding");
      notify(p.pi,"decision",`Proposal ${p.id} (${p.title}) was approved. Project ${project.id} is awaiting a funding allocation.`,`#/project/${project.id}`);
      saveDB();
      return { ok: true, proposal: p, project, deferred: true };
    }
    return err("BAD_REQUEST", "Unknown decision.");
  },

  withdraw(id, caller) {
    // UC-006, FR-012
    if(!caller||caller.role!=='PI') return err('FORBIDDEN','Only a Principal Investigator can withdraw a proposal.');
    const p = findProposal(id);
    if (!p) return err("NOT_FOUND", "Proposal not found.");
    if (p.pi !== caller.id)
      return err(
        "FORBIDDEN",
        "Access denied: only the owning PI can withdraw this proposal.",
      );
    if (p.status !== "Under Review")
      return err(
        "CONFLICT",
        "Only proposals that are Under Review can be withdrawn.",
      );
    p.status = "Draft";
    p.submissionDate = null;
    p.lastUpdated = nowISO();
    audit(
      caller.id,
      "PROPOSAL_WITHDRAWN",
      p.id,
      "Withdrawn by PI before decision",
    );
    saveDB();
    return { ok: true };
  },
};

/* ---------- Project & Milestone Tracking (UC-011/012) ---------- */
function createProject(p, status) {
  const proj = {
    id: nextId("prj"),
    proposalId: p.id,
    title: p.title,
    pi: p.pi,
    team: [],
    domain: p.domain,
    status,
    startDate: p.startDate || todayISO(),
    expectedEndDate: p.endDate || addMonthsISO(todayISO(), 12),
    actualEndDate: null,
    activationDate: status === "Active" ? todayISO() : null,
    funding: {
      source: p.fundingSource==='Other' ? p.fundingSourceOther : p.fundingSource,
      proposedBudget: p.budget || 0,
      sanctioned: 0,
      received: 0,
      utilized: 0,
    },
    disbursements: [],
    utilizations: [],
  };
  DB.projects.push(proj);
  const names = (p.expectedMilestones || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const planned=Array.isArray(p.milestonePlan)&&p.milestonePlan.length?p.milestonePlan:names.map((name,i)=>({name,targetDate:addMonthsISO(proj.startDate,3*(i+1)),description:'',expectedDeliverables:''}));
  planned.forEach((plan, i) => {
    const nm=String(plan.name||names[i]||'').trim();
    const name = nm.replace(/^M\d+[:.\-\s]+/i, "") || nm; // strip a leading code so it isn't doubled
    const milestone={
      id: nextId("ms"),
      projectId: proj.id,
      code: "M" + (i + 1),
      name,
      description: String(plan.description||''),
      targetDate: plan.targetDate||addMonthsISO(proj.startDate,3*(i+1)),
      status: "Not Started",
      completionDate: null,
      remarks: "",
      deliverables: [],
    };
    DB.milestones.push(milestone);
    String(plan.expectedDeliverables||'').split(',').map(x=>x.trim()).filter(Boolean).forEach(deliverableName=>milestone.deliverables.push({id:nextId('dlv'),projectId:proj.id,milestoneId:milestone.id,name:deliverableName,type:'Expected deliverable',description:'',dueDate:milestone.targetDate,submissionDate:'',status:'Pending',submittedBy:null,remarks:''}));
  });
  audit(
    p.pi,
    "PROJECT_CREATED",
    proj.id,
    status === "Active"
      ? "Project created from approved proposal"
      : "Project created; activation deferred until funding confirmation",
  );
  if (status === "Active")
    audit(p.pi, "PROJECT_ACTIVATED", proj.id, "Project is Active");
  return proj;
}

const MilestoneService = {
  displayStatus(m) {
    // FR-017 'Overdue'
    if (
      (m.status === "In Progress" || m.status === "Not Started") &&
      m.targetDate < todayISO()
    )
      return "Overdue";
    return m.status;
  },

  submitCompletion(id, caller, evidence, remarks) {
    // UC-011, FR-018
    const m = findMilestone(id);
    if (!m) return err("NOT_FOUND", "Milestone not found.");
    const proj = findProject(m.projectId);
    if (!canContributeProject(proj,caller))
      return err(
        "FORBIDDEN",
        "Access denied: project contributors or the Research Coordinator can submit this milestone.",
      ); // BR-016, BR-024
    if (proj.status !== "Active")
      return err("CONFLICT", "Blocked: project is On Hold or Completed.");
    if (m.status !== "In Progress")
      return err("CONFLICT", "Denied: milestone is not In Progress.");
    if (!evidence || !evidence.length)
      return err(
        "UNPROCESSABLE",
        "Submission rejected: upload at least one evidence document.",
      ); // FR-018, BR-013
    evidence.forEach((f) => {
      const prev = DB.documents.filter(
        (d) => d.projectId === proj.id && d.name === f.name,
      );
      DB.documents.push({
        id: nextId("doc"),
        projectId: proj.id,
        milestoneId: m.id,
        type: "Milestone Evidence",
        name: f.name,
        size: f.size,
        version: prev.length + 1, // FR-028 versioning
        uploadedBy: caller.id,
        uploadDate: todayISO(),
      });
    });
    m.status = "Submitted for Review";
    if (remarks) m.remarks = remarks;
    m.submittedAt = nowISO();
    m.completionReview={status:'Submitted for Review',submittedAt:m.submittedAt,submittedBy:caller.id,outcome:'Pending'};
    audit(
      caller.id,
      "MILESTONE_SUBMITTED",
      m.id,
      `${m.code} ${m.name} submitted for completion review`,
    );
    usersByRole("APPROVER").forEach((a) =>
      notify(
        a.id,
        "review",
        `Milestone ${m.code} (${m.name}) of ${proj.title} submitted for completion review.`, `#/milestone/${m.id}`,
      ),
    ); // FR-030
    saveDB();
    return { ok: true };
  },

  updateStatus(id, caller, status){
    const m=findMilestone(id); if(!m) return err('NOT_FOUND','Milestone not found.');
    const proj=findProject(m.projectId);
    if(!canContributeProject(proj,caller) || (!['PI','COORDINATOR'].includes(caller.role)&&projectAccess(proj,caller)!=='Contributor')) return err('FORBIDDEN','You do not have permission to update milestone progress.');
    if(['On Hold','Completed'].includes(proj.status)) return err('CONFLICT','Milestones cannot be changed while the project is On Hold or Completed.');
    if(!['Pending','Not Started','In Progress'].includes(status)) return err('UNPROCESSABLE','Choose Pending or In Progress. Completion requires review.');
    if(m.status==='Submitted for Review') return err('CONFLICT','This milestone is awaiting committee review.');
    m.status=status==='Pending'?'Not Started':status;
    audit(caller.id,'MILESTONE_STATUS_CHANGED',m.id,`Status changed to ${m.status}`); saveDB(); return {ok:true};
  },

  decide(id, approver, decision, comments) {
    // UC-012, FR-019, AC-19/20
    if (approver.role !== "APPROVER")
      return err(
        "FORBIDDEN",
        "Forbidden: your role cannot review milestone completions.",
      );
    const m = findMilestone(id);
    if (!m) return err("NOT_FOUND", "Milestone not found.");
    const proj = findProject(m.projectId);
    if(!canViewProject(proj,approver)) return err('FORBIDDEN','You cannot review this project.');
    if(hasViewOnlyMembership(proj,approver)) return err('FORBIDDEN','View Only project access cannot review milestone completion.');
    if(['On Hold','Completed'].includes(proj.status)) return err('CONFLICT','Milestone completion cannot be reviewed while the project is On Hold or Completed.');
    if (m.status !== "Submitted for Review")
      return err(
        "CONFLICT",
        "This milestone is no longer Submitted for Review. Refresh the queue.",
      );
    comments = (comments || "").trim();

    if (decision === "Completed") {
      m.status = "Completed";
      m.completionDate = todayISO();
      m.completionReview={status:'Reviewed',outcome:'Approved',reviewer:approver.id,reviewedAt:nowISO(),comments};
      if (comments) m.remarks = comments;
      m.deliverables.forEach((d) => {
        if (d.status !== "Completed") {
          d.status = "Completed";
          d.submissionDate = todayISO();
          d.submittedBy = proj.pi;
        }
      });
      audit(
        approver.id,
        "MILESTONE_COMPLETED",
        m.id,
        comments || "Milestone completion approved",
      );
      notify(
        proj.pi,
        "approval",
        `Milestone ${m.code} (${m.name}) of ${proj.title} was approved and marked Completed.`, `#/milestone/${m.id}`,
      );
    } else if (decision === "Revision Required") {
      if (!comments)
        return err(
          "UNPROCESSABLE",
          "Revision request blocked: comments are required.",
        ); // AC-20
      m.status = "In Progress";
      m.remarks = comments;
      m.completionReview={status:'Reviewed',outcome:'Revision Required',reviewer:approver.id,reviewedAt:nowISO(),comments};
      audit(approver.id, "MILESTONE_REVISION_REQUESTED", m.id, comments);
      notify(
        proj.pi,
        "revision",
        `Revision requested for milestone ${m.code} (${m.name}) of ${proj.title}: ${comments}`, `#/milestone/${m.id}`,
      );
    } else {
      return err("BAD_REQUEST", "Unknown decision.");
    }
    saveDB();
    return { ok: true };
  },
};

const DeliverableService = {
  add(milestoneId, caller, data){
    const m=findMilestone(milestoneId); if(!m) return err('NOT_FOUND','Milestone not found.');
    const proj=findProject(m.projectId);
    if(!canContributeProject(proj,caller) || (!['PI','COORDINATOR'].includes(caller.role)&&projectAccess(proj,caller)!=='Contributor')) return err('FORBIDDEN','You do not have permission to add deliverables.');
    if(['On Hold','Completed'].includes(proj.status)) return err('CONFLICT','Deliverables cannot be changed while the project is On Hold or Completed.');
    const name=String(data.name||'').trim(), type=String(data.type||'').trim(), dueDate=data.dueDate||'';
    if(!name || !type) return err('UNPROCESSABLE','Enter a deliverable name and type.');
    if(dueDate && (!validISODate(dueDate) || dueDate < proj.startDate)) return err('UNPROCESSABLE','Enter a valid due date on or after the project start date.');
    const d={id:nextId('dlv'),projectId:proj.id,milestoneId:m.id,name,type,description:String(data.description||'').trim(),dueDate,submissionDate:'',status:'Pending',submittedBy:null,remarks:''};
    m.deliverables.push(d); audit(caller.id,'DELIVERABLE_ADDED',d.id,`${name} added to ${m.code}`); saveDB(); return {ok:true,deliverable:d};
  },
  update(id, caller, data){
    const m=DB.milestones.find(x=>x.deliverables.some(d=>d.id===id)); if(!m) return err('NOT_FOUND','Deliverable not found.');
    const proj=findProject(m.projectId); if(!canContributeProject(proj,caller)||(!['PI','COORDINATOR'].includes(caller.role)&&projectAccess(proj,caller)!=='Contributor')) return err('FORBIDDEN','You do not have permission to update deliverables.');
    if(['On Hold','Completed'].includes(proj.status)) return err('CONFLICT','Deliverables cannot be changed while the project is On Hold or Completed.');
    const d=m.deliverables.find(x=>x.id===id), status=data.status||d.status;
    if(!['Pending','In Progress','Submitted','Completed'].includes(status)) return err('UNPROCESSABLE','Invalid deliverable status.');
    const submissionDate=data.submissionDate===undefined?d.submissionDate:data.submissionDate;
    if(status==='Completed' && !submissionDate) return err('UNPROCESSABLE','A completion date is required for a completed deliverable.');
    if(submissionDate && (!validISODate(submissionDate) || submissionDate < proj.startDate)) return err('UNPROCESSABLE','Enter a valid submission date on or after the project start date.');
    const name=String(data.name??d.name).trim(), type=String(data.type??d.type).trim(), dueDate=data.dueDate===undefined?d.dueDate:data.dueDate, description=String(data.description??d.description??'').trim();
    if(!name||!type) return err('UNPROCESSABLE','Deliverable name and type are required.');
    if(dueDate && (!validISODate(dueDate)||dueDate<proj.startDate)) return err('UNPROCESSABLE','Enter a valid due date on or after the project start date.');
    Object.assign(d,{name,type,description,dueDate,status,submissionDate,remarks:String(data.remarks??d.remarks??'').trim(),submittedBy:submissionDate?caller.id:d.submittedBy});
    audit(caller.id,'DELIVERABLE_UPDATED',d.id,`Status set to ${status}`); saveDB(); return {ok:true,deliverable:d};
  }
};

/* ---------- Funding Management (UC-013/014/018, FR-022…FR-025) ---------- */
const FundingService = {
  records(proj){
    if(Array.isArray(proj.fundingRecords)&&proj.fundingRecords.length)return proj.fundingRecords;
    if(!proj.fundingRecords)proj.fundingRecords=[];
    if(Number(proj.funding?.sanctioned||0)>0)proj.fundingRecords.push({id:`FUND-${proj.id}`,source:proj.funding.source||'Self-funded',proposedAmount:Number(proj.funding.proposedBudget||0),authorizedAmount:Number(proj.funding.sanctioned||0),sanctioned:Number(proj.funding.sanctioned||0),received:Number(proj.funding.received||0),status:'Confirmed'});
    return proj.fundingRecords;
  },
  refreshTotals(proj){
    const records=this.records(proj);
    proj.funding.sanctioned=records.reduce((sum,r)=>sum+Number(r.sanctioned||0),0);
    proj.funding.received=records.reduce((sum,r)=>sum+Number(r.received||0),0);
    proj.funding.source=records.length>1?'Multiple sources':records[0]?.source||proj.funding.source||'Self-funded';
    proj.funding.utilized=(proj.utilizations||[]).reduce((sum,r)=>sum+Number(r.amount||0),0);
  },
  allocationOptions(projects){
    return projects.flatMap(proj=>this.records(proj).map(record=>({projectId:proj.id,fundingId:record.id,projectTitle:proj.title,source:record.source,sanctioned:Number(record.sanctioned||0),received:Number(record.received||0)})));
  },
  utilizationPct(proj) {
    return proj.funding.sanctioned > 0
      ? Math.round((proj.funding.utilized / proj.funding.sanctioned) * 100)
      : 0;
  },

  recordUtilization(projectId, caller, e) {
    // UC-014, FR-023, AC-21…26
    if (caller.role !== "COORDINATOR")
      return err(
        "FORBIDDEN",
        "Only Research Coordinators can record fund utilization.",
      );
    const proj = findProject(projectId);
    if (!proj) return err("NOT_FOUND", "Project not found.");
    if(hasViewOnlyMembership(proj,caller)) return err('FORBIDDEN','View Only project access cannot record utilization.');
    const records=this.records(proj),record=e.fundingId?records.find(x=>x.id===e.fundingId):records[0];
    if(e.fundingId&&!record)return err('UNPROCESSABLE','Select a valid funding source for this project.');
    if (!record||Number(record.sanctioned||0)<=0)
      return err(
        "CONFLICT",
        "Project has no recorded funding allocation (AC-22).",
      );
    const amt = Number(e.amount);
    if(e.date<proj.startDate) return err('UNPROCESSABLE','Utilization date cannot be earlier than the project start date.');
    if (!e.category || !String(e.description||'').trim() || !(amt > 0) || !Number.isFinite(amt) || !validISODate(e.date))
      return err(
        "UNPROCESSABLE",
        "Enter a category, description, valid date and amount greater than zero (AC-23).",
      );
    proj.funding.utilized += amt;
    proj.utilizations.unshift({
      id:`UTIL-${proj.id}-${DB.counters.util++}`,
      fundingId:record.id,
      fundingSource:record.source,
      category: e.category,
      description: e.description || "",
      amount: amt,
      date: e.date || todayISO(),
      recordedBy: caller.id,
    });
    audit(
      caller.id,
      "FUNDING_UTILIZATION_RECORDED",
      proj.id,
      `${e.category}: ${fmtMoney(amt)}${e.description ? " — " + e.description : ""}`,
    );
    this.refreshTotals(proj);
    const pct = this.utilizationPct(proj);
    if (pct >= 80) {
      // FR-025 budget overrun alert
      const msg = `Warning: funding utilization for ${proj.title} (${proj.id}) has reached ${pct}% of the sanctioned budget.`;
      const threshold=pct>=100?'over':'approaching',key=`funding-threshold:${proj.id}:${threshold}`;
      if(!DB.notifications.some(n=>n.key===key&&n.recipient===proj.pi)){notify(proj.pi,"funding",msg,`#/project/${proj.id}`);DB.notifications[0].key=key;}
      if(caller.id!==proj.pi&&!DB.notifications.some(n=>n.key===key&&n.recipient===caller.id)){notify(caller.id,"funding",msg,`#/project/${proj.id}`);DB.notifications[0].key=key;}
    }
    saveDB();
    return { ok: true, pct };
  },

  recordDisbursement(projectId, caller, e) {
    // FR-022 disbursement schedule
    if (caller.role !== "FUNDING")
      return err(
        "FORBIDDEN",
        "Only Funding Agency representatives can record disbursements.",
      );
    const proj = findProject(projectId);
    if (!proj) return err("NOT_FOUND", "Project not found.");
    if(hasViewOnlyMembership(proj,caller)) return err('FORBIDDEN','View Only project access cannot record disbursements.');
    const amt = Number(e.amount);
    if(e.date<proj.startDate) return err('UNPROCESSABLE','Disbursement date cannot be earlier than the project start date.');
    if (!(amt > 0) || !Number.isFinite(amt) || !validISODate(e.date))
      return err("UNPROCESSABLE", "Enter a valid date and an amount greater than zero.");
    const records=this.records(proj),record=e.fundingId?records.find(x=>x.id===e.fundingId):records[0];
    if(e.fundingId&&!record)return err('UNPROCESSABLE','Select a valid funding source for this project.');
    if(!record||record.sanctioned<=0)return err('CONFLICT','Select a funding allocation before recording a disbursement.');
    if(Number(record.received||0)+amt>Number(record.sanctioned||0)) return err('UNPROCESSABLE','Disbursements cannot exceed the sanctioned amount for this funding source.');
    record.received=Number(record.received||0)+amt;
    proj.disbursements.unshift({
      id:`DISB-${proj.id}-${DB.counters.disb++}`,
      fundingId:record.id,
      fundingSource:record.source,
      amount: amt,
      date: e.date || todayISO(),
      recordedBy: caller.id,
    });
    this.refreshTotals(proj);
    audit(
      caller.id,
      "FUNDING_DISBURSED",
      proj.id,
      `${fmtMoney(amt)} disbursed`,
    );
    notifyFundingStakeholders(proj,caller.id,`${fmtMoney(amt)} was disbursed to ${proj.title} (${proj.id}) by the funding agency.`);
    saveDB();
    return { ok: true };
  },

  recordAllocation(projectId, caller, allocation) {
    // UC-005 alt flow b, BR-007
    if (!['FUNDING','COORDINATOR'].includes(caller.role))
      return err(
        "FORBIDDEN",
        "Only an authorized coordinator or funding representative can confirm sanctions.",
      );
    const proj = findProject(projectId);
    if (!proj) return err("NOT_FOUND", "Project not found.");
    if(hasViewOnlyMembership(proj,caller)) return err('FORBIDDEN','View Only project access cannot record a funding allocation.');
    if (!['Pending Funding','Active'].includes(proj.status))
      return err(
        "CONFLICT",
        "Funding can only be allocated to a project awaiting or receiving funding.",
      );
    const amount=Number(allocation.amount), authorizedAmount=Number(allocation.authorizedAmount), scheduleDate=allocation.scheduleDate;
    if(!(amount>0)||!Number.isFinite(amount)||!(authorizedAmount>0)||!Number.isFinite(authorizedAmount)||!validISODate(scheduleDate)) return err('UNPROCESSABLE','Enter a valid authorized amount, sanctioned amount and disbursement schedule date.');
    if(amount>authorizedAmount)return err('UNPROCESSABLE','The sanctioned amount cannot exceed the amount authorized by this funding source.');
    if(scheduleDate<proj.startDate) return err('UNPROCESSABLE','Disbursement schedule cannot be earlier than the project start date.');
    const proposal=findProposal(proj.proposalId);
    if(!proposal || proposal.status!=='Approved') return err('CONFLICT','Only an approved proposal can receive a funding allocation.');
    const selected=String(allocation.source||proj.funding.source||proposal.fundingSource||'').trim();
    const source=selected==='Other'?String(allocation.sourceName||'').trim():selected;
    const proposalSource=proposal.fundingSource==='Other'?proposal.fundingSourceOther:proposal.fundingSource;
    if(!source||(!DB.fundingSources.includes(selected)&&source!==proposalSource))return err('UNPROCESSABLE','Choose a valid funding source.');
    if(selected==='Other'&&!source)return err('UNPROCESSABLE','Enter the custom funding source name.');
    const records=this.records(proj);
    const wasPending=proj.status==='Pending Funding';
    const existing=records.find(r=>String(r.source||'').toLowerCase()===source.toLowerCase());
    const record=existing||{id:`FUND-${proj.id}-${String(records.length+1).padStart(2,'0')}`,source,proposedAmount:0};
    const nextSanctioned=Number(record.sanctioned||0)+amount;
    if(nextSanctioned>authorizedAmount)return err('UNPROCESSABLE','Total sanctioned funding from this source cannot exceed its authorized amount.');
    Object.assign(record,{source,authorizedAmount,sanctioned:nextSanctioned,received:Number(record.received||0),status:'Confirmed',disbursementSchedule:[...(record.disbursementSchedule||[]),{amount,date:scheduleDate}]});
    if(!existing)records.push(record);proj.fundingRecords=records;
    if(wasPending)proj.funding.proposedBudget=Number(proj.funding.proposedBudget||proposal.budget||0);
    proj.disbursements=proj.disbursements||[];proj.utilizations=proj.utilizations||[];this.refreshTotals(proj);
    if(wasPending){proj.status="Active";proj.activationDate=todayISO();}
    audit(
      caller.id,
      "FUNDING_SANCTION_CONFIRMED",
      proj.id,
      `${source}: ${fmtMoney(amount)} sanctioned; first disbursement scheduled ${scheduleDate}`,
    );
    if(wasPending)audit(caller.id, "PROJECT_ACTIVATED", proj.id, "Project is Active");
    notifyFundingStakeholders(proj,caller.id,wasPending?`Funding of ${fmtMoney(amount)} from ${source} for ${proj.title} (${proj.id}) was confirmed. The project is now Active.`:`An additional allocation of ${fmtMoney(amount)} from ${source} was recorded for ${proj.title} (${proj.id}).`);
    saveDB();
    return { ok: true };
  },
};

/* ---------- Administration (UC-002, FR-004, BR-019/020) ---------- */
const AdminService = {
  createUser(actor, data) {
    // UC-002, FR-004, BR-019: only administrators may provision accounts with roles
    if (actor.role !== "ADMIN")
      return err(
        "FORBIDDEN",
        "Only administrators can create user accounts and assign roles.",
      );
    const name = String(data.name || "").trim();
    const email = String(data.email || "")
      .trim()
      .toLowerCase();
    const dept = String(data.dept || "").trim();
    const role = data.role;
    const password = String(data.password || "");
    if (!name) return err("UNPROCESSABLE", "Enter the user's full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return err("UNPROCESSABLE", "Enter a valid email address.");
    if (DB.users.some((u) => u.email.toLowerCase() === email))
      return err("CONFLICT", "An account with this email already exists.");
    if (!VALID_ROLES.includes(role))
      return err("UNPROCESSABLE", "Choose a valid role.");
    if (password.length < 6)
      return err("UNPROCESSABLE", "Password must be at least 6 characters long.");
    const user = {
      id: nextId("usr"),
      name,
      email,
      role,
      dept: dept || "—",
      active: true,
      passwordHash: fakeHash(password),
      registeredOn: todayISO(),
    };
    DB.users.push(user);
    audit(actor.id, "USER_CREATED", user.id, `Account created with role ${role}`);
    notify(
      user.id,
      "system",
      `Welcome to RPMS! Your ${role} account was created by the system administrator.`,
    );
    saveDB();
    return { ok: true, user };
  },

  setRole(actor, userId, role) {
    if (actor.role !== "ADMIN")
      return err("FORBIDDEN", "Only administrators can change user roles."); // BR-019
    const u = DB.users.find((x) => x.id === userId);
    if (!u) return err("NOT_FOUND", "User not found.");
    if (!VALID_ROLES.includes(role)) return err("UNPROCESSABLE", "Choose a valid role.");
    u.role = role;
    audit(actor.id, "USER_ROLE_CHANGED", u.id, `Role set to ${role}`);
    saveDB();
    return { ok: true };
  },
  setActive(actor, userId, active) {
    if (actor.role !== "ADMIN")
      return err(
        "FORBIDDEN",
        "Only administrators can activate or deactivate accounts.",
      ); // BR-019
    const u = DB.users.find((x) => x.id === userId);
    if (!u) return err("NOT_FOUND", "User not found.");
    if (typeof active !== 'boolean') return err("UNPROCESSABLE", "Choose whether the account should be active.");
    u.active = active;
    audit(
      actor.id,
      active ? "USER_ACTIVATED" : "USER_DEACTIVATED",
      u.id,
      active
        ? "Account activated"
        : "Account deactivated; historical records retained (NFR-014)",
    );
    saveDB();
    return { ok: true };
  },
  markAllNotificationsRead(userId) {
    DB.notifications.forEach((n) => {
      if (n.recipient === userId) n.read = true;
    });
    saveDB();
  },
};
