// Response shapes of https://api.arthistory.piogino.ch/v1 (reference: backend/docs/api.md).
import type { PartRef, SiblingRef, WholeRef } from './series';

/** Plural URL segment of an entity type (`/v1/artists/…`). */
export type Plural = 'artists' | 'artworks' | 'places' | 'movements' | 'institutions' | 'people' | 'polities' | 'events' | 'glossary' | 'bibliography';
/** Singular `type` field inside responses. */
export type EntityType = 'artist' | 'artwork' | 'place' | 'movement' | 'institution' | 'person' | 'polity' | 'event' | 'term' | 'source';

/** Every date is one of these or null. `to` is inclusive; open ends are null; BCE years are negative. */
export interface DateRange {
  label: string;
  from: string | null;
  to: string | null;
  from_year: number | null;
  to_year: number | null;
}

export interface List<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Ref {
  /** The entry's public number (API 085), in references that name an entry. */
  public_id?: number;
  slug: string;
  name: string;
}

export interface Image {
  url: string;
  source_url: string | null;
  license: string | null;
  credit: string | null;
  caption: string | null;
}

export interface PointGeometry {
  type: 'Point';
  coordinates: [number, number];
}

export type Category =
  | 'presence' | 'association' | 'influence' | 'education'
  | 'collaboration' | 'membership' | 'patronage' | 'provenance' | 'polity' | 'depiction' | 'glossary' | 'architecture' | 'publication' | 'event' | 'family'
  | 'heritage';  // heritage designations (API 166)

export interface Relationship {
  type: string;
  direction: 'outgoing' | 'incoming' | 'mutual';
  label: string;
  category: Category;
  is_physical_presence: boolean;
  /** name_then: its former name in use during the relationship (API 152/159) — "lived in Tokyo (then Edo)". */
  /** polity_then: the state the place (an institution's city) belonged to at the start of the relationship (API 161). */
  /** qualifier: a place's words apart from others of its name (API 162) — "Cambridge (Massachusetts)". */
  entity: { type: EntityType; slug: string; name: string; period?: DateRange | null; name_then?: NameThen | null; polity_then?: PolityRef | null; qualifier?: string | null };
  period: DateRange | null;
  note: string | null;
  certainty: string | null;
  notes_html: string | null;
  /** Computed, not entered: from the provenance (owned_by, held_by, kept_in, transferred_to, commissioned). */
  derived?: boolean;
  /** Where the period's end comes from (provenance); `implied` = only by the next owner's acquisition. */
  end_basis?: EndBasis | null;
  /** Where this link comes from (migration 049). */
  sources?: Citation[];
}

/**
 * Where a fact comes from (migrations 049/050): an entry of the bibliography (`source`), a Wikidata statement, or a note
 * in words (`text`, not verified). `text` is the short form to show ("Busch 1993, S. 45", "Wikidata, Q45585, P2048").
 */
export interface Citation {
  kind: 'source' | 'wikidata' | 'text';
  /** database (Wikidata, aggregators) < institution (museum) < scholarly (literature) < primary (archive); null for text. */
  reliability: 'database' | 'institution' | 'scholarly' | 'primary' | null;
  text: string;
  source?: { slug: string; siglum: string } | null;
  wikidata?: { item: string; property: string | null; url: string } | null;
  locator: string | null; url: string | null; accessed: string | null; note: string | null;
  /** The value changed after the source was cited. */
  outdated: boolean;
}

/** recorded: a source gives the end · implied: the next acquisition · ongoing: still there · unknown: nothing after it. */
/** An inventory entry, a catalogue, an exhibition, a sighting under a provenance step (API 104); certainties are the source's doubts ("¿nº 411?"). */
export interface ProvenanceRecord {
  kind: 'inventory' | 'catalogue' | 'exhibition' | 'sighting' | 'document' | 'other';
  date: DateRange | null; place: Ref | null; room: string | null; number: string | null; number_certainty: string;
  document: string | null; certainty: string; note: string | null;
  /** API 113: other works with this number in the same record (inventory, date, place) — linked only when > 0 */
  id?: number; shared?: number | null;
}
export type EndBasis = 'recorded' | 'implied' | 'ongoing' | 'unknown' | 'point'; // point: an event, a moment (API 082)

/** An entry whose texts [[link]] this one (backlink). */
export interface EntryRef { type: EntityType; slug: string; name: string }
/** A polity named by a place's timeline or a relationship (API 161): always a polity, so no `type`. */
export interface PolityRef { slug: string; public_id?: number | null; name: string }

interface DetailBase {
  slug: string;
  /** The public number (API 085: from 100001, never changed) and the canonical address "/artworks/100476/<slug>". */
  public_id: number; path: string;
  wikidata_id: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
  relationships: Relationship[];
  /** The glossary terms this entry's texts link (<a class="glossary-link" data-term=…>), for popovers. */
  glossary?: Record<string, GlossaryHint>;
  /** The sources this entry's texts cite in footnotes (a.source-link[data-source]). */
  bibliography?: Record<string, SourceHint>;
  /** Previews of the other entries its texts link (a.entry-link[data-entry="type/slug"]), for popovers. */
  entries?: Record<string, EntryHint>;
  /** Entries whose texts link this one (every type except terms, which have `used_in`). */
  mentioned_in?: EntryRef[];
  /** Where its fields come from: {birth: [...], created: [...], institution: [...] …}; no key without citations. */
  sources?: Record<string, Citation[]>;
}

