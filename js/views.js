'use strict';
/* ==========================================================================
   RPMS prototype — views, part 1: login, dashboard, proposal flows (UC-004)
   ========================================================================== */

let pendingEditorError = null;   // carries a failed-submit result into a re-rendered editor
const FIELD_IDS = {
  'Project title':'f-title','Abstract':'f-abstract','Objectives':'f-objectives','Methodology':'f-methodology',
  'Expected outcomes':'f-outcomes','Research domain':'f-domain','Expected milestones':'milestone-plan','Budget (INR)':'f-budget','Proposed start date':'f-start','Expected end date':'f-end','Custom funding source':'f-source-other',
};

/* ---------- Login (UC-001) ---------- */
function viewLogin(opts){
  opts = opts || {};
  const cur = Auth.current();
  if(cur && !cur.expired){ location.hash = '#/dashboard'; return; }
  const expiredMsg = opts.expired ? alertBox('info','Your session has expired. Please sign in again. (M-03)') : '';
  const serverRequired=window.location.protocol==='file:'?alertBox('error','This page was opened as a local file. Open RPMS at http://127.0.0.1:8080 after starting MySQL and the RPMS server to sign in.'):'';
  appEl().innerHTML = `
  <div class="login-wrap">
    <div class="login-card">
      <h1>Sign in</h1>
      <p class="sub">Sign in with institutional credentials</p>
      ${expiredMsg}
      <div id="login-msg">${serverRequired}</div>
      <form id="login-form" autocomplete="off">
        <div class="field"><label for="l-email">Email</label>
          <input type="email" id="l-email" placeholder="name@lnmiit.ac.in" required></div>
        <div class="field"><label for="l-pass">Password</label>
          <input type="password" id="l-pass" placeholder="••••••••" required></div>
        <button class="btn btn-primary btn-block" type="submit">Login</button>
      </form>
      <p class="demo-creds"><a href="#/forgot-password">Forgot password?</a></p>
      <p class="demo-creds" style="margin-top:12px">New user? <a href="#/register">Create an account</a></p>
      <div class="demo-creds">Demo accounts (password <code>demo123</code>):
        <br>${[['PI','priya.sharma@lnmiit.ac.in'],['Approver','rajesh.gupta@lnmiit.ac.in'],
               ['Coordinator','kavita.rao@lnmiit.ac.in'],['Funding agency','dst.rep@serb.gov.in'],
               ['Admin','admin@lnmiit.ac.in'],['Auditor','auditor@lnmiit.ac.in']]
              .map(([l,e])=>`<button type="button" data-email="${e}">${l}</button>`).join('')}
      </div>
      ${window.RPMS_API_MODE?'':'<p class="demo-creds"><a href="#" id="reset-demo">Reset demo data</a></p>'}
    </div>
  </div>`;
  document.querySelectorAll('.demo-creds button[data-email]').forEach(b => {
    b.onclick = () => {
      document.getElementById('l-email').value = b.dataset.email;
      document.getElementById('l-pass').value = DEMO_PASSWORD;
    };
  });
  const resetDemo=document.getElementById('reset-demo');
  if(resetDemo) resetDemo.onclick = e => { e.preventDefault(); resetDB(); };
  document.getElementById('login-form').onsubmit = ev => {
    ev.preventDefault();
    const res = Auth.login(document.getElementById('l-email').value, document.getElementById('l-pass').value);
    if(!res.ok){
      document.getElementById('login-msg').innerHTML = alertBox('error', esc(res.message));
    }else{
      toast('Welcome, ' + res.user.name);
      location.hash = '#/dashboard';
    }
  };
}

