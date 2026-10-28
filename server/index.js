'use strict';

const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {URL}=require('node:url');
const {createPool}=require('./database');
const {migrate}=require('./migrate');
const repository=require('./repository');
const {createDomain}=require('./domain');
const {createToken,verifyToken,bearer,sessionExpiry,SESSION_TTL_SECONDS}=require('./security');

const ROOT=path.resolve(__dirname,'..');
const FILE_ROOT=path.join(__dirname,'uploads');
const MAX_UPLOAD=25*1024*1024;
const MAX_JSON=35*1024*1024;
const ALLOWED_DOCUMENT_TYPES=new Set(['Proposal','Approval Letter','Progress Report','Publication','Financial Report','Milestone Evidence','Other']);
const SECURITY_HEADERS={'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"};
let poolPromise;
const getPool=()=>poolPromise||(poolPromise=createPool());
const domain=createDomain(ROOT);

if(process.env.NODE_ENV==='production'&&(!process.env.RPMS_JWT_SECRET||process.env.RPMS_JWT_SECRET.length<32))throw new Error('Set RPMS_JWT_SECRET to a random value of at least 32 characters in production.');

const sendJson=(res,status,body)=>{res.writeHead(status,{...SECURITY_HEADERS,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
const jsonBody=async(req,limit=MAX_JSON)=>{
  const buffers=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>limit)throw httpError(413,'Request body is too large.');buffers.push(chunk);}
  if(!size)return {};
  try{return JSON.parse(Buffer.concat(buffers).toString('utf8'));}catch{throw httpError(400,'Invalid JSON request body.');}
};
const rawBody=async(req,limit=MAX_UPLOAD)=>{
  const buffers=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>limit)throw httpError(413,'Uploaded file exceeds the 25 MB limit.');buffers.push(chunk);}
  return Buffer.concat(buffers);
};
const httpError=(status,message)=>Object.assign(new Error(message),{status});
const cleanJson=value=>JSON.parse(JSON.stringify(value));

async function issueSession(conn,userId){
  const sid=crypto.randomUUID();const token=createToken(userId,sid);
  await conn.execute('INSERT INTO sessions(session_id,user_id,expires_at) VALUES(?,?,?)',[sid,userId,sessionExpiry()]);
  return token;
}

async function authUser(conn,req){
  const token=bearer(req),claims=verifyToken(token);if(!claims)throw httpError(401,'Your session is invalid or has expired. Please sign in again.');
  const [[row]]=await conn.execute(`SELECT u.user_id,u.full_name,u.email,u.role_key,u.department,u.active,s.expires_at,s.revoked_at
    FROM sessions s JOIN users u ON u.user_id=s.user_id WHERE s.session_id=?`,[claims.sid]);
  if(!row||!row.active||row.revoked_at||new Date(row.expires_at).getTime()<=Date.now()||row.user_id!==claims.sub)throw httpError(401,'Your session is invalid or has expired. Please sign in again.');
  return {id:row.user_id,name:row.full_name,email:row.email,role:row.role_key,dept:row.department,active:!!row.active};
}

