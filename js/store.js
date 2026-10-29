'use strict';
/* ==========================================================================
   RPMS prototype — in-browser data store (simulates the SRS section 16 database).
   All records persist in localStorage. "Reset demo data" on the login page reseeds.
   Password for every demo account: demo123 (NFR-005 is simulated — nothing real is stored).
   ========================================================================== */

const DB_KEY = 'rpms_db_v1';
const SESSION_KEY = 'rpms_session_v1';
const SESSION_TTL_MS = 30 * 60 * 1000; // NFR-008: 30-minute sliding session
const DEMO_PASSWORD = 'demo123';

/* ---------- small helpers ---------- */
function pad3(n){ return String(n).padStart(3,'0'); }
function iso(d){ return d.toISOString().slice(0,10); }
function todayISO(){ return iso(new Date()); }
function nowISO(){ return new Date().toISOString().slice(0,16); }
function addMonthsISO(dateStr, months){
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  return iso(d);
}
function daysBetween(fromISO, toISO){
  return Math.round((new Date(toISO+'T00:00:00') - new Date(fromISO+'T00:00:00')) / 86400000);
}
function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function parseDisplayDate(value){
  if(!value) return null;
  if(value instanceof Date) return Number.isNaN(value.getTime())?null:value;
  const text=String(value).trim();if(!text)return null;
  let normalized=text;
  if(/^\d{4}-\d{2}-\d{2}$/.test(text)) normalized=`${text}T00:00:00Z`;
  else if(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(text)) normalized=text.replace(' ','T')+':00Z';
  else if(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)) normalized=text.replace(' ','T')+'Z';
  else if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) normalized=text+':00Z';
  const date=new Date(normalized);
  return Number.isNaN(date.getTime())?null:date;
}
function fmtDate(d){
  const dt=parseDisplayDate(d);if(!dt)return '—';
  return dt.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'});
}
function fmtDateTime(d){
  const dt=parseDisplayDate(d);if(!dt)return '—';
  return dt.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})+', '+
         dt.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
}
function fmtMoney(n){ if(n===null||n===undefined||n==='') return '—';
  return '₹' + Number(n).toLocaleString('en-IN'); }
function humanSize(bytes){
  if(bytes < 1024) return bytes + ' B';
  if(bytes < 1048576) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1048576).toFixed(1) + ' MB';
}

/* ---------- lookups ---------- */
function findProposal(id){ return DB.proposals.find(p => p.id === id && !p.deletedAt); }
function findProject(id){ return DB.projects.find(p => p.id === id); }
function findMilestone(id){ return DB.milestones.find(m => m.id === id); }
function userById(id){ return DB.users.find(u => u.id === id) || { name:'Unknown', role:'?' }; }
function usersByRole(role){ return DB.users.filter(u => u.role === role && u.active); }

