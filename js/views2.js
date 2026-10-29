'use strict';
/* ==========================================================================
   RPMS prototype — views, part 2: review queue (UC-005), milestones (UC-011/012),
   funding, users, audit, notifications, projects
   ========================================================================== */

let pendingEvidence = [];   // in-memory evidence files for the current milestone form

function requireRole(u, roles, what){
  if(roles.includes(u.role)) return true;
  appEl().innerHTML = page('Forbidden', what||'', 
    alertBox('error',`Forbidden: your role (${ROLE_LABEL[u.role]}) cannot access this page (FR-004, NFR-006).`));
  return false;
}

/* ---------- Approver review queue (UC-005 start, wireframe 05) ---------- */
function viewReviewQueue(_, u){
  if(!requireRole(u,['APPROVER','ADMIN'],'Research Committee review queue')) return;
  const q = DB.proposals.filter(p=>p.status==='Under Review')
    .sort((a,b)=> (a.submissionDate||'') < (b.submissionDate||'') ? -1 : 1);
  const mq = DB.milestones.filter(m=>m.status==='Submitted for Review');
  appEl().innerHTML = page('Review Queue','Proposals and milestone completions awaiting decision', `
    <section class="card"><h2>Proposals Under Review</h2>
      ${q.length ? table(['Proposal ID','Title','PI','Submitted','Budget','Action'], q.map(p=>[
          p.id, `<a href="#/review/${p.id}">${esc(p.title)}</a>`, esc(userById(p.pi).name),
          fmtDate(p.submissionDate), fmtMoney(p.budget), `<a href="#/review/${p.id}">Open</a>`
        ])) : emptyState('No proposals are waiting for review. (M-18)')}
    </section>
    <section class="card"><h2>Milestone completions to verify</h2>
      ${mq.length ? table(['Milestone','Project','Target date','Action'], mq.map(m=>{
          const proj = findProject(m.projectId);
          return [`${m.code} ${esc(m.name)}`, `<a href="#/project/${proj.id}">${esc(proj.title)}</a>`,
                  fmtDate(m.targetDate), `<a href="#/milestone/${m.id}">Open</a>`];
        })) : emptyState('No milestone completions to verify.')}
    </section>`);
}

function viewProposalAssistance(_,u){
  if(!requireRole(u,['COORDINATOR'],'Proposal draft assistance'))return;
  const drafts=DB.proposals.filter(proposal=>proposal.status==='Draft'&&!proposal.deletedAt);
  appEl().innerHTML=page('Proposal Drafts','Research Coordinator assistance (user class 11.2, UC-003)',`
    <div class="row-actions"><a class="btn btn-primary" href="#/proposal/new">+ Prepare a draft for a PI</a></div>
    <section class="card"><h2>Draft proposals</h2>${drafts.length?table(['Proposal','Principal Investigator','Last updated','Action'],drafts.map(proposal=>[
      esc(proposal.title||'Untitled draft'),esc(userById(proposal.pi).name),fmtDate(proposal.lastUpdated),`<a href="#/proposal/${encodeURIComponent(proposal.id)}">Open draft</a> <button type="button" class="btn btn-light btn-sm" data-delete-draft="${esc(proposal.id)}">Delete</button>`
    ])):emptyState('No proposal drafts need assistance.')}</section>`);
  bindDraftDeleteButtons(u);
}

/* ---------- Review / Approve / Reject a proposal (UC-005 main, wireframe 06) ---------- */
function viewReviewProposal(id, u){
  if(!requireRole(u,['APPROVER','ADMIN'],'Proposal review')) return;
  const p = findProposal(id);
  if(!p){ appEl().innerHTML = page('Not found','', emptyState('Proposal not found.')); return; }
  const locked = p.status !== 'Under Review';
  appEl().innerHTML = page('Review Proposal '+p.id, `${pill(p.status)} · PI: ${esc(userById(p.pi).name)} · Submitted: ${fmtDateTime(p.submissionDate)}`, `
    <div id="review-msg">
      ${locked ? alertBox('error','This proposal is no longer Under Review. Refresh the review queue. (M-13)') : ''}
    </div>
    <section class="card"><h2>Proposal details (read-only)</h2>
      <div class="summary"><dl>
        <dt>Project title</dt><dd>${esc(p.title)}</dd>
        <dt>Funding source</dt><dd>${esc(p.fundingSource==='Other'?(p.fundingSourceOther||'Other'):p.fundingSource)}</dd>
        <dt>Budget (INR)</dt><dd>${fmtMoney(p.budget)}</dd>
        <dt>Proposed dates</dt><dd>${fmtDate(p.startDate)} → ${fmtDate(p.endDate)}</dd>
      </dl></div>
      <h3>Abstract</h3><div class="ro">${esc(p.abstract)}</div>
      <h3>Objectives</h3><div class="ro">${esc(p.objectives)}</div>
      <h3>Methodology</h3><div class="ro">${esc(p.methodology)}</div>
      <h3>Expected outcomes</h3><div class="ro">${esc(p.expectedOutcomes)}</div>
      <h3>Expected milestones</h3><div class="ro">${esc(p.expectedMilestones)}</div>
      ${p.investigatorDetails?`<h3>Investigator details</h3><div class="ro">${esc(p.investigatorDetails)}</div>`:''}
      ${p.expectedDeliverables?`<h3>Expected deliverables</h3><div class="ro">${esc(p.expectedDeliverables)}</div>`:''}
      <h3>Supporting documents</h3>
      ${p.documents.length ? table(['Name','Type','Version','Size','Uploaded','Action'], p.documents.map(d=>[
          esc(d.name), esc(d.type), 'v'+d.version, esc(d.size), fmtDate(d.uploadDate),`<button class="btn btn-sm" data-download-doc="${esc(d.id)}" data-download-name="${esc(d.name)}">Download</button>`])) : emptyState('None.')}
    </section>
    ${locked ? '' : `
    <section class="form-card">
      <p class="quiet">Approval creates a Pending Funding project. The Funding Agency representative records the sanctioned amount and disbursement schedule before activation.</p>
      <div class="field"><label for="rv-comments">Review comments (required when rejecting)</label>
        <textarea id="rv-comments" placeholder="Enter comments for the Principal Investigator…"></textarea></div>
      <div class="row-actions">
        <button class="btn btn-success" id="rv-approve">Approve</button>
        <button class="btn btn-warn" id="rv-revision">Request Revisions</button>
        <button class="btn btn-danger" id="rv-reject">Reject</button>
        <a class="btn btn-light" href="#/review">Back to queue</a>
      </div>
    </section>`}
  `);
  document.querySelectorAll('[data-download-doc]').forEach(button=>button.onclick=()=>DocumentService.download(button.dataset.downloadDoc,button.dataset.downloadName).catch(error=>toast(error.message,'error')));
  if(locked) return;
  const comments = () => document.getElementById('rv-comments').value;
  const showErr = res => {
    document.getElementById('review-msg').innerHTML = alertBox('error', esc(res.message));
    window.scrollTo({top:0, behavior:'smooth'});
  };
  document.getElementById('rv-approve').onclick = () => {
    const res = ProposalService.decide(p.id, u, 'Approved', comments(), false);
    if(!res.ok) return showErr(res);
    toast(res.deferred
      ? 'Proposal approved — project activation deferred until funding confirmation.'
      : 'Proposal approved. The project is now Active. (M-15)');
    location.hash = '#/review';
  };
  document.getElementById('rv-reject').onclick = () => {
    const res = ProposalService.decide(p.id, u, 'Rejected', comments());
    if(!res.ok) return showErr(res);
    toast('Proposal rejected. The PI has been notified.');
    location.hash = '#/review';
  };
  document.getElementById('rv-revision').onclick = () => {
    const res=ProposalService.decide(p.id,u,'Revision Required',comments());
    if(!res.ok)return showErr(res);
    toast('Revision requested. The proposal draft was returned to the PI.'); location.hash='#/review';
  };
}

