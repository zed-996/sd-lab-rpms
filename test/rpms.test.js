'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createDomain}=require('../server/domain');
const repository=require('../server/repository');
const {createToken,verifyToken}=require('../server/security');
const {statements}=require('../server/migrate');
const {handler,parseMultipart,filteredState,reportRows,csv,commitOutcome}=require('../server/index');

function freshDomain(){return createDomain(path.resolve(__dirname,'..'));}
function validProposal(overrides={}){
  return {title:'Test research project',abstract:'A sufficiently detailed research abstract.',objectives:'Complete the stated objective.',methodology:'Use the stated research method.',expectedOutcomes:'Publish the result.',domain:'Engineering',fundingSource:'DST-SERB',budget:100000,startDate:'2027-01-01',endDate:'2028-01-01',expectedMilestones:'Design',milestonePlan:[{name:'Design',description:'Complete the design.',targetDate:'2027-03-01',expectedDeliverables:'Design report'}],expectedDeliverables:'Research report',...overrides};
}
function createApprovedProject(){
  const domain=freshDomain();let state=domain.seed();
  const pi=state.users.find(user=>user.role==='PI'),approver=state.users.find(user=>user.role==='APPROVER');
  const saved=domain.call('proposal.saveDraft',state,pi,{data:validProposal()});assert.equal(saved.result.ok,true);state=saved.state;
  const proposalId=saved.result.id;
  const submitted=domain.call('proposal.submit',state,pi,{id:proposalId});assert.equal(submitted.result.ok,true);state=submitted.state;
  const decided=domain.call('proposal.decide',state,approver,{id:proposalId,decision:'Approved',comments:'Approved'});assert.equal(decided.result.ok,true);state=decided.state;
  const project=state.projects.find(item=>item.proposalId===proposalId);
  return {domain,state,pi,approver,project,proposalId};
}

test('passwords are stored as salted scrypt hashes',async()=>{
  const a=await repository.hashPassword('secret123'),b=await repository.hashPassword('secret123');
  assert.match(a,/^scrypt\$/);assert.notEqual(a,b);
  assert.equal(await repository.verifyPassword('secret123',a),true);
  assert.equal(await repository.verifyPassword('incorrect',a),false);
});

test('JWT signatures and expiry are checked',()=>{
  const token=createToken('USR-1','session-1',1000);
  assert.deepEqual(verifyToken(token,1001),{sub:'USR-1',sid:'session-1',iat:1000,exp:2800});
  assert.equal(verifyToken(token,2800),null);
  assert.equal(verifyToken(token.slice(0,-1)+'x',1001),null);
});

test('MySQL schema parser keeps trigger bodies intact',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../server/schema.sql'),'utf8');
  const parsed=statements(sql);
  assert.ok(parsed.some(statement=>statement.includes('CREATE TRIGGER audit_logs_no_update')));
  assert.ok(parsed.some(statement=>statement.includes('CREATE TRIGGER review_records_no_delete')));
  assert.ok(parsed.filter(statement=>statement.startsWith('CREATE TABLE')).length>=18);
});

test('funding catalog inserts use the same deterministic IDs referenced by project records',async()=>{
  const calls=[];await repository.ensureCatalog({execute:async(sql,values)=>calls.push({sql,values})});
  const catalog=calls.filter(call=>call.sql.includes('INSERT INTO funding_sources'));
  for(const source of repository.SOURCE_OPTIONS){
    assert.ok(catalog.some(call=>call.values[0]===repository.sourceId(source)&&call.values[1]===source));
  }
});

test('MySQL DATE and DATETIME values round-trip when returned as Date objects',()=>{
  const date=new Date('2026-10-28T16:08:29.000Z');
  assert.equal(repository.isoDate(date),'2026-10-28');
  assert.equal(repository.isoDateTime(date),'2026-10-28 16:08:29');
  assert.equal(repository.isoDateTime('2026-10-28 16:08:29'),'2026-10-28 16:08:29');
});

test('new account row is saved before its foreign-key-backed session is inserted',async()=>{
  const events=[],conn={commit:async()=>events.push('commit')};
  const outcome={state:{users:[{id:'USR-NEW'}]},afterSave:async(_conn,result)=>{events.push(`session:${result.state.users[0].id}`);result.token='test-token';}};
  await commitOutcome(conn,outcome,{},async(_conn,state)=>events.push(`user:${state.users[0].id}`));
  assert.deepEqual(events,['user:USR-NEW','session:USR-NEW','commit']);
  assert.equal(outcome.token,'test-token');
  assert.equal('afterSave' in outcome,false);
});

