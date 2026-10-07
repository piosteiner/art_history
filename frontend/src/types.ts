// Response shapes of https://api.arthistory.piogino.ch/v1 (reference: backend/docs/api.md).
import type { PartRef, SiblingRef, WholeRef } from './series';

/** Plural URL segment of an entity type (`/v1/artists/…`). */
export type Plural = 'artists' | 'artworks' | 'places' | 'movements' | 'institutions' | 'people' | 'polities' | 'glossary' | 'bibliography';
/** Singular `type` field inside responses. */
export type EntityType = 'artist' | 'artwork' | 'place' | 'movement' | 'institution' | 'person' | 'polity' | 'term' | 'source';

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
  | 'collaboration' | 'membership' | 'patronage' | 'provenance' | 'polity' | 'depiction' | 'glossary' | 'architecture' | 'publication';

export interface Relationship {
  type: string;
  direction: 'outgoing' | 'incoming' | 'mutual';
  label: string;
  category: Category;
  is_physical_presence: boolean;
  entity: { type: EntityType; slug: string; name: string; period?: DateRange | null };
  period: DateRange | null;
  note: string | null;
  certainty: string | null;
  notes_html: string | null;
  /** Computed, not entered: from the provenance (owned_by, kept_in, transferred_to). */
  derived?: boolean;
  /** Where the period's end comes from (provenance); `implied` = only by the next owner's acquisition. */
  end_basis?: EndBasis | null;
}

/** recorded: a source gives the end · implied: the next acquisition · ongoing: still there · unknown: nothing after it. */
export type EndBasis = 'recorded' | 'implied' | 'ongoing' | 'unknown';

/** An entry whose texts [[link]] this one (backlink). */
export interface EntryRef { type: EntityType; slug: string; name: string }

interface DetailBase {
  slug: string;
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
}

/** A cited source, for popovers on short references: siglum ("Busch 1993") and the full citation (HTML, italic titles). */
export interface SourceHint { siglum: string; citation: string }

/** A linked entry, for a Wikipedia-style preview: subtitle = dates, maker, kind or where; excerpt = its text's opening. */
export interface EntryHint { type: EntityType; slug: string; name: string; subtitle: string | null; image_url: string | null; excerpt: string | null }

export interface GlossaryHint { name: string; category: TermCategory; definition: string | null }
export type TermCategory = 'technique' | 'architecture' | 'material' | 'iconography' | 'style' | 'format' | 'other';

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
  role: 'original' | 'translation' | 'romanization' | 'alternative';
  ruby_html: string | null; // with furigana, escaped and safe to insert
  reading: string | null;
}

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
  title_lang?: string | null;
  title_ruby_html?: string | null;
  title_reading?: string | null;
  names?: NameEntry[];
  sort_key?: string;
  search_text?: string | null;
}

interface Located {
  country: Country | null;
  polities: PolityLink[];
}

export interface BirthPlace { slug: string; name: string; country_code: string | null }

// ---- list items ----------------------------------------------------------------------------------

