-- 249 — Private tables are not readable by the public API's role (found 2026-11-13 while building 248).
--
-- The owner role's default privileges (Phase 2) grant SELECT on every new table to arthistory_api — right for the
-- content tables, which the API reads. Tables meant for the CMS or for the accounts only were locked where a migration
-- revoked it (audit_log, feedback, private_images, admin_users); 30 others were not, although their migrations call
-- them "CMS only" or "private to the account": chats, study sets, accounts' views and logs, drafts, open cases.
-- No API code reads them (checked: src/routes, src/*.js) — so nothing was exposed — but a single injectable query
-- in the API would have made private chats readable. Defence in depth: the role that answers the public loses them.
-- The CMS and the site's account routes use arthistory_admin and are unaffected; the public view of open cases is
-- public_open_cases (248). test/e2e/api-grants.spec.js keeps it so for tables added later.
REVOKE ALL ON
  -- accounts, friends, chats (220–226, 240)
  account_blocks, account_log, account_views, friendships, chat_messages, chat_reports, chat_emotes,
  set_chat_hidden, set_chat_messages, set_chat_reads, set_chat_removed,
  -- study sets (218–229)
  study_plans, study_progress, study_sessions, study_set_events, study_set_invitations, study_set_items, study_set_links,
  study_set_members, study_set_proposals, study_set_snapshots, study_set_votes, study_sets,
  -- the CMS's working state: drafts, its search, downloads, scopes, open cases (117, 119, 116, 094, 198, 203, 214)
  form_drafts, page_drafts, page_downloads, editor_scopes, admin_search_docs, open_cases, open_case_updates
FROM arthistory_api;