test('multipart parser preserves binary file bytes and removes path components',()=>{
  const boundary='rpms-test-boundary';
  const body=Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\nOther\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="../report.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    Buffer.from([0,255,13,10,42]),Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const parts=parseMultipart(body,`multipart/form-data; boundary=${boundary}`);
  assert.equal(parts.find(part=>part.name==='type').data.toString(),'Other');
  const file=parts.find(part=>part.name==='file');
  assert.equal(file.filename,'report.bin');assert.deepEqual(file.data,Buffer.from([0,255,13,10,42]));
});

test('PI draft fields cannot spoof proposal identity or lifecycle state',()=>{
  const domain=freshDomain(),state=domain.seed(),pi=state.users.find(user=>user.role==='PI');
  const notPI=state.users.find(user=>user.role==='FUNDING');
  const denied=domain.call('proposal.saveDraft',state,notPI,{data:validProposal()});
  assert.equal(denied.result.code,'FORBIDDEN');
  const created=domain.call('proposal.saveDraft',state,pi,{data:{...validProposal(),pi:'USR-FAKE',status:'Approved'}});
  assert.equal(created.result.ok,true);
  const proposal=created.state.proposals.find(item=>item.id===created.result.id);
  assert.equal(proposal.pi,pi.id);assert.equal(proposal.status,'Draft');
});

test('coordinator may prepare a draft for an active PI but cannot submit it',()=>{
  const domain=freshDomain(),state=domain.seed(),pi=state.users.find(user=>user.role==='PI'),coordinator=state.users.find(user=>user.role==='COORDINATOR');
  const created=domain.call('proposal.saveDraft',state,coordinator,{data:{...validProposal(),principalInvestigatorId:pi.id,pi:'USR-FAKE',status:'Approved'}});
  assert.equal(created.result.ok,true);
  const proposal=created.state.proposals.find(item=>item.id===created.result.id);
  assert.equal(proposal.pi,pi.id);assert.equal(proposal.status,'Draft');
  assert.equal(domain.call('proposal.submit',created.state,coordinator,{id:proposal.id}).result.code,'FORBIDDEN');
});

test('proposal dates are validated and rejection requires a reason',()=>{
  const domain=freshDomain();let state=domain.seed();const pi=state.users.find(user=>user.role==='PI'),approver=state.users.find(user=>user.role==='APPROVER');
  const invalid=domain.call('proposal.saveDraft',state,pi,{data:validProposal({endDate:'2027-01-01'})});state=invalid.state;
  const invalidSubmit=domain.call('proposal.submit',state,pi,{id:invalid.result.id});
  assert.equal(invalidSubmit.result.code,'UNPROCESSABLE');
  const draft=domain.call('proposal.saveDraft',state,pi,{data:validProposal()});state=draft.state;
  state=domain.call('proposal.submit',state,pi,{id:draft.result.id}).state;
  const missingReason=domain.call('proposal.decide',state,approver,{id:draft.result.id,decision:'Rejected',comments:''});
  assert.equal(missingReason.result.code,'UNPROCESSABLE');
  const rejected=domain.call('proposal.decide',state,approver,{id:draft.result.id,decision:'Rejected',comments:'Insufficient method detail.'});
  assert.equal(rejected.result.ok,true);
  assert.equal(rejected.state.proposals.find(item=>item.id===draft.result.id).status,'Rejected');
  assert.ok(rejected.state.notifications.some(n=>n.recipient===pi.id&&n.href===`#/proposal/${draft.result.id}`));
});

test('proposal approval waits for funding and copies the submitted milestone plan',()=>{
  const {domain,state,project}=createApprovedProject();
  assert.equal(project.status,'Pending Funding');assert.equal(project.activationDate,null);
  const milestone=state.milestones.find(item=>item.projectId===project.id);
  assert.equal(milestone.name,'Design');assert.equal(milestone.targetDate,'2027-03-01');
  assert.equal(milestone.description,'Complete the design.');
  assert.equal(milestone.deliverables[0].name,'Design report');
});

test('deadline notification refresh alerts project investigators without duplicating the day alert',()=>{
  const fixture=createApprovedProject();let {domain,state,project}=fixture;
  const funding=state.users.find(user=>user.role==='FUNDING');
  state=domain.call('funding.allocation',state,funding,{projectId:project.id,data:{source:'DST-SERB',amount:50000,scheduleDate:'2027-01-02'}}).state;
  const milestone=state.milestones.find(item=>item.projectId===project.id);
  milestone.status='In Progress';milestone.targetDate=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
  state=domain.refreshDeadlines(state);
  const pi=state.users.find(user=>user.id===project.pi),coordinator=state.users.find(user=>user.role==='COORDINATOR');
  assert.ok(state.notifications.some(n=>n.recipient===pi.id&&n.href===`#/milestone/${milestone.id}`));
  assert.ok(state.notifications.some(n=>n.recipient===coordinator.id&&n.href===`#/milestone/${milestone.id}`));
  const total=state.notifications.filter(n=>n.key?.startsWith(`milestone-deadline:${milestone.id}:`)).length;
  state=domain.refreshDeadlines(state);
  assert.equal(state.notifications.filter(n=>n.key?.startsWith(`milestone-deadline:${milestone.id}:`)).length,total);
});