/* ---------- Password recovery ---------- */
function viewForgotPassword(){
  appEl().innerHTML = `<div class="login-wrap"><div class="login-card">
    <h1>Reset your password</h1><p class="sub">Enter your account email to request a reset link.</p>
    <div id="reset-request-msg"></div>
    <form id="reset-request-form"><div class="field"><label for="reset-email">Email</label>
      <input type="email" id="reset-email" required placeholder="name@lnmiit.ac.in"></div>
      <button class="btn btn-primary btn-block" type="submit">Create reset link</button></form>
    <p class="demo-creds"><a href="#/login">Back to sign in</a></p>
  </div></div>`;
  document.getElementById('reset-request-form').onsubmit = ev => {
    ev.preventDefault();
    const result = Auth.requestPasswordReset(document.getElementById('reset-email').value);
    const box = document.getElementById('reset-request-msg');
    box.innerHTML = result.ok
      ? `${alertBox('success','If an active account matches that email, a password reset link is ready.')}<p>${result.token?`<a class="btn btn-primary" href="#/reset-password/${encodeURIComponent(result.token)}">Open password reset link</a>`:''}</p><p class="quiet">Reset links expire after 15 minutes and can only be used once.</p>`
      : alertBox('error', esc(result.message));
  };
}

function viewResetPassword(token){
  const valid = Auth.passwordResetIsValid(token);
  const requestLink = token === 'null';
  appEl().innerHTML = `<div class="login-wrap"><div class="login-card">
    <h1>Choose a new password</h1>
    <div id="reset-password-msg">${valid ? '' : requestLink ? alertBox('info','If an active account matches that email, a reset link is ready. For this local demo, use an email from the demo accounts.') : alertBox('error','This password reset link is invalid or has expired. Request a new link.')}</div>
    ${valid ? `<form id="reset-password-form"><div class="field"><label for="new-pass">New password</label>
      <input type="password" id="new-pass" minlength="6" required></div>
      <div class="field"><label for="new-pass-confirm">Confirm new password</label>
      <input type="password" id="new-pass-confirm" minlength="6" required></div>
      <button class="btn btn-primary btn-block" type="submit">Save new password</button></form>` : ''}
    <p class="demo-creds"><a href="#/login">Back to sign in</a> · <a href="#/forgot-password">Request another link</a></p>
  </div></div>`;
  const form = document.getElementById('reset-password-form');
  if(form) form.onsubmit = ev => {
    ev.preventDefault();
    const password = document.getElementById('new-pass').value;
    if(password !== document.getElementById('new-pass-confirm').value){
      document.getElementById('reset-password-msg').innerHTML = alertBox('error','Passwords do not match.'); return;
    }
    const result = Auth.resetPassword(token, password);
    if(!result.ok){ document.getElementById('reset-password-msg').innerHTML = alertBox('error',esc(result.message)); return; }
    document.getElementById('reset-password-msg').innerHTML = alertBox('success','Password updated. You can now sign in with your new password.');
    form.remove();
  };
}

/* ---------- Dashboard (role-routed, FR-033) ---------- */
function viewDashboard(_, u){
  if(u.role === 'APPROVER'){ location.hash = '#/review'; return; }
  if(u.role === 'COORDINATOR' || u.role === 'FUNDING'){ location.hash = '#/funding'; return; }
  if(u.role === 'AUDITOR'){ location.hash = '#/audit'; return; }
  if(u.role === 'ADMIN'){ adminDashboard(u); return; }
  piDashboard(u);
}

function piDashboard(u){
  const mine = DB.proposals.filter(p=>p.pi===u.id);
  const drafts = mine.filter(p=>p.status==='Draft').length;
  const underReview = mine.filter(p=>p.status==='Under Review').length;
  const myProjects = DB.projects.filter(x=>x.pi===u.id);
  const ids = myProjects.map(x=>x.id);
  const activeMs = DB.milestones.filter(m=>ids.includes(m.projectId) && m.status!=='Completed');
  appEl().innerHTML = page('PI Dashboard','Welcome back, '+esc(u.name), `
    <div class="stats">
      ${statCard(drafts,'Drafts')}
      ${statCard(underReview,'Under Review')}
      ${statCard(activeMs.length,'Active milestones')}
    </div>
    <div class="row-actions"><a class="btn btn-primary" href="#/proposal/new">+ New Proposal</a></div>
    <section class="card"><h2>My Proposals</h2>
      ${mine.length ? table(['Title','Status','Last updated','Action'], mine.map(p=>[
          `<a href="#/proposal/${p.id}">${esc(p.title)}</a>`, pill(p.status), fmtDate(p.lastUpdated),
          p.status==='Draft' ? `<a href="#/proposal/${p.id}">Edit / Submit</a>` : `<a href="#/proposal/${p.id}">View</a>`
        ])) : emptyState('No proposals yet — click “+ New Proposal” to start one.')}
    </section>
    <section class="card"><h2>My Active Milestones</h2>
      ${activeMs.length ? table(['Milestone','Project','Target date','Status','Action'], activeMs.map(m=>{
          const proj = findProject(m.projectId);
          return [`${m.code} ${esc(m.name)}`,
                  `<a href="#/project/${proj.id}">${esc(proj.title)}</a>`,
                  fmtDate(m.targetDate), pill(MilestoneService.displayStatus(m)),
                  m.status==='In Progress' && proj.status==='Active'
                    ? `<a href="#/milestone/${m.id}">Submit completion</a>`
                    : `<a href="#/milestone/${m.id}">View</a>`];
        })) : emptyState('No open milestones.')}
    </section>
    ${alertsFor(u.id)}
    <section class="card"><h2>Notifications (${unreadCount(u.id)} unread)</h2>
      ${notifList(u.id, 4)}
      <a href="#/notifications" class="quiet">View all →</a>
    </section>`);
}