/* ---------- seed data (matches the wireframe scenario) ---------- */
function seedDB(){
  const t = todayISO();
  return {
    meta:{ seededOn: t },
    users:[
      { id:'USR-001', name:'Arjun Malhotra',   email:'admin@lnmiit.ac.in',        role:'ADMIN',       dept:'Administration',     active:true },
      { id:'USR-101', name:'Dr. Priya Sharma', email:'priya.sharma@lnmiit.ac.in', role:'PI',          dept:'CSE',                active:true },
      { id:'USR-102', name:'Dr. Amit Mehta',   email:'amit.mehta@lnmiit.ac.in',   role:'PI',          dept:'ECE',                active:true },
      { id:'USR-104', name:'Dr. Sunita Rao',   email:'sunita.rao@lnmiit.ac.in',   role:'PI',          dept:'CHE',                active:true },
      { id:'USR-103', name:'Ms. Kavita Rao',   email:'kavita.rao@lnmiit.ac.in',   role:'COORDINATOR', dept:'Research Office',    active:true },
      { id:'USR-205', name:'Prof. Rajesh Gupta', email:'rajesh.gupta@lnmiit.ac.in', role:'APPROVER',  dept:'Research Committee', active:true },
      { id:'USR-301', name:'Dr. Suresh Nair',  email:'dst.rep@serb.gov.in',       role:'FUNDING',     dept:'DST - SERB',         active:true },
      { id:'USR-401', name:'Ms. Rekha Iyer',   email:'auditor@lnmiit.ac.in',      role:'AUDITOR',     dept:'Internal Audit',     active:true },
    ],
    fundingSources:['DST-SERB','AICTE','Ministry of Power','Siemens R&D Grant','Other','Self-funded'],
    proposals:[
      { id:'PROP-2026-042', title:'AI-based Crop Disease Detection', pi:'USR-101', domain:'AI/ML',
        fundingSource:'DST-SERB', budget:null,
        abstract:'A deep learning approach to early detection of crop diseases from low-cost smartphone imagery, targeting smallholder farms in Rajasthan.',
        objectives:'Develop a CNN-based classifier for 12 major crop diseases; deploy an on-device inference app; validate accuracy with 2 agricultural universities.',
        methodology:'', expectedOutcomes:'',
        startDate:'', endDate:'',
        expectedMilestones:'M1 Dataset, M2 Prototype model, M3 Field validation',
        status:'Draft', submissionDate:null, lastUpdated:'2026-09-19T10:30', version:1,
        documents:[ {id:'DOC-101', type:'Proposal', name:'proposal_draft_v1.pdf', size:'1.2 MB', version:1, uploadedBy:'USR-101', uploadDate:'2026-09-19'} ],
        review:null },
      { id:'PROP-2026-043', title:'Soil Moisture Sensing Network', pi:'USR-101', domain:'IoT',
        fundingSource:'AICTE', budget:950000,
        abstract:'A LPWAN-based soil moisture monitoring network for precision irrigation across 40 acres of demonstration farmland.',
        objectives:'Design low-power sensor nodes; build a LoRa gateway mesh; publish irrigation advisories to farmers.',
        methodology:'Hardware prototyping with ESP32 + LoRa modules; field deployment in 2 villages; edge analytics on the gateway.',
        expectedOutcomes:'A working 40-node network and a farmer-facing advisory dashboard.',
        startDate:'2027-01-05', endDate:'2027-12-31',
        expectedMilestones:'M1 Node design, M2 Field deployment, M3 Advisory dashboard',
        status:'Under Review', submissionDate:'2026-09-12T09:15', lastUpdated:'2026-09-12T09:15', version:1,
        documents:[ {id:'DOC-102', type:'Proposal', name:'soil_moisture_proposal.pdf', size:'2.4 MB', version:2, uploadedBy:'USR-101', uploadDate:'2026-09-12'} ],
        review:null },
      { id:'PROP-2026-044', title:'Wearable Health Monitoring', pi:'USR-102', domain:'Health Tech',
        fundingSource:'AICTE', budget:850000,
        abstract:'A low-power wearable patch for continuous monitoring of vitals in post-operative patients.',
        objectives:'Develop the sensor patch; validate against clinical ECG/SpO2 baselines; build a clinician dashboard.',
        methodology:'Flexible PCB design; clinical pilot with 30 patients; ML anomaly detection on edge.',
        expectedOutcomes:'A certified prototype and a published validation study.',
        startDate:'2027-02-01', endDate:'2027-11-30',
        expectedMilestones:'M1 Sensor patch, M2 Clinical pilot, M3 Dashboard',
        status:'Under Review', submissionDate:'2026-09-20T11:05', lastUpdated:'2026-09-20T11:05', version:1,
        documents:[ {id:'DOC-103', type:'Proposal', name:'wearable_health_proposal.pdf', size:'1.8 MB', version:1, uploadedBy:'USR-102', uploadDate:'2026-09-20'} ],
        review:null },
      { id:'PROP-2026-047', title:'Low-cost Water Quality Sensors', pi:'USR-104', domain:'Environment',
        fundingSource:'DST-SERB', budget:600000,
        abstract:'An IoT sensor node suite for continuous water quality monitoring of urban lakes.',
        objectives:'Develop pH/turbidity/TDS nodes; deploy across 5 lakes; open-source the data pipeline.',
        methodology:'Calibration against lab-grade instruments; solar-powered nodes; LoRaWAN backhaul.',
        expectedOutcomes:'5 deployed stations with a public data dashboard.',
        startDate:'2027-01-15', endDate:'2027-10-31',
        expectedMilestones:'M1 Node calibration, M2 Lake deployment, M3 Public dashboard',
        status:'Under Review', submissionDate:'2026-09-22T14:40', lastUpdated:'2026-09-22T14:40', version:1,
        documents:[ {id:'DOC-104', type:'Proposal', name:'water_quality_proposal.pdf', size:'2.1 MB', version:1, uploadedBy:'USR-104', uploadDate:'2026-09-22'} ],
        review:null },
      { id:'PROP-2026-031', title:'Smart Grid Load Analytics', pi:'USR-101', domain:'Energy',
        fundingSource:'DST-SERB', budget:2400000,
        abstract:'ML-based short-term load forecasting for the campus smart grid to reduce peak demand charges.',
        objectives:'Forecast hourly load 24h ahead with <5% MAPE; integrate with campus SCADA.',
        methodology:'LSTM + transformer ensembles trained on 3 years of smart-meter data.',
        expectedOutcomes:'A deployed forecasting service integrated with the facilities team workflow.',
        startDate:'2026-09-05', endDate:'2027-08-31',
        expectedMilestones:'M1 Dataset, M2 Prototype model, M3 Field validation',
        status:'Approved', submissionDate:'2026-08-20T10:00', lastUpdated:'2026-09-02T12:00', version:1,
        documents:[ {id:'DOC-105', type:'Proposal', name:'smart_grid_proposal_final.pdf', size:'3.1 MB', version:1, uploadedBy:'USR-101', uploadDate:'2026-08-20'} ],
        review:{ decision:'Approved', reviewer:'USR-205', reviewDate:'2026-09-02T12:00',
                 comments:'Strong methodology and feasible milestones. Approved.', fundingConfirmed:true } },
      { id:'PROP-2026-029', title:'Drone-based Pest Scouting', pi:'USR-102', domain:'AI/ML',
        fundingSource:'AICTE', budget:1200000,
        abstract:'Multispectral drone imagery to detect and localise pest infestations early.',
        objectives:'Build an orthomosaic pipeline; classify infestation hot-spots; advise targeted spraying.',
        methodology:'Drone surveys every 10 days; segmentation models; agronomy validation.',
        expectedOutcomes:'A validated pest-alert service for 3 partner farms.',
        startDate:'2026-11-01', endDate:'2027-06-30',
        expectedMilestones:'M1 Imagery pipeline, M2 Hot-spot model, M3 Farm pilot',
        status:'Rejected', submissionDate:'2026-08-02T09:30', lastUpdated:'2026-08-15T15:30', version:2,
        documents:[ {id:'DOC-106', type:'Proposal', name:'drone_pest_proposal.pdf', size:'1.5 MB', version:1, uploadedBy:'USR-102', uploadDate:'2026-08-02'} ],
        review:{ decision:'Rejected', reviewer:'USR-205', reviewDate:'2026-08-15T15:30',
                 comments:'Budget justification is insufficient for the drone fleet; please re-apply with a revised budget.' } },
    ],
    projects:[
      { id:'PRJ-2026-015', proposalId:'PROP-2026-031', title:'Smart Grid Load Analytics', pi:'USR-101', domain:'Energy',
        status:'Active', startDate:'2026-09-05', expectedEndDate:'2027-08-31', actualEndDate:null, activationDate:'2026-09-02',
        team:[], funding:{ source:'DST-SERB', proposedBudget:2400000, sanctioned:2400000, received:1200000, utilized:2040000 },
        disbursements:[ {amount:1200000, date:'2026-09-10', recordedBy:'USR-301'} ],
        utilizations:[
          {category:'Equipment',  description:'GPU server for model training', amount:1200000, date:'2026-09-20', recordedBy:'USR-103'},
          {category:'Manpower',   description:'RA stipends (Sep–Oct)',         amount:840000,  date:'2026-10-24', recordedBy:'USR-103'},
        ] },
    ],
    milestones:[
      { id:'MS-301', projectId:'PRJ-2026-015', code:'M1', name:'Dataset & simulation setup',
        description:'Collect and clean 3 years of smart-meter data.', targetDate:'2026-10-15',
        status:'Completed', completionDate:'2026-10-12', remarks:'Completed ahead of schedule.',
        deliverables:[ {id:'DLV-31', name:'Cleaned smart-meter dataset', dueDate:'2026-10-15', submissionDate:'2026-10-10', status:'Submitted', submittedBy:'USR-101'} ] },
      { id:'MS-302', projectId:'PRJ-2026-015', code:'M2', name:'Prototype model',
        description:'Train and evaluate the forecasting models.', targetDate:'2026-11-03',
        status:'In Progress', completionDate:null, remarks:'',
        deliverables:[
          {id:'DLV-32', name:'Trained forecasting model', dueDate:'2026-11-01', submissionDate:'2026-10-20', status:'Submitted', submittedBy:'USR-101'},
          {id:'DLV-33', name:'Model evaluation report',   dueDate:'2026-11-03', submissionDate:null,         status:'Pending',   submittedBy:null} ] },
      { id:'MS-303', projectId:'PRJ-2026-015', code:'M3', name:'Field validation',
        description:'Pilot the forecasting service with the facilities team.', targetDate:'2027-02-28',
        status:'Not Started', completionDate:null, remarks:'', deliverables:[] },
    ],
    documents:[
      { id:'DOC-201', projectId:'PRJ-2026-015', milestoneId:null, type:'Approval Letter',   name:'approval_letter_DST.pdf',    size:'0.3 MB', version:1, uploadedBy:'USR-101', uploadDate:'2026-09-02' },
      { id:'DOC-202', projectId:'PRJ-2026-015', milestoneId:null, type:'Progress Report',   name:'progress_report_v1.pdf',     size:'1.1 MB', version:1, uploadedBy:'USR-101', uploadDate:'2026-10-05' },
      { id:'DOC-203', projectId:'PRJ-2026-015', milestoneId:null, type:'Progress Report',   name:'progress_report_v1.pdf',     size:'1.3 MB', version:2, uploadedBy:'USR-101', uploadDate:'2026-10-24' },
      { id:'DOC-204', projectId:'PRJ-2026-015', milestoneId:'MS-301', type:'Milestone Evidence', name:'m1_dataset_evidence.zip', size:'18.7 MB', version:1, uploadedBy:'USR-101', uploadDate:'2026-10-10' },
    ],
    notifications:[
      { id:'NOTF-5011', recipient:'USR-101', type:'deadline', message:'Milestone M2 (Prototype model) of project Smart Grid Load Analytics is due in 7 days.', created:'2026-10-27T08:00', read:false },
      { id:'NOTF-5012', recipient:'USR-101', type:'funding',  message:'Warning: funding utilization for Smart Grid Load Analytics has reached 85% of the sanctioned budget.', created:'2026-10-24T17:00', read:false },
      { id:'NOTF-5013', recipient:'USR-205', type:'review',   message:'New proposal PROP-2026-047 (Low-cost Water Quality Sensors) submitted for review.', created:'2026-09-22T14:41', read:false },
      { id:'NOTF-5014', recipient:'USR-205', type:'review',   message:'New proposal PROP-2026-044 (Wearable Health Monitoring) submitted for review.', created:'2026-09-20T11:06', read:false },
      { id:'NOTF-5015', recipient:'USR-205', type:'review',   message:'New proposal PROP-2026-043 (Soil Moisture Sensing Network) submitted for review.', created:'2026-09-12T09:16', read:false },
      { id:'NOTF-5016', recipient:'USR-101', type:'approval', message:'Proposal PROP-2026-031 (Smart Grid Load Analytics) was approved. Project PRJ-2026-015 activated.', created:'2026-09-02T12:05', read:true },
    ],
    auditLog:[
      { id:'LOG-8001', actor:'USR-101', action:'PROPOSAL_SUBMITTED',           target:'PROP-2026-031', time:'2026-08-20T10:00', remarks:'Proposal submitted for committee review' },
      { id:'LOG-8002', actor:'USR-205', action:'PROPOSAL_APPROVED',            target:'PROP-2026-031', time:'2026-09-02T12:00', remarks:'Approved with funding confirmation' },
      { id:'LOG-8003', actor:'USR-205', action:'PROJECT_ACTIVATED',            target:'PRJ-2026-015',  time:'2026-09-02T12:00', remarks:'Project activated upon funding confirmation' },
      { id:'LOG-8004', actor:'USR-103', action:'FUNDING_UTILIZATION_RECORDED', target:'PRJ-2026-015',  time:'2026-10-24T17:00', remarks:'Manpower: ₹8,40,000 — RA stipends (Sep–Oct)' },
      { id:'LOG-8005', actor:'USR-102', action:'PROPOSAL_SUBMITTED',           target:'PROP-2026-044', time:'2026-09-20T11:05', remarks:'Proposal submitted for committee review' },
    ],
    counters:{ prop:48, prj:16, ms:304, dlv:34, doc:205, notf:5017, log:8006, usr:501, disb:1, util:1 },
  };
}

