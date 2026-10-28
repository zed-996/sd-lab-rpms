'use strict';
/* Existing synchronous UI services now call the RPMS server. The server owns
   authentication, validation, authorization and MySQL persistence. */
window.RPMS_API_MODE=true;
const RPMS_TOKEN_KEY='rpms_jwt_session';
const tokenGet=()=>sessionStorage.getItem(RPMS_TOKEN_KEY)||'';
function setRemoteState(state){if(state)DB=state;}
function apiRequest(method,url,body,options={}){
  if(window.location.protocol==='file:')return {ok:false,code:'SERVER_REQUIRED',message:'Open RPMS at http://127.0.0.1:8080 after starting MySQL and the RPMS server. Opening index.html directly cannot sign in.'};
  const xhr=new XMLHttpRequest();
  try{
    xhr.open(method,'/api'+url,false);
    xhr.setRequestHeader('Accept','application/json');
    const token=tokenGet();if(token)xhr.setRequestHeader('Authorization','Bearer '+token);
    if(options.multipart){xhr.send(body);}else{
      xhr.setRequestHeader('Content-Type','application/json');xhr.send(body===undefined?null:JSON.stringify(body));
    }
  }catch{
    return {ok:false,code:'SERVER_UNAVAILABLE',message:'The RPMS server could not be reached. Start MySQL and the RPMS server, then open http://127.0.0.1:8080.'};
  }
  let result;try{result=JSON.parse(xhr.responseText||'{}');}catch{result={ok:false,code:'ERROR',message:'The server returned an unreadable response.'};}
  if(result.token)sessionStorage.setItem(RPMS_TOKEN_KEY,result.token);
  if(result.state)setRemoteState(result.state);
  if(xhr.status===401&&url!=='/auth/login')sessionStorage.removeItem(RPMS_TOKEN_KEY);
  if(xhr.status>=500)return {ok:false,code:result.code||'ERROR',message:result.message||'The server could not complete the request.'};
  return result;
}
function apiCommand(command,payload){return apiRequest('POST','/commands/'+encodeURIComponent(command),payload);}

Auth.login=(email,password)=>apiRequest('POST','/auth/login',{email,password});
Auth.register=data=>apiRequest('POST','/auth/register',data);
Auth.current=()=>{
  if(!tokenGet())return null;
  const response=apiRequest('GET','/auth/session');return response.ok?response.user:null;
};
Auth.logout=()=>{const result=apiRequest('POST','/auth/logout',{});sessionStorage.removeItem(RPMS_TOKEN_KEY);return result;};
Auth.requestPasswordReset=email=>apiRequest('POST','/auth/password-reset/request',{email});
Auth.passwordResetIsValid=token=>apiRequest('POST','/auth/password-reset/validate',{token}).valid===true;
Auth.resetPassword=(token,password)=>apiRequest('POST','/auth/password-reset/complete',{token,password});

ProjectAccess.grant=(projectId,_caller,userId,access)=>apiCommand('project.access.grant',{projectId,userId,access});
ProjectAccess.update=(projectId,_caller,userId,access)=>apiCommand('project.access.update',{projectId,userId,access});
ProjectAccess.revoke=(projectId,_caller,userId)=>apiCommand('project.access.revoke',{projectId,userId});
ProjectService.updateStatus=(projectId,_caller,status,reason)=>apiCommand('project.status',{projectId,status,reason});

ProposalService.saveDraft=(data,_caller,existingId)=>apiCommand('proposal.saveDraft',{data,existingId});
ProposalService.submit=(id,_caller)=>apiCommand('proposal.submit',{id});
ProposalService.decide=(id,_caller,decision,comments)=>apiCommand('proposal.decide',{id,decision,comments});
ProposalService.withdraw=(id,_caller)=>apiCommand('proposal.withdraw',{id});

MilestoneService.submitCompletion=(id,_caller,evidence,remarks)=>{
  const form=new FormData();form.append('remarks',remarks||'');
  (evidence||[]).forEach(file=>{if(file instanceof File)form.append('evidence',file,file.name);});
  return apiRequest('POST',`/milestones/${encodeURIComponent(id)}/completion`,form,{multipart:true});
};
MilestoneService.updateStatus=(id,_caller,status)=>apiCommand('milestone.status',{id,status});
MilestoneService.decide=(id,_caller,decision,comments)=>apiCommand('milestone.decide',{id,decision,comments});

DeliverableService.add=(milestoneId,_caller,data)=>apiCommand('deliverable.add',{milestoneId,data});
DeliverableService.update=(id,_caller,data)=>apiCommand('deliverable.update',{id,data});
FundingService.recordUtilization=(projectId,_caller,data)=>apiCommand('funding.utilization',{projectId,data});
FundingService.recordDisbursement=(projectId,_caller,data)=>apiCommand('funding.disbursement',{projectId,data});
FundingService.recordAllocation=(projectId,_caller,data)=>apiCommand('funding.allocation',{projectId,data});
AdminService.createUser=(_actor,data)=>apiCommand('admin.createUser',{data});
AdminService.setRole=(_actor,userId,role)=>apiCommand('admin.setRole',{userId,role});
AdminService.setActive=(_actor,userId,active)=>apiCommand('admin.setActive',{userId,active});
AdminService.markAllNotificationsRead=userId=>apiCommand('notification.markRead',{userId});

const DocumentService={
  upload(file,{projectId='',proposalId='',milestoneId='',type='Other'}={}){
    if(!(file instanceof File)||file.size===0)return {ok:false,code:'UNPROCESSABLE',message:'Choose a non-empty file to upload.'};
    const form=new FormData();form.append('file',file,file.name);form.append('type',type);
    const query=new URLSearchParams();if(projectId)query.set('projectId',projectId);if(proposalId)query.set('proposalId',proposalId);if(milestoneId)query.set('milestoneId',milestoneId);
    return apiRequest('POST','/documents/upload'+(query.size?'?'+query.toString():''),form,{multipart:true});
  },
  download(id,name='document'){
    return fetch(`/api/documents/${encodeURIComponent(id)}/download`,{headers:{Authorization:'Bearer '+tokenGet()}}).then(async response=>{
      if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.message||'Unable to download document.');}
      const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name||'document';document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
    });
  }
};
const ReportService={get(){return apiRequest('GET','/reports');},async downloadCsv(){const response=await fetch('/api/reports?format=csv',{headers:{Authorization:'Bearer '+tokenGet()}});if(!response.ok)throw new Error('The report could not be downloaded.');const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='rpms-project-report.csv';document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);}};