function canSeeProject(project,user){
  if(!project||!user)return false;
  if(project.pi===user.id||(project.team||[]).some(m=>m.userId===user.id))return true;
  return ['COORDINATOR','APPROVER','ADMIN','AUDITOR','FUNDING'].includes(user.role);
}
function canContributeProject(project,user){
  if(!project||!user)return false;
  if(project.pi===user.id||['COORDINATOR','ADMIN'].includes(user.role))return true;
  return (project.team||[]).some(m=>m.userId===user.id&&m.access==='Contributor');
}
function canUploadProjectDocument(project,user){
  if(!project||!user)return false;
  if(project.pi===user.id||user.role==='ADMIN')return true;
  return (project.team||[]).some(m=>m.userId===user.id&&m.access==='Contributor');
}
function accessFor(project,user){
  if(project.pi===user.id)return 'Owner';
  return (project.team||[]).find(m=>m.userId===user.id)?.access||null;
}
function filteredState(state,user){
  const out=cleanJson(state);
  const visibleProjects=out.projects.filter(p=>canSeeProject(p,user));
  const projectIds=new Set(visibleProjects.map(p=>p.id));
  const ownerProposals=new Set(out.proposals.filter(p=>p.pi===user.id).map(p=>p.id));
  const staff=['COORDINATOR','APPROVER','ADMIN','AUDITOR'].includes(user.role);
  const visibleProposalIds=new Set(out.proposals.filter(p=>ownerProposals.has(p.id)||staff||visibleProjects.some(pr=>pr.proposalId===p.id)).map(p=>p.id));
  const userIds=new Set([user.id]);
  visibleProjects.forEach(project=>{userIds.add(project.pi);(project.team||[]).forEach(member=>userIds.add(member.userId));});
  out.proposals.filter(p=>visibleProposalIds.has(p.id)).forEach(proposal=>userIds.add(proposal.pi));
  if(['ADMIN','AUDITOR'].includes(user.role))out.auditLog.forEach(entry=>userIds.add(entry.actor));
  const ownsProject=visibleProjects.some(project=>project.pi===user.id);
  out.users=out.users.filter(account=>user.role==='ADMIN'||(user.role==='PI'&&ownsProject&&account.active)||(user.role==='COORDINATOR'&&account.role==='PI'&&account.active)||userIds.has(account.id))
    .map(({id,name,email,role,dept,active,registeredOn,lastLogin})=>({id,name,email,role,dept,active,registeredOn,lastLogin}));
  out.projects=visibleProjects.map(p=>{
    if(accessFor(p,user)==='View Only'){
      p.funding={source:'Restricted',proposedBudget:0,sanctioned:0,received:0,utilized:0};delete p.disbursements;delete p.utilizations;
      delete p.fundingRecords;
    }
    return p;
  });
  const projectProposalIds=new Set(visibleProjects.map(p=>p.proposalId));
  out.proposals=out.proposals.filter(p=>ownerProposals.has(p.id)||staff);
  out.milestones=out.milestones.filter(m=>projectIds.has(m.projectId));
  out.documents=out.documents.filter(d=>(d.projectId&&projectIds.has(d.projectId))||(d.proposalId&&(visibleProposalIds.has(d.proposalId)||projectProposalIds.has(d.proposalId))));
  out.notifications=out.notifications.filter(n=>n.recipient===user.id);
  if(!['ADMIN','AUDITOR'].includes(user.role))out.auditLog=[];
  return out;
}

async function withWrite(user,work){
  const pool=await getPool(),conn=await pool.getConnection();
  let locked=false;
  try{
    const [lock]=await conn.query("SELECT GET_LOCK('rpms-mutation',10) AS acquired");
    if(Number(lock[0]?.acquired)!==1)throw httpError(503,'The system is busy. Please retry the operation.');
    locked=true;await conn.beginTransaction();
    const previous=await repository.loadState(conn);
    const outcome=await work(conn,previous);
    if(outcome?.error){await conn.rollback();return outcome;}
    await commitOutcome(conn,outcome,previous);
    return outcome;
  }catch(error){try{await conn.rollback();}catch{}throw error;}
  finally{if(locked)try{await conn.query("SELECT RELEASE_LOCK('rpms-mutation')");}catch{}conn.release();}
}

async function commitOutcome(conn,outcome,previous,saveState=repository.saveState){
  if(outcome?.state&&!outcome.persisted)await saveState(conn,outcome.state,previous);
  if(typeof outcome?.afterSave==='function'){
    const afterSave=outcome.afterSave;
    delete outcome.afterSave;
    await afterSave(conn,outcome);
  }
  await conn.commit();
}

function statusForResult(result){
  if(result?.ok)return 200;
  return ({UNAUTHORIZED:401,FORBIDDEN:403,NOT_FOUND:404,CONFLICT:409,UNPROCESSABLE:422,BAD_REQUEST:400})[result?.code]||400;
}

