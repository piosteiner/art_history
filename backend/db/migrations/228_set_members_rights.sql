-- 228 — Who may do what in a study set (owner 2026-11-05):
--   private  only its owner
--   shared   the owner invites friends or hands out links; each member has their rights: viewer, or editor in one of
--            three ways — full (changes apply at once), with approval (the owner approves each change), with votes
--   public   also listed under "Shared sets" and seen by anyone; edited only by its owner and the members invited
-- A set's votes are one kind or the other, never both (owner: "3 and 4 can't exist with each other"):
--   advisory  the members with editing rights vote, the owner sees the votes and decides — whenever they like
--   binding   the vote decides after vote_hours (1–24 h), or earlier once the remaining votes can't change it: accepted
--             with more yes than no, rejected with more no than yes; a tie → the owner decides. The proposer votes yes
--             by proposing; one vote is enough. A set with only two who vote (the owner and the proposer): no vote,
--             accepted at once. owner_veto (the owner's choice, off at first): the owner may decide a binding vote before it ends.
-- Viewers read and study the set; they vote on nothing and see its chat only when the owner allows it to them (chat).
-- Links (study_set_links) and invitations to friends (study_set_invitations) carry the rights the newcomer gets; a link
-- turned off lets no one new in — those who joined with it stay.
--
-- Postgres: a DOMAIN for the rights (one CHECK shared by three tables), plpgsql functions that apply and settle
-- proposals in the database (the site's routes, the minute timer and the tests all go through the same rules),
-- partial unique indexes for "one open proposal per entry", FOR UPDATE so two settlements never apply one twice.

CREATE DOMAIN set_rights AS text CHECK (VALUE IN ('view', 'full', 'approval', 'vote'));
COMMENT ON DOMAIN set_rights IS 'A member''s rights in a study set (228): view, full, approval (the owner approves), vote (the set''s kind of vote).';

-- ---- the set: shared instead of "by link"; its kind of vote --------------------------------------------------------
ALTER TABLE study_sets DROP CONSTRAINT study_sets_visibility_check, DROP CONSTRAINT study_sets_shared_has_code;
UPDATE study_sets SET visibility = 'shared' WHERE visibility = 'link';
UPDATE study_sets SET share_code = NULL WHERE visibility <> 'public';
ALTER TABLE study_sets
  ADD CONSTRAINT study_sets_visibility_check CHECK (visibility IN ('private', 'shared', 'public')),
  ADD CONSTRAINT study_sets_public_has_code CHECK ((visibility = 'public') = (share_code IS NOT NULL)),
  DROP COLUMN edit_code,
  ADD COLUMN vote_mode  text NOT NULL DEFAULT 'advisory' CHECK (vote_mode IN ('advisory', 'binding')),
  ADD COLUMN vote_hours smallint NOT NULL DEFAULT 24 CHECK (vote_hours BETWEEN 1 AND 24),
  ADD COLUMN owner_veto boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN study_sets.share_code IS 'A public set''s address /sets/s/<code> (228: public sets only).';
COMMENT ON COLUMN study_sets.vote_mode IS 'Advisory: the owner decides seeing the votes; binding: the vote decides (228).';
COMMENT ON COLUMN study_sets.owner_veto IS 'Binding votes: the owner may decide before the vote ends (228).';

-- ---- members (were the editors, 220) -------------------------------------------------------------------------------
ALTER TABLE study_set_editors RENAME TO study_set_members;
ALTER INDEX study_set_editors_pkey RENAME TO study_set_members_pkey;
ALTER INDEX study_set_editors_account_idx RENAME TO study_set_members_account_idx;
ALTER TRIGGER study_set_editors_not_owner ON study_set_members RENAME TO study_set_members_not_owner;
ALTER TABLE study_set_members
  ADD COLUMN rights set_rights NOT NULL DEFAULT 'full',
  ADD COLUMN chat   boolean NOT NULL DEFAULT false,
  ADD COLUMN via    text CHECK (via IN ('link', 'invitation'));
ALTER TABLE study_set_members ALTER COLUMN rights DROP DEFAULT;
COMMENT ON TABLE study_set_members IS 'The members of a study set besides its owner (228, were its editors): their rights.';
COMMENT ON COLUMN study_set_members.chat IS 'A viewer may read and write the set''s chat (members with editing rights always may).';

CREATE TABLE study_set_links (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  set_id     bigint NOT NULL REFERENCES study_sets (id) ON DELETE CASCADE,
  code       text NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9_-]{16}$'),
  rights     set_rights NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz,
  joined     integer NOT NULL DEFAULT 0
);
COMMENT ON TABLE study_set_links IS 'Links to join a study set with given rights (228); ended = no one new joins with it.';
CREATE INDEX study_set_links_set_idx ON study_set_links (set_id, created_at DESC);

CREATE TABLE study_set_invitations (
  set_id     bigint NOT NULL REFERENCES study_sets (id) ON DELETE CASCADE,
  account_id bigint NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  rights     set_rights NOT NULL,
  chat       boolean NOT NULL DEFAULT false,
  invited_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (set_id, account_id)
);
COMMENT ON TABLE study_set_invitations IS 'A friend invited to a study set with given rights (228), until they accept or decline.';
CREATE INDEX study_set_invitations_account_idx ON study_set_invitations (account_id);

-- ---- proposals of any change and their votes (replace 221's proposed removals; none were made) --------------------
DROP TABLE study_set_votes;
DROP TABLE study_set_proposals;
CREATE TABLE study_set_proposals (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  set_id      bigint NOT NULL REFERENCES study_sets (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('add', 'remove', 'field')),
  entity_type entity_type,
  entity_id   bigint,
  field       text CHECK (field IN ('name', 'topic', 'description')),
  old_value   text,               -- field: as it was when proposed — changed since, the proposal is outdated
  new_value   text,
  procedure   text NOT NULL CHECK (procedure IN ('approval', 'advisory', 'binding')),
  proposed_by bigint REFERENCES admin_users (id) ON DELETE SET NULL,
  reason      text CHECK (length(reason) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  closes_at   timestamptz,        -- binding: the end of the vote
  tie_at      timestamptz,        -- binding: ended even — the owner decides
  decided_at  timestamptz,
  outcome     text CHECK (outcome IN ('accepted', 'rejected', 'withdrawn', 'outdated', 'closed')),
  decided_by  bigint REFERENCES admin_users (id) ON DELETE SET NULL,
  by_vote     boolean NOT NULL DEFAULT false,
  CHECK ((kind = 'field') = (field IS NOT NULL)),
  CHECK ((kind <> 'field') = (entity_type IS NOT NULL AND entity_id IS NOT NULL)),
  CHECK ((procedure = 'binding') = (closes_at IS NOT NULL)),
  CHECK ((decided_at IS NULL) = (outcome IS NULL)),
  CHECK (kind <> 'field' OR field <> 'name' OR btrim(new_value) <> '')
);
COMMENT ON TABLE study_set_proposals IS 'A change of a study set proposed by a member without full rights (228): decided by the owner or a vote.';
COMMENT ON COLUMN study_set_proposals.outcome IS 'accepted / rejected; withdrawn by the proposer; outdated: done or changed meanwhile; closed: the set went private.';
CREATE UNIQUE INDEX study_set_proposals_open_entry ON study_set_proposals (set_id, entity_type, entity_id) WHERE decided_at IS NULL AND kind <> 'field';
CREATE INDEX study_set_proposals_open ON study_set_proposals (set_id) WHERE decided_at IS NULL;
CREATE INDEX study_set_proposals_due ON study_set_proposals (closes_at) WHERE decided_at IS NULL AND procedure = 'binding' AND tie_at IS NULL;
CREATE INDEX study_set_proposals_set ON study_set_proposals (set_id, decided_at DESC);

CREATE TABLE study_set_votes (
  proposal_id bigint NOT NULL REFERENCES study_set_proposals (id) ON DELETE CASCADE,
  voter_id    bigint NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  vote        text NOT NULL CHECK (vote IN ('yes', 'no', 'abstain')),
  at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id, voter_id)
);
COMMENT ON TABLE study_set_votes IS 'A vote on a proposal (228): yes, no, abstain — changeable until it is decided.';

-- who votes: the owner and the members with editing rights — as they are now (a member gone, their vote no longer counts)
CREATE FUNCTION study_set_voters(sid bigint) RETURNS SETOF bigint LANGUAGE sql STABLE AS $$
  SELECT owner_id FROM study_sets WHERE id = sid
  UNION SELECT account_id FROM study_set_members WHERE set_id = sid AND rights <> 'view'
$$;

-- the history trigger (221): changes made directly outdate the open proposals they make pointless
CREATE OR REPLACE FUNCTION study_set_log() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f text;
BEGIN
  IF TG_TABLE_NAME = 'study_sets' THEN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO study_set_events (set_id, actor_id, action) VALUES (NEW.id, coalesce(study_set_actor(), NEW.owner_id), 'created');
      FOREACH f IN ARRAY ARRAY['name', 'topic', 'description'] LOOP
        INSERT INTO study_set_events (set_id, actor_id, action, field, new_value)
          SELECT NEW.id, coalesce(study_set_actor(), NEW.owner_id), 'changed', f, to_jsonb(NEW) ->> f WHERE to_jsonb(NEW) ->> f IS NOT NULL;
      END LOOP;
    ELSE
      FOREACH f IN ARRAY ARRAY['name', 'topic', 'description'] LOOP
        IF (to_jsonb(OLD) ->> f) IS DISTINCT FROM (to_jsonb(NEW) ->> f) THEN
          INSERT INTO study_set_events (set_id, actor_id, action, field, old_value, new_value)
            VALUES (NEW.id, coalesce(study_set_actor(), NEW.updated_by), 'changed', f, to_jsonb(OLD) ->> f, to_jsonb(NEW) ->> f);
          UPDATE study_set_proposals SET decided_at = now(), outcome = 'outdated'
            WHERE set_id = NEW.id AND kind = 'field' AND field = f AND decided_at IS NULL;
        END IF;
      END LOOP;
      IF (OLD.locked_at IS NULL) <> (NEW.locked_at IS NULL) THEN
        INSERT INTO study_set_events (set_id, actor_id, action) VALUES (NEW.id, study_set_actor(), CASE WHEN NEW.locked_at IS NULL THEN 'unlocked' ELSE 'locked' END);
      END IF;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO study_set_events (set_id, actor_id, action, entity_type, entity_id)
      VALUES (NEW.set_id, coalesce(study_set_actor(), NEW.added_by), 'added', NEW.entity_type, NEW.entity_id);
    UPDATE study_set_proposals SET decided_at = now(), outcome = 'outdated'
      WHERE set_id = NEW.set_id AND kind = 'add' AND (entity_type, entity_id) = (NEW.entity_type, NEW.entity_id) AND decided_at IS NULL;
  ELSE
    -- the set itself being deleted takes its items along: no events for a set that is gone
    IF EXISTS (SELECT 1 FROM study_sets WHERE id = OLD.set_id) THEN
      INSERT INTO study_set_events (set_id, actor_id, action, entity_type, entity_id)
        VALUES (OLD.set_id, study_set_actor(), 'removed', OLD.entity_type, OLD.entity_id);
      UPDATE study_set_proposals SET decided_at = now(), outcome = 'outdated'
        WHERE set_id = OLD.set_id AND kind = 'remove' AND (entity_type, entity_id) = (OLD.entity_type, OLD.entity_id) AND decided_at IS NULL;
    END IF;
  END IF;
  RETURN NULL;
END $$;

-- a proposal carried out — or found outdated (already done, the field changed, the entry deleted from the site). The
-- change is the proposer's in the set's history (arthistory.user_id for its triggers), restored afterwards.
-- decider: the owner (NULL: the vote decided).
CREATE FUNCTION study_proposal_accept(pid bigint, decider bigint, via_vote boolean) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  q study_set_proposals;
  result text := 'accepted';
  current text;
  actor text := current_setting('arthistory.user_id', true);
BEGIN
  SELECT * INTO q FROM study_set_proposals WHERE id = pid AND decided_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF q.kind = 'add' THEN
    IF EXISTS (SELECT 1 FROM study_set_items i WHERE i.set_id = q.set_id AND (i.entity_type, i.entity_id) = (q.entity_type, q.entity_id))
       OR NOT EXISTS (SELECT 1 FROM entity_index e WHERE (e.type, e.id) = (q.entity_type, q.entity_id)) THEN result := 'outdated'; END IF;
  ELSIF q.kind = 'remove' THEN
    IF NOT EXISTS (SELECT 1 FROM study_set_items i WHERE i.set_id = q.set_id AND (i.entity_type, i.entity_id) = (q.entity_type, q.entity_id)) THEN result := 'outdated'; END IF;
  ELSE
    SELECT to_jsonb(s) ->> q.field INTO current FROM study_sets s WHERE s.id = q.set_id;
    IF current IS DISTINCT FROM q.old_value THEN result := 'outdated'; END IF;
  END IF;
  UPDATE study_set_proposals SET decided_at = now(), outcome = result, decided_by = decider, by_vote = via_vote WHERE id = pid;
  IF result = 'accepted' THEN
    PERFORM set_config('arthistory.user_id', coalesce(q.proposed_by::text, ''), true);
    IF q.kind = 'add' THEN
      INSERT INTO study_set_items (set_id, entity_type, entity_id, added_by) VALUES (q.set_id, q.entity_type, q.entity_id, q.proposed_by);
      UPDATE study_sets SET updated_by = q.proposed_by WHERE id = q.set_id;
    ELSIF q.kind = 'remove' THEN
      DELETE FROM study_set_items WHERE set_id = q.set_id AND (entity_type, entity_id) = (q.entity_type, q.entity_id);
      UPDATE study_sets SET updated_by = q.proposed_by WHERE id = q.set_id;
    ELSE
      EXECUTE format('UPDATE study_sets SET %I = $1, updated_by = $2 WHERE id = $3', q.field) USING q.new_value, q.proposed_by, q.set_id;
    END IF;
    PERFORM set_config('arthistory.user_id', coalesce(actor, ''), true);
  END IF;
  RETURN result;
END $$;
COMMENT ON FUNCTION study_proposal_accept IS 'Carries out a proposed change of a study set as its proposer''s — or closes it as outdated (228).';

CREATE FUNCTION study_proposal_reject(pid bigint, decider bigint, via_vote boolean) RETURNS text LANGUAGE sql AS $$
  UPDATE study_set_proposals SET decided_at = now(), outcome = 'rejected', decided_by = decider, by_vote = via_vote
  WHERE id = pid AND decided_at IS NULL RETURNING 'rejected'
$$;

-- a binding vote looked at now: decided when the votes still missing can't change it, when everyone has voted or the
-- time is up (more yes → accepted, more no → rejected, even → the owner decides); not while the set is locked
CREATE FUNCTION study_proposal_settle(pid bigint) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  q record;
  voters integer;
  yes integer;
  no integer;
  abstain integer;
  missing integer;
BEGIN
  SELECT p.id, p.set_id, p.closes_at, s.locked_at INTO q FROM study_set_proposals p JOIN study_sets s ON s.id = p.set_id
    WHERE p.id = pid AND p.decided_at IS NULL AND p.procedure = 'binding' AND p.tie_at IS NULL;
  IF NOT FOUND OR q.locked_at IS NOT NULL THEN RETURN NULL; END IF;
  SELECT count(*) INTO voters FROM study_set_voters(q.set_id);
  SELECT count(*) FILTER (WHERE vote = 'yes'), count(*) FILTER (WHERE vote = 'no'), count(*) FILTER (WHERE vote = 'abstain')
    INTO yes, no, abstain FROM study_set_votes WHERE proposal_id = pid AND voter_id IN (SELECT study_set_voters(q.set_id));
  missing := greatest(voters - yes - no - abstain, 0);
  IF voters <= 2 OR yes > no + missing THEN RETURN study_proposal_accept(pid, NULL, true);
  ELSIF no > yes + missing THEN RETURN study_proposal_reject(pid, NULL, true);
  ELSIF missing = 0 OR now() >= q.closes_at THEN
    IF yes > no THEN RETURN study_proposal_accept(pid, NULL, true);
    ELSIF no > yes THEN RETURN study_proposal_reject(pid, NULL, true);
    END IF;
    UPDATE study_set_proposals SET tie_at = now() WHERE id = pid;
    RETURN 'tie';
  END IF;
  RETURN NULL;
END $$;
COMMENT ON FUNCTION study_proposal_settle IS 'A binding vote decided if it can be now (228): early, at its end, or a tie for the owner.';

-- every binding vote that can be decided (one set, or all — the site's minute timer); returns how many changed
CREATE FUNCTION study_proposals_settle(sid bigint DEFAULT NULL) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  pid bigint;
  n integer := 0;
BEGIN
  FOR pid IN SELECT id FROM study_set_proposals WHERE decided_at IS NULL AND procedure = 'binding' AND tie_at IS NULL
      AND (sid IS NULL OR set_id = sid) ORDER BY id LOOP
    IF study_proposal_settle(pid) IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$;

-- handing a set to one of its members: they own it, the old owner stays as a member with full rights
CREATE FUNCTION study_set_transfer(sid bigint, new_owner bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE old_owner bigint;
BEGIN
  SELECT owner_id INTO old_owner FROM study_sets WHERE id = sid FOR UPDATE;
  DELETE FROM study_set_members WHERE set_id = sid AND account_id = new_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'not a member of the set' USING ERRCODE = 'check_violation'; END IF;
  UPDATE study_sets SET owner_id = new_owner WHERE id = sid;
  INSERT INTO study_set_members (set_id, account_id, rights, via) VALUES (sid, old_owner, 'full', NULL);
  DELETE FROM study_set_invitations WHERE set_id = sid AND account_id = new_owner;
END $$;

GRANT SELECT, INSERT, UPDATE ON study_set_proposals TO arthistory_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON study_set_votes, study_set_invitations TO arthistory_admin;
GRANT SELECT, INSERT, UPDATE ON study_set_links TO arthistory_admin;
GRANT EXECUTE ON FUNCTION study_set_voters(bigint), study_proposal_accept(bigint, bigint, boolean), study_proposal_reject(bigint, bigint, boolean),
  study_proposal_settle(bigint), study_proposals_settle(bigint), study_set_transfer(bigint, bigint) TO arthistory_admin;
