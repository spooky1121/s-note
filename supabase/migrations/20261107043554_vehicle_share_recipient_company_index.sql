-- Cover the recipient-company foreign key used by invitation scope checks.
begin;
create index if not exists vehicle_shares_recipient_company_idx on snote_private.vehicle_shares(recipient_company_id);
commit;