function adminDashboard(u){
  const underReview = DB.proposals.filter(p=>p.status==='Under Review').length;
  appEl().innerHTML = page('Admin Dashboard','System-wide summary (FR-033)', `
    <div class="stats">
      ${statCard(DB.users.length,'Users')}
      ${statCard(DB.projects.filter(p=>p.status==='Active').length,'Active projects')}
      ${statCard(underReview,'Proposals under review')}
      ${statCard(DB.auditLog.length,'Audit entries')}
    </div>
    <div class="row-actions">
      <a class="btn btn-primary" href="#/users">Manage Users &amp; Roles</a>
      <a class="btn" href="#/review">Review Queue</a>
      <a class="btn" href="#/audit">Open Audit Log</a>
    </div>
    <section class="card"><h2>Recent Audit Activity</h2>
      ${table(['Time','Actor','Action','Target','Remarks'], DB.auditLog.slice(0,8).map(a=>[
        fmtDateTime(a.time), esc(userById(a.actor).name), esc(a.action),
        esc(a.target), esc(a.remarks)]))}
      <p class="quiet">Append-only trail (NFR-024, NFR-025).</p>
    </section>`);
}

/* ---------- Proposal editor (UC-003/UC-004) ---------- */
function field(id, label, val, type, req, placeholder){
  const control = type === 'textarea'
    ? `<textarea id="${id}" placeholder="${esc(placeholder||'')}">${esc(val||'')}</textarea>`
    : `<input type="${type||'text'}" id="${id}" value="${esc(val ?? '')}" placeholder="${esc(placeholder||'')}">`;
  return `<div class="field"><label for="${id}">${esc(label)}${req?' <span class="req">*</span>':''}</label>${control}</div>`;
}

function viewProposal(id, u){
  if(id === 'new'){ renderProposalEditor(u, null); return; }
  const p = findProposal(id);
  if(!p){ appEl().innerHTML = page('Not found','', emptyState('Proposal not found.')); return; }
  const isOwner = p.pi === u.id;
  if(!isOwner && !['APPROVER','ADMIN','AUDITOR','COORDINATOR'].includes(u.role)){
    appEl().innerHTML = page('Forbidden','', alertBox('error','Access denied: you can only view proposals you own (BR-024, NFR-007).'));
    return;
  }
  if(p.status === 'Draft'&&(isOwner||u.role==='COORDINATOR')){ renderProposalEditor(u, p, pendingEditorError); pendingEditorError = null; return; }
  renderProposalReadOnly(p, u, isOwner);
}