/** A cited source, for popovers on short references: siglum ("Busch 1993") and the full citation (HTML, italic titles). */
export interface SourceHint { siglum: string; citation: string }

/** A linked entry, for a Wikipedia-style preview: subtitle = dates, maker, kind or where; excerpt = its text's opening. */
export interface EntryHint { type: EntityType; slug: string; name: string; subtitle: string | null; image_url: string | null; excerpt: string | null }

export interface GlossaryHint { name: string; category: TermCategory; definition: string | null }
export type TermCategory = 'technique' | 'architecture' | 'material' | 'iconography' | 'style' | 'format' | 'object type' | 'group of works' | 'mounting' | 'performing arts' | 'heritage designation' | 'other';  // group of works: API 131, mounting: 133, performing arts: 145, heritage designation: 165

// ---- countries and polities ---------------------------------------------------------------------

/**
 * Today's country, derived from the entry's place (birthplace, place of creation, location) or, without a place,
 * from its polities when they all lie in one modern country. `name`/`slug` come from the country's place entry.
 */
export interface Country {
  code: string;
  name: string | null;
  slug: string | null;
  source: 'place' | 'polity';
  place: Ref | null;
}

/** A dated link to a polity (state, empire, dynasty); entered by hand, not derived from places. */
export interface PolityLink {
  slug: string; name: string; kind: string | null;
  relationship: 'nationality' | 'created_in_polity' | 'located_in_polity';
  period: DateRange | null; // of the link (e.g. nationality 1880–1917)
  polity_period: DateRange | null; // when the polity existed
  country_codes: string[];
}

/** One name of an entry besides its display name; `lang` is BCP 47 ("ja", "zh-Hant", "ja-Latn"), may be null. */
export interface NameEntry {
  text: string;
  lang: string | null;
  role: 'original' | 'translation' | 'romanization' | 'alternative' | 'former';  // former: a name it had before (API 139)
  ruby_html: string | null; // with furigana, escaped and safe to insert
  reading: string | null;
  /** For a translation (migration 052): official (institution, publisher) · common (in use) · own (the author's); else null. */
  status?: TranslationStatus | null;
  /** What kind of name (API 153): a birth name, a pseudonym, an art name (gō) … */
  kind?: NameKind | null;
  /** When the name was in use, its context and sources (API 152) — on detail pages only. */
  period?: DateRange | null; note?: string | null; sources?: Citation[];
}
/** A holder's former name in use at a provenance step (API 152: `owner.name_then`). */
export interface NameThen { text: string; lang: string | null; period: DateRange | null; note: string | null }
export type TranslationStatus = 'official' | 'common' | 'own';
export type NameKind = 'birth' | 'married' | 'pseudonym' | 'art_name' | 'religious' | 'nickname' | 'abbreviation';

/** Display name (`name`) with its language, furigana and other names; `search_text`: further words it is found by. */
interface Named {
  name_lang?: string | null;
  name_ruby_html?: string | null;
  name_reading?: string | null;
  names?: NameEntry[];
  sort_key?: string;
  search_text?: string | null;
}
/** The same for artworks, whose display name is `title`. */
interface Titled {
  /** null: the title is in its original language; else it is itself a translation of this status (migration 052). */
  title_status?: TranslationStatus | null;
  title_lang?: string | null;
  title_ruby_html?: string | null;
  title_reading?: string | null;
  names?: NameEntry[];
  sort_key?: string;
  search_text?: string | null;
}

/** Artists and people (migration 066): name parts, each null when not set; `sort_key` is "Family, Given" or `sort_name`. */
interface PersonName {
  given_name?: string | null;
  family_name?: string | null;
  sort_name?: string | null;
}

interface Located {
  country: Country | null;
  polities: PolityLink[];
}

export interface BirthPlace { slug: string; name: string; country_code: string | null }

// ---- list items ----------------------------------------------------------------------------------