test('funding allocations support multiple sources and source-linked entries',()=>{
  const fixture=createApprovedProject();let {domain,state,project}=fixture;
  const funding=state.users.find(user=>user.role==='FUNDING');
  let result=domain.call('funding.allocation',state,funding,{projectId:project.id,data:{source:'DST-SERB',authorizedAmount:60000,amount:50000,scheduleDate:'2027-01-02'}});
  assert.equal(result.result.ok,true);state=result.state;
  result=domain.call('funding.allocation',state,funding,{projectId:project.id,data:{source:'AICTE',authorizedAmount:40000,amount:25000,scheduleDate:'2027-01-02'}});
  assert.equal(result.result.ok,true);state=result.state;
  project=state.projects.find(item=>item.id===project.id);
  assert.equal(project.status,'Active');assert.equal(project.funding.sanctioned,75000);assert.equal(project.fundingRecords.length,2);
  assert.equal(project.fundingRecords[0].authorizedAmount,60000);
  const overAuthorized=domain.call('funding.allocation',state,funding,{projectId:project.id,data:{source:'DST-SERB',authorizedAmount:60000,amount:10001,scheduleDate:'2027-01-03'}});
  assert.equal(overAuthorized.result.code,'UNPROCESSABLE');
  const bad=domain.call('funding.disbursement',state,funding,{projectId:project.id,data:{fundingId:project.fundingRecords[1].id,amount:25001,date:'2027-01-05'}});
  assert.equal(bad.result.code,'UNPROCESSABLE');
  const coordinator=state.users.find(user=>user.role==='COORDINATOR');
  const utilization=domain.call('funding.utilization',state,coordinator,{projectId:project.id,data:{fundingId:project.fundingRecords[1].id,amount:1000,date:'2027-01-05',category:'Equipment',description:'Prototype components'}});
  assert.equal(utilization.result.ok,true);
  const row=utilization.state.projects.find(item=>item.id===project.id).utilizations[0];
  assert.equal(row.fundingId,project.fundingRecords[1].id);assert.equal(row.fundingSource,'AICTE');
});

test('completion submission requires evidence and a committee decision',()=>{
  let {domain,state,project,pi,approver}=createApprovedProject();
  const funding=state.users.find(user=>user.role==='FUNDING');
  const allocation=domain.call('funding.allocation',state,funding,{projectId:project.id,data:{source:'DST-SERB',authorizedAmount:50000,amount:50000,scheduleDate:'2027-01-02'}});state=allocation.state;
  const milestone=state.milestones.find(item=>item.projectId===project.id);
  assert.equal(milestone.status,'Not Started');
  const start=domain.call('milestone.status',state,pi,{id:milestone.id,status:'In Progress'});assert.equal(start.result.ok,true);state=start.state;
  assert.equal(state.milestones.find(item=>item.id===milestone.id).status,'In Progress');
  const backToNotStarted=domain.call('milestone.status',state,pi,{id:milestone.id,status:'Not Started'});assert.equal(backToNotStarted.result.ok,true);state=backToNotStarted.state;
  assert.equal(state.milestones.find(item=>item.id===milestone.id).status,'Not Started');
  const restart=domain.call('milestone.status',state,pi,{id:milestone.id,status:'In Progress'});assert.equal(restart.result.ok,true);state=restart.state;
  const invalidCompletion=domain.call('milestone.status',state,pi,{id:milestone.id,status:'Completed'});assert.equal(invalidCompletion.result.code,'UNPROCESSABLE');
  const missing=domain.call('milestone.submit',state,pi,{id:milestone.id,evidence:[],remarks:''});assert.equal(missing.result.code,'UNPROCESSABLE');
  const submitted=domain.call('milestone.submit',state,pi,{id:milestone.id,evidence:[{name:'evidence.pdf',size:1024,mimeType:'application/pdf'}],remarks:'Ready'});assert.equal(submitted.result.ok,true);state=submitted.state;
  const completed=domain.call('milestone.decide',state,approver,{id:milestone.id,decision:'Completed',comments:'Verified'});assert.equal(completed.result.ok,true);
  assert.equal(completed.state.milestones.find(item=>item.id===milestone.id).status,'Completed');
});