/* ---------- Milestone detail: submit completion (PI) / verify (Approver) ---------- */
function viewMilestone(id, u){
  const m = findMilestone(id);
  if(!m){ appEl().innerHTML = page('Not found','', emptyState('Milestone not found.')); return; }
  const proj = findProject(m.projectId);
  if(!canViewProject(proj,u)){
    appEl().innerHTML = page('Forbidden','',alertBox('error','Access denied: this project has not been shared with your account.'));
    return;
  }
  const isOwner = proj.pi === u.id;
  if(!isOwner && !projectAccess(proj,u) && !['APPROVER','ADMIN','AUDITOR','COORDINATOR'].includes(u.role)){
    appEl().innerHTML = page('Forbidden','', alertBox('error','Access denied (BR-024).')); return;
  }
  const canEditDeliverables=canContributeProject(proj,u)&&(['PI','COORDINATOR'].includes(u.role)||projectAccess(proj,u)==='Contributor')&&!['On Hold','Completed'].includes(proj.status);
  const deliverables = m.deliverables.length ? table(['Deliverable','Type','Due date','Submission date','Status','Submitted by','Remarks','Update'], m.deliverables.map(d=>[
    `<b>${esc(d.name)}</b><br>${esc(d.description||'')}`,esc(d.type||'—'), fmtDate(d.dueDate),fmtDate(d.submissionDate), pill(d.status),d.submittedBy?esc(userById(d.submittedBy).name):'—',esc(d.remarks||'—'),canEditDeliverables?`<input type="text" aria-label="Deliverable name" data-dlv-name="${esc(d.id)}" value="${esc(d.name)}"><input type="text" aria-label="Deliverable type" data-dlv-type="${esc(d.id)}" value="${esc(d.type||'')}"><input type="text" aria-label="Description" data-dlv-description="${esc(d.id)}" value="${esc(d.description||'')}"><input type="date" aria-label="Due date" data-dlv-due="${esc(d.id)}" value="${esc(d.dueDate||'')}"><select data-dlv-status="${esc(d.id)}"><option ${d.status==='Pending'?'selected':''}>Pending</option><option ${d.status==='In Progress'?'selected':''}>In Progress</option><option ${d.status==='Submitted'?'selected':''}>Submitted</option><option ${d.status==='Completed'?'selected':''}>Completed</option></select><input type="date" aria-label="Submission date" data-dlv-date="${esc(d.id)}" value="${esc(d.submissionDate||'')}"><input type="text" aria-label="Remarks" data-dlv-remarks="${esc(d.id)}" placeholder="Remarks" value="${esc(d.remarks||'')}"><button class="btn btn-sm" data-save-deliverable="${esc(d.id)}">Save</button>`:'—'])) : emptyState('No deliverables recorded.');
  const evidence = DB.documents.filter(d=>d.projectId===proj.id && d.milestoneId===m.id);
  const evidenceTable = evidence.length ? table(['Evidence document','Version','Size','Uploaded','Action'],
      evidence.map(d=>[esc(d.name),'v'+d.version,esc(d.size),fmtDate(d.uploadDate),`<button class="btn btn-sm" data-download-doc="${esc(d.id)}" data-download-name="${esc(d.name)}">Download</button>`]))
    : emptyState('No evidence documents uploaded yet.');

  appEl().innerHTML = page('Milestone '+m.code+' — '+m.name, '', `
    <div id="ms-msg"></div>
    <div class="summary"><dl>
      <dt>Milestone</dt><dd>${m.code} ${esc(m.name)}</dd>
      <dt>Project</dt><dd><a href="#/project/${proj.id}">${esc(proj.title)}</a> ${pill(proj.status)}</dd>
      <dt>Target date</dt><dd>${fmtDate(m.targetDate)}</dd>
      <dt>Current status</dt><dd>${pill(MilestoneService.displayStatus(m))}</dd>
      ${m.submittedAt?`<dt>Completion submission</dt><dd>${fmtDateTime(m.submittedAt)} · submitted by ${esc(userById(m.completionReview?.submittedBy||proj.pi).name)}</dd>`:''}
      ${m.completionReview&&m.completionReview.outcome!=='Pending'?`<dt>Review outcome</dt><dd>${esc(m.completionReview.outcome)} by ${esc(userById(m.completionReview.reviewer).name)} on ${fmtDateTime(m.completionReview.reviewedAt)}${m.completionReview.comments?` — ${esc(m.completionReview.comments)}`:''}</dd>`:''}
      ${m.remarks?`<dt>Review comments / remarks</dt><dd>${esc(m.remarks)}</dd>`:''}
    </dl></div>
    <section class="card"><h2>Associated deliverables</h2>${deliverables}</section>
    <section class="card"><h2>Evidence documents</h2>${evidenceTable}</section>
    <div id="ms-form"></div>
  `);

  const formEl = document.getElementById('ms-form');
  document.querySelectorAll('[data-download-doc]').forEach(button=>button.onclick=()=>DocumentService.download(button.dataset.downloadDoc,button.dataset.downloadName).catch(error=>toast(error.message,'error')));
  document.querySelectorAll('[data-save-deliverable]').forEach(button=>button.onclick=()=>{
    const did=button.dataset.saveDeliverable;
    const result=DeliverableService.update(did,u,{name:document.querySelector(`[data-dlv-name="${did}"]`).value,type:document.querySelector(`[data-dlv-type="${did}"]`).value,description:document.querySelector(`[data-dlv-description="${did}"]`).value,dueDate:document.querySelector(`[data-dlv-due="${did}"]`).value,status:document.querySelector(`[data-dlv-status="${did}"]`).value,submissionDate:document.querySelector(`[data-dlv-date="${did}"]`).value,remarks:document.querySelector(`[data-dlv-remarks="${did}"]`).value});
    if(!result.ok)return toast(result.message,'error');toast('Deliverable updated.');viewMilestone(m.id,u);
  });
  if(u.role === 'APPROVER' && m.status === 'Submitted for Review'){
    formEl.innerHTML = `
      <section class="form-card">
        <p>Verify the completion evidence above, then approve the milestone or request a revision (UC-012, FR-019).</p>
        <div class="field"><label for="ms-comments">Comments (required when requesting revision)</label>
          <textarea id="ms-comments" placeholder="Comments for the PI…"></textarea></div>
        <div class="row-actions">
          <button class="btn btn-success" id="ms-approve">Approve Completion</button>
          <button class="btn btn-warn" id="ms-revision">Request Revision</button>
          <a class="btn btn-light" href="#/review">Back to queue</a>
        </div>
      </section>`;
    const showErr = res => {
      document.getElementById('ms-msg').innerHTML = alertBox('error', esc(res.message));
      window.scrollTo({top:0, behavior:'smooth'});
    };
    document.getElementById('ms-approve').onclick = () => {
      const res = MilestoneService.decide(m.id, u, 'Completed', document.getElementById('ms-comments').value);
      if(!res.ok) return showErr(res);
      toast('Milestone approved and marked Completed.');
      viewMilestone(m.id, u);
    };
    document.getElementById('ms-revision').onclick = () => {
      const res = MilestoneService.decide(m.id, u, 'Revision Required', document.getElementById('ms-comments').value);
      if(!res.ok) return showErr(res);
      toast('Revision requested — milestone returned to In Progress.');
      viewMilestone(m.id, u);
    };
  }
  else if(canContributeProject(proj,u) && (['PI','COORDINATOR'].includes(u.role)||projectAccess(proj,u)==='Contributor') && proj.status==='Active'){
    const canSubmit=['In Progress','Overdue'].includes(MilestoneService.displayStatus(m));
    pendingEvidence = [];
    formEl.innerHTML = `
      <section class="form-card">
        <h2 style="margin-top:0">Milestone progress</h2>
        ${m.status!=='Submitted for Review' ? `<div class="inline-access"><label for="milestone-status">Update status</label><select id="milestone-status"><option value="In Progress" ${m.status==='In Progress'?'selected':''}>In Progress</option><option value="Not Started" ${['Not Started','Pending'].includes(m.status)?'selected':''}>Not Started</option></select><button class="btn btn-sm" id="save-milestone-status">Save status</button></div>`:''}
        ${canSubmit ? `<h2>Submit milestone for completion review (UC-011)</h2>
        <div class="field"><label>Evidence documents <span class="req">*</span> (at least one, FR-018 / BR-013)</label>
          <div class="upload-row">
            <input type="file" id="ev-file" multiple style="flex:1">
            <button class="btn btn-light" id="ev-add" type="button">Add evidence</button>
          </div>
          <div class="filelist" id="ev-list"></div>
        </div>
        <div class="field"><label for="ms-remarks">Remarks (optional)</label>
          <textarea id="ms-remarks" placeholder="Add remarks for the approver…"></textarea></div>
        <div class="row-actions">
          <button class="btn btn-primary" id="ms-submit">Submit for Review</button>
          <a class="btn btn-light" href="#/dashboard">Cancel</a>
        </div>`:''}
        ${proj.status==='Active' ? `<h2>Add deliverable</h2><div class="grid2"><div class="field"><label for="dlv-name">Name *</label><input id="dlv-name" type="text"></div><div class="field"><label for="dlv-type">Type *</label><input id="dlv-type" type="text" placeholder="Report, dataset, software…"></div></div><div class="grid2"><div class="field"><label for="dlv-due">Due date</label><input id="dlv-due" type="date"></div><div class="field"><label for="dlv-description">Description</label><input id="dlv-description" type="text"></div></div><button class="btn btn-primary btn-sm" id="add-deliverable">Add Deliverable</button>`:''}
      </section>`;
    const statusButton=document.getElementById('save-milestone-status');
    if(statusButton) statusButton.onclick=()=>{const result=MilestoneService.updateStatus(m.id,u,document.getElementById('milestone-status').value);if(!result.ok)return toast(result.message,'error');toast('Milestone status updated.');viewMilestone(m.id,u);};
    const addButton=document.getElementById('add-deliverable');
    if(addButton) addButton.onclick=()=>{const result=DeliverableService.add(m.id,u,{name:document.getElementById('dlv-name').value,type:document.getElementById('dlv-type').value,dueDate:document.getElementById('dlv-due').value,description:document.getElementById('dlv-description').value});if(!result.ok)return toast(result.message,'error');toast('Deliverable added.');viewMilestone(m.id,u);};
    const submitButton=document.getElementById('ms-submit');
    if(submitButton) submitButton.onclick = () => {
      const res = MilestoneService.submitCompletion(m.id, u, pendingEvidence, document.getElementById('ms-remarks').value);
      if(!res.ok){document.getElementById('ms-msg').innerHTML=alertBox('error',esc(res.message));return;}
      toast('Milestone submitted for completion review. Approvers have been notified.'); viewMilestone(m.id,u);
    };
    const renderChips = () => {
      document.getElementById('ev-list').innerHTML = pendingEvidence.map((f,i)=>
        `<div class="filechip"><span>${esc(f.name)} (${humanSize(f.size)}) — ready to upload</span>
         <button data-i="${i}" type="button">Remove</button></div>`).join('');
      document.querySelectorAll('#ev-list button').forEach(b => b.onclick = () => {
        pendingEvidence.splice(Number(b.dataset.i),1); renderChips();
      });
    };
    const evidenceButton=document.getElementById('ev-add');
    if(evidenceButton) evidenceButton.onclick = () => {
      const inp = document.getElementById('ev-file');
      [...inp.files].forEach(f => pendingEvidence.push(f));
      inp.value = '';
      renderChips();
    };
  }
  else{
    const memberAccess=projectAccess(proj,u);
    const readOnlyReason=proj.status!=='Active'
      ? `Milestone progress cannot be changed while the project is ${esc(proj.status)}.`
      : memberAccess==='View Only'
        ? `Your project access is View Only. Ask ${esc(userById(proj.pi).name)} to change it to Contributor.`
        : `Your current role has read-only access here. Status changes are available to the project PI, a Research Coordinator, or an assigned Contributor. The project PI is ${esc(userById(proj.pi).name)}.`;
    formEl.innerHTML = `<section class="card"><p class="quiet">${readOnlyReason}</p></section>`;
  }
}

