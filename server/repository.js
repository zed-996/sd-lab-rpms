'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROLE_NAMES = {
  PI:'Principal Investigator', COORDINATOR:'Research Coordinator', APPROVER:'Research Committee Approver',
  ADMIN:'System Administrator', FUNDING:'Funding Agency Representative', AUDITOR:'Institutional Auditor'
};
const SOURCE_OPTIONS = ['DST-SERB','AICTE','Ministry of Power','Siemens R&D Grant','Other','Self-funded'];
const json = value => JSON.stringify(value ?? null);
const parsed = value => {
  if(value == null) return null;
  if(typeof value==='object') return value;
  try{return JSON.parse(value);}catch{return null;}
};
const isoDate = value => value ? (value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10)) : null;
const isoDateTime = value => {
  if(!value)return null;
  if(value instanceof Date)return value.toISOString().slice(0,19).replace('T',' ');
  const text=String(value);
  const sqlDateTime=text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if(sqlDateTime)return `${sqlDateTime[1]} ${sqlDateTime[2]}`;
  return new Date(text).toISOString().slice(0,19).replace('T',' ');
};
const sourceId = value => 'SRC-'+crypto.createHash('sha1').update(String(value).toLowerCase()).digest('hex').slice(0,24);

function sizeBytes(value){
  if(typeof value==='number') return value;
  const match=String(value||'').match(/([\d.]+)\s*(B|KB|MB|GB)/i);
  if(!match) return 0;
  const mult={B:1,KB:1024,MB:1048576,GB:1073741824}[match[2].toUpperCase()];
  return Math.round(Number(match[1])*mult);
}

async function ensureCatalog(conn){
  for(const [key,name] of Object.entries(ROLE_NAMES)){
    await conn.execute('INSERT INTO roles(role_key,role_name,permissions) VALUES(?,?,JSON_ARRAY()) ON DUPLICATE KEY UPDATE role_name=VALUES(role_name)',[key,name]);
  }
  for(const name of SOURCE_OPTIONS){
    await conn.execute('INSERT INTO funding_sources(funding_source_id,organization,program,active) VALUES(?,?,?,TRUE) ON DUPLICATE KEY UPDATE active=TRUE',[sourceId(name),name,'']);
  }
}

function seedPrototypeState(projectRoot){
  const storage=new Map();
  const context={localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},Date,Math,JSON,Number,String,Object,Array,RegExp,Set,Map};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot,'js/store.js'),'utf8'),context,{timeout:2000});
  return JSON.parse(vm.runInContext('JSON.stringify(DB)',context));
}