async function handleLogin(req,res){
  const body=await jsonBody(req,32*1024);const email=String(body.email||'').trim().toLowerCase();
  const outcome=await withWrite(null,async(conn,state)=>{
    const user=state.users.find(x=>x.email.toLowerCase()===email);
    const valid=user&&await repository.verifyPassword(body.password||'',user.passwordHash);
    if(!valid||!user.active)return {error:{status:401,message:'Invalid email or password.'}};
    user.lastLogin=new Date().toISOString().slice(0,19);
    addAuditToState(state,user.id,'USER_LOGIN',user.id,'Signed in','User');
    const token=await issueSession(conn,user.id);
    return {token,user:{id:user.id,name:user.name,email:user.email,role:user.role,dept:user.dept,active:true},state};
  });
  if(outcome.error)return sendJson(res,outcome.error.status,{ok:false,code:'UNAUTHORIZED',message:outcome.error.message});
  return sendJson(res,200,{ok:true,token:outcome.token,user:outcome.user,state:filteredState(outcome.state,outcome.user)});
}

async function handleRegister(req,res){
  const data=await jsonBody(req,64*1024);
  const outcome=await withWrite(null,async(conn,state)=>{
    const result=domain.register(state,{name:data.name,email:data.email,dept:data.dept,password:data.password});
    if(!result.result.ok)return {error:{status:statusForResult(result.result),result:result.result}};
    const user=result.state.users.find(x=>x.id===result.result.user.id);
    user.passwordHash=await repository.hashPassword(data.password);
    return {user,state:result.state,afterSave:async(sessionConn,registered)=>{registered.token=await issueSession(sessionConn,user.id);}};
  });
  if(outcome.error)return sendJson(res,outcome.error.status,{ok:false,...outcome.error.result});
  return sendJson(res,201,{ok:true,token:outcome.token,user:{id:outcome.user.id,name:outcome.user.name,email:outcome.user.email,role:outcome.user.role,dept:outcome.user.dept,active:true},state:filteredState(outcome.state,outcome.user)});
}

async function handleSession(req,res){
  const pool=await getPool(),probe=await pool.getConnection();let user,claims;
  try{user=await authUser(probe,req);claims=verifyToken(bearer(req));}finally{probe.release();}
  const outcome=await withWrite(user,async(conn,state)=>{
    await conn.execute('UPDATE sessions SET expires_at=? WHERE session_id=?',[sessionExpiry(),claims.sid]);
    const refreshed=domain.refreshDeadlines(state);
    return {state:refreshed,refreshed};
  });
  return sendJson(res,200,{ok:true,user,token:createToken(user.id,claims.sid),state:filteredState(outcome.refreshed,user)});
}

async function handleLogout(req,res){
  const claims=verifyToken(bearer(req));
  if(claims){const pool=await getPool(),probe=await pool.getConnection();let user;try{user=await authUser(probe,req);}finally{probe.release();}
    await withWrite(user,async(conn,state)=>{await conn.execute('UPDATE sessions SET revoked_at=UTC_TIMESTAMP() WHERE session_id=?',[claims.sid]);addAuditToState(state,user.id,'USER_LOGOUT',user.id,'Signed out','User');return {state};});
  }
  return sendJson(res,200,{ok:true});
}