/* ---------- Funding management (UC-013/014/018, FR-022…025) ---------- */
function viewFunding(_, u){
  if(!requireRole(u,['COORDINATOR','FUNDING','ADMIN','AUDITOR','PI'],'Funding management')) return;
  const projects = u.role === 'PI' ? DB.projects.filter(p=>canViewProject(p,u)&&projectAccess(p,u)!=='View Only') : DB.projects;
  const allocationOptions=FundingService.allocationOptions(projects);
  const availableForUtilization=allocationOptions.filter(a=>a.sanctioned>0);
  const availableForDisbursement=allocationOptions.filter(a=>a.sanctioned>a.received);
  let forms = '';
  if(u.role === 'COORDINATOR'){
    forms = `<section class="form-card"><h2 style="margin-top:0">Record Fund Utilization (UC-014, FR-023)</h2>
      <div class="grid2">
        <div class="field"><label for="ut-allocation">Project and funding source</label><select id="ut-allocation" ${availableForUtilization.length?'':'disabled'}>
          ${availableForUtilization.map(a=>`<option value="${esc(a.projectId)}|${esc(a.fundingId)}">${esc(a.projectId)} — ${esc(a.projectTitle)} · ${esc(a.source)}</option>`).join('')||'<option>No approved allocations</option>'}</select></div>
        <div class="field"><label for="ut-cat">Category</label><select id="ut-cat">
          ${['Equipment','Consumables','Travel','Manpower','Other'].map(c=>`<option>${c}</option>`).join('')}</select></div>
        <div class="field"><label for="ut-amt">Amount (INR) <span class="req">*</span></label>
          <input type="number" id="ut-amt" min="1" placeholder="e.g. 50000"></div>
        <div class="field"><label for="ut-date">Date</label><input type="date" id="ut-date" value="${todayISO()}"></div>
      </div>
      <div class="field"><label for="ut-desc">Description <span class="req">*</span></label>
        <input type="text" id="ut-desc" placeholder="What was this spending for?"></div>
      <div class="row-actions"><button class="btn btn-primary" id="ut-save">Record Utilization</button></div>
    </section>`;
  }
  if(u.role === 'FUNDING'){
    forms = `<section class="form-card"><h2 style="margin-top:0">Record Disbursement (FR-022)</h2>
      <div class="grid2">
        <div class="field"><label for="db-allocation">Project and funding source</label><select id="db-allocation" ${availableForDisbursement.length?'':'disabled'}>
          ${availableForDisbursement.map(a=>`<option value="${esc(a.projectId)}|${esc(a.fundingId)}">${esc(a.projectId)} — ${esc(a.projectTitle)} · ${esc(a.source)} (${fmtMoney(a.sanctioned-a.received)} available)</option>`).join('')||'<option>No remaining approved allocation</option>'}</select></div>
        <div class="field"><label for="db-amt">Amount (INR) <span class="req">*</span></label>
          <input type="number" id="db-amt" min="1" placeholder="e.g. 600000"></div>
        <div class="field"><label for="db-date">Date</label><input type="date" id="db-date" value="${todayISO()}"></div>
      </div>
      <div class="row-actions"><button class="btn btn-primary" id="db-save">Record Disbursement</button></div>
    </section>`;
  }
  appEl().innerHTML = page('Funding Management',
    'Sanctioned budget, disbursements and utilization per project (FR-022…FR-025)', `
    ${forms}
    <div id="fund-cards">${projects.map(p => fundingCard(p, { extra: fundingCardExtra(p, u) })).join('') || emptyState('No projects with funding yet.')}</div>`);
  document.querySelectorAll('[data-sanction-source]').forEach(select=>select.onchange=()=>{const field=document.getElementById(`sanction-source-other-${select.dataset.sanctionSource}`);field.classList.toggle('hidden',select.value!=='Other');field.required=select.value==='Other';});
  if(u.role === 'COORDINATOR'){
    document.getElementById('ut-save').onclick = () => {
      const selection=document.getElementById('ut-allocation').value;if(!selection||!selection.includes('|'))return toast('Record a funding allocation before entering utilization.','error');
      const [projectId,fundingId]=selection.split('|');
      const res = FundingService.recordUtilization(projectId, u, {
        fundingId,
        amount: document.getElementById('ut-amt').value,
        category: document.getElementById('ut-cat').value,
        description: document.getElementById('ut-desc').value,
        date: document.getElementById('ut-date').value,
      });
      if(!res.ok) return toast(res.message,'error');
      toast(res.pct >= 80 ? `Utilization recorded — budget alert raised at ${res.pct}% (FR-025).` : 'Utilization entry recorded (AC-24).');
      viewFunding(null, u);
    };
  }
  if(u.role === 'FUNDING'){
    document.getElementById('db-save').onclick = () => {
      const selection=document.getElementById('db-allocation').value;if(!selection||!selection.includes('|'))return toast('There is no remaining sanctioned balance to disburse.','error');
      const [projectId,fundingId]=selection.split('|');
      const res = FundingService.recordDisbursement(projectId, u, {
        fundingId,amount: document.getElementById('db-amt').value, date: document.getElementById('db-date').value });
      if(!res.ok) return toast(res.message,'error');
      toast('Disbursement recorded.');
      viewFunding(null, u);
    };
  }
  if(['FUNDING','COORDINATOR'].includes(u.role))document.querySelectorAll('[data-confirm-sanction]').forEach(button=>button.onclick=()=>{
    const projectId=button.dataset.confirmSanction,source=document.getElementById(`sanction-source-${projectId}`).value;
    const result=FundingService.recordAllocation(projectId,u,{source,sourceName:document.getElementById(`sanction-source-other-${projectId}`).value,authorizedAmount:document.getElementById(`funding-authorized-${projectId}`).value,amount:document.getElementById(`sanction-amount-${projectId}`).value,scheduleDate:document.getElementById(`sanction-date-${projectId}`).value});
    if(!result.ok)return toast(result.message,'error');toast('Funding allocation recorded.');viewFunding(null,u);
  });
}

