'use strict';
/* ==========================================================================
   RPMS prototype — hash router, top bar and session guard (NFR-004/006/008)
   ========================================================================== */

const NAV = {
  PI:          [['#/dashboard','Dashboard'],['#/projects','Projects'],['#/notifications','Notifications']],
  APPROVER:    [['#/review','Review Queue'],['#/projects','Projects'],['#/notifications','Notifications']],
  COORDINATOR: [['#/proposal-assistance','Proposal Drafts'],['#/funding','Funding'],['#/projects','Projects'],['#/reports','Reports'],['#/notifications','Notifications']],
  FUNDING:     [['#/funding','Funding'],['#/projects','Projects'],['#/reports','Reports'],['#/notifications','Notifications']],
  ADMIN:       [['#/dashboard','Dashboard'],['#/users','Users'],['#/audit','Audit Log'],['#/projects','Projects'],['#/reports','Reports'],['#/notifications','Notifications']],
  AUDITOR:     [['#/audit','Audit Log'],['#/projects','Projects'],['#/reports','Reports'],['#/notifications','Notifications']],
};

const ROUTES = [
  { re:/^#\/login$/,               fn:(m,u)=>viewLogin(),                              pub:true },
  { re:/^#\/register$/,            fn:()=>viewRegister(),                              pub:true },
  { re:/^#\/forgot-password$/,     fn:()=>viewForgotPassword(),                         pub:true },
  { re:/^#\/(?:reset-password|reset)\/([\w-]+)$/, fn:(token)=>viewResetPassword(token), pub:true },
  { re:/^#\/dashboard$/,           fn:viewDashboard },
  { re:/^#\/projects$/,            fn:viewProjects },
  { re:/^#\/project\/([\w-]+)$/,   fn:viewProject },
  { re:/^#\/proposal\/new$/,       fn:(m,u)=>viewProposal('new',u) },
  { re:/^#\/proposal-assistance$/, fn:viewProposalAssistance },
  { re:/^#\/proposal\/([\w-]+)$/,  fn:viewProposal },
  { re:/^#\/confirm\/([\w-]+)$/,   fn:(id)=>viewConfirm(id) },
  { re:/^#\/review$/,              fn:viewReviewQueue },
  { re:/^#\/review\/([\w-]+)$/,    fn:viewReviewProposal },
  { re:/^#\/milestones$/,          fn:viewReviewQueue },
  { re:/^#\/milestone\/([\w-]+)$/, fn:viewMilestone },
  { re:/^#\/funding$/,             fn:viewFunding },
  { re:/^#\/reports$/,             fn:viewReports },
  { re:/^#\/users$/,               fn:viewUsers },
  { re:/^#\/audit$/,               fn:viewAudit },
  { re:/^#\/notifications$/,       fn:viewNotifications },
];

function renderTopbar(u){
  const tb = document.getElementById('topbar');
  if(!u){
    tb.innerHTML = `<div class="topbar-inner" style="max-width:1120px;margin:0 auto">
      <a class="brand" href="#/login"><span class="logo-mark">R</span> RPMS <span class="brand-sub">— Research Project Management System</span></a></div>`;
    return;
  }
  const active = location.hash;
  const nav = (NAV[u.role]||[]).map(([href,label]) =>
    `<a class="navlink ${active.startsWith(href)?'active':''}" href="${href}">${label}</a>`).join('');
  const unread = unreadCount(u.id);
  tb.innerHTML = `<div class="topbar-inner" style="max-width:1120px;margin:0 auto">
    <a class="brand" href="#/dashboard"><span class="logo-mark">R</span> RPMS <span class="brand-sub">— Research Project Management System</span></a>
    <nav class="nav">${nav}</nav>
    <div class="top-right">
      <a class="bell" href="#/notifications" title="Notifications" aria-label="Notifications${unread ? `, ${unread} unread` : ''}">
        <img class="bell-icon" src="notification-svgrepo-com.svg?v=24" width="24" height="24" alt="" aria-hidden="true">
        ${unread?`<span class="badge">${unread}</span>`:''}</a>
      <span class="userchip">${esc(u.name)} <span class="role">(${ROLE_LABEL[u.role]})</span></span>
      <button class="btn btn-light btn-sm" id="btn-logout">Logout</button>
    </div></div>`;
  document.getElementById('btn-logout').onclick = () => {
    Auth.logout();
    toast('You have been signed out (FR-003).');
    location.hash = '#/login';
  };
}

function router(){
  const hash = location.hash || '#/login';
  const session = Auth.current();

  if(session && session.expired){
    Auth.logout();
    renderTopbar(null);
    viewLogin({ expired:true });
    return;
  }
  if(session) refreshDeadlineNotifications();
  const route = ROUTES.find(r => r.re.test(hash));
  if(!route){
    location.hash = session ? '#/dashboard' : '#/login';
    return;
  }
  if(!route.pub){
    if(!session){ location.hash = '#/login'; return; }
    renderTopbar(session);
  }else{
    renderTopbar(null);
  }
  const m = hash.match(route.re);
  route.fn(m[1], session);
}

window.addEventListener('hashchange', router);
router();
