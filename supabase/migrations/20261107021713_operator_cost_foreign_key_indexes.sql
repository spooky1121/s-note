-- Cover user removal and transfer-job foreign key lookups without broad table scans.
begin;
create index if not exists snote_cost_preferences_user_idx on snote_cost_private.preferences(user_id);
create index if not exists snote_operator_transfer_files_job_idx on snote_operator_private.transfer_files(actor_id,request_id);
commit;