function fundingCardExtra(proj, u){
  const rows = [];
  if(u.role!=='PI'&&proj.fundingRecords?.length)rows.push('<h3>Funding sources</h3>'+table(['Source','Authorized','Sanctioned','Disbursed','Schedule'],proj.fundingRecords.map(record=>[esc(record.source),fmtMoney(record.authorizedAmount),fmtMoney(record.sanctioned),fmtMoney(record.received),(record.disbursementSchedule||[]).map(item=>`${fmtDate(item.date)} · ${fmtMoney(item.amount)}`).join('<br>')||'—'])));
  if(u.role !== 'PI'){
    if(proj.disbursements.length)
      rows.push('<h3>Disbursements</h3>' + table(['Date','Funding source','Amount','Recorded by'], proj.disbursements.map(d=>[
        fmtDate(d.date),esc(d.fundingSource||proj.fundingRecords?.find(r=>r.id===d.fundingId)?.source||'—'),fmtMoney(d.amount),esc(userById(d.recordedBy).name)])));
    if(proj.utilizations.length)
      rows.push('<h3>Utilization entries</h3>' + table(['Date','Funding source','Category','Description','Amount','Recorded by'],
        proj.utilizations.slice(0,6).map(x=>[
          fmtDate(x.date),esc(x.fundingSource||proj.fundingRecords?.find(r=>r.id===x.fundingId)?.source||'—'),esc(x.category), esc(x.description), fmtMoney(x.amount), esc(userById(x.recordedBy).name)])));
  }
  if(['FUNDING','COORDINATOR'].includes(u.role)&&['Pending Funding','Active'].includes(proj.status)){
    const initialRecord=proj.fundingRecords?.find(r=>Number(r.sanctioned||0)===0)||proj.fundingRecords?.[0];
    const initial=initialRecord?.source||'';
    const selected=DB.fundingSources.includes(initial)?initial:(initial?'Other':DB.fundingSources[0]);
    const otherName=initial&&!DB.fundingSources.includes(initial)?initial:'';
    rows.push(`<div class="card"><h3>Record funding allocation</h3><p class="quiet">Proposed budget: ${fmtMoney(proj.funding.proposedBudget)}. Enter the source's authorized cap separately from this project's sanction. ${proj.status==='Pending Funding'?'This first confirmation activates the project.':'Additional sources can be recorded without changing project status.'}</p><div class="grid2"><div class="field"><label for="sanction-source-${proj.id}">Funding source</label><select id="sanction-source-${proj.id}" data-sanction-source="${proj.id}">${DB.fundingSources.map(source=>`<option value="${esc(source)}" ${source===selected?'selected':''}>${esc(source)}</option>`).join('')}</select><input class="${selected==='Other'?'':'hidden'}" type="text" id="sanction-source-other-${proj.id}" value="${esc(otherName)}" placeholder="Enter funding source name" ${selected==='Other'?'required':''}></div><div class="field"><label for="funding-authorized-${proj.id}">Authorized amount (INR) <span class="req">*</span></label><input type="number" min="1" id="funding-authorized-${proj.id}" value="${Number(initialRecord?.authorizedAmount||0)||''}" required></div><div class="field"><label for="sanction-amount-${proj.id}">Sanctioned amount (INR) <span class="req">*</span></label><input type="number" min="1" id="sanction-amount-${proj.id}" required></div><div class="field"><label for="sanction-date-${proj.id}">Disbursement schedule date</label><input type="date" min="${esc(proj.startDate)}" id="sanction-date-${proj.id}" required></div></div><button class="btn btn-success" data-confirm-sanction="${proj.id}">Save allocation${proj.status==='Pending Funding'?' and activate':''}</button></div>`);
  }
  return rows.join('');
}

