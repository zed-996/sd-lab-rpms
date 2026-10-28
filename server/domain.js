'use strict';

const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function createDomain(projectRoot){
  const localStorage=new Map();
  const context={
    Date,Math,JSON,Number,String,Object,Array,RegExp,Set,Map,
    localStorage:{getItem:key=>localStorage.get(key)||null,setItem:(key,value)=>localStorage.set(key,value),removeItem:key=>localStorage.delete(key)},
    confirm:()=>true
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot,'js/store.js'),'utf8'),context,{filename:'js/store.js'});
  vm.runInContext(fs.readFileSync(path.join(projectRoot,'js/services.js'),'utf8'),context,{filename:'js/services.js'});
  function call(operation,state,user,payload={}){
    payload=payload&&typeof payload==='object'?payload:{};
    if(!payload.data||typeof payload.data!=='object')payload={...payload,data:{}};
    context.__rpms_state=state;
    context.__rpms_actor=user;
    vm.runInContext('DB=__rpms_state',context);
    const script=({
      'proposal.saveDraft':`ProposalService.saveDraft(__rpms_payload.data,__rpms_actor,__rpms_payload.existingId)`,
      'proposal.submit':`ProposalService.submit(__rpms_payload.id,__rpms_actor)`,
      'proposal.decide':`ProposalService.decide(__rpms_payload.id,__rpms_actor,__rpms_payload.decision,__rpms_payload.comments,false)`,
      'proposal.withdraw':`ProposalService.withdraw(__rpms_payload.id,__rpms_actor)`,
      'project.access.grant':`ProjectAccess.grant(__rpms_payload.projectId,__rpms_actor,__rpms_payload.userId,__rpms_payload.access)`,
      'project.access.update':`ProjectAccess.update(__rpms_payload.projectId,__rpms_actor,__rpms_payload.userId,__rpms_payload.access)`,
      'project.access.revoke':`ProjectAccess.revoke(__rpms_payload.projectId,__rpms_actor,__rpms_payload.userId)`,
      'project.status':`ProjectService.updateStatus(__rpms_payload.projectId,__rpms_actor,__rpms_payload.status,__rpms_payload.reason)`,
      'milestone.submit':`MilestoneService.submitCompletion(__rpms_payload.id,__rpms_actor,__rpms_payload.evidence,__rpms_payload.remarks)`,
      'milestone.status':`MilestoneService.updateStatus(__rpms_payload.id,__rpms_actor,__rpms_payload.status)`,
      'milestone.decide':`MilestoneService.decide(__rpms_payload.id,__rpms_actor,__rpms_payload.decision,__rpms_payload.comments)`,
      'deliverable.add':`DeliverableService.add(__rpms_payload.milestoneId,__rpms_actor,__rpms_payload.data)`,
      'deliverable.update':`DeliverableService.update(__rpms_payload.id,__rpms_actor,__rpms_payload.data)`,
      'funding.utilization':`FundingService.recordUtilization(__rpms_payload.projectId,__rpms_actor,__rpms_payload.data)`,
      'funding.disbursement':`FundingService.recordDisbursement(__rpms_payload.projectId,__rpms_actor,__rpms_payload.data)`,
      'funding.allocation':`FundingService.recordAllocation(__rpms_payload.projectId,__rpms_actor,__rpms_payload.data)`,
      'admin.createUser':`AdminService.createUser(__rpms_actor,__rpms_payload.data)`,
      'admin.setRole':`AdminService.setRole(__rpms_actor,__rpms_payload.userId,__rpms_payload.role)`,
      'admin.setActive':`AdminService.setActive(__rpms_actor,__rpms_payload.userId,__rpms_payload.active)`,
      'notification.markRead':`AdminService.markAllNotificationsRead(__rpms_actor.id)`,
    })[operation];
    if(!script) throw new Error('Unsupported operation');
    context.__rpms_payload=payload;
    const result=vm.runInContext(script,context);
    const nextState=JSON.parse(vm.runInContext('JSON.stringify(DB)',context));
    return {result,state:nextState};
  }
  function register(state,data){
    context.__rpms_state=state;context.__rpms_data=data;
    vm.runInContext('DB=__rpms_state',context);
    const result=vm.runInContext('Auth.register(__rpms_data)',context);
    return {result,state:JSON.parse(vm.runInContext('JSON.stringify(DB)',context))};
  }
  function seed(){return JSON.parse(vm.runInContext('JSON.stringify(seedDB())',context));}
  function refreshDeadlines(state){context.__rpms_state=state;vm.runInContext('DB=__rpms_state',context);vm.runInContext('refreshDeadlineNotifications()',context);return JSON.parse(vm.runInContext('JSON.stringify(DB)',context));}
  return {call,register,seed,refreshDeadlines};
}

module.exports={createDomain};