async function loadState(conn){
  const [users]=await conn.query('SELECT * FROM users');
  const [proposals]=await conn.query('SELECT * FROM proposals');
  const [projects]=await conn.query('SELECT * FROM projects');
  const [teams]=await conn.query('SELECT * FROM project_investigators WHERE active=TRUE');
  const [funding]=await conn.query('SELECT pf.*,fs.organization,fs.program FROM project_funding pf JOIN funding_sources fs ON fs.funding_source_id=pf.funding_source_id');
  const [disbursements]=await conn.query('SELECT * FROM funding_disbursements ORDER BY created_at DESC');
  const [utilizations]=await conn.query('SELECT * FROM funding_utilizations ORDER BY created_at DESC');
  const [milestones]=await conn.query('SELECT * FROM milestones');
  const [deliverables]=await conn.query('SELECT * FROM deliverables');
  const [documents]=await conn.query('SELECT * FROM project_documents ORDER BY upload_date DESC');
  const [notifications]=await conn.query('SELECT * FROM notifications ORDER BY created_at DESC');
  const [auditLog]=await conn.query('SELECT * FROM audit_logs ORDER BY occurred_at DESC');
  const [reviews]=await conn.query('SELECT * FROM review_records ORDER BY review_date');
  const [sequences]=await conn.query('SELECT * FROM rpms_sequences');
  const sourceValues=SOURCE_OPTIONS.slice();
  const counterDefaults={prop:48,prj:16,ms:304,dlv:34,doc:205,notf:5017,log:8006,usr:501,disb:1,util:1};
  const counters={...counterDefaults};
  for(const s of sequences) if(s.sequence_key in counters) counters[s.sequence_key]=Number(s.next_value);

  const state={meta:{seededOn:new Date().toISOString().slice(0,10)},users:users.map(u=>({id:u.user_id,name:u.full_name,email:u.email,role:u.role_key,dept:u.department,active:!!u.active,passwordHash:u.password_hash,registeredOn:isoDate(u.registered_at),lastLogin:isoDateTime(u.last_login_at)})),fundingSources:sourceValues,proposals:[],projects:[],milestones:[],documents:[],notifications:[],auditLog:[],counters,passwordResets:[]};
  const reviewByTarget=new Map();
  for(const r of reviews){
    const key=`${r.target_type}:${r.proposal_id||r.milestone_id}`;
    const value={decision:r.decision,reviewer:r.reviewer_id,reviewDate:isoDateTime(r.review_date),comments:r.comments||''};
    const list=reviewByTarget.get(key)||[];list.push(value);reviewByTarget.set(key,list);
  }
  state.proposals=proposals.map(row=>{
    const p=parsed(row.details)||{};
    const history=reviewByTarget.get(`Proposal:${row.proposal_id}`)||[];
    return {...p,id:row.proposal_id,pi:row.pi_user_id,title:row.title,abstract:row.abstract_text,objectives:row.objectives,methodology:row.methodology,expectedOutcomes:row.expected_outcomes,domain:row.research_domain,budget:Number(row.proposed_budget),fundingSource:row.custom_funding_source?'Other':(p.fundingSource||row.funding_source_id),fundingSourceOther:row.custom_funding_source||'',startDate:isoDate(row.proposed_start_date)||'',endDate:isoDate(row.expected_end_date)||'',status:row.status,submissionDate:isoDateTime(row.submission_date),version:row.version,documents:[],review:history.at(-1)||p.review||null,reviewHistory:history};
  });
  state.projects=projects.map(row=>{
    const d=parsed(row.details)||{};
    const projectFunding=funding.filter(x=>x.project_id===row.project_id).map(f=>({id:f.funding_id,source:f.organization==='Other'&&f.program?f.program:f.organization,proposedAmount:Number(f.proposed_amount),authorizedAmount:Number(f.authorized_amount||0),sanctioned:Number(f.approved_amount||0),received:Number(f.received_amount||0),status:f.funding_status,disbursementSchedule:parsed(f.details)?.disbursementSchedule||[]}));
    const p=state.proposals.find(x=>x.id===row.proposal_id);
    const project={...d,id:row.project_id,proposalId:row.proposal_id,title:row.title,pi:row.principal_investigator_id,domain:row.research_domain,status:row.status,startDate:isoDate(row.start_date),expectedEndDate:isoDate(row.expected_end_date),actualEndDate:isoDate(row.actual_end_date),activationDate:isoDate(row.activation_date),team:teams.filter(t=>t.project_id===row.project_id&&t.project_role!=='PI').map(t=>({userId:t.investigator_id,access:t.access_level,addedBy:t.assigned_by,addedAt:isoDateTime(t.date_assigned)})),fundingRecords:projectFunding,funding:{...(d.funding||{}),source:projectFunding.length>1?'Multiple sources':projectFunding[0]?.source||p?.fundingSource||'Self-funded',proposedBudget:projectFunding.reduce((sum,f)=>sum+f.proposedAmount,0)||Number(p?.budget||0),sanctioned:projectFunding.reduce((sum,f)=>sum+f.sanctioned,0),received:projectFunding.reduce((sum,f)=>sum+f.received,0),utilized:0},disbursements:[],utilizations:[]};
    project.disbursements=disbursements.filter(x=>x.project_id===row.project_id).map(x=>({id:x.disbursement_id,fundingId:x.funding_id,amount:Number(x.amount),date:isoDate(x.disbursement_date||x.scheduled_for),recordedBy:x.recorded_by,scheduledFor:isoDate(x.scheduled_for),status:x.status}));
    project.utilizations=utilizations.filter(x=>x.project_id===row.project_id).map(x=>({id:x.utilization_id,fundingId:x.funding_id,category:x.category,description:x.description,amount:Number(x.amount),date:isoDate(x.utilization_date),recordedBy:x.recorded_by}));
    project.funding.utilized=project.utilizations.reduce((sum,x)=>sum+x.amount,0);
    return project;
  });
  state.milestones=milestones.map(row=>{
    const d=parsed(row.details)||{};const history=reviewByTarget.get(`Milestone:${row.milestone_id}`)||[];
    return {...d,id:row.milestone_id,projectId:row.project_id,code:row.code,name:row.milestone_name,description:row.description||'',targetDate:isoDate(row.target_date),completionDate:isoDate(row.completion_date),status:row.status==='Pending'?'Not Started':row.status,remarks:row.remarks||'',submittedAt:isoDateTime(row.submitted_at),completionReview:parsed(row.completion_review)||d.completionReview||null,reviewHistory:history,deliverables:deliverables.filter(x=>x.milestone_id===row.milestone_id).map(x=>({id:x.deliverable_id,projectId:x.project_id,milestoneId:x.milestone_id,name:x.deliverable_name,type:x.deliverable_type,description:x.description||'',dueDate:isoDate(x.due_date)||'',submissionDate:isoDate(x.submission_date)||'',status:x.status,submittedBy:x.submitted_by,remarks:x.remarks||''}))};
  });
  state.documents=documents.map(row=>({id:row.document_id,projectId:row.project_id,milestoneId:row.milestone_id,proposalId:row.proposal_id,type:row.document_type,name:row.document_name,size:row.size_bytes,version:row.version,uploadedBy:row.uploaded_by,uploadDate:isoDateTime(row.upload_date),fileReference:row.file_reference,mimeType:row.mime_type,remarks:row.remarks||''}));
  for(const p of state.proposals) p.documents=state.documents.filter(d=>d.proposalId===p.id||d.projectId===state.projects.find(x=>x.proposalId===p.id)?.id);
  state.notifications=notifications.map(n=>({id:n.notification_id,recipient:n.recipient_user_id,type:n.notification_type,message:n.message,href:n.related_url||'',created:isoDateTime(n.created_at),read:!!n.is_read,key:n.dedupe_key}));
  state.auditLog=auditLog.map(a=>({id:a.log_id,actor:a.actor_user_id,action:a.action_type,target:a.target_id,time:isoDateTime(a.occurred_at),remarks:a.remarks||'',targetEntity:a.target_entity}));
  return state;
}