/* ---------- Users & roles (UC-002, FR-004, BR-019/020) ---------- */
function viewUsers(_, u){
  if(!requireRole(u,['ADMIN'],'User administration')) return;
  appEl().innerHTML = page('Manage Users & Roles','FR-004: only administrators may assign or modify roles (BR-019)', `
    <section class="form-card"><h2 style="margin-top:0">Create User (UC-002)</h2>
      <div class="grid2">
        <div class="field"><label for="nu-name">Full name <span class="req">*</span></label>
          <input type="text" id="nu-name" placeholder="e.g. Prof. N. Agarwal"></div>
        <div class="field"><label for="nu-dept">Department</label>
          <input type="text" id="nu-dept" placeholder="e.g. Research Committee"></div>
        <div class="field"><label for="nu-email">Email <span class="req">*</span></label>
          <input type="email" id="nu-email" placeholder="name@lnmiit.ac.in"></div>
        <div class="field"><label for="nu-role">Role <span class="req">*</span></label>
          <select id="nu-role">${Object.keys(ROLE_LABEL).map(r=>`<option value="${r}" ${r==='PI'?'selected':''}>${ROLE_LABEL[r]}</option>`).join('')}</select></div>
        <div class="field"><label for="nu-pass">Initial password <span class="req">*</span></label>
          <input type="password" id="nu-pass" placeholder="At least 6 characters"></div>
      </div>
      <div class="row-actions"><button class="btn btn-primary" id="nu-save">Create User</button></div>
      <p class="quiet">Provisioning other roles lives here because the SRS reserves role assignment for
      administrators (BR-019) — self-registration always joins as a Principal Investigator.</p>
    </section>
    <section class="card">
      ${table(['Name','Email','Department','Role','Status','Action'], DB.users.map(x=>[
        esc(x.name), esc(x.email), esc(x.dept),
        `<select data-user="${x.id}" class="role-sel">
           ${Object.keys(ROLE_LABEL).map(r=>`<option value="${r}" ${r===x.role?'selected':''}>${ROLE_LABEL[r]}</option>`).join('')}
         </select>`,
        x.active ? pill('Active') : pill('Rejected').replace('>Rejected<','>Deactivated<'),
        `<button class="btn btn-sm ${x.active?'btn-danger':''}" data-toggle="${x.id}">${x.active?'Deactivate':'Activate'}</button>`
      ]))}
      <p class="quiet">Deactivated users cannot log in (BR-020); their historical records are retained (NFR-014).</p>
    </section>`);
  document.getElementById('nu-save').onclick = () => {
    const val = id => document.getElementById(id).value;
    const res = AdminService.createUser(u, { name:val('nu-name'), email:val('nu-email'),
      dept:val('nu-dept'), role:val('nu-role'), password:val('nu-pass') });
    if(!res.ok){ toast(res.message,'error'); return; }
    toast('User created with role ' + val('nu-role') + '.');
    viewUsers(null, u);
  };
  document.querySelectorAll('.role-sel').forEach(sel => sel.onchange = () => {
    const res = AdminService.setRole(u, sel.dataset.user, sel.value);
    toast(res.ok ? 'Role updated (BR-019) and written to the audit log.' : res.message, res.ok?'success':'error');
    if(res.ok) viewUsers(null, u);
  });
  document.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => {
    const target = DB.users.find(x=>x.id===b.dataset.toggle);
    const res = AdminService.setActive(u, target.id, !target.active);
    toast(res.ok ? (target.active?'Account deactivated.':'Account activated.') : res.message, res.ok?'success':'error');
    if(res.ok) viewUsers(null, u);
  });
}