export interface ArtistItem extends Located, Named, PersonName {
  slug: string; name: string; birth: DateRange | null; death: DateRange | null; image_url: string | null;
  /** API 147: when active, for artists whose dates of life are unknown. */
  active: DateRange | null;
  birth_place: BirthPlace | null;
  /** API 164 (list): the collections holding their works now and those that held them, with counts. */
  collections?: { slug: string; name: string; now: number; before: number }[];
}
/** One of an artwork's makers; the main creator comes first. `role`: "landscape", "figures" … */
export interface CreatorRef extends Ref { main: boolean; role: string | null; certainty: string | null }
export interface ArtworkItem extends Located, Titled {
  slug: string; title: string; created: DateRange | null; kind: string | null; image_url: string | null;
  creator: Ref | null; creators?: CreatorRef[];
  /** Series (migration 037): the nearest whole and the position in it. */
  part_of?: { slug: string; title: string; kind?: string | null } | null; part_number?: string | null;
  /** A whole (API 132): a group of works (series, versions …) — its number of parts entered, and how many it has. */
  is_group?: boolean; parts?: number; parts_count?: number | null;
  /** Lent to (deposited at) `institution`; the owner is the provenance's last step (migration 048). */
  on_loan?: boolean;
  /** The 1933–1945 provenance category (API 074): A–D, null when not assessed — a filter on the list. */
  provenance_category?: ProvenanceCategory | null;
  /** Destroyed, partly destroyed or lost (API 103); null while extant. */
  fate?: ArtworkFate['status'] | null;
  /** The institutions that hold it now and those that held it before (provenance) — searchable in lists. */
  holders?: { now: { slug: string; name: string }[]; before: { slug: string; name: string }[] } | null;
  /** How much of its life the provenance covers (API 078); `gap_1933_1945`: no holder known then — a list filter. */
  provenance_coverage?: { documented_percent: number | null; has_provenance: boolean; gap_1933_1945: boolean } | null;
  /** Materials, and every name of the type / material terms in every language, for searching (API migration 071). */
  materials?: string[]; term_names?: string[];
}
/** qualifier: what sets it apart from places of the same name — "Massachusetts", "district of Portugal" (API 162); null when its name is the only one. */
export interface PlaceItem extends Named { slug: string; name: string; kind: string | null; designation?: string | null; qualifier?: string | null; country_code: string | null; location: PointGeometry | null }
export interface MovementItem extends Named { slug: string; name: string; kind: string | null; period: DateRange | null }
export interface InstitutionItem extends Located, Named {
  slug: string; name: string; kind: string | null; founded: DateRange | null; image_url: string | null;
  /** Closed / dissolved (API 106); null while it exists or not recorded. */
  dissolved?: DateRange | null;
  /** The artists of the works it holds now and held before, with counts (API 107). */
  artists_held?: { slug: string; name: string; now: number; before: number }[];
  location?: PointGeometry | null; // its own point (migration 034); else only its city's
}
/** Derived from relationships: commissioned / patron of, owner of an artwork, depicted in an artwork. */
export type PersonRole = 'patron' | 'owner' | 'depicted';
/** Everyone relevant who isn't an artist, also groups (family, dynasty, religious order …). */
export interface PersonItem extends Located, Named, PersonName {
  slug: string; name: string; kind: string | null; occupations: string[];
  birth: DateRange | null; death: DateRange | null; active: DateRange | null; // active: groups, or when the lifespan is unknown
  roles: PersonRole[]; birth_place: BirthPlace | null;
}
export type ReadingStatus = 'to_read' | 'reading' | 'read';
/** A source of the bibliography (formatted after the KHIST UZH guide). */
export interface SourceItem extends Named {
  slug: string; name: string; siglum: string; citation: string; kind: string | null; subtitle: string | null;
  authors: string[] | null; year: string | number | null; reading_status: ReadingStatus | null; read_on: DateRange | null;
  primary_source: boolean | null;
}
export interface TermItem extends Named { slug: string; name: string; category: TermCategory; definition: string | null; image_url: string | null }
export interface PolityItem extends Named { slug: string; name: string; kind: string | null; period: DateRange | null; country_codes: string[] }
/** Something that happened: a fire, a trial, an auction, an exhibition (migration 047). */
export interface EventItem extends Located, Named {
  slug: string; name: string; kind: string | null; period: DateRange | null; place: Ref | null;
  part_of: Ref | null; image_url: string | null;
  location?: PointGeometry | null; // exact spot, else a point inside the area
}

// ---- details -------------------------------------------------------------------------------------

/** In an artist's `artworks`, `co_creator: true` marks works they made together with the main creator. */
export interface ArtworkSummary { slug: string; title: string; created: DateRange | null; kind?: string | null; creator?: Ref | null; co_creator?: boolean; role?: string | null }
export type KindRef = Ref & { kind?: string | null; period?: DateRange | null };

export interface Artist extends DetailBase, Located, Named, PersonName {
  type: 'artist';
  birth_place: BirthPlace | null;
  name: string; alt_names: string[];
  birth: DateRange | null; death: DateRange | null; active: DateRange | null; // active: API 147
  biography_html: string | null;
  images: Image[]; image_url: string | null;
  artworks: ArtworkSummary[];
}

export interface Dimensions { height_cm: number | null; width_cm: number | null; depth_cm: number | null; note: string | null; label: string | null }
/** A further measured part next to the work itself: mount, frame, sheet, base … */
/** A further measurement (API 025): its part — a glossary term when it is one (134: frame, mount …). */
export interface PartDimensions { part: string; height_cm: number | null; width_cm: number | null; depth_cm: number | null; label: string; term?: { slug: string; name: string } | null }

export interface Artwork extends DetailBase, Located, Titled {
  type: 'artwork';
  title: string; alt_titles: string[]; attribution_label: string | null;
  /** Where an immovable work stands (a building, garden, bridge …): point and/or outline (migration 034). */
  location?: PointGeometry | null; area?: GeoJSON.Geometry | null;
  created: DateRange | null; kind: string | null; medium: string | null; inventory_number: string | null;
  materials: string[]; dimensions: Dimensions | null;
  /** Type and materials as glossary terms (API migration 071): links (detail), and every name of them in every
   *  language — of the type, the materials and the terms the medium mentions — for searching (list and detail). */
  kind_term?: Ref | null; material_terms?: Ref[]; term_names?: string[];
  other_dimensions?: PartDimensions[]; // detail only; empty list when there are none
  /** Series (migration 037): a part has the chain of wholes and its neighbours; a whole has its parts in order. */
  part_of?: WholeRef[]; part_number?: string | null;
  previous_part?: SiblingRef | null; next_part?: SiblingRef | null;
  parts_count?: number | null; parts?: PartRef[];
  description_html: string | null;
  images: Image[]; image_url: string | null;
  creator: Ref | null; creators?: CreatorRef[]; institution: Ref | null;
  provenance?: ProvenanceStep[];
  /** The work's page at its museum / collection (migration 038) and the day the link was added (039, YYYY-MM-DD). */
  web_url?: string | null; web_url_accessed?: string | null;
  /** Further numbers besides `inventory_number` (migration 048): the owner's, former ones, catalogue raisonné numbers. */
  numbers?: ArtworkNumber[];
  /** Lent to (deposited at) `institution` — since when; the lender is the provenance's last owner. */
  on_loan?: boolean; on_loan_since?: DateRange | null;
  /** The 1933–1945 provenance status (API 074), null when not assessed; `note`: the source's own wording. */
  provenance_status?: ProvenanceStatus | null;
  /** API 169: the building history — phases in order (optional: older answers lack it). */
  phases?: Phase[];
  /** What became of it (API 103): destroyed / partly destroyed / lost, when and how; null while extant. */
  fate?: ArtworkFate | null;
  completion?: ArtworkCompletion | null;
  authenticity?: ArtworkAuthenticity | null;
  stolen?: ArtworkStolen | null;
  /** What the span of `created` means (API 135): `duration` = worked on over that time, `uncertain` = made at some point
   * in it; null = not stated. */
  created_span?: 'duration' | 'uncertain' | null;
  /** When the design, block or model was made, if earlier than `created` (a print pulled, a cast made later; 074). */
  conceived?: DateRange | null;
  /** Where the provenance is silent (API 078), from the creation until today; null without a creation date. */
  provenance_coverage?: ProvenanceCoverage | null;
  /** How far it travelled (API 091): the line through the provenance stops — null without two placed stops. */
  travel?: { km: number; legs: number; placed: number; steps: number } | null;
}