async function handlePasswordReset(req,res,action){
  const body=await jsonBody(req,32*1024),raw=String(body.token||'');
  if(action==='request'){
    const email=String(body.email||'').trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw httpError(422,'Enter a valid email address.');
    const pool=await getPool(),conn=await pool.getConnection();
    try{
      const [[user]]=await conn.execute('SELECT user_id FROM users WHERE email=? AND active=TRUE',[email]);
      const token=crypto.randomBytes(32).toString('base64url'),tokenHash=crypto.createHash('sha256').update(token).digest('hex');
      if(!user)return sendJson(res,200,{ok:true,token});
      await conn.beginTransaction();
      try{
        await conn.execute('UPDATE password_resets SET used_at=UTC_TIMESTAMP() WHERE user_id=? AND used_at IS NULL',[user.user_id]);
        await conn.execute('INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE))',[tokenHash,user.user_id]);
        await conn.commit();
      }catch(error){await conn.rollback();throw error;}
      return sendJson(res,200,{ok:true,token});
    }finally{conn.release();}
  }
  if(!raw||raw.length>256)return action==='validate'?sendJson(res,200,{ok:true,valid:false}):sendJson(res,401,{ok:false,code:'UNAUTHORIZED',message:'This password reset link is invalid or has expired.'});
  const tokenHash=crypto.createHash('sha256').update(raw).digest('hex');
  if(action==='validate'){
    const pool=await getPool(),conn=await pool.getConnection();
    try{const [[row]]=await conn.execute('SELECT 1 AS valid FROM password_resets r JOIN users u ON u.user_id=r.user_id WHERE r.token_hash=? AND r.used_at IS NULL AND r.expires_at>UTC_TIMESTAMP() AND u.active=TRUE',[tokenHash]);return sendJson(res,200,{ok:true,valid:!!row});}finally{conn.release();}
  }
  const password=String(body.password||'');if(password.length<6||password.length>1024)throw httpError(422,'Password must be at least 6 characters long.');
  const outcome=await withWrite(null,async(conn,state)=>{
    const [[reset]]=await conn.execute('SELECT r.user_id FROM password_resets r JOIN users u ON u.user_id=r.user_id WHERE r.token_hash=? AND r.used_at IS NULL AND r.expires_at>UTC_TIMESTAMP() AND u.active=TRUE FOR UPDATE',[tokenHash]);
    if(!reset)return {error:{status:401,result:{ok:false,code:'UNAUTHORIZED',message:'This password reset link is invalid or has expired.'}}};
    const user=state.users.find(x=>x.id===reset.user_id);if(!user||!user.active)return {error:{status:401,result:{ok:false,code:'UNAUTHORIZED',message:'This password reset link is invalid or has expired.'}}};
    user.passwordHash=await repository.hashPassword(password);
    await conn.execute('UPDATE password_resets SET used_at=UTC_TIMESTAMP() WHERE user_id=? AND used_at IS NULL',[reset.user_id]);
    await conn.execute('UPDATE sessions SET revoked_at=UTC_TIMESTAMP() WHERE user_id=? AND revoked_at IS NULL',[reset.user_id]);
    addAuditToState(state,user.id,'PASSWORD_RESET',user.id,'Password changed using a reset link','User');
    return {state};
  });
  if(outcome.error)return sendJson(res,outcome.error.status,outcome.error.result);
  return sendJson(res,200,{ok:true});
}

async function handleCommand(req,res,operation){
  const body=await jsonBody(req);const pool=await getPool(),probe=await pool.getConnection();
  let user;try{user=await authUser(probe,req);}finally{probe.release();}
  const outcome=await withWrite(user,async(conn,state)=>{
    const actor=state.users.find(u=>u.id===user.id);if(!actor||!actor.active)return {error:{status:401,message:'Account is inactive.'}};
    const payload=body||{};
    const result=domain.call(operation,state,actor,payload);
    if(!result.result?.ok)return {error:{status:statusForResult(result.result),result:result.result}};
    if(operation==='admin.createUser'){
      const fresh=result.state.users.find(x=>x.id===result.result.user.id);
      fresh.passwordHash=await repository.hashPassword(payload.data.password);
    }
    if(operation==='admin.setActive'&&payload.active===false)await conn.execute('UPDATE sessions SET revoked_at=UTC_TIMESTAMP() WHERE user_id=? AND revoked_at IS NULL',[payload.userId]);
    return {state:result.state,result:result.result};
  });
  if(outcome.error)return sendJson(res,outcome.error.status,{ok:false,...outcome.error.result});
  const conn=await pool.getConnection();try{const fresh=await repository.loadState(conn);return sendJson(res,200,{ok:true,result:outcome.result,state:filteredState(fresh,user)});}finally{conn.release();}
}

function parseMultipart(buffer,contentType){
  const boundaryMatch=String(contentType||'').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if(!boundaryMatch)throw httpError(400,'Multipart boundary is missing.');
  const boundary=Buffer.from(`--${boundaryMatch[1]||boundaryMatch[2]}`),parts=[];let cursor=0;
  while((cursor=buffer.indexOf(boundary,cursor))!==-1){
    cursor+=boundary.length;if(buffer.slice(cursor,cursor+2).toString()==='--')break;
    if(buffer.slice(cursor,cursor+2).toString()==='\r\n')cursor+=2;
    const headerEnd=buffer.indexOf(Buffer.from('\r\n\r\n'),cursor);if(headerEnd<0)break;
    const headers=buffer.slice(cursor,headerEnd).toString('utf8');let bodyStart=headerEnd+4;const end=buffer.indexOf(boundary,bodyStart);if(end<0)break;
    let bodyEnd=end;if(buffer.slice(bodyEnd-2,bodyEnd).toString()==='\r\n')bodyEnd-=2;
    const disposition=headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1]||'';
    const name=disposition.match(/name="([^"]+)"/i)?.[1]||'';
    const filename=disposition.match(/filename="([^"]*)"/i)?.[1];
    const mime=headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim()||'application/octet-stream';
    parts.push({name,filename:filename==null?null:path.basename(filename),mime,data:buffer.subarray(bodyStart,bodyEnd)});cursor=end;
  }
  return parts;
}