/* ---------- Audit log (UC-019, NFR-024/025) ---------- */
function viewAudit(_, u){
  if(!requireRole(u,['ADMIN','AUDITOR'],'Audit trail')) return;
  appEl().innerHTML = page('Audit Log','Append-only record of significant actions (NFR-024, NFR-025) — read-only', `
    <section class="card">
      ${table(['Time','Actor','Action','Target','Remarks'], DB.auditLog.map(a=>[
        fmtDateTime(a.time), esc(userById(a.actor).name), esc(a.action), esc(a.target), esc(a.remarks)]))}
    </section>`);
}

/* ---------- Notifications (FR-029…FR-031) ---------- */
function viewNotifications(_, u){
  const unread = unreadCount(u.id);
  appEl().innerHTML = page('Notifications', unread+' unread', `
    <section class="card">
      <div class="row-actions" style="margin-top:0">
        ${unread ? '<button class="btn btn-sm" id="ntf-read">Mark all as read</button>' : '<span class="quiet">All caught up.</span>'}
      </div>
      ${notifList(u.id, 100)}
    </section>`);
  const b = document.getElementById('ntf-read');
  if(b) b.onclick = () => { AdminService.markAllNotificationsRead(u.id); viewNotifications(null, u); };
}

/* ---------- Projects browse (UC-007/008, FR-013/014) ---------- */
const projFilter = { q:'', status:'', domain:'', funding:'', dateFrom:'', dateTo:'' };
function viewProjects(_, u){
  const visibleProjects = DB.projects.filter(p=>canViewProject(p,u));
  const domains = [...new Set(visibleProjects.map(p=>p.domain))];
  const fundingSources=[...new Set(visibleProjects.map(p=>p.funding?.source).filter(Boolean))];
  appEl().innerHTML = page('Projects','Browse, search and filter research projects (FR-013, FR-014)', `
    <section class="card">
      <div class="filters">
        <input id="pq" placeholder="Search title, PI or domain…" value="${esc(projFilter.q)}">
        <select id="ps"><option value="">All statuses</option>
          ${['Active','Pending Funding','On Hold','Completed'].map(s=>`<option ${projFilter.status===s?'selected':''}>${s}</option>`).join('')}</select>
        <select id="pd"><option value="">All domains</option>
          ${domains.map(d=>`<option ${projFilter.domain===d?'selected':''}>${esc(d)}</option>`).join('')}</select>
        <select id="pf"><option value="">All funding sources</option>${fundingSources.map(source=>`<option ${projFilter.funding===source?'selected':''}>${esc(source)}</option>`).join('')}</select>
        <label class="quiet">From <input id="pfrom" type="date" value="${esc(projFilter.dateFrom)}"></label><label class="quiet">To <input id="pto" type="date" value="${esc(projFilter.dateTo)}"></label>
      </div>
      <div id="ptab">${projectsTable(u)}</div>
    </section>`);
  document.getElementById('pq').oninput = e => { projFilter.q = e.target.value; document.getElementById('ptab').innerHTML = projectsTable(u); };
  document.getElementById('ps').onchange = e => { projFilter.status = e.target.value; document.getElementById('ptab').innerHTML = projectsTable(u); };
  document.getElementById('pd').onchange = e => { projFilter.domain = e.target.value; document.getElementById('ptab').innerHTML = projectsTable(u); };
  document.getElementById('pf').onchange = e => { projFilter.funding = e.target.value; document.getElementById('ptab').innerHTML = projectsTable(u); };
  document.getElementById('pfrom').onchange = e => { projFilter.dateFrom=e.target.value;document.getElementById('ptab').innerHTML=projectsTable(u); };
  document.getElementById('pto').onchange = e => { projFilter.dateTo=e.target.value;document.getElementById('ptab').innerHTML=projectsTable(u); };
}
function projectsTable(u){
  const q = projFilter.q.toLowerCase();
  const rows = DB.projects.filter(p => canViewProject(p,u) &&
    (!projFilter.status || p.status === projFilter.status) &&
    (!projFilter.domain || p.domain === projFilter.domain) &&
    (!projFilter.funding || p.funding?.source===projFilter.funding) &&
    (!projFilter.dateFrom || p.expectedEndDate>=projFilter.dateFrom) &&
    (!projFilter.dateTo || p.startDate<=projFilter.dateTo) &&
    (!q || (p.title+' '+userById(p.pi).name+' '+p.domain+' '+p.id).toLowerCase().includes(q))
  );
  return rows.length ? table(['Project ID','Title','PI','Domain','Status','Start','Expected end','Action'],
      rows.map(p=>[p.id, `<a href="#/project/${p.id}">${esc(p.title)}</a>`, esc(userById(p.pi).name),
        esc(p.domain), pill(p.status), fmtDate(p.startDate), fmtDate(p.expectedEndDate),
        `<a href="#/project/${p.id}">View</a>`]))
    : emptyState('No projects match the current filters.');
}