async function upsert(conn,sql,values){await conn.execute(sql,values);}
async function saveState(conn,state,previous){
  await ensureCatalog(conn);
  for(const user of state.users){
    await upsert(conn,`INSERT INTO users(user_id,full_name,email,password_hash,role_key,department,active,registered_at,last_login_at) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE full_name=VALUES(full_name),email=VALUES(email),password_hash=VALUES(password_hash),role_key=VALUES(role_key),department=VALUES(department),active=VALUES(active),last_login_at=COALESCE(VALUES(last_login_at),last_login_at)`,[user.id,user.name,user.email,user.passwordHash||'!',user.role,user.dept||'',!!user.active,user.registeredOn?isoDateTime(user.registeredOn+'T00:00:00Z'):new Date().toISOString().slice(0,19).replace('T',' '),user.lastLogin?isoDateTime(user.lastLogin):null]);
    if(user.role==='PI') await upsert(conn,'INSERT INTO investigator_profiles(user_id,designation,research_interests,contact_information) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE designation=VALUES(designation)',[user.id,user.designation||null,user.researchInterests||null,json(user.contactInformation||{department:user.dept||''})]);
  }
  for(const source of state.fundingSources){await upsert(conn,'INSERT INTO funding_sources(funding_source_id,organization,program,active) VALUES(?,?,?,TRUE) ON DUPLICATE KEY UPDATE active=TRUE',[sourceId(source),source,'']);}
  for(const p of state.proposals){
    const standardSource=p.fundingSource==='Other'?'Other':p.fundingSource;
    const details={...p};delete details.documents;delete details.review;
    await upsert(conn,`INSERT INTO proposals(proposal_id,pi_user_id,title,abstract_text,objectives,methodology,expected_outcomes,research_domain,proposed_budget,funding_source_id,custom_funding_source,proposed_start_date,expected_end_date,investigator_details,expected_milestones,expected_deliverables,status,submission_date,version,details) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),abstract_text=VALUES(abstract_text),objectives=VALUES(objectives),methodology=VALUES(methodology),expected_outcomes=VALUES(expected_outcomes),research_domain=VALUES(research_domain),proposed_budget=VALUES(proposed_budget),funding_source_id=VALUES(funding_source_id),custom_funding_source=VALUES(custom_funding_source),proposed_start_date=VALUES(proposed_start_date),expected_end_date=VALUES(expected_end_date),investigator_details=VALUES(investigator_details),expected_milestones=VALUES(expected_milestones),expected_deliverables=VALUES(expected_deliverables),status=VALUES(status),submission_date=VALUES(submission_date),version=VALUES(version),details=VALUES(details)`,[p.id,p.pi,p.title||'',p.abstract||'',p.objectives||'',p.methodology||'',p.expectedOutcomes||'',p.domain||'',Number(p.budget)||0,sourceId(standardSource||'Other'),p.fundingSource==='Other'?(p.fundingSourceOther||null):null,p.startDate||null,p.endDate||null,p.investigatorDetails||null,json(p.expectedMilestones?String(p.expectedMilestones).split(',').map(x=>x.trim()).filter(Boolean):[]),p.expectedDeliverables||null,p.status,p.submissionDate?isoDateTime(p.submissionDate):null,p.version||1,json(details)]);
  }
  for(const p of state.projects){
    const details={...p};delete details.team;delete details.funding;delete details.fundingRecords;delete details.disbursements;delete details.utilizations;
    await upsert(conn,`INSERT INTO projects(project_id,proposal_id,title,principal_investigator_id,research_domain,start_date,expected_end_date,actual_end_date,status,activation_date,details) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE proposal_id=VALUES(proposal_id),title=VALUES(title),principal_investigator_id=VALUES(principal_investigator_id),research_domain=VALUES(research_domain),start_date=VALUES(start_date),expected_end_date=VALUES(expected_end_date),actual_end_date=VALUES(actual_end_date),status=VALUES(status),activation_date=VALUES(activation_date),details=VALUES(details)`,[p.id,p.proposalId,p.title,p.pi,p.domain||'',p.startDate,p.expectedEndDate,p.actualEndDate||null,p.status,p.activationDate||null,json(details)]);
    const proposal=state.proposals.find(x=>x.id===p.proposalId);const selectedSource=p.funding?.source||proposal?.fundingSource||'Self-funded';
    const records=Array.isArray(p.fundingRecords)&&p.fundingRecords.length?p.fundingRecords:[{id:`FUND-${p.id}`,source:selectedSource,proposedAmount:Number(p.funding?.proposedBudget??proposal?.budget??0),authorizedAmount:Number(p.funding?.sanctioned||0),sanctioned:Number(p.funding?.sanctioned||0),received:Number(p.funding?.received||0),status:p.status==='Pending Funding'?'Pending':'Confirmed',disbursementSchedule:p.funding?.disbursementSchedule||[]}];
    p.fundingRecords=records;
    for(const [i,record] of records.entries()){
      const source=record.source||selectedSource,selectedId=sourceId(source),fundingId=record.id||`FUND-${p.id}-${String(i+1).padStart(2,'0')}`;record.id=fundingId;
      await upsert(conn,'INSERT INTO funding_sources(funding_source_id,organization,program,active) VALUES(?,?,?,TRUE) ON DUPLICATE KEY UPDATE active=TRUE',[selectedId,source,'']);
      await upsert(conn,`INSERT INTO project_funding(funding_id,project_id,funding_source_id,proposed_amount,authorized_amount,approved_amount,received_amount,funding_status,details) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE funding_source_id=VALUES(funding_source_id),proposed_amount=VALUES(proposed_amount),authorized_amount=VALUES(authorized_amount),approved_amount=VALUES(approved_amount),received_amount=VALUES(received_amount),funding_status=VALUES(funding_status),details=VALUES(details)`,[fundingId,p.id,selectedId,Number(record.proposedAmount||0),Number(record.authorizedAmount||0),Number(record.sanctioned||0),Number(record.received||0),record.status||'Confirmed',json(record)]);
    }
    const existing = new Map((previous?.projects.find(x=>x.id===p.id)?.team||[]).map(m=>[m.userId,m]));
    const activeIds=new Set((p.team||[]).map(m=>m.userId));
    const ownerRow=await conn.execute(`INSERT INTO project_investigators(project_id,investigator_id,project_role,access_level,active) VALUES(?,?,'PI','Owner',TRUE) ON DUPLICATE KEY UPDATE project_role='PI',access_level='Owner',active=TRUE,date_removed=NULL`,[p.id,p.pi]);
    for(const member of (p.team||[])) await upsert(conn,`INSERT INTO project_investigators(project_id,investigator_id,project_role,access_level,assigned_by,date_assigned,active) VALUES(?,?,'Investigator',?,?,COALESCE(?,CURRENT_TIMESTAMP),TRUE) ON DUPLICATE KEY UPDATE access_level=VALUES(access_level),assigned_by=VALUES(assigned_by),active=TRUE,date_removed=NULL`,[p.id,member.userId,member.access||'View Only',member.addedBy||p.pi,member.addedAt?isoDateTime(member.addedAt):null]);
    for(const prior of existing.values()) if(!activeIds.has(prior.userId)) await conn.execute('UPDATE project_investigators SET active=FALSE,date_removed=UTC_TIMESTAMP() WHERE project_id=? AND investigator_id=?',[p.id,prior.userId]);
    for(const [i,d] of (p.disbursements||[]).entries()){
      const id=d.id||`${p.id}-D-${i+1}`;
      await upsert(conn,`INSERT INTO funding_disbursements(disbursement_id,project_id,funding_id,amount,scheduled_for,disbursement_date,status,recorded_by) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE funding_id=VALUES(funding_id),amount=VALUES(amount),scheduled_for=VALUES(scheduled_for),disbursement_date=VALUES(disbursement_date),status=VALUES(status),recorded_by=VALUES(recorded_by)`,[id,p.id,d.fundingId||records[0].id,Number(d.amount),d.scheduledFor||d.date||null,d.date||null,d.status||'Disbursed',d.recordedBy||p.pi]);
    }
    for(const [i,u] of (p.utilizations||[]).entries()){
      const id=u.id||`${p.id}-U-${i+1}`;
      await upsert(conn,`INSERT INTO funding_utilizations(utilization_id,project_id,funding_id,category,description,amount,utilization_date,recorded_by) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE funding_id=VALUES(funding_id),category=VALUES(category),description=VALUES(description),amount=VALUES(amount),utilization_date=VALUES(utilization_date),recorded_by=VALUES(recorded_by)`,[id,p.id,u.fundingId||records[0].id,u.category||'Other',u.description||'',Number(u.amount),u.date,u.recordedBy||p.pi]);
    }
    const before=previous?.projects.find(x=>x.id===p.id);
    if(before&&before.status!==p.status) await conn.execute('INSERT INTO project_status_history(project_id,previous_status,new_status,changed_by,changed_at,reason) VALUES(?,?,?,?,?,?)',[p.id,before.status,p.status,state.auditLog.find(x=>x.target===p.id)?.actor||p.pi,state.auditLog.find(x=>x.target===p.id)?.time?isoDateTime(state.auditLog.find(x=>x.target===p.id).time):new Date().toISOString().slice(0,19).replace('T',' '),state.auditLog.find(x=>x.target===p.id)?.remarks||'']);
  }
  for(const m of state.milestones){
    const details={...m};delete details.deliverables;delete details.reviewHistory;
    await upsert(conn,`INSERT INTO milestones(milestone_id,project_id,code,milestone_name,description,target_date,completion_date,status,remarks,completion_review,submitted_at,details) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE code=VALUES(code),milestone_name=VALUES(milestone_name),description=VALUES(description),target_date=VALUES(target_date),completion_date=VALUES(completion_date),status=VALUES(status),remarks=VALUES(remarks),completion_review=VALUES(completion_review),submitted_at=VALUES(submitted_at),details=VALUES(details)`,[m.id,m.projectId,m.code,m.name,m.description||'',m.targetDate,m.completionDate||null,m.status,m.remarks||null,json(m.completionReview),m.submittedAt?isoDateTime(m.submittedAt):null,json(details)]);
    for(const d of m.deliverables||[]) await upsert(conn,`INSERT INTO deliverables(deliverable_id,project_id,milestone_id,deliverable_name,deliverable_type,description,due_date,submission_date,status,submitted_by,remarks) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE deliverable_name=VALUES(deliverable_name),deliverable_type=VALUES(deliverable_type),description=VALUES(description),due_date=VALUES(due_date),submission_date=VALUES(submission_date),status=VALUES(status),submitted_by=VALUES(submitted_by),remarks=VALUES(remarks)`,[d.id,m.projectId,m.id,d.name,d.type||'Other',d.description||'',d.dueDate||null,d.submissionDate||null,d.status,d.submittedBy||null,d.remarks||null]);
  }
  for(const d of state.documents){
    const projectId=d.projectId||null,proposalId=d.proposalId||(!projectId?state.proposals.find(p=>p.documents?.some(x=>x.id===d.id))?.id:null);
    await upsert(conn,`INSERT INTO project_documents(document_id,project_id,proposal_id,milestone_id,document_type,document_name,file_reference,mime_type,size_bytes,version,uploaded_by,upload_date,approval_status,remarks) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE project_id=VALUES(project_id),proposal_id=VALUES(proposal_id),milestone_id=VALUES(milestone_id),document_type=VALUES(document_type),document_name=VALUES(document_name),file_reference=VALUES(file_reference),mime_type=VALUES(mime_type),size_bytes=VALUES(size_bytes),version=VALUES(version),remarks=VALUES(remarks)`,[d.id,projectId,proposalId,d.milestoneId||null,d.type||'Other',d.name,d.fileReference||`demo://${d.name}`,d.mimeType||'application/octet-stream',sizeBytes(d.size),d.version||1,d.uploadedBy,d.uploadDate?isoDateTime(d.uploadDate):new Date().toISOString().slice(0,19).replace('T',' '),d.approvalStatus||null,d.remarks||null]);
  }
  for(const n of state.notifications) await upsert(conn,`INSERT INTO notifications(notification_id,recipient_user_id,notification_type,message,related_url,created_at,is_read,dedupe_key) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE message=VALUES(message),related_url=VALUES(related_url),is_read=VALUES(is_read),dedupe_key=VALUES(dedupe_key)`,[n.id,n.recipient,n.type,n.message,n.href||null,n.created?isoDateTime(n.created):new Date().toISOString().slice(0,19).replace('T',' '),!!n.read,n.key||null]);

  const oldAudit=new Set((previous?.auditLog||[]).map(a=>a.id));
  for(const a of state.auditLog) if(!oldAudit.has(a.id)) await upsert(conn,'INSERT INTO audit_logs(log_id,actor_user_id,action_type,target_entity,target_id,occurred_at,remarks) VALUES(?,?,?,?,?,?,?)',[a.id,a.actor,a.action,a.targetEntity||'Record',a.target,a.time?isoDateTime(a.time):new Date().toISOString().slice(0,19).replace('T',' '),a.remarks||null]);
  await persistReviewChanges(conn,state,previous);
  for(const [key,value] of Object.entries(state.counters||{})) await upsert(conn,'INSERT INTO rpms_sequences(sequence_key,next_value) VALUES(?,?) ON DUPLICATE KEY UPDATE next_value=GREATEST(next_value,VALUES(next_value))',[key,Number(value)||1]);
}

