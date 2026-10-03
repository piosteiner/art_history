// Response shapes of https://api.arthistory.piogino.ch/v1 (reference: backend/docs/api.md).

/** Plural URL segment of an entity type (`/v1/artists/…`). */
export type Plural = 'artists' | 'artworks' | 'places' | 'movements' | 'institutions' | 'patrons';
/** Singular `type` field inside responses. */
export type EntityType = 'artist' | 'artwork' | 'place' | 'movement' | 'institution' | 'patron';

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
  | 'collaboration' | 'membership' | 'patronage' | 'provenance';

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
}

interface DetailBase {
  slug: string;
  wikidata_id: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
  relationships: Relationship[];
}

// ---- list items ----------------------------------------------------------------------------------

export interface ArtistItem {
  slug: string; name: string; sort_name: string | null; birth: DateRange | null; death: DateRange | null; image_url: string | null;
  /** Requested from the backend (place of the `born_in` relationship); absent until it is delivered. */
  birth_place?: { slug: string; name: string; country_code: string | null } | null;
}
export interface ArtworkItem { slug: string; title: string; created: DateRange | null; kind: string | null; image_url: string | null; creator: Ref | null }
export interface PlaceItem { slug: string; name: string; kind: string | null; country_code: string | null; location: PointGeometry | null }
export interface MovementItem { slug: string; name: string; kind: string | null; period: DateRange | null }
export interface InstitutionItem { slug: string; name: string; kind: string | null; founded: DateRange | null; image_url: string | null }
export interface PatronItem { slug: string; name: string; kind: string | null; active: DateRange | null }

// ---- details -------------------------------------------------------------------------------------

export interface ArtworkSummary { slug: string; title: string; created: DateRange | null; kind?: string | null; creator?: Ref | null }
export type KindRef = Ref & { kind?: string | null; period?: DateRange | null };

export interface Artist extends DetailBase {
  type: 'artist';
  name: string; sort_name: string | null; alt_names: string[];
  birth: DateRange | null; death: DateRange | null;
  biography_html: string | null;
  images: Image[]; image_url: string | null;
  artworks: ArtworkSummary[];
}

export interface Dimensions { height_cm: number | null; width_cm: number | null; depth_cm: number | null; note: string | null; label: string | null }

export interface Artwork extends DetailBase {
  type: 'artwork';
  title: string; alt_titles: string[]; attribution_label: string | null;
  created: DateRange | null; kind: string | null; medium: string | null; inventory_number: string | null;
  materials: string[]; dimensions: Dimensions | null;
  description_html: string | null;
  images: Image[]; image_url: string | null;
  creator: Ref | null; institution: Ref | null;
}

export interface Place extends DetailBase {
  type: 'place';
  name: string; alt_names: string[]; kind: string | null; country_code: string | null;
  location: PointGeometry | null; area: unknown | null;
  description_html: string | null;
  ancestors: KindRef[]; children: KindRef[]; institutions: KindRef[];
}

export interface Movement extends DetailBase {
  type: 'movement';
  name: string; alt_names: string[]; kind: string | null; period: DateRange | null;
  description_html: string | null;
  ancestors: KindRef[]; children: KindRef[];
}

export interface Institution extends DetailBase {
  type: 'institution';
  name: string; alt_names: string[]; kind: string | null; founded: DateRange | null; website_url: string | null;
  description_html: string | null;
  images: Image[]; image_url: string | null;
  place: (Ref & { location: PointGeometry | null }) | null;
  artworks: ArtworkSummary[];
}

export interface Patron extends DetailBase {
  type: 'patron';
  name: string; alt_names: string[]; kind: string | null; active: DateRange | null;
  notes_html: string | null;
}

export type Entity = Artist | Artwork | Place | Movement | Institution | Patron;

export interface ItemByPlural {
  artists: ArtistItem; artworks: ArtworkItem; places: PlaceItem;
  movements: MovementItem; institutions: InstitutionItem; patrons: PatronItem;
}
export interface DetailByPlural {
  artists: Artist; artworks: Artwork; places: Place;
  movements: Movement; institutions: Institution; patrons: Patron;
}

// ---- search, vocabulary --------------------------------------------------------------------------

export interface SearchHit { type: EntityType; slug: string; name: string; kind: string | null; period: DateRange | null; score: string }

export interface RelationshipType {
  code: string; label: string; inverse_label: string | null; category: Category;
  is_physical_presence: boolean; is_symmetric: boolean;
  subject_types: EntityType[]; object_types: EntityType[]; description: string | null;
}

// ---- map (GeoJSON, [longitude, latitude]) --------------------------------------------------------

export interface Feature<G, P> { type: 'Feature'; geometry: G; properties: P }
export interface LineStringGeometry { type: 'LineString'; coordinates: [number, number][] }

export interface StopProps {
  layer: 'presence' | 'association';
  relationship: string; label: string; category: Category;
  place: Ref; period: DateRange | null; note: string | null; certainty: string | null;
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
}
export interface PresenceMap { type: 'FeatureCollection'; features: Feature<PointGeometry, PresenceProps>[] }

export interface PlaceCountProps { slug: string; name: string; kind: string | null; country_code: string | null; presence_count: number; association_count: number }
export interface PlacesMap { type: 'FeatureCollection'; features: Feature<PointGeometry, PlaceCountProps>[] }

// ---- graph ---------------------------------------------------------------------------------------

export interface GraphNode { id: string; type: EntityType; slug: string; name: string; kind: string | null; depth: number; period: DateRange | null }
export interface GraphEdge { source: string; target: string; type: string; label: string; category: Category; symmetric: boolean; certainty: string | null; note: string | null; period: DateRange | null }
export interface Graph { root: string; depth: number; types: string[]; truncated: boolean; nodes: GraphNode[]; edges: GraphEdge[] }