/* ---------- Project detail (UC-008, FR-015) ---------- */
function viewProject(id, u){
  const proj = findProject(id);
  if(!proj){ appEl().innerHTML = page('Not found','', emptyState('Project not found.')); return; }
  if(!canViewProject(proj,u)){
    appEl().innerHTML = page('Forbidden','',alertBox('error','Access denied: this project has not been shared with your account.'));
    return;
  }
  const memberAccess=projectAccess(proj,u);
  const canSeeFunding = (u.role !== 'APPROVER' || proj.pi === u.id) && memberAccess!=='View Only';   // NFR-023
  const canSeeProposal=proj.pi===u.id||['COORDINATOR','APPROVER','ADMIN','AUDITOR'].includes(u.role);
  const projectTeam = proj.team || [];
  const teamChoices = DB.users.filter(x=>x.active && x.id!==proj.pi && !projectTeam.some(m=>m.userId===x.id));
  const canManageTeam = u.role==='PI' && proj.pi===u.id;
  const canUploadDocuments=proj.pi===u.id||u.role==='ADMIN'||(proj.team||[]).some(m=>m.userId===u.id&&m.access==='Contributor');
  const statusOptions={Active:['On Hold','Completed','Terminated'],'On Hold':['Active','Terminated']}[proj.status]||[];
  const canChangeStatus=statusOptions.length&&((u.role==='PI'&&proj.pi===u.id)||['COORDINATOR','ADMIN'].includes(u.role));
  const ms = DB.milestones.filter(m=>m.projectId===proj.id);
  const docs = DB.documents.filter(d=>d.projectId===proj.id||d.proposalId===proj.proposalId);
  appEl().innerHTML = page(proj.title, `${proj.id} · ${pill(proj.status)}`, `
    <div class="summary"><dl>
      <dt>Principal Investigator</dt><dd>${esc(userById(proj.pi).name)}</dd>
      <dt>Domain</dt><dd>${esc(proj.domain)}</dd>
      <dt>Timeline</dt><dd>${fmtDate(proj.startDate)} → ${fmtDate(proj.expectedEndDate)}</dd>
      ${proj.funding.proposedBudget?`<dt>Proposed budget</dt><dd>${fmtMoney(proj.funding.proposedBudget)}</dd>`:''}
      ${canSeeProposal?`<dt>Linked proposal</dt><dd><a href="#/proposal/${proj.proposalId}">${proj.proposalId}</a></dd>`:''}
    </dl></div>
    <section class="card"><h2>Funding</h2>
      ${canSeeFunding ? `
        <div class="fund-nums">
          <div class="fn"><b>${fmtMoney(proj.funding.sanctioned)}</b><span>Sanctioned</span></div>
          <div class="fn"><b>${fmtMoney(proj.funding.received)}</b><span>Disbursed</span></div>
          <div class="fn"><b>${fmtMoney(proj.funding.utilized)}</b><span>Utilized</span></div>
          <div class="fn"><b>${fmtMoney(proj.funding.sanctioned - proj.funding.utilized)}</b><span>Remaining</span></div>
        </div>
        ${utilizationBar(FundingService.utilizationPct(proj))}
        ${proj.fundingRecords?.length?table(['Funding source','Authorized','Sanctioned','Disbursed'],proj.fundingRecords.map(record=>[esc(record.source),fmtMoney(record.authorizedAmount),fmtMoney(record.sanctioned),fmtMoney(record.received)])):''}`
        : alertBox('info','Funding details are restricted for your role (NFR-023).')}
    </section>
    <section class="card"><h2>Milestones &amp; deliverables</h2>
      ${ms.length ? table(['Code','Milestone','Target date','Status','Action'], ms.map(m=>[
          m.code, `<a href="#/milestone/${m.id}">${esc(m.name)}</a>`, fmtDate(m.targetDate),
          pill(MilestoneService.displayStatus(m)),
          `<a href="#/milestone/${m.id}">Open</a>`])) : emptyState('No milestones defined yet.')}
    </section>
    <section class="card"><h2>Documents</h2>
      ${docs.length ? table(['Name','Type','Version','Size','Uploaded by','Uploaded','Action'], docs.map(d=>[
          esc(d.name), esc(d.type), 'v'+d.version, esc(d.size), esc(userById(d.uploadedBy).name), fmtDate(d.uploadDate),`<button class="btn btn-sm" data-download-doc="${esc(d.id)}" data-download-name="${esc(d.name)}">Download</button>`]))
        : emptyState('No documents uploaded.')}
      <p class="quiet">Version history is maintained per document name (FR-028).</p>
      ${canUploadDocuments?`<div class="grid2"><div class="field"><label for="project-doc-file">Upload project document</label><input type="file" id="project-doc-file"></div><div class="field"><label for="project-doc-type">Category</label><select id="project-doc-type">${['Approval Letter','Progress Report','Publication','Financial Report','Other'].map(t=>`<option>${t}</option>`).join('')}</select></div></div><button class="btn btn-primary btn-sm" id="upload-project-doc">Upload document</button>`:''}
    </section>
    ${canManageTeam ? `<section class="card"><h2>Manage Project Team</h2>
      <p class="quiet">Search registered users and assign project-specific access. The designated PI remains on the team.</p>
      ${projectTeam.length ? table(['Investigator','Institutional email','Project access','Actions'],projectTeam.map(m=>{const member=userById(m.userId);return [esc(member.name),esc(member.email),`<select data-team-access="${esc(member.id)}"><option ${m.access==='View Only'?'selected':''}>View Only</option><option ${m.access==='Contributor'?'selected':''}>Contributor</option></select>`,`<button class="btn btn-sm" data-update-team="${esc(member.id)}">Update</button> <button class="btn btn-danger btn-sm" data-remove-team="${esc(member.id)}">Remove access</button>`];})) : emptyState('No investigators are assigned yet.')}
      ${teamChoices.length ? `<div class="grid2"><div class="field"><label for="team-search">Search by name or institutional email</label><input id="team-search" type="search" placeholder="Type a name or email"><select id="team-user"><option value="">Select an investigator</option>${teamChoices.map(member=>`<option value="${esc(member.id)}">${esc(member.name)} — ${esc(member.email)}</option>`).join('')}</select></div><div class="field"><label for="team-level">Project access level</label><select id="team-level"><option>View Only</option><option>Contributor</option></select><button class="btn btn-primary btn-sm" id="add-team-member">Add to project</button></div></div>` : ''}
    </section>` : ''}
    ${canChangeStatus?`<section class="form-card"><h2>Project status</h2><div class="grid2"><div class="field"><label for="project-next-status">Change status</label><select id="project-next-status">${statusOptions.map(s=>`<option>${s}</option>`).join('')}</select></div><div class="field"><label for="project-status-reason">Reason</label><input id="project-status-reason" type="text" placeholder="Required for hold, completion or termination"></div></div><button class="btn btn-primary btn-sm" id="save-project-status">Update status</button></section>`:''}
    <div class="row-actions"><a class="btn" href="#/projects">Back to Projects</a></div>`);
  document.querySelectorAll('[data-download-doc]').forEach(button=>button.onclick=()=>DocumentService.download(button.dataset.downloadDoc,button.dataset.downloadName).catch(error=>toast(error.message,'error')));
  const uploadDoc=document.getElementById('upload-project-doc');
  if(uploadDoc)uploadDoc.onclick=()=>{const file=document.getElementById('project-doc-file').files[0];if(!file)return toast('Choose a document to upload.','error');const result=DocumentService.upload(file,{projectId:proj.id,type:document.getElementById('project-doc-type').value});if(!result.ok)return toast(result.message,'error');toast('Project document uploaded.');viewProject(id,u);};
  const saveStatus=document.getElementById('save-project-status');
  if(saveStatus)saveStatus.onclick=()=>{const result=ProjectService.updateStatus(proj.id,u,document.getElementById('project-next-status').value,document.getElementById('project-status-reason').value);if(!result.ok)return toast(result.message,'error');toast('Project status updated.');viewProject(id,u);};
  const teamSearch=document.getElementById('team-search'), teamSelect=document.getElementById('team-user');
  if(teamSearch && teamSelect) teamSearch.oninput=()=>{const query=teamSearch.value.toLowerCase();[...teamSelect.options].forEach((option,i)=>{if(i) option.hidden=!option.text.toLowerCase().includes(query);});};
  const addTeam=document.getElementById('add-team-member');
  if(addTeam) addTeam.onclick = () => {
    const result = ProjectAccess.grant(proj.id,u,teamSelect.value,document.getElementById('team-level').value);
    if(!result.ok) return toast(result.message,'error');
    toast('Investigator added to the project team.'); viewProject(id,u);
  };
  document.querySelectorAll('[data-update-team]').forEach(button=>button.onclick=()=>{
    const memberId=button.dataset.updateTeam, level=document.querySelector(`[data-team-access="${memberId}"]`).value;
    const result=ProjectAccess.update(proj.id,u,memberId,level); if(!result.ok)return toast(result.message,'error');
    toast('Project access updated.');viewProject(id,u);
  });
  document.querySelectorAll('[data-remove-team]').forEach(button=>button.onclick=()=>{
    if(!confirm('Remove this investigator’s access to the project? Their user account and project history will remain.')) return;
    const result = ProjectAccess.revoke(proj.id,u,button.dataset.removeTeam);
    if(!result.ok) return toast(result.message,'error');
    toast('Project access removed.'); viewProject(id,u);
  });
}

