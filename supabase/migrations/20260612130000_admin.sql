-- Stage 8: promote the operator account to admin.
--
-- The admin area itself needs no new policies: admin mutations run through
-- service-role server actions gated by an is_admin() check in the app (see
-- the rls_policies migration header), and the only admin-readable table,
-- sync_log, already has its is_admin() select policy. SPEC "Roles: user,
-- admin (admin = Anton, set manually in DB)" — this is that manual step,
-- recorded as a migration. No-op on environments where the account does
-- not exist (e.g. the local verification stack).

update profiles
set role = 'admin'
where id in (select id from auth.users where email = 'a.chontoroh@gmail.com');