export interface ArtistItem extends Located, Named {
  slug: string; name: string; sort_name: string | null; birth: DateRange | null; death: DateRange | null; image_url: string | null;
  birth_place: BirthPlace | null;
}
/** One of an artwork's makers; the main creator comes first. `role`: "landscape", "figures" … */
export interface CreatorRef extends Ref { main: boolean; role: string | null; certainty: string | null }
export interface ArtworkItem extends Located, Titled {
  slug: string; title: string; created: DateRange | null; kind: string | null; image_url: string | null;
  creator: Ref | null; creators?: CreatorRef[];
  /** Series (migration 037): the nearest whole and the position in it. */
  part_of?: { slug: string; title: string } | null; part_number?: string | null;
}
export interface PlaceItem extends Named { slug: string; name: string; kind: string | null; country_code: string | null; location: PointGeometry | null }
export interface MovementItem extends Named { slug: string; name: string; kind: string | null; period: DateRange | null }
export interface InstitutionItem extends Located, Named {
  slug: string; name: string; kind: string | null; founded: DateRange | null; image_url: string | null;
  location?: PointGeometry | null; // its own point (migration 034); else only its city's
}
/** Derived from relationships: commissioned / patron of, owner of an artwork, depicted in an artwork. */
export type PersonRole = 'patron' | 'owner' | 'depicted';
/** Everyone relevant who isn't an artist, also groups (family, dynasty, religious order …). */
export interface PersonItem extends Located, Named {
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

// ---- details -------------------------------------------------------------------------------------

/** In an artist's `artworks`, `co_creator: true` marks works they made together with the main creator. */
export interface ArtworkSummary { slug: string; title: string; created: DateRange | null; kind?: string | null; creator?: Ref | null; co_creator?: boolean; role?: string | null }
export type KindRef = Ref & { kind?: string | null; period?: DateRange | null };

export interface Artist extends DetailBase, Located, Named {
  type: 'artist';
  birth_place: BirthPlace | null;
  name: string; sort_name: string | null; alt_names: string[];
  birth: DateRange | null; death: DateRange | null;
  biography_html: string | null;
  images: Image[]; image_url: string | null;
  artworks: ArtworkSummary[];
}

export interface Dimensions { height_cm: number | null; width_cm: number | null; depth_cm: number | null; note: string | null; label: string | null }
/** A further measured part next to the work itself: mount, frame, sheet, base … */
export interface PartDimensions { part: string; height_cm: number | null; width_cm: number | null; depth_cm: number | null; label: string }

export interface Artwork extends DetailBase, Located, Titled {
  type: 'artwork';
  title: string; alt_titles: string[]; attribution_label: string | null;
  /** Where an immovable work stands (a building, garden, bridge …): point and/or outline (migration 034). */
  location?: PointGeometry | null; area?: GeoJSON.Geometry | null;
  created: DateRange | null; kind: string | null; medium: string | null; inventory_number: string | null;
  materials: string[]; dimensions: Dimensions | null;
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
}

export type AcquisitionMethod =
  | 'creation' | 'commission' | 'inheritance' | 'purchase' | 'auction' | 'gift' | 'bequest' | 'exchange'
  | 'confiscation' | 'forced_sale' | 'restitution' | 'unknown';

/** One owner in an artwork's provenance, as recorded; `period` is computed (its end per `end_basis`). */
export interface ProvenanceStep {
  position: number;
  owner: EntryRef | null; // an entry on this site, else only described:
  owner_label: string | null; owner_name: string | null;
  acquired: DateRange | null; ended: DateRange | null;
  method: AcquisitionMethod | null;
  /** The handover from the previous owner is documented (false: possibly someone in between). */
  direct: boolean;
  label: string | null; certainty: string | null;
  place: Ref | null;
  period: DateRange | null; end_basis: EndBasis | null;
  notes_html: string | null;
  sources: string[] | null;
}

export interface Place extends DetailBase, Named {
  type: 'place';
  name: string; alt_names: string[]; kind: string | null; country_code: string | null;
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
  description_html: string | null;
  images: Image[]; image_url: string | null;
  place: (Ref & { location: PointGeometry | null }) | null;
  location?: PointGeometry | null; address?: string | null;
  artworks: ArtworkSummary[];
}

export interface Person extends DetailBase, Located, Named {
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

export interface Term extends DetailBase, Named {
  type: 'term';
  name: string; alt_names: string[]; category: TermCategory; definition: string | null;
  description_html: string | null;
  images: Image[]; image_url: string | null;
  /** Entries whose texts link this term. */
  used_in: EntryRef[];
}

export interface Source extends DetailBase, Named, Omit<SourceItem, 'slug'> {
  type: 'source';
  description_html: string | null; // the notes
  url?: string | null; isbn?: string | null; doi?: string | null;
}

export type Entity = Artist | Artwork | Place | Movement | Institution | Person | Polity | Term | Source;

export interface ItemByPlural {
  artists: ArtistItem; artworks: ArtworkItem; places: PlaceItem;
  movements: MovementItem; institutions: InstitutionItem; people: PersonItem; polities: PolityItem; glossary: TermItem; bibliography: SourceItem;
}
export interface DetailByPlural {
  artists: Artist; artworks: Artwork; places: Place;
  movements: Movement; institutions: Institution; people: Person; polities: Polity; glossary: Term; bibliography: Source;
}

// ---- search, vocabulary --------------------------------------------------------------------------

export interface SearchHit { type: EntityType; slug: string; name: string; kind: string | null; period: DateRange | null; score: string }

export interface RelationshipType {
  code: string; label: string; inverse_label: string | null; category: Category;
  is_physical_presence: boolean; is_symmetric: boolean;
  subject_types: EntityType[]; object_types: EntityType[]; description: string | null;
  /** Computed, never entered: `creator` (graph only), `owned_by`, `kept_in`, `transferred_to` (provenance). */
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
}
export type StopFeature = Feature<PointGeometry, StopProps>;
export type RouteFeature = Feature<LineStringGeometry, { layer: 'route' }>;

export interface EntityMap {
  type: 'FeatureCollection';
  entity: { type: EntityType; slug: string; name: string };
  features: (StopFeature | RouteFeature)[];
}

export interface PresenceProps {
  relationship: string; label: string; place: Ref;
  entity: { type: EntityType; slug: string; name: string };
  period: DateRange | null; note: string | null; certainty: string | null;
  institution?: Ref | null; artwork?: Ref | null; // the exact venue, see StopProps
}
export interface PresenceMap { type: 'FeatureCollection'; features: Feature<PointGeometry, PresenceProps>[] }

/** Institutions and immovable artworks with an exact location of their own (`/v1/map/sites`). */
export interface SiteProps { type: 'institution' | 'artwork'; slug: string; name: string; kind: string | null; address: string | null; place: Ref | null }
export interface SitesMap { type: 'FeatureCollection'; features: Feature<GeoJSON.Geometry, SiteProps>[] }

export interface PlaceCountProps { slug: string; name: string; kind: string | null; country_code: string | null; presence_count: number; association_count: number }
export interface PlacesMap { type: 'FeatureCollection'; features: Feature<PointGeometry, PlaceCountProps>[] }

// ---- graph ---------------------------------------------------------------------------------------

export interface GraphNode { id: string; type: EntityType; slug: string; name: string; kind: string | null; depth: number; period: DateRange | null }
export interface GraphEdge {
  source: string; target: string; type: string; label: string; category: Category; symmetric: boolean;
  certainty: string | null; note: string | null; period: DateRange | null;
  derived?: boolean; end_basis?: EndBasis | null;
}
export interface Graph { root: string; depth: number; types: string[]; truncated: boolean; nodes: GraphNode[]; edges: GraphEdge[] }