/* ---------- persistence ---------- */
function saveDB(){ if(typeof window==='undefined'||!window.RPMS_API_MODE) localStorage.setItem(DB_KEY, JSON.stringify(DB)); }
function loadDB(){
  try{
    const raw = localStorage.getItem(DB_KEY);
    if(raw){
      const db = JSON.parse(raw);
      if(db && db.meta){
        // Normalize records as the local prototype schema evolves.
        db.counters = Object.assign({ usr:501 }, db.counters);
        db.counters.disb = db.counters.disb || 1; db.counters.util = db.counters.util || 1;
        db.proposals = db.proposals || [];
        db.fundingSources = ['DST-SERB','AICTE','Ministry of Power','Siemens R&D Grant','Other','Self-funded'];
        db.proposals.forEach(p=>{if(p.fundingSource==='DST - SERB')p.fundingSource='DST-SERB';});
        db.projects = db.projects || [];
        db.projects.forEach(p => { p.team = p.team || (p.authorizedPIs || []).map(userId => ({userId, access:'View Only'})); if(p.funding){if(p.funding.source==='DST - SERB')p.funding.source='DST-SERB';p.funding.proposedBudget=p.funding.proposedBudget??p.funding.sanctioned??0;} });
        db.milestones = db.milestones || [];
        db.milestones.forEach(m => { m.deliverables = m.deliverables || []; });
        db.documents = db.documents || [];
        db.notifications = db.notifications || [];
        db.auditLog = db.auditLog || [];
        return db;
      }
    }
  }catch(e){ /* fall through to reseed */ }
  const db = seedDB(); if(typeof window==='undefined'||!window.RPMS_API_MODE) localStorage.setItem(DB_KEY, JSON.stringify(db)); return db;
}
function resetDB(){
  localStorage.removeItem(DB_KEY);
  localStorage.removeItem(SESSION_KEY);
  location.reload();
}
let DB = loadDB();

function nextId(kind){
  const c = DB.counters;
  switch(kind){
    case 'prop': return `PROP-2026-${pad3(c.prop++)}`;
    case 'prj':  return `PRJ-2026-${pad3(c.prj++)}`;
    case 'ms':   return `MS-${c.ms++}`;
    case 'dlv':  return `DLV-${c.dlv++}`;
    case 'doc':  return `DOC-${c.doc++}`;
    case 'notf': return `NOTF-${c.notf++}`;
    case 'log':  return `LOG-${c.log++}`;
    case 'usr':  return `USR-${c.usr++}`;
  }
}
