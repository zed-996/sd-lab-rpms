CREATE TABLE IF NOT EXISTS roles (
  role_key VARCHAR(24) PRIMARY KEY,
  role_name VARCHAR(80) NOT NULL,
  permissions JSON NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  user_id VARCHAR(40) PRIMARY KEY,
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role_key VARCHAR(24) NOT NULL,
  department VARCHAR(160) NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  registered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL,
  CONSTRAINT fk_users_role FOREIGN KEY (role_key) REFERENCES roles(role_key)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS investigator_profiles (
  user_id VARCHAR(40) PRIMARY KEY,
  researcher_id VARCHAR(80) NULL,
  designation VARCHAR(160) NULL,
  research_interests TEXT NULL,
  contact_information JSON NULL,
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS funding_sources (
  funding_source_id VARCHAR(80) PRIMARY KEY,
  organization VARCHAR(200) NOT NULL,
  program VARCHAR(200) NOT NULL DEFAULT '',
  contact_details JSON NULL,
  description TEXT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_funding_source_org_program (organization, program)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS proposals (
  proposal_id VARCHAR(40) PRIMARY KEY,
  pi_user_id VARCHAR(40) NOT NULL,
  title VARCHAR(240) NOT NULL,
  abstract_text TEXT NOT NULL,
  objectives TEXT NOT NULL,
  methodology TEXT NOT NULL,
  expected_outcomes TEXT NOT NULL,
  research_domain VARCHAR(160) NOT NULL,
  proposed_budget DECIMAL(15,2) NOT NULL DEFAULT 0,
  funding_source_id VARCHAR(80) NULL,
  custom_funding_source VARCHAR(200) NULL,
  proposed_start_date DATE NULL,
  expected_end_date DATE NULL,
  investigator_details TEXT NULL,
  expected_milestones JSON NULL,
  expected_deliverables TEXT NULL,
  status ENUM('Draft','Under Review','Approved','Rejected') NOT NULL DEFAULT 'Draft',
  submission_date DATETIME NULL,
  version INT NOT NULL DEFAULT 1,
  details JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_proposals_pi FOREIGN KEY (pi_user_id) REFERENCES users(user_id),
  CONSTRAINT fk_proposals_source FOREIGN KEY (funding_source_id) REFERENCES funding_sources(funding_source_id),
  CONSTRAINT chk_proposal_dates CHECK (expected_end_date IS NULL OR proposed_start_date IS NULL OR expected_end_date > proposed_start_date),
  KEY idx_proposals_queue (status, submission_date),
  KEY idx_proposals_pi_status (pi_user_id, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS projects (
  project_id VARCHAR(40) PRIMARY KEY,
  proposal_id VARCHAR(40) NOT NULL UNIQUE,
  title VARCHAR(240) NOT NULL,
  principal_investigator_id VARCHAR(40) NOT NULL,
  research_domain VARCHAR(160) NOT NULL,
  start_date DATE NOT NULL,
  expected_end_date DATE NOT NULL,
  actual_end_date DATE NULL,
  status ENUM('Proposed','Under Review','Approved','Pending Funding','Active','On Hold','Completed','Terminated') NOT NULL,
  activation_date DATE NULL,
  details JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_projects_proposal FOREIGN KEY (proposal_id) REFERENCES proposals(proposal_id),
  CONSTRAINT fk_projects_pi FOREIGN KEY (principal_investigator_id) REFERENCES users(user_id),
  CONSTRAINT chk_project_dates CHECK (expected_end_date > start_date),
  KEY idx_projects_status (status),
  KEY idx_projects_pi (principal_investigator_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS project_investigators (
  project_investigator_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id VARCHAR(40) NOT NULL,
  investigator_id VARCHAR(40) NOT NULL,
  project_role ENUM('PI','Investigator','Coordinator') NOT NULL DEFAULT 'Investigator',
  access_level ENUM('Owner','View Only','Contributor') NOT NULL DEFAULT 'View Only',
  assigned_by VARCHAR(40) NULL,
  date_assigned DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_removed DATETIME NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_team_project FOREIGN KEY (project_id) REFERENCES projects(project_id),
  CONSTRAINT fk_team_investigator FOREIGN KEY (investigator_id) REFERENCES users(user_id),
  CONSTRAINT fk_team_assigner FOREIGN KEY (assigned_by) REFERENCES users(user_id),
  UNIQUE KEY uq_project_investigator (project_id, investigator_id),
  KEY idx_team_user_active (investigator_id, active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS project_funding (
  funding_id VARCHAR(48) PRIMARY KEY,
  project_id VARCHAR(40) NOT NULL,
  funding_source_id VARCHAR(80) NOT NULL,
  proposed_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  authorized_amount DECIMAL(15,2) NULL,
  approved_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  received_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  funding_start_date DATE NULL,
  funding_end_date DATE NULL,
  funding_status VARCHAR(40) NOT NULL DEFAULT 'Pending',
  details JSON NULL,
  CONSTRAINT fk_project_funding_project FOREIGN KEY (project_id) REFERENCES projects(project_id),
  CONSTRAINT fk_project_funding_source FOREIGN KEY (funding_source_id) REFERENCES funding_sources(funding_source_id),
  CONSTRAINT chk_funding_amounts CHECK (proposed_amount >= 0 AND approved_amount >= 0 AND received_amount >= 0),
  CONSTRAINT chk_funding_authorization CHECK (approved_amount <= COALESCE(authorized_amount, approved_amount) AND received_amount <= approved_amount),
  KEY idx_funding_project (project_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS funding_disbursements (
  disbursement_id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(40) NOT NULL,
  funding_id VARCHAR(48) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  scheduled_for DATE NULL,
  disbursement_date DATE NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'Scheduled',
  recorded_by VARCHAR(40) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_disbursement_project FOREIGN KEY (project_id) REFERENCES projects(project_id),
  CONSTRAINT fk_disbursement_funding FOREIGN KEY (funding_id) REFERENCES project_funding(funding_id),
  CONSTRAINT fk_disbursement_actor FOREIGN KEY (recorded_by) REFERENCES users(user_id),
  CONSTRAINT chk_disbursement_amount CHECK (amount > 0),
  KEY idx_disbursement_project (project_id, scheduled_for)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS funding_utilizations (
  utilization_id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(40) NOT NULL,
  funding_id VARCHAR(48) NOT NULL,
  category VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  utilization_date DATE NOT NULL,
  recorded_by VARCHAR(40) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_utilization_project FOREIGN KEY (project_id) REFERENCES projects(project_id),
  CONSTRAINT fk_utilization_funding FOREIGN KEY (funding_id) REFERENCES project_funding(funding_id),
  CONSTRAINT fk_utilization_actor FOREIGN KEY (recorded_by) REFERENCES users(user_id),
  CONSTRAINT chk_utilization_amount CHECK (amount > 0),
  KEY idx_utilization_project (project_id, utilization_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS milestones (
  milestone_id VARCHAR(40) PRIMARY KEY,
  project_id VARCHAR(40) NOT NULL,
  code VARCHAR(24) NOT NULL,
  milestone_name VARCHAR(240) NOT NULL,
  description TEXT NULL,
  target_date DATE NOT NULL,
  completion_date DATE NULL,
  status ENUM('Pending','Not Started','In Progress','Submitted for Review','Completed','Revision Required') NOT NULL,
  remarks TEXT NULL,
  completion_review JSON NULL,
  submitted_at DATETIME NULL,
  details JSON NULL,
  CONSTRAINT fk_milestone_project FOREIGN KEY (project_id) REFERENCES projects(project_id),
  UNIQUE KEY uq_project_milestone_code (project_id, code),
  KEY idx_milestone_due (target_date, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS deliverables (
  deliverable_id VARCHAR(40) PRIMARY KEY,
  project_id VARCHAR(40) NOT NULL,
  milestone_id VARCHAR(40) NULL,
  deliverable_name VARCHAR(240) NOT NULL,
  deliverable_type VARCHAR(120) NOT NULL,
  description TEXT NULL,
  due_date DATE NULL,
  submission_date DATE NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'Pending',
  submitted_by VARCHAR(40) NULL,
  remarks TEXT NULL,
  CONSTRAINT fk_deliverable_project FOREIGN KEY (project_id) REFERENCES projects(project_id),
  CONSTRAINT fk_deliverable_milestone FOREIGN KEY (milestone_id) REFERENCES milestones(milestone_id),
  CONSTRAINT fk_deliverable_submitter FOREIGN KEY (submitted_by) REFERENCES users(user_id),
  KEY idx_deliverables_project (project_id, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS project_documents (
  document_id VARCHAR(40) PRIMARY KEY,
  project_id VARCHAR(40) NULL,
  proposal_id VARCHAR(40) NULL,
  milestone_id VARCHAR(40) NULL,
  document_type ENUM('Proposal','Approval Letter','Progress Report','Publication','Financial Report','Milestone Evidence','Other') NOT NULL,
  document_name VARCHAR(255) NOT NULL,
  file_reference VARCHAR(500) NOT NULL,
  mime_type VARCHAR(160) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  version INT NOT NULL DEFAULT 1,
  uploaded_by VARCHAR(40) NOT NULL,
  upload_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approval_status VARCHAR(40) NULL,
  remarks TEXT NULL,
  CONSTRAINT fk_document_project FOREIGN KEY (project_id) REFERENCES projects(project_id),
  CONSTRAINT fk_document_proposal FOREIGN KEY (proposal_id) REFERENCES proposals(proposal_id),
  CONSTRAINT fk_document_milestone FOREIGN KEY (milestone_id) REFERENCES milestones(milestone_id),
  CONSTRAINT fk_document_uploader FOREIGN KEY (uploaded_by) REFERENCES users(user_id),
  CONSTRAINT chk_document_parent CHECK (project_id IS NOT NULL OR proposal_id IS NOT NULL),
  KEY idx_documents_project (project_id, document_type),
  KEY idx_documents_milestone (milestone_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS review_records (
  review_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  target_type ENUM('Proposal','Milestone') NOT NULL,
  proposal_id VARCHAR(40) NULL,
  milestone_id VARCHAR(40) NULL,
  reviewer_id VARCHAR(40) NOT NULL,
  decision VARCHAR(40) NOT NULL,
  comments TEXT NULL,
  review_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_review_proposal FOREIGN KEY (proposal_id) REFERENCES proposals(proposal_id),
  CONSTRAINT fk_review_milestone FOREIGN KEY (milestone_id) REFERENCES milestones(milestone_id),
  CONSTRAINT fk_review_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(user_id),
  CONSTRAINT chk_review_target CHECK ((target_type='Proposal' AND proposal_id IS NOT NULL AND milestone_id IS NULL) OR (target_type='Milestone' AND milestone_id IS NOT NULL AND proposal_id IS NULL)),
  KEY idx_review_proposal (proposal_id, review_date),
  KEY idx_review_milestone (milestone_id, review_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  notification_id VARCHAR(40) PRIMARY KEY,
  recipient_user_id VARCHAR(40) NOT NULL,
  notification_type VARCHAR(48) NOT NULL,
  message TEXT NOT NULL,
  related_url VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  dedupe_key VARCHAR(200) NULL,
  CONSTRAINT fk_notification_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(user_id),
  UNIQUE KEY uq_notification_dedupe (recipient_user_id, dedupe_key),
  KEY idx_notification_inbox (recipient_user_id, is_read, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  log_id VARCHAR(40) PRIMARY KEY,
  actor_user_id VARCHAR(40) NOT NULL,
  action_type VARCHAR(80) NOT NULL,
  target_entity VARCHAR(80) NOT NULL,
  target_id VARCHAR(80) NOT NULL,
  occurred_at DATETIME NOT NULL,
  remarks TEXT NULL,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(user_id),
  KEY idx_audit_target (target_entity, target_id),
  KEY idx_audit_actor_time (actor_user_id, occurred_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS project_status_history (
  status_history_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id VARCHAR(40) NOT NULL,
  previous_status VARCHAR(40) NULL,
  new_status VARCHAR(40) NOT NULL,
  changed_by VARCHAR(40) NOT NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT NULL,
  CONSTRAINT fk_status_history_project FOREIGN KEY (project_id) REFERENCES projects(project_id),
  CONSTRAINT fk_status_history_actor FOREIGN KEY (changed_by) REFERENCES users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  session_id CHAR(64) PRIMARY KEY,
  user_id VARCHAR(40) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME NULL,
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(user_id),
  KEY idx_sessions_user (user_id, expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash CHAR(64) PRIMARY KEY,
  user_id VARCHAR(40) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rpms_sequences (
  sequence_key VARCHAR(32) PRIMARY KEY,
  next_value BIGINT UNSIGNED NOT NULL
) ENGINE=InnoDB;

DELIMITER //
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit log entries are immutable'; END//
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit log entries are immutable'; END//
CREATE TRIGGER review_records_no_update BEFORE UPDATE ON review_records FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Review records are immutable'; END//
CREATE TRIGGER review_records_no_delete BEFORE DELETE ON review_records FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Review records are immutable'; END//
DELIMITER ;