function renderProposalEditor(u, p, error){
  const isNew = !p;
  const d = p || { title:'', abstract:'', objectives:'', methodology:'', expectedOutcomes:'',
    budget:'', domain:'AI/ML', fundingSource:DB.fundingSources[0], fundingSourceOther:'', startDate:'', endDate:'', expectedMilestones:'', expectedDeliverables:'', investigatorDetails:'' };
  const initialPlan=Array.isArray(d.milestonePlan)&&d.milestonePlan.length?d.milestonePlan:String(d.expectedMilestones||'').split(',').map(x=>x.trim()).filter(Boolean).map(name=>({name:name.replace(/^M\d+[:.\-\s]+/i,''),description:'',targetDate:'',expectedDeliverables:''}));
  if(!initialPlan.length)initialPlan.push({name:'',description:'',targetDate:'',expectedDeliverables:''});
  appEl().innerHTML = page(isNew ? 'New Proposal' : 'Proposal — Edit Draft and Submit',
    'UC-004: fields marked * are mandatory for submission (BR-002)', `
    <div class="form-card">
      <div class="row-actions" style="margin-top:0">
        ${p ? `<span>${pill(p.status)}</span><span class="quiet">Proposal ID: ${p.id}</span>` : '<span class="quiet">New draft — an ID is assigned on first save</span>'}
      </div>
      <div id="editor-msg">${error ? alertBox('error', esc(error.message)) : ''}</div>
      ${p&&p.review&&p.review.decision==='Revision Required'?alertBox('warn',`Research Committee requested revisions: ${esc(p.review.comments)}`):''}
      ${isNew&&u.role==='COORDINATOR'?`<div class="field"><label for="f-principal-investigator">Principal investigator <span class="req">*</span></label><select id="f-principal-investigator" required><option value="">Select a PI</option>${DB.users.filter(person=>person.active&&person.role==='PI').map(person=>`<option value="${esc(person.id)}">${esc(person.name)} — ${esc(person.email)}</option>`).join('')}</select></div>`:`<div class="field"><label>Principal investigator</label><div class="ro">${esc(userById(p?.pi||u.id).name)} (${esc(userById(p?.pi||u.id).email)})</div></div>`}
      ${field('f-title','Project title',d.title,'text',true,'e.g. AI-based Crop Disease Detection')}
      ${field('f-abstract','Abstract',d.abstract,'textarea',true,'A deep learning approach to…')}
      ${field('f-objectives','Objectives',d.objectives,'textarea',true,'Develop CNN model for…')}
      ${field('f-methodology','Methodology',d.methodology,'textarea',true,'Transfer learning with…')}
      ${field('f-outcomes','Expected outcomes',d.expectedOutcomes,'textarea',true,'Automated detection…')}
      <div class="grid2">
        ${field('f-domain','Research domain',d.domain,'text',true)}
        ${`<div class="field"><label for="f-source">Funding source <span class="req">*</span></label>
            <select id="f-source">${DB.fundingSources.map(s=>`<option value="${esc(s)}" ${s===d.fundingSource?'selected':''}>${esc(s)}</option>`).join('')}</select></div>`}
        ${field('f-start','Proposed start date',d.startDate,'date',true)}
        ${field('f-end','Expected end date',d.endDate,'date',true)}
      </div>
      <div class="field"><label>Milestone plan <span class="req">*</span></label><p class="quiet">These definitions become the approved project plan. Target dates must be on or after the proposed start date.</p><div id="milestone-plan"></div><button type="button" class="btn btn-light btn-sm" id="add-plan-milestone">Add milestone</button></div>
      <div id="other-source-wrap" class="${d.fundingSource==='Other'?'':'hidden'}">${field('f-source-other','Other funding source name',d.fundingSourceOther,'text',false,'Enter the funding agency or source')}</div>
      ${field('f-investigators','Co-investigator details',d.investigatorDetails,'textarea',false,'Name, department and institutional email')}
      ${field('f-deliverables','Expected deliverables',d.expectedDeliverables,'textarea',false,'List expected outputs and artifacts')}
      ${field('f-budget','Budget (INR)',d.budget ?? '','number',true,'e.g. 1500000')}
      ${`<div class="field"><label for="f-doc">Supporting document (optional)</label><input type="file" id="f-doc"></div>`}
      <div class="row-actions">
        <button class="btn" id="btn-draft">Save Draft</button>
        ${u.role==='PI'?'<button class="btn btn-primary" id="btn-submit">Submit Proposal</button>':'<span class="quiet">The assigned PI must submit this draft for review.</span>'}
        <a class="btn btn-light" href="${u.role==='COORDINATOR'?'#/proposal-assistance':'#/dashboard'}">Cancel</a>
      </div>
    </div>`);
  markMissingFields(error);
  const planHost=document.getElementById('milestone-plan');
  let planRows=initialPlan.map(m=>({...m}));
  const renderPlan=()=>{
    planHost.innerHTML=planRows.map((m,i)=>`<div class="card milestone-plan-row" data-plan-row="${i}"><div class="grid2"><div class="field"><label>Milestone title <span class="req">*</span></label><input type="text" class="plan-name" value="${esc(m.name||'')}" placeholder="e.g. Dataset collection"></div><div class="field"><label>Target date <span class="req">*</span></label><input type="date" class="plan-date" min="${esc(document.getElementById('f-start').value)}" value="${esc(m.targetDate||'')}"></div></div><div class="field"><label>Description</label><textarea class="plan-description" placeholder="Describe the milestone work">${esc(m.description||'')}</textarea></div><div class="field"><label>Expected deliverables (comma-separated)</label><input type="text" class="plan-deliverables" value="${esc(m.expectedDeliverables||'')}" placeholder="Dataset, validation report"></div>${planRows.length>1?'<button type="button" class="btn btn-light btn-sm remove-plan-milestone">Remove milestone</button>':''}</div>`).join('');
    planHost.querySelectorAll('.remove-plan-milestone').forEach(button=>button.onclick=()=>{planRows.splice(Number(button.closest('[data-plan-row]').dataset.planRow),1);renderPlan();});
  };
  renderPlan();
  document.getElementById('add-plan-milestone').onclick=()=>{planRows.push({name:'',description:'',targetDate:'',expectedDeliverables:''});renderPlan();};
  document.getElementById('f-start').addEventListener('change',()=>planHost.querySelectorAll('.plan-date').forEach(input=>input.min=document.getElementById('f-start').value));
  const sourceSelect=document.getElementById('f-source');
  const updateOther=()=>{const wrap=document.getElementById('other-source-wrap'), input=document.getElementById('f-source-other');wrap.classList.toggle('hidden',sourceSelect.value!=='Other');input.required=sourceSelect.value==='Other';};
  sourceSelect.addEventListener('change',updateOther); updateOther();
  const collect = () => ({
    title:v('f-title'), abstract:v('f-abstract'), objectives:v('f-objectives'),
    methodology:v('f-methodology'), expectedOutcomes:v('f-outcomes'),
    budget:v('f-budget')===''?null:Number(v('f-budget')),
    domain:v('f-domain'), fundingSource:v('f-source'), fundingSourceOther:v('f-source-other'),
    startDate:v('f-start'), endDate:v('f-end'), milestonePlan:[...planHost.querySelectorAll('.milestone-plan-row')].map(row=>({name:row.querySelector('.plan-name').value.trim(),targetDate:row.querySelector('.plan-date').value,description:row.querySelector('.plan-description').value.trim(),expectedDeliverables:row.querySelector('.plan-deliverables').value.trim()})),
    expectedMilestones:[...planHost.querySelectorAll('.plan-name')].map(input=>input.value.trim()).filter(Boolean).join(', '), expectedDeliverables:v('f-deliverables'), investigatorDetails:v('f-investigators'),
    ...(isNew&&u.role==='COORDINATOR'?{principalInvestigatorId:document.getElementById('f-principal-investigator').value}:{}),
  });
  function v(id){ return document.getElementById(id).value; }
  function showError(res){
    document.getElementById('editor-msg').innerHTML = alertBox('error', esc(res.message));
    markMissingFields(res);
    window.scrollTo({top:0, behavior:'smooth'});
  }
  function saveDraft(){
    const docInp = document.getElementById('f-doc');
    const res = ProposalService.saveDraft(collect(), u, p && p.id);
    if(!res.ok) return res;
    if(docInp.files.length){
      const f = docInp.files[0];
      const uploaded=DocumentService.upload(f,{proposalId:res.id,type:'Proposal'});
      if(!uploaded.ok) return uploaded;
    }
    return res;
  }
  document.getElementById('btn-draft').onclick = () => {
    const res = saveDraft();
    if(!res.ok) return showError(res);
    toast('Draft saved (FR-007).');
    location.hash = u.role==='COORDINATOR'?'#/proposal-assistance':'#/dashboard';
  };
  const submitButton=document.getElementById('btn-submit');
  if(submitButton)submitButton.onclick = () => {
    const res = saveDraft();
    if(!res.ok) return showError(res);
    const s = ProposalService.submit(res.id, u);
    if(!s.ok){
      if(isNew){ pendingEditorError = s; location.hash = '#/proposal/' + res.id; }
      else showError(s);
      return;
    }
    location.hash = '#/confirm/' + res.id;
  };
}