async function persistReviewChanges(conn,state,previous){
  const prevP=new Map((previous?.proposals||[]).map(p=>[p.id,p.review?.reviewDate]));
  for(const p of state.proposals) if(p.review?.reviewDate&&p.review.reviewDate!==prevP.get(p.id)) await conn.execute('INSERT INTO review_records(target_type,proposal_id,reviewer_id,decision,comments,review_date) VALUES(\'Proposal\',?,?,?,?,?)',[p.id,p.review.reviewer,p.review.decision,p.review.comments||null,isoDateTime(p.review.reviewDate)]);
  const prevM=new Map((previous?.milestones||[]).map(m=>[m.id,m.completionReview?.reviewedAt]));
  for(const m of state.milestones) if(m.completionReview?.reviewedAt&&m.completionReview.reviewedAt!==prevM.get(m.id)) await conn.execute('INSERT INTO review_records(target_type,milestone_id,reviewer_id,decision,comments,review_date) VALUES(\'Milestone\',?,?,?,?,?)',[m.id,m.completionReview.reviewer,m.completionReview.outcome,m.completionReview.comments||null,isoDateTime(m.completionReview.reviewedAt)]);
}

async function initialize(conn,projectRoot){
  await ensureCatalog(conn);
  const [[{count}]]=await conn.query('SELECT COUNT(*) AS count FROM users');
  if(Number(count)>0) return;
  const state=seedPrototypeState(projectRoot);
  for(const user of state.users) user.passwordHash=await hashPassword('demo123');
  const conn2=conn;
  await saveState(conn2,state,{users:[],proposals:[],projects:[],milestones:[],documents:[],notifications:[],auditLog:[]});
}

function hashPassword(password){
  const salt=crypto.randomBytes(16);
  return new Promise((resolve,reject)=>crypto.scrypt(String(password),salt,64,(error,key)=>error?reject(error):resolve(`scrypt$${salt.toString('hex')}$${key.toString('hex')}`)));
}
function verifyPassword(password,encoded){
  const [scheme,saltHex,keyHex]=String(encoded||'').split('$');
  if(scheme!=='scrypt'||!saltHex||!keyHex) return Promise.resolve(false);
  const expected=Buffer.from(keyHex,'hex');
  return new Promise((resolve,reject)=>crypto.scrypt(String(password),Buffer.from(saltHex,'hex'),expected.length,(error,key)=>error?reject(error):resolve(crypto.timingSafeEqual(key,expected))));
}

module.exports={loadState,saveState,initialize,ensureCatalog,hashPassword,verifyPassword,ROLE_NAMES,SOURCE_OPTIONS,sourceId,isoDate,isoDateTime,parsed,sizeBytes};