/** A stretch of time in the coverage: like a DateRange, but the API leaves its `label` empty (`years()` in coverage.ts). */
export type Stretch = Omit<DateRange, 'label'> & { label: string | null };
/** A stretch without a known holder (API 078): the holders `before` / `after` it and undated `candidates`. */
export interface ProvenanceGap {
  period: Stretch | null; in_1933_1945: boolean;
  before: string | null; after: string | null; candidates: string[];
}
/** One stretch of an artwork's life: `documented` · `presumed` (a holder known, not the edges) · `gap`; positions of the steps around a gap. */
export interface CoverageSegment extends ProvenanceGap {
  kind: 'documented' | 'presumed' | 'gap';
  before_position: number | null; after_position: number | null;
  /** A gap: the step it is shown after — the last one between its owners dated before it (API 079); else before_position. */
  show_after?: number | null;
}
export interface ProvenanceCoverage {
  segments: CoverageSegment[];
  documented_percent: number; has_provenance: boolean; gap_years: number; gap_1933_1945_years: number;
}

/**
 * The categories of the Swiss Federal Office of Culture for 1933–1945: A clarified, no looted art · B not fully
 * clarified, no indications · C not fully clarified, indications or suspicious circumstances · D looted / seized.
 */
export type ProvenanceCategory = 'A' | 'B' | 'C' | 'D';
export interface ProvenanceStatus { category: ProvenanceCategory; code: string; label: string; note: string | null }
/** What became of an artwork (API 103): null while extant as far as known; `note`: how, in the source's words. */
/** Doubts about it (API 175): attribution disputed, or a forgery; null when none are known. */
export interface ArtworkAuthenticity { status: 'disputed' | 'forgery'; label: string; date: DateRange | null; note: string | null }
/** An open theft in its provenance (API 175): the theft step not recovered; null when none. */
export interface ArtworkStolen { date: DateRange | null; note: string | null; provenance_id: number }

/** Whether it was finished (API 172): left unfinished, or finished by another hand; null when finished as far as known. */
export interface ArtworkCompletion { status: 'unfinished' | 'completed_by_another'; label: string; date: DateRange | null; note: string | null }

/** What became of it (API 103); `event`: its cause — an event that concerns the work at that time (API, 2026-10-30). */
export interface ArtworkFate { status: 'destroyed' | 'partly_destroyed' | 'lost'; label: string; date: DateRange | null; note: string | null; event?: { slug: string; name: string } | null }

/** "18" at the Foundation E.G. Bührle Collection, "658" in Rewald's catalogue raisonné … */
export interface ArtworkNumber { number: string; label: string | null; institution: Ref | null; source: Ref | null; sources?: Citation[] }

export type AcquisitionMethod =
  | 'creation' | 'commission' | 'inheritance' | 'purchase' | 'auction' | 'gift' | 'bequest' | 'exchange'
  | 'confiscation' | 'forced_sale' | 'forced_gift' | 'restitution' // forced_gift: given under duress (API 121)
  | 'settlement' // kept after an agreement with claimants (API 073)
  | 'transfer' | 'claim' | 'dissolution'
  | 'theft' // on a custody step: the owner keeps the title; `ended` = recovered (API 077)
  | 'find' | 'partage' | 'spoils_of_war' | 'in_lieu' // found or excavated, division of finds, taken in war, accepted in lieu of tax (API 120)
  | 'unknown';

/**
 * How a holder held the work (migration 063): `estate` = the owner's estate; `agent` (consignment) and `custodian` (loan,
 * deposit) didn't own it. API 077: `publisher` (an edition — of the chain), `foundry`, `trustee` (custody), `event` (no
 * holder: a claim, a settlement between others, a collection dissolved — described by `label`).
 */
export type ProvenanceRole = 'owner' | 'dealer' | 'agent' | 'estate' | 'custodian' | 'publisher' | 'foundry' | 'trustee' | 'event'
  | 'possessor'; // held without good title: seized, looted, stolen, or received from those who took it (API 083)
/**
 * `currency`: ISO 4217, old ones like FRF too, or a historical code without ISO ("RM", "AFRF" = French francs before
 * 1960). `chf_today` (API 090): the value in today's Swiss francs — always null until rates are loaded.
 */