function markMissingFields(error){
  if(!error || !error.fields) return;
  error.fields.forEach(label => {
    const id = FIELD_IDS[label];
    if(!id) return;
    const input = document.getElementById(id);
    if(input) input.insertAdjacentHTML('afterend','<div class="ferr">This field is required.</div>');
  });
}

/* ---------- Submission confirmation (UC-004 end, wireframe 04) ---------- */
function viewConfirm(id){
  const p = findProposal(id);
  if(!p || p.status !== 'Under Review'){ location.hash = '#/proposal/'+id; return; }
  appEl().innerHTML = page('Submission Confirmation','', `
    ${alertBox('success','Proposal submitted successfully. The Research Committee has been notified. (M-11)')}
    <div class="summary"><dl>
      <dt>Proposal ID</dt><dd>${p.id}</dd>
      <dt>Title</dt><dd>${esc(p.title)}</dd>
      <dt>Status</dt><dd>${pill(p.status)}</dd>
      <dt>Submitted on</dt><dd>${fmtDateTime(p.submissionDate)}</dd>
      <dt>Submitted by</dt><dd>${esc(userById(p.pi).name)}</dd>
    </dl></div>
    <div class="row-actions">
      <a class="btn btn-primary" href="#/dashboard">Back to Dashboard</a>
      <a class="btn" href="#/proposal/${p.id}">View Proposal</a>
    </div>`);
}

