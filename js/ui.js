'use strict';
/* ==========================================================================
   RPMS prototype — small UI helpers (pills, tables, toasts, event wiring).
   ========================================================================== */

const ROLE_LABEL = {
  ADMIN:'System Administrator', PI:'Principal Investigator', COORDINATOR:'Research Coordinator',
  APPROVER:'Research Committee Approver', FUNDING:'Funding Agency Representative', AUDITOR:'Institutional Auditor',
};

const PILL = {
  'Draft':'pill-amber-outline','Under Review':'pill-amber','Approved':'pill-green','Rejected':'pill-red',
  'Active':'pill-green','Pending Funding':'pill-amber','On Hold':'pill-amber','Completed':'pill-green',
  'Terminated':'pill-gray','Not Started':'pill-gray','In Progress':'pill-blue',
  'Submitted for Review':'pill-purple','Revision Required':'pill-red','Overdue':'pill-red',
  'Submitted':'pill-green','Pending':'pill-amber',
};
function pill(status){ return `<span class="pill ${PILL[status]||'pill-gray'}">${esc(status)}</span>`; }

const NOTIF_PILL = {
  review:'pill-purple', decision:'pill-blue', approval:'pill-green',
  revision:'pill-red', deadline:'pill-amber', funding:'pill-amber',
};

function statCard(value, label){ return `<div class="stat"><b>${value}</b><span>${esc(label)}</span></div>`; }

function table(headers, rows){
  if(!rows || !rows.length) return '';
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}
function emptyState(msg){ return `<p class="empty">${esc(msg)}</p>`; }

function page(title, subtitle, body){
  return `<div class="page-head"><h1>${esc(title)}</h1>${subtitle?`<p class="sub">${subtitle}</p>`:''}</div>${body}`;
}
function appEl(){ return document.getElementById('app'); }

function toast(msg, kind){
  const t = document.createElement('div');
  t.className = 'toast ' + (kind||'success');
  t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(), 300); }, 3800);
}

function alertBox(kind, msg){ return `<div class="alert alert-${kind}">${msg}</div>`; }

function utilizationBar(pct){
  const cls = pct >= 100 ? 'over' : (pct >= 80 ? 'warn' : '');
  return `<div class="bar ${cls}"><i style="width:${Math.min(pct,100)}%"></i></div>
          <span class="quiet">${pct}% of sanctioned budget utilized${pct>=80?' — alert (FR-025)':''}</span>`;
}

function notifList(userId, limit){
  const list = DB.notifications.filter(n=>n.recipient===userId).slice(0, limit||20);
  if(!list.length) return '<p class="empty">No notifications yet.</p>';
  return `<ul class="notif">${list.map(n =>
    `<li class="${n.read?'':'unread'}"><span class="ntime">${fmtDateTime(n.created)}</span><span>${esc(n.message)}${n.href?` <a class="notif-link" href="${esc(n.href)}">Open details</a>`:''}</span></li>`
  ).join('')}</ul>`;
}
function unreadCount(userId){ return DB.notifications.filter(n=>n.recipient===userId && !n.read).length; }

/* Deadline + budget alerts for a PI (FR-025, FR-030) */
function alertsFor(piId){
  const items = [];
  const myProjects = DB.projects.filter(p=>p.pi===piId);
  const ids = myProjects.map(p=>p.id);
  DB.milestones
    .filter(m => ids.includes(m.projectId) && ['In Progress','Not Started'].includes(m.status))
    .forEach(m => {
      const days = daysBetween(todayISO(), m.targetDate);
      if(days < 0)      items.push(['error', `Milestone ${m.code} (${esc(m.name)}) is overdue by ${-days} day(s).`]);
      else if(days<=7)  items.push(['warn',  `Milestone ${m.code} (${esc(m.name)}) is due in ${days} day(s).`]);
    });
  myProjects.forEach(p => {
    const pct = FundingService.utilizationPct(p);
    if(pct >= 80) items.push(['error', `Funding utilization for ${esc(p.title)} is at ${pct}% of the sanctioned budget.`]);
  });
  if(!items.length) return '';
  return `<section class="card"><h2>Alerts</h2>
    ${items.map(([k,t])=>`<div class="alert alert-${k}">${t}</div>`).join('')}</section>`;
}

function fundingCard(proj, opts){
  const pct = FundingService.utilizationPct(proj);
  const remaining = proj.funding.sanctioned - proj.funding.utilized;
  return `<div class="card">
    <h2><a href="#/project/${proj.id}">${esc(proj.title)}</a> ${pill(proj.status)}</h2>
    <p class="quiet">Funding source: ${esc(proj.funding.source)} · PI: ${esc(userById(proj.pi).name)} · Project ${proj.id}</p>
    <div class="fund-nums">
      <div class="fn"><b>${fmtMoney(proj.funding.sanctioned)}</b><span>Sanctioned</span></div>
      <div class="fn"><b>${fmtMoney(proj.funding.received)}</b><span>Disbursed</span></div>
      <div class="fn"><b>${fmtMoney(proj.funding.utilized)}</b><span>Utilized</span></div>
      <div class="fn"><b>${fmtMoney(remaining)}</b><span>Remaining</span></div>
    </div>
    ${utilizationBar(pct)}
    ${pct >= 80 ? alertBox('warn','Budget alert: utilization has reached '+pct+'% of the sanctioned budget (FR-025).') : ''}
    ${opts && opts.extra ? opts.extra : ''}
  </div>`;
}