export interface Price { amount: number; currency: string; note: string | null; chf_today?: number | null }
/** A number a provenance step records (API 077): kind lot · stock · inventory · catalogue · ek · err · munich · linz · aussee · lugt · other; `label` "Munich no.". */
/** shared (API 113): other works with this number within its reach — any holder's for ERR, Munich …, else the same holder's; linked only when > 0 */
export interface ProvenanceNumber { kind: string; label: string; number: string; id?: number; shared?: number }
/** `GET /v1/provenance-numbers?number=`: the steps recording a number. */
export interface ProvenanceNumberHit {
  kind: string; kind_label: string; number: string; artwork: { slug: string; title: string };
  position: number; owner_name: string | null; period: DateRange | null;
}

/**
 * One holder in an artwork's provenance; `period` is computed (its end per `end_basis`). `kind` (migration 063): a
 * recorded `step`, or a line computed by the API (`implied: true`, no sources) — the artist from the creation date
 * first (`creation`), the institution it is lent to last (`loan`).
 */
export interface ProvenanceStep {
  kind?: 'creation' | 'step' | 'loan'; implied?: boolean;
  position: number;
  owner: (EntryRef & { name_then?: NameThen | null }) | null; // an entry on this site (with its name then, 152), else only described:
  owner_label: string | null; owner_name: string | null;
  /** Further owners of the same step ("Leo Stein and Gertrude Stein"). */
  co_owners?: EntryRef[];
  role?: ProvenanceRole; price?: Price | null;
  acquired: DateRange | null; ended: DateRange | null;
  method: AcquisitionMethod | null;
  /** The handover from the previous owner is documented (false: possibly someone in between). */
  direct: boolean;
  label: string | null; certainty: string | null;
  place: Ref | null;
  period: DateRange | null; end_basis: EndBasis | null;
  notes_html: string | null;
  /** Citations (migration 049); before that, plain URLs. */
  sources: (Citation | string)[] | null;
  /**
   * API 074: `in_chain: false` for agents and custodians (consignments, auctions, deposits, loans) — they held the work
   * alongside its owner, not as a new owner. `not_sold`: an agent that didn't sell it. `via` (owner steps): the agents
   * the work went through to this owner ("Galerie Moos").
   */
  in_chain?: boolean; not_sold?: boolean; via?: string | null;
  /** API 096: announced, not yet a fact (an auction to come) — the day it is planned for, until then. */
  planned_until?: string | null;
  /** API 077: further places after `place`, in order ("Köln → Berlin → Geneva"); numbers it records; the event it belongs to. */
  further_places?: (Ref & { period: DateRange | null })[]; numbers?: ProvenanceNumber[]; event?: Ref | null;
  /** API 104: the evidence under the step — inventory entries, catalogues, exhibitions, sightings — by date. */
  records?: ProvenanceRecord[];
  /** API 084: what the holder gave for it — an artwork on this site, else only described. */
  exchanged_for?: { artwork: { slug: string; title: string } | null; text: string | null } | null;
  /** API 084: other sources' readings of this step when they contradict each other — beside it, not part of the chain. */
  alternatives?: ProvenanceAlternative[];
  /** API 086: what the holders' lives and whereabouts imply — derived, not stated by a source. */
  inferences?: Inference[];
  /** The step's id — the anchor #provenance-<id> a search hit points at; null for implied lines (no stored step). */
  id: number | null;
}

/**
 * A conclusion from the holders' lives (API 086): `narrowed` (the giver died within the window: `period` = the narrowed
 * window), `from_estate` (wholly after the giver's death), `travelled` (the giver was far away: `km`).
 */
export interface Inference { kind: 'narrowed' | 'from_estate' | 'travelled'; text: string; period: Stretch | null; km: number | null }

/** Another source's reading of a provenance step (API 084). */
export interface ProvenanceAlternative {
  owner: EntryRef | null; owner_label: string | null; role: ProvenanceRole | null; method: AcquisitionMethod | null;
  acquired: DateRange | null; ended: DateRange | null; label: string | null; certainty: string | null;
  notes_html: string | null; sources: (Citation | string)[] | null;
}

export interface Place extends DetailBase, Named {
  type: 'place';
  /** country_code: its country today — by hand, else where its point lies, else its parent's (API 155). */
  name: string; alt_names: string[]; kind: string | null; country_code: string | null;
  /** What it is as a unit — "canton of Switzerland", "province of Italy" (API 158); `kind` the coarse kind. */
  designation?: string | null;
  /** What sets it apart from places of the same name (API 162): its region, designation, kind or country; null = the only one. */
  qualifier?: string | null;
  /** When it existed as such — a dissolved unit, a merged city (API 159); null = not known / still there. */
  existed?: DateRange | null;
  /** The states it belonged to over time (API 161), inherited from the places above (`via`), the nearest link winning. */
  polities?: { polity: PolityRef; period: DateRange | null; via: { slug: string; name: string } | null }[];
  /** The first-level division its point lies in — canton, Land, province, prefecture (Natural Earth; API 155). */
  within?: { code: string; name: string } | null;
  location: PointGeometry | null; area: unknown | null;
  description_html: string | null;
  ancestors: KindRef[]; children: KindRef[]; institutions: KindRef[];
}

export interface Movement extends DetailBase, Named {
  type: 'movement';
  name: string; alt_names: string[]; kind: string | null; period: DateRange | null;
  description_html: string | null;
  ancestors: KindRef[]; children: KindRef[];
}