/* ---------- Project and funding reports (FR-032, UC-020) ---------- */
function viewReports(_,u){
  if(!requireRole(u,['COORDINATOR','FUNDING','ADMIN','AUDITOR'],'Project and funding reports'))return;
  const response=ReportService.get();
  if(!response.ok){appEl().innerHTML=page('Reports','Project progress and funding utilization',alertBox('error',esc(response.message||'The report could not be loaded.')));return;}
  const rows=response.rows||[];
  const completed=rows.reduce((sum,row)=>sum+row.milestonesCompleted,0),milestoneCount=rows.reduce((sum,row)=>sum+row.milestones,0);
  appEl().innerHTML=page('Project & Funding Reports','Milestone progress, deliverables and funding utilization across authorized projects (FR-032)',`
    <div class="stats">${statCard(rows.length,'Projects')}${statCard(`${completed} / ${milestoneCount}`,'Milestones completed')}${statCard(fmtMoney(rows.reduce((sum,row)=>sum+row.sanctioned,0)),'Total sanctioned')}${statCard(fmtMoney(rows.reduce((sum,row)=>sum+row.utilized,0)),'Total utilized')}</div>
    <div class="row-actions"><button class="btn btn-primary" id="download-project-report">Download CSV report</button></div>
    <section class="card"><h2>Project status and funding</h2>${rows.length?table(['Project','Principal Investigator','Status','Timeline','Milestones','Deliverables','Funding source','Sanctioned','Disbursed','Utilized','Remaining'],rows.map(row=>[
      `<a href="#/project/${encodeURIComponent(row.projectId)}">${esc(row.title)}</a><br><span class="quiet">${esc(row.projectId)}</span>`,esc(row.principalInvestigator),pill(row.status),`${fmtDate(row.startDate)} → ${fmtDate(row.expectedEndDate)}`,`${row.milestonesCompleted} / ${row.milestones}`,`${row.deliverablesCompleted} / ${row.deliverables}`,esc(row.fundingSource||'—'),fmtMoney(row.sanctioned),fmtMoney(row.disbursed),fmtMoney(row.utilized),fmtMoney(row.remaining)])):emptyState('No projects are available for this report.')}</section>`);
  document.getElementById('download-project-report').onclick=()=>ReportService.downloadCsv().catch(error=>toast(error.message,'error'));
}