function newDocId(state){const n=state.counters.doc++;return `DOC-${String(n).padStart(3,'0')}`;}
function addAuditToState(state,actor,action,target,remarks,targetEntity='Record'){
  const n=state.counters.log++;state.auditLog.unshift({id:`LOG-${String(n).padStart(4,'0')}`,actor,action,target,targetEntity,time:new Date().toISOString().slice(0,19),remarks});
}
async function handleUpload(req,res,user,route){
  const bytes=await rawBody(req,MAX_UPLOAD+64*1024);const parts=parseMultipart(bytes,req.headers['content-type']);
  const fields=Object.fromEntries(parts.filter(x=>!x.filename).map(x=>[x.name,x.data.toString('utf8')]));
  const file=parts.find(x=>x.filename);if(!file||!file.data.length)throw httpError(422,'Choose a non-empty document to upload.');
  const type=fields.type||'Other';if(!ALLOWED_DOCUMENT_TYPES.has(type))throw httpError(422,'Choose a valid document category.');
  const pool=await getPool(),conn0=await pool.getConnection();let actor;try{actor=await authUser(conn0,req);}finally{conn0.release();}
  if(file.filename.length>255||file.mime.length>160)throw httpError(422,'The document name or file type is too long.');
  const docId=`DOC-${crypto.randomUUID()}`;const relative=`files/${docId}`;const full=path.join(FILE_ROOT,docId);await fs.promises.mkdir(FILE_ROOT,{recursive:true});
  await fs.promises.writeFile(full,file.data,{flag:'wx',mode:0o600});
  let outcome;
  try{outcome=await withWrite(actor,async(conn,state)=>{
    let project=null,proposal=null;
    if(route.projectId){project=state.projects.find(p=>p.id===route.projectId);if(!project)return {error:{status:404,message:'Project not found.'}};if(!canSeeProject(project,actor))return {error:{status:403,message:'You do not have access to this project.'}};}
    if(route.proposalId){proposal=state.proposals.find(p=>p.id===route.proposalId);if(!proposal)return {error:{status:404,message:'Proposal not found.'}};if(proposal.pi!==actor.id&&actor.role!=='ADMIN'&&!(actor.role==='COORDINATOR'&&proposal.status==='Draft'))return {error:{status:403,message:'Only the proposal PI, an assisting coordinator on a draft, or an administrator can upload supporting documents.'}};}
    if(route.milestoneId){const m=state.milestones.find(x=>x.id===route.milestoneId);if(!m)return {error:{status:404,message:'Milestone not found.'}};project=state.projects.find(p=>p.id===m.projectId);if(!canSeeProject(project,actor))return {error:{status:403,message:'You do not have access to this milestone.'}};}
    if(project&&!canUploadProjectDocument(project,actor))return {error:{status:403,message:'Only the project PI, assigned contributors or an administrator can upload documents.'}};
    if(!project&&!proposal)return {error:{status:422,message:'Choose a project, proposal or milestone for this document.'}};
    if(route.projectId&&route.milestoneId&&state.milestones.find(m=>m.id===route.milestoneId)?.projectId!==route.projectId)return {error:{status:422,message:'The milestone does not belong to the selected project.'}};
    if(project&&proposal&&project.proposalId!==proposal.id)return {error:{status:422,message:'The proposal does not belong to the selected project.'}};
    const parentProject=project?.id||null,parentProposal=proposal?.id||null;
    const sameName=state.documents.filter(d=>d.name===file.filename&&((parentProject&&d.projectId===parentProject)||(parentProposal&&d.proposalId===parentProposal)));
    const document={id:docId,projectId:parentProject,proposalId:parentProposal,milestoneId:route.milestoneId||null,type,name:file.filename,mimeType:file.mime,size:file.data.length,version:sameName.length+1,uploadedBy:actor.id,uploadDate:new Date().toISOString().slice(0,19),fileReference:relative};
    state.documents.unshift(document);if(proposal){proposal.documents=proposal.documents||[];proposal.documents.unshift(document);}
    addAuditToState(state,actor.id,'DOCUMENT_UPLOADED',document.id,`${type}: ${file.filename}`);
    return {state,result:{ok:true,document:{id:docId,name:file.filename,type,version:document.version,size:file.data.length,uploadDate:document.uploadDate}}};
  });}catch(error){await fs.promises.unlink(full).catch(()=>{});throw error;}
  if(outcome.error){await fs.promises.unlink(full).catch(()=>{});return sendJson(res,outcome.error.status,{ok:false,code:outcome.error.status===403?'FORBIDDEN':outcome.error.status===404?'NOT_FOUND':'UNPROCESSABLE',message:outcome.error.message});}
  return sendJson(res,201,{ok:true,result:outcome.result,state:filteredState(outcome.state,actor)});
}