test('View Only project membership blocks contributor actions and removes funding from its DTO',()=>{
  const fixture=createApprovedProject();let {domain,state,project}=fixture;
  const funding=state.users.find(user=>user.role==='FUNDING');
  state=domain.call('funding.allocation',state,funding,{projectId:project.id,data:{source:'DST-SERB',authorizedAmount:50000,amount:50000,scheduleDate:'2027-01-02'}}).state;
  project=state.projects.find(item=>item.id===project.id);
  const member=state.users.find(user=>user.role==='PI'&&user.id!==project.pi);
  const grant=domain.call('project.access.grant',state,state.users.find(user=>user.id===project.pi),{projectId:project.id,userId:member.id,access:'View Only'});
  assert.equal(grant.result.ok,true);state=grant.state;
  const ownerRemoval=domain.call('project.access.revoke',state,state.users.find(user=>user.id===project.pi),{projectId:project.id,userId:project.pi});
  assert.equal(ownerRemoval.result.code,'CONFLICT');
  const blocked=domain.call('milestone.status',state,member,{id:state.milestones.find(item=>item.projectId===project.id).id,status:'In Progress'});
  assert.equal(blocked.result.code,'FORBIDDEN');
  const view=filteredState(state,{id:member.id,role:member.role});
  const shared=view.projects.find(item=>item.id===project.id);
  assert.equal(shared.funding.source,'Restricted');assert.equal('fundingRecords' in shared,false);assert.equal(view.proposals.some(p=>p.id===project.proposalId),false);
  assert.equal(view.users.some(user=>user.id===funding.id),false,'unrelated registered-user contact details must not be disclosed');
  const before=state.notifications.filter(n=>n.recipient===member.id).length;
  state=domain.call('funding.allocation',state,funding,{projectId:project.id,data:{source:'AICTE',authorizedAmount:40000,amount:25000,scheduleDate:'2027-01-03'}}).state;
  assert.equal(state.notifications.filter(n=>n.recipient===member.id).length,before,'View Only membership must not receive funding amounts');
});

test('completed deliverables require a valid submission date',()=>{
  const fixture=createApprovedProject();let {domain,state,project,pi}=fixture;
  const funding=state.users.find(user=>user.role==='FUNDING');
  state=domain.call('funding.allocation',state,funding,{projectId:project.id,data:{source:'DST-SERB',authorizedAmount:50000,amount:50000,scheduleDate:'2027-01-02'}}).state;
  const milestone=state.milestones.find(item=>item.projectId===project.id);
  const existing=milestone.deliverables[0];
  const missing=domain.call('deliverable.update',state,pi,{id:existing.id,data:{status:'Completed'}});
  assert.equal(missing.result.code,'UNPROCESSABLE');
  const badDate=domain.call('deliverable.update',state,pi,{id:existing.id,data:{status:'Completed',submissionDate:'2026-12-31'}});
  assert.equal(badDate.result.code,'UNPROCESSABLE');
});

test('report output is role guarded and CSV quotes user content',()=>{
  const {state,project}=createApprovedProject(),coordinator=state.users.find(user=>user.role==='COORDINATOR');
  assert.throws(()=>reportRows(state,{id:'USR-X',role:'PI'}),/cannot generate/);
  assert.equal(reportRows(state,coordinator).some(row=>row.projectId===project.id),true);
  const result=csv([{title:'Research, "phase one"'}]);assert.match(result,/"Research, ""phase one"""/);
});

test('health endpoint is available without opening a database connection',async()=>{
  const response={headers:null,status:null,body:'',writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body||'';}};
  await handler({url:'/api/health',method:'GET',headers:{host:'localhost'}},response);
  assert.equal(response.status,200);assert.equal(JSON.parse(response.body).storage,'mysql');
  assert.equal(response.headers['X-Frame-Options'],'DENY');
});

test('browser scripts are served without stale cache',async()=>{
  const response={headers:null,status:null,body:'',writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body||'';}};
  await handler({url:'/js/services.js',method:'GET',headers:{host:'localhost'}},response);
  assert.equal(response.status,200);
  assert.equal(response.headers['Cache-Control'],'no-store');
  assert.match(Buffer.from(response.body).toString('utf8'),/return m\.status;/);
});

test('login transport explains file-based and offline server errors instead of failing silently',()=>{
  const context=vm.createContext({window:{location:{protocol:'file:'}},sessionStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},XMLHttpRequest:class{open(){throw new Error('offline');}},Auth:{},ProjectAccess:{},ProjectService:{},ProposalService:{},MilestoneService:{},DeliverableService:{},FundingService:{},AdminService:{}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/api-client.js'),'utf8'),context);
  const fileResult=vm.runInContext("apiRequest('POST','/auth/login',{})",context);
  assert.equal(fileResult.code,'SERVER_REQUIRED');
  context.window.location.protocol='http:';
  const offlineResult=vm.runInContext("apiRequest('POST','/auth/login',{})",context);
  assert.equal(offlineResult.code,'SERVER_UNAVAILABLE');
});