/* ---------- Proposal read-only view ---------- */
function renderProposalReadOnly(p, u, isOwner){
  const reviewer = p.review ? userById(p.review.reviewer) : null;
  appEl().innerHTML = page(p.title, `${p.id} · ${pill(p.status)}`, `
    ${p.review ? alertBox(p.review.decision==='Approved'?'success':(p.review.decision==='Rejected'?'error':'info'),
        `Review decision: <b>${p.review.decision}</b> by ${esc(reviewer.name)} on ${fmtDate(p.review.reviewDate)} — “${esc(p.review.comments)}”`) : ''}
    <div class="summary"><dl>
      <dt>Principal Investigator</dt><dd>${esc(userById(p.pi).name)}</dd>
      <dt>Research domain</dt><dd>${esc(p.domain||'—')}</dd>
      <dt>Funding source</dt><dd>${esc(p.fundingSource==='Other'?(p.fundingSourceOther||'Other'):p.fundingSource||'—')}</dd>
      <dt>Budget (INR)</dt><dd>${fmtMoney(p.budget)}</dd>
      <dt>Proposed dates</dt><dd>${fmtDate(p.startDate)} → ${fmtDate(p.endDate)}</dd>
      <dt>Submitted</dt><dd>${p.submissionDate?fmtDateTime(p.submissionDate):'—'}</dd>
    </dl></div>
    <section class="card"><h2>Abstract</h2><div class="ro ${p.abstract?'':'empty-ro'}">${esc(p.abstract||'Not provided')}</div></section>
    <section class="card"><h2>Objectives</h2><div class="ro ${p.objectives?'':'empty-ro'}">${esc(p.objectives||'Not provided')}</div></section>
    <section class="card"><h2>Methodology</h2><div class="ro ${p.methodology?'':'empty-ro'}">${esc(p.methodology||'Not provided')}</div></section>
    <section class="card"><h2>Expected outcomes</h2><div class="ro ${p.expectedOutcomes?'':'empty-ro'}">${esc(p.expectedOutcomes||'Not provided')}</div></section>
    <section class="card"><h2>Expected milestones</h2><div class="ro ${p.expectedMilestones?'':'empty-ro'}">${esc(p.expectedMilestones||'Not defined')}</div></section>
    ${p.investigatorDetails?`<section class="card"><h2>Investigator details</h2><div class="ro">${esc(p.investigatorDetails)}</div></section>`:''}
    ${p.expectedDeliverables?`<section class="card"><h2>Expected deliverables</h2><div class="ro">${esc(p.expectedDeliverables)}</div></section>`:''}
    <section class="card"><h2>Supporting documents</h2>
      ${p.documents.length ? table(['Name','Type','Version','Size','Uploaded','Action'], p.documents.map(d=>[
        esc(d.name), esc(d.type), 'v'+d.version, esc(d.size), fmtDate(d.uploadDate),`<button class="btn btn-sm" data-download-doc="${esc(d.id)}">Download</button>`]))
        : emptyState('No documents uploaded.')}
    </section>
    <div class="row-actions">
      ${isOwner && p.status==='Under Review' ? '<button class="btn btn-warn" id="btn-withdraw">Withdraw Proposal (FR-012)</button>' : ''}
      <a class="btn" href="#/dashboard">Back to Dashboard</a>
    </div>`);
  const w = document.getElementById('btn-withdraw');
  document.querySelectorAll('[data-download-doc]').forEach(button=>button.onclick=()=>DocumentService.download(button.dataset.downloadDoc).catch(error=>toast(error.message,'error')));
  if(w) w.onclick = () => {
    const res = ProposalService.withdraw(p.id, u);
    if(res.ok){ toast('Proposal withdrawn. You can edit and resubmit it.'); viewProposal(p.id, u); }
    else toast(res.message, 'error');
  };
}