async function handleCompletionUpload(req,res,user,milestoneId){
  const body=await rawBody(req,MAX_UPLOAD*3);const parts=parseMultipart(body,req.headers['content-type']);
  const remarks=parts.find(p=>p.name==='remarks')?.data.toString('utf8')||'';
  const files=parts.filter(p=>p.name==='evidence'&&p.filename&&p.data.length);
  if(!files.length)throw httpError(422,'Attach at least one completion evidence document.');
  if(files.length>10)throw httpError(422,'Attach no more than 10 evidence files at a time.');
  const pool=await getPool(),conn0=await pool.getConnection();let actor;try{actor=await authUser(conn0,req);}finally{conn0.release();}
  if(files.some(f=>f.filename.length>255||f.mime.length>160))throw httpError(422,'An evidence document name or file type is too long.');
  await fs.promises.mkdir(FILE_ROOT,{recursive:true});const pending=files.map(f=>({file:f,id:`DOC-${crypto.randomUUID()}`}));
  for(const x of pending){x.full=path.join(FILE_ROOT,x.id);await fs.promises.writeFile(x.full,x.file.data,{flag:'wx',mode:0o600});}
  let outcome;
  try{outcome=await withWrite(actor,async(conn,state)=>{
    const evidence=pending.map(x=>({name:x.file.filename,size:x.file.data.length,mimeType:x.file.mime,fileReference:`files/${x.id}`,id:x.id}));
    const result=domain.call('milestone.submit',state,state.users.find(u=>u.id===actor.id),{id:milestoneId,evidence,remarks});
    if(!result.result.ok)return {error:{status:statusForResult(result.result),result:result.result}};
    const newIds=new Set(result.state.documents.filter(d=>!state.documents.some(before=>before.id===d.id)).map(d=>d.id));
    for(const item of pending){const doc=result.state.documents.find(d=>newIds.has(d.id)&&d.name===item.file.filename&&!d.fileReference);if(doc){doc.id=item.id;doc.fileReference=`files/${item.id}`;doc.mimeType=item.file.mime;doc.size=item.file.data.length;}else{
        const duplicate=result.state.documents.find(d=>newIds.has(d.id)&&d.name===item.file.filename);if(duplicate){duplicate.id=item.id;duplicate.fileReference=`files/${item.id}`;duplicate.mimeType=item.file.mime;duplicate.size=item.file.data.length;}
      }}
    return {state:result.state,result:result.result};
  });}catch(error){for(const x of pending)await fs.promises.unlink(x.full).catch(()=>{});throw error;}
  if(outcome.error){for(const x of pending)await fs.promises.unlink(x.full).catch(()=>{});return sendJson(res,outcome.error.status,{ok:false,...outcome.error.result});}
  return sendJson(res,200,{ok:true,result:outcome.result,state:filteredState(outcome.state,actor)});
}