export interface Institution extends DetailBase, Located, Named {
  type: 'institution';
  name: string; alt_names: string[]; kind: string | null; founded: DateRange | null; website_url: string | null;
  dissolved?: DateRange | null; // closed / dissolved (API 106)
  description_html: string | null;
  images: Image[]; image_url: string | null;
  place: (Ref & { location: PointGeometry | null }) | null;
  location?: PointGeometry | null; address?: string | null;
  artworks: ArtworkSummary[];
}

export interface Person extends DetailBase, Located, Named, PersonName {
  type: 'person';
  birth_place: BirthPlace | null;
  name: string; alt_names: string[]; kind: string | null; occupations: string[];
  birth: DateRange | null; death: DateRange | null; active: DateRange | null; roles: PersonRole[];
  description_html: string | null;
}

export interface Polity extends DetailBase, Named {
  type: 'polity';
  name: string; alt_names: string[]; kind: string | null; period: DateRange | null; country_codes: string[];
  description_html: string | null;
  ancestors: KindRef[]; children: KindRef[];
}

export interface Event extends DetailBase, Located, Named {
  type: 'event';
  name: string; alt_names: string[]; kind: string | null; period: DateRange | null;
  place: (Ref & { location?: PointGeometry | null }) | null;
  part_of: Ref | null; parts: KindRef[];
  /** Exact spot and/or drawn area (e.g. the burned districts). */
  location: PointGeometry | null; area: GeoJSON.Geometry | null;
  description_html: string | null;
  images: Image[]; image_url: string | null;
}

export interface Term extends DetailBase, Named {
  type: 'term';
  name: string; alt_names: string[]; category: TermCategory; definition: string | null;
  description_html: string | null;
  images: Image[]; image_url: string | null;
  /** Entries whose texts link this term. */
  used_in: EntryRef[];
  /** API 145: its broader terms upwards, nearest first (Yoroboshi → Noh → …), and the terms directly under it. */
  broader: KindRef[];
  narrower: { slug: string; name: string; category: TermCategory; definition: string | null }[];
}

export interface Source extends DetailBase, Named, Omit<SourceItem, 'slug'> {
  type: 'source';
  description_html: string | null; // the notes
  url?: string | null; isbn?: string | null; doi?: string | null;
}

export type Entity = Artist | Artwork | Place | Movement | Institution | Person | Polity | Event | Term | Source;

export interface ItemByPlural {
  artists: ArtistItem; artworks: ArtworkItem; places: PlaceItem;
  movements: MovementItem; institutions: InstitutionItem; people: PersonItem; polities: PolityItem; events: EventItem; glossary: TermItem; bibliography: SourceItem;
}
export interface DetailByPlural {
  artists: Artist; artworks: Artwork; places: Place;
  movements: Movement; institutions: Institution; people: Person; polities: Polity; events: Event; glossary: Term; bibliography: Source;
}

// ---- search, vocabulary --------------------------------------------------------------------------

/** A whole among the search hits (API): its kind, how many parts are entered (of how many) and the museums holding them. */
export interface HitGroup { kind: string | null; parts: number; parts_count: number | null; held_by: string[] }
export interface SearchHit { type: EntityType; slug: string; name: string; kind: string | null; period: DateRange | null; score: string; subtitle?: string | null; image_url?: string | null; institution?: string | null; group?: HitGroup | null }

export interface RelationshipType {
  code: string; label: string; inverse_label: string | null; category: Category;
  is_physical_presence: boolean; is_symmetric: boolean;
  subject_types: EntityType[]; object_types: EntityType[]; description: string | null;
  /** Computed, never entered: `creator` (graph only), `owned_by`, `held_by`, `kept_in`, `transferred_to`, `commissioned` (provenance). */
  derived?: boolean;
}

// ---- map (GeoJSON, [longitude, latitude]) --------------------------------------------------------

export interface Feature<G, P> { type: 'Feature'; geometry: G; properties: P }
export interface LineStringGeometry { type: 'LineString'; coordinates: [number, number][] }

export interface StopProps {
  layer: 'presence' | 'association';
  relationship: string; label: string; category: Category;
  place: Ref; period: DateRange | null; note: string | null; certainty: string | null;
  /** The exact venue when the link points at an institution or an immovable artwork; `place` is then its city. */
  institution?: Ref | null; artwork?: Ref | null;
  /** An event it took part in or depicts (an `association` stop at the event's position). */
  event?: Ref | null;
}
export type StopFeature = Feature<PointGeometry, StopProps>;
export type RouteFeature = Feature<LineStringGeometry, { layer: 'route' }>;

export interface EntityMap {
  type: 'FeatureCollection';
  entity: { type: EntityType; slug: string; name: string };
  features: (StopFeature | RouteFeature)[];
  /** Artworks: the provenance in the chain's order (not by date), every step on the map or in `unplaced`. */
  provenance?: ProvenanceMap;
}

/** One step of the provenance as the map has it: number `step` of `steps` in the chain (creation, steps, loan). */
export interface ProvenanceMapStep {
  kind: 'creation' | 'step' | 'loan';
  step: number; steps: number;
  holder: { type: EntityType; slug: string; name: string } | null; holder_label: string | null;
  role: string | null; method: string | null; certainty: string | null;
  period: DateRange | null; end_basis: string | null; provenance_id: number | null;
}
/**
 * A step with a place. `place_basis`: `recorded` (the step's own) · `holder_seat` (the institution's seat) ·
 * `created_in` (the recorded place of creation) · `artist_residence` / `artist_workplace` (where the artist lived or worked then: "probably").
 */