/* ---------- Registration (new users) ---------- */
function viewRegister(){
  const cur = Auth.current();
  if(cur && !cur.expired){ location.hash = '#/dashboard'; return; }
  appEl().innerHTML = `
  <div class="login-wrap" style="max-width:580px">
    <div class="login-card">
      <h1>Create your account</h1>
      <p class="sub">Register with your institutional email to start using RPMS</p>
      <div id="reg-msg"></div>
      <form id="reg-form" autocomplete="off" novalidate>
        <div class="grid2">
          <div class="field"><label for="r-name">Full name <span class="req">*</span></label>
            <input type="text" id="r-name" placeholder="e.g. Dr. Rakesh Verma"></div>
          <div class="field"><label for="r-dept">Department</label>
            <input type="text" id="r-dept" placeholder="e.g. CSE"></div>
        </div>
        <div class="field"><label for="r-email">Institutional email <span class="req">*</span></label>
          <input type="email" id="r-email" placeholder="name@lnmiit.ac.in"></div>
        <div class="field"><label>Role you will join as</label>
          <div class="ro">Principal Investigator (PI)</div>
          <p class="quiet">Per the SRS, roles are assigned only by the System Administrator (FR-004, BR-019, UC-002).
          New accounts join as Principal Investigators; coordinator, approver, funding-agency and auditor accounts
          are provisioned by an administrator from the Users page.</p>
        </div>
        <div class="grid2">
          <div class="field"><label for="r-pass">Password <span class="req">*</span></label>
            <input type="password" id="r-pass" placeholder="At least 6 characters"></div>
          <div class="field"><label for="r-pass2">Confirm password <span class="req">*</span></label>
            <input type="password" id="r-pass2"></div>
        </div>
        <button class="btn btn-primary btn-block" type="submit">Create Account</button>
      </form>
      <p class="demo-creds">Already registered? <a href="#/login">Sign in</a></p>
    </div>
  </div>`;
  document.getElementById('reg-form').onsubmit = ev => {
    ev.preventDefault();
    const val = id => document.getElementById(id).value;
    const msg = document.getElementById('reg-msg');
    if(val('r-pass') !== val('r-pass2')){
      msg.innerHTML = alertBox('error','Passwords do not match.');
      return;
    }
    const res = Auth.register({ name:val('r-name'), email:val('r-email'), dept:val('r-dept'), password:val('r-pass') });
    if(!res.ok){
      msg.innerHTML = alertBox('error', esc(res.message));
      return;
    }
    toast('Account created. Welcome, ' + res.user.name + '!');
    location.hash = '#/dashboard';
  };
}