async function handleDownload(req,res,user,id){
  const conn=await (await getPool()).getConnection();
  try{
    const state=await repository.loadState(conn),doc=state.documents.find(x=>x.id===id);if(!doc)throw httpError(404,'Document not found.');
    const project=state.projects.find(p=>p.id===doc.projectId);
    const proposal=state.proposals.find(p=>p.id===doc.proposalId);
    const linkedProject=proposal&&state.projects.find(p=>p.proposalId===proposal.id);
    const allowed=(project&&canSeeProject(project,user))||(proposal&&(proposal.pi===user.id||['COORDINATOR','APPROVER','ADMIN','AUDITOR'].includes(user.role)||(linkedProject&&canSeeProject(linkedProject,user))));
    if(!allowed)throw httpError(403,'You cannot access this document.');
    if(!doc.fileReference||doc.fileReference.startsWith('demo://'))throw httpError(404,'This demonstration document has no stored file payload.');
    const full=path.resolve(FILE_ROOT,path.basename(doc.fileReference));
    if(!full.startsWith(FILE_ROOT+path.sep))throw httpError(400,'Invalid document reference.');
    const stat=await fs.promises.stat(full);res.writeHead(200,{...SECURITY_HEADERS,'Content-Type':doc.mimeType||'application/octet-stream','Content-Length':stat.size,'Content-Disposition':`attachment; filename="${String(doc.name).replace(/[\r\n"\\]/g,'_')}"`,'Cache-Control':'private, no-store'});fs.createReadStream(full).pipe(res);
  }finally{conn.release();}
}

function reportRows(state,user){
  if(!['COORDINATOR','ADMIN','AUDITOR','FUNDING'].includes(user.role))throw httpError(403,'Your role cannot generate this report.');
  return state.projects.filter(p=>canSeeProject(p,user)).map(p=>{
    const milestones=state.milestones.filter(m=>m.projectId===p.id),deliverables=milestones.flatMap(m=>m.deliverables||[]);
    return {projectId:p.id,title:p.title,principalInvestigator:state.users.find(u=>u.id===p.pi)?.name||'Unknown',status:p.status,domain:p.domain,startDate:p.startDate,expectedEndDate:p.expectedEndDate,milestones:milestones.length,milestonesCompleted:milestones.filter(m=>m.status==='Completed').length,deliverables:deliverables.length,deliverablesCompleted:deliverables.filter(d=>d.status==='Completed').length,fundingSource:(p.fundingRecords||[]).map(f=>f.source).filter(Boolean).join('; ')||p.funding?.source||'',sanctioned:Number(p.funding?.sanctioned||0),disbursed:Number(p.funding?.received||0),utilized:Number(p.funding?.utilized||0),remaining:Number(p.funding?.sanctioned||0)-Number(p.funding?.utilized||0)};
  });
}

function csv(rows){
  if(!rows.length)return '';
  const keys=Object.keys(rows[0]);const quote=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  return [keys.map(quote).join(','),...rows.map(row=>keys.map(key=>quote(row[key])).join(','))].join('\r\n');
}

async function serveStatic(req,res,url){
  let relative=decodeURIComponent(url.pathname);
  if(relative==='/')relative='/index.html';
  const allowed=relative==='/index.html'||/^\/(?:css|js)\/[\w.-]+\.js$/.test(relative)||/^\/(?:css)\/[\w.-]+\.css$/.test(relative)||/^\/notification-[\w.-]+\.svg$/.test(relative);
  if(!allowed)return sendJson(res,404,{ok:false,message:'Not found.'});
  const full=path.resolve(ROOT,'.'+relative);if(!full.startsWith(ROOT+path.sep))return sendJson(res,404,{ok:false,message:'Not found.'});
  try{const data=await fs.promises.readFile(full);const type=relative.endsWith('.html')?'text/html; charset=utf-8':relative.endsWith('.js')?'text/javascript; charset=utf-8':relative.endsWith('.css')?'text/css; charset=utf-8':'image/svg+xml';const cacheControl=/\.(?:html|js|css)$/.test(relative)?'no-store':'public, max-age=3600';res.writeHead(200,{...SECURITY_HEADERS,'Content-Type':type,'Cache-Control':cacheControl});res.end(data);}catch{return sendJson(res,404,{ok:false,message:'Not found.'});}
}