export interface ProvenanceStopProps extends ProvenanceMapStep {
  layer: 'provenance_stop';
  place: Ref;
  precision: 'site' | 'settlement' | 'region' | 'country' | null;
  place_basis: 'recorded' | 'holder_seat' | 'created_in' | 'artist_residence' | 'artist_workplace';
  /** API 077: 0 at the step's place, 1, 2 … at its further places (`part_label`: when it was there). */
  part?: number; part_label?: string | null;
  /** The step's `position` in the artwork's provenance (API 078), to match it with the detail's steps. */
  position?: number;
}
/** From one placed step to the next; `between`: the steps passed over that have no place. */
export interface ProvenanceSegmentProps {
  layer: 'provenance_segment';
  from_step: number; to_step: number;
  /** Every handover on it documented as direct. */
  direct: boolean;
  /** An end not recorded: the creation, the loan, or a place not recorded. */
  implied: boolean;
  between: ProvenanceMapStep[];
  /** API 077: within one step — the holder took it from one of its places to the next. */
  move?: boolean;
  /** API 078: the gaps between its two stops — a "?" mid-segment. */
  gaps?: ProvenanceGap[];
}
export interface ProvenanceMap {
  type: 'FeatureCollection';
  features: (Feature<PointGeometry, ProvenanceStopProps> | Feature<LineStringGeometry, ProvenanceSegmentProps>)[];
  unplaced: ProvenanceMapStep[];
  /** API 078: every gap of the provenance, for the text under the map. */
  gaps?: ProvenanceGap[];
}

export interface PresenceProps {
  relationship: string; label: string; place: Ref;
  entity: { type: EntityType; slug: string; name: string };
  period: DateRange | null; note: string | null; certainty: string | null;
  institution?: Ref | null; artwork?: Ref | null; // the exact venue, see StopProps
}
export interface PresenceMap { type: 'FeatureCollection'; features: Feature<PointGeometry, PresenceProps>[] }

/** Institutions and immovable artworks with an exact location of their own (`/v1/map/sites`). */
export interface SiteProps {
  type: 'institution' | 'artwork'; slug: string; name: string; kind: string | null; address: string | null; place: Ref | null;
  /** When it existed, in years (API 106): founded (a building: made) … dissolved (destroyed); null = not known / still there. */
  from_year?: number | null; to_year?: number | null;
  /** A branch of the institution (API 154): at its place, for its period — the seat is the feature without `branch`. */
  branch?: { place: Ref; period: DateRange | null } | null;
}
export interface SitesMap { type: 'FeatureCollection'; features: Feature<GeoJSON.Geometry, SiteProps>[] }

export interface PlaceCountProps { slug: string; name: string; kind: string | null; country_code: string | null; presence_count: number; association_count: number }
/** Events with a position (`/v1/map/events`): area, else exact spot, else the place's marker. */
export interface EventMapProps { slug: string; name: string; kind: string | null; period: DateRange | null; place: Ref | null; precision: 'area' | 'spot' | 'place' }
export interface EventsMap { type: 'FeatureCollection'; features: Feature<GeoJSON.Geometry, EventMapProps>[] }

export interface PlacesMap { type: 'FeatureCollection'; features: Feature<PointGeometry, PlaceCountProps>[] }

// ---- graph ---------------------------------------------------------------------------------------

export interface GraphNode { id: string; type: EntityType; slug: string; name: string; kind: string | null; depth: number; period: DateRange | null }
export interface GraphEdge {
  source: string; target: string; type: string; label: string; category: Category; symmetric: boolean;
  certainty: string | null; note: string | null; period: DateRange | null;
  derived?: boolean; end_basis?: EndBasis | null;
}
export interface Graph { root: string; depth: number; types: string[]; truncated: boolean; nodes: GraphNode[]; edges: GraphEdge[] }

/**
 * A curated view of the start map (`/v1/featured`): a title, an intro and the start map's own URL query
 * ("artists=vincent-van-gogh&movements=none&from=1886&to=1890") — what the map shows is exactly what that URL shows.
 */
export interface FeaturedView {
  slug: string;
  title: string;
  /** Markdown rendered to sanitized HTML, like every `*_html`. */
  intro_html: string | null;
  query: string;
}

// ---- full-text search, network questions, versions (API 087–089) ------------------------------------------------

/** An entry as the network and history answers name it: its current name and canonical `path`. */
export interface NetRef {
  type: EntityType; slug: string; public_id: number; name: string | null; kind?: string | null;
  period?: DateRange | null; path: string; gone?: boolean;
}

/** `GET /v1/search/text` (087): names and texts; `headline_html` is escaped text with <mark>s, or null (name only). */
export interface TextHit {
  type: EntityType; slug: string; public_id: number; path: string; name: string; kind: string | null; period: DateRange | null;
  /** What it is in one line — an artwork's artist and date, a museum's city (the previews'); its picture. */
  subtitle?: string | null; image_url?: string | null;
  /** Artworks: where it is now; a whole (series, versions, cycle) its parts and where they are (API). */
  institution?: string | null; group?: HitGroup | null;
  matched_in: 'name' | 'text' | 'provenance'; provenance_ids: number[]; score: number; headline_html: string | null;
}

/** One link of `GET /v1/network/path` (088): reads "from <reads> to". */
export interface PathStep {
  from: NetRef; to: NetRef; relationship_type: string; reads: string; forward: boolean;
  period: DateRange | null; note: string | null; certainty: string | null; provenance_id: number | null;
}
export interface NetworkPath { from: NetRef; to: NetRef; found: boolean; length: number | null; steps: PathStep[] }