async function handler(req,res){
  try{
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`),pathname=url.pathname;
    if(pathname.startsWith('/api/')){
      if(req.method==='GET'&&pathname==='/api/health')return sendJson(res,200,{ok:true,service:'rpms',storage:'mysql'});
      if(req.method==='POST'&&pathname==='/api/auth/login')return await handleLogin(req,res);
      if(req.method==='POST'&&pathname==='/api/auth/register')return await handleRegister(req,res);
      if(req.method==='GET'&&pathname==='/api/auth/session')return await handleSession(req,res);
      if(req.method==='POST'&&pathname==='/api/auth/logout')return await handleLogout(req,res);
      if(req.method==='POST'&&pathname==='/api/auth/password-reset/request')return await handlePasswordReset(req,res,'request');
      if(req.method==='POST'&&pathname==='/api/auth/password-reset/validate')return await handlePasswordReset(req,res,'validate');
      if(req.method==='POST'&&pathname==='/api/auth/password-reset/complete')return await handlePasswordReset(req,res,'complete');
      if(req.method==='POST'&&pathname==='/api/documents/upload'){
        const c=await (await getPool()).getConnection();let user;try{user=await authUser(c,req);}finally{c.release();}
        return await handleUpload(req,res,user,{projectId:url.searchParams.get('projectId'),proposalId:url.searchParams.get('proposalId'),milestoneId:url.searchParams.get('milestoneId')});
      }
      const evidenceMatch=pathname.match(/^\/api\/milestones\/([\w-]+)\/completion$/);
      if(req.method==='POST'&&evidenceMatch){const c=await (await getPool()).getConnection();let user;try{user=await authUser(c,req);}finally{c.release();}return await handleCompletionUpload(req,res,user,evidenceMatch[1]);}
      const downloadMatch=pathname.match(/^\/api\/documents\/([\w-]+)\/download$/);
      if(req.method==='GET'&&downloadMatch){const c=await (await getPool()).getConnection();let user;try{user=await authUser(c,req);}finally{c.release();}return await handleDownload(req,res,user,downloadMatch[1]);}
      if(req.method==='POST'&&pathname.startsWith('/api/commands/')){
        const operation=decodeURIComponent(pathname.slice('/api/commands/'.length));return await handleCommand(req,res,operation);
      }
      if(req.method==='GET'&&pathname==='/api/reports'){
        const pool=await getPool(),c=await pool.getConnection();let user;try{user=await authUser(c,req);const state=await repository.loadState(c),rows=reportRows(state,user);if(url.searchParams.get('format')==='csv'){res.writeHead(200,{...SECURITY_HEADERS,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="rpms-project-report.csv"','Cache-Control':'private, no-store'});return res.end(csv(rows));}return sendJson(res,200,{ok:true,rows});}finally{c.release();}
      }
      return sendJson(res,404,{ok:false,message:'API route not found.'});
    }
    if(req.method==='GET'||req.method==='HEAD')return await serveStatic(req,res,url);
    return sendJson(res,405,{ok:false,message:'Method not allowed.'});
  }catch(error){
    const status=error.status||500;
    if(status>=500)console.error(error.stack||error.message);
    if(!res.headersSent)sendJson(res,status,{ok:false,code:status===401?'UNAUTHORIZED':status===403?'FORBIDDEN':status===404?'NOT_FOUND':'ERROR',message:status>=500?'The server could not complete the request.':error.message});
    else res.destroy();
  }
}

async function start(){
  const pool=await getPool();await migrate(pool,ROOT);await fs.promises.mkdir(FILE_ROOT,{recursive:true});
  const sweepDeadlines=()=>withWrite(null,async(conn,state)=>({state:domain.refreshDeadlines(state)})).catch(error=>console.error(`Deadline notification sweep failed: ${error.message}`));
  await sweepDeadlines();
  const deadlineTimer=setInterval(sweepDeadlines,60*60*1000);deadlineTimer.unref();
  const server=http.createServer(handler);const port=Number(process.env.PORT||8080),host=process.env.HOST||'127.0.0.1';
  server.listen(port,host,()=>console.log(`RPMS listening at http://${host}:${port}`));
  const close=async()=>{clearInterval(deadlineTimer);server.close();await pool.end();};process.once('SIGINT',close);process.once('SIGTERM',close);
}
if(require.main===module)start().catch(error=>{console.error(`RPMS startup failed: ${error.message}`);process.exitCode=1;});

module.exports={handler,parseMultipart,filteredState,reportRows,csv,commitOutcome};