/** `GET /v1/network/hands` (088): holders in a window and the handovers dated in it. */
export interface HandsHolder { holder: NetRef; roles: string[]; flag: string | null; artworks: NetRef[] }
export interface Handover { from: NetRef; to: NetRef; artwork: NetRef; period: DateRange | null; note: string | null; certainty: string | null; provenance_id: number | null }
export interface NetworkHands { holders: HandsHolder[]; handovers: Handover[] }

/** `GET /v1/network/shared-hands` (088): works through the same hands; depth 2+ via one of those (`via`). */
export interface SharedHand { artwork: NetRef; depth: number; via: NetRef | null; holders: (NetRef & { together?: boolean })[]; together: boolean }
export interface SharedHands { artwork: NetRef; data: SharedHand[] }

/** `GET /v1/history/<plural>/<number>` (089): versions, newest first. `as_of` is exact to the microsecond — pass it back as given. */
export interface Version { changed_at: string; as_of: string; sources: string[]; tables: string[]; changes: number }
export interface History { type: EntityType; current: NetRef | null; deleted: boolean; history_since: string; versions: Version[] }

/** `GET /v1/<plural>/<number>?as_of=` (089): the entry as recorded then — raw fields, not the normal detail. */
export interface AsOfRelationship {
  relationship_type: string; reads: string; direction: 'out' | 'in'; other: NetRef; period: DateRange | null;
  label: string | null; certainty: string | null; notes_md: string | null;
}
export interface AsOfStep {
  id: number; position: number; role: string | null; method: string | null; direct: boolean; certainty: string | null;
  acquired: DateRange | null; ended: DateRange | null; label: string | null; notes_md: string | null; alternative_to: number | null;
  holder: NetRef | null; holder_label: string | null;
}
export interface AsOfDetail {
  type: EntityType; as_of: string; requested: string; history_since: string; version: string;
  current: NetRef | null; deleted: boolean; entry: Record<string, unknown>;
  relationships: AsOfRelationship[]; provenance?: AsOfStep[];
  changes_since: { changed_at: string; table: string; action: string; fields: string[]; source: string | null }[];
}

// ---- spatial history (API 091) ----------------------------------------------------------------------------------

/** `GET /v1/map/encounters`: two dated stays overlapping at one place — or within `within_km` (then `other_place`). */
export interface EncounterRow {
  a: { type: EntityType; slug: string; name: string; public_id?: number };
  b: { type: EntityType; slug: string; name: string; public_id?: number };
  place: Ref; other_place: Ref | null;
  venue: { type?: 'institution' | 'artwork'; slug: string; name: string } | null;
  overlap: Stretch; days: number; km: number; approximate: boolean;
  a_relationship: string; b_relationship: string;
}

/** `GET /v1/map/clusters`: places with presence grouped for a zoom; `bbox` [w, s, e, n] to zoom into. */
export interface ClusterProps { cluster: number; places: number; presence: number; top: { slug: string; name: string; presence: number }[] }
export interface ClustersMap { type: 'FeatureCollection'; features: (Feature<PointGeometry, ClusterProps> & { bbox: [number, number, number, number] })[] }

/** GET /v1/periods (API 100): styles, movements and periods with where and when each was active. */
export interface PeriodSpan {
  place: string;
  period: DateRange;
  fuzzy: { start: boolean; end: boolean };
}
export interface PeriodWork {
  slug: string;
  public_id: number | null;
  title: string;
  creator: string | null;
  /** the main creator's slug (API 112): the work's dot on the artist's row in the artists view */
  creator_slug: string | null;
  created: DateRange | null;
  /** where it was made, the places above and its country (slugs) — for its lane; made_in: the place's name */
  places: string[];
  made_in: string | null;
}
export interface Period {
  slug: string;
  public_id: number | null;
  name: string;
  kind: 'style' | 'movement' | 'period' | 'school';
  parent: string | null;
  period: DateRange | null;
  /** false: drafted, not yet reviewed (marked "to complete" in the admin) */
  reviewed: boolean;
  spans: PeriodSpan[];
  works: PeriodWork[];
  /** its artists (API 112) — linked directly, or creators of its works; a style has its phases' artists too */
  artists: PeriodArtist[];
}
export interface PeriodArtist {
  slug: string;
  public_id: number | null;
  name: string;
  /** birth – death (open end: living) */
  life: DateRange | null;
  /** 'artist': associated with / member of / founded it; 'works': only through works of theirs */
  via: 'artist' | 'works';
  /** the link's own dates, when recorded ("member 1874–1886") */
  active: DateRange | null;
  /** where they lived and worked during the period, the places above and the countries (slugs) — for the lane */
  places: string[];
  /** birth or death known only roughly: that edge fades */
  fuzzy: { start: boolean; end: boolean };
}
export interface Periods {
  lanes: { slug: string; name: string; public_id: number | null }[];
  periods: Period[];
}

/** One phase of a work's building history (API 169). */
export type PhaseKind = 'construction' | 'extension' | 'alteration' | 'completion' | 'restoration' | 'damage' | 'destruction' | 'demolition' | 'reconstruction' | 'other';
export interface Phase {
  kind: PhaseKind; title: string; part: string | null; period: DateRange | null; notes_html: string | null;
  people: { type: 'artist' | 'person' | 'institution'; slug: string; name: string; public_id: number | null; role: string | null; patron: boolean }[];
}
