// The project's vocabulary for the public statistics page (/statistik, GET /v1/stats/vocabulary): every kind of relationship,
// every option a provenance step can take and the roles and kinds of other names (152/153), with how often each is used — so that professionals can see the model
// and give feedback. The lists come from the database (relationship_types, the enums via enum_range(), the number
// kinds, the currencies): a new value appears by itself. The German explanations of the provenance options live here
// (the database knows only their codes); `label` is the wording the site shows (English, as on the entry pages).

const METHODS = {
  creation: ['creation', 'Entstehung: das Werk entsteht bei der Künstlerin oder dem Künstler.'],
  commission: ['commission', 'Auftrag: das Werk wurde bestellt und an die Auftraggeberin oder den Auftraggeber geliefert.'],
  inheritance: ['inheritance', 'Erbschaft: durch Erbgang an die Erbinnen und Erben.'],
  purchase: ['purchase', 'Kauf (auch über den Handel).'],
  auction: ['auction', 'Kauf an einer Auktion.'],
  gift: ['gift', 'Schenkung zu Lebzeiten.'],
  bequest: ['bequest', 'Vermächtnis: testamentarisch an eine bestimmte Person oder Institution.'],
  exchange: ['exchange', 'Tausch gegen ein anderes Werk oder eine Sache.'],
  transfer: ['transfer', 'Übertragung ohne Kauf, etwa zwischen Institutionen oder bei einer Fusion.'],
  confiscation: ['confiscation', 'Beschlagnahmung durch eine Behörde oder einen Staat.'],
  theft: ['stolen', 'Diebstahl.'],
  forced_sale: ['forced sale', 'Zwangsverkauf: Verkauf unter Verfolgung oder Zwang, etwa 1933–1945.'],
  forced_gift: ['forced gift', 'Erzwungene Schenkung: unter Zwang abgegeben, ohne dass ein Preis bezahlt wurde.'],
  restitution: ['restitution', 'Rückgabe an die Berechtigten oder ihre Erbinnen und Erben.'],
  settlement: ['settlement', 'Einigung mit den Anspruchstellenden („faire und gerechte Lösung“); das Werk bleibt.'],
  claim: ['claim', 'Anspruch: eine Forderung auf Rückgabe wurde erhoben.'],
  dissolution: ['dissolution', 'Auflösung einer Sammlung oder Institution.'],
  find: ['found', 'Fund: zufällig gefunden oder ausgegraben, nachdem das Werk verloren oder verschüttet war.'],
  partage: ['partage of finds', 'Fundteilung zwischen Ausgrabenden und Gastland.'],
  spoils_of_war: ['spoils of war', 'Kriegsbeute oder Abgabe als Kriegsentschädigung in einem Friedensvertrag.'],
  in_lieu: ['in lieu of tax', 'An Zahlung statt: vom Staat als Steuerzahlung angenommen (französisch „dation“).'],
  unknown: ['unknown', 'Die Art des Erwerbs ist unbekannt.'],
};
const ROLES = {
  owner: ['owner', 'Eigentümerin oder Eigentümer.'],
  dealer: ['dealer', 'Handel: hat das Werk gekauft, um es weiterzuverkaufen.'],
  agent: ['agent', 'Kommission oder Auktionshaus: hatte das Werk zum Verkauf, ohne Eigentum.'],
  estate: ['estate', 'Nachlass der Eigentümerin oder des Eigentümers.'],
  custodian: ['custodian', 'Verwahrung ohne Eigentum: Depositum, Leihgabe.'],
  publisher: ['publisher', 'Verlag einer Auflage (Druckgrafik).'],
  foundry: ['foundry', 'Giesserei: hat den Guss ausgeführt und das Werk gehalten.'],
  trustee: ['trustee', 'Treuhand oder Sicherungsübereignung: gehalten, ohne Eigentum.'],
  possessor: ['possessor', 'Besitz ohne Rechtstitel: beschlagnahmt, geraubt, gestohlen oder von diesen erhalten; das Eigentum bleibt bei den Berechtigten.'],
  event: ['event', 'Ereignis ohne Halter: ein Anspruch, eine Einigung zwischen Dritten, eine aufgelöste Sammlung.'],
};
const CERTAINTY = {
  attested: ['attested', 'Belegt durch eine Quelle.'],
  probable: ['probable', 'Wahrscheinlich, aber nicht ausdrücklich belegt.'],
  possible: ['possible', 'Möglich; die Quellen lassen es offen.'],
  disputed: ['disputed', 'Umstritten: Quellen widersprechen sich.'],
};
const RECORDS = {
  inventory: ['inventory', 'Eintrag in einem Inventar.'],
  catalogue: ['catalogue', 'Eintrag in einem Verkaufs-, Sammlungs- oder Werkkatalog.'],
  exhibition: ['exhibition', 'In einer Ausstellung gezeigt.'],
  sighting: ['sighting', 'Gesehen oder erwähnt, etwa in einem Brief oder Reisebericht.'],
  document: ['document', 'Ein anderes Dokument: Rechnung, Brief, Karteikarte.'],
  other: ['other', 'Ein anderer Nachweis.'],
};
const STATUS = {
  a_clear: ['A', 'Provenienz 1933–1945 geklärt: kein NS-verfolgungsbedingt entzogenes Kulturgut.'],
  b_no_indications: ['B', 'Nicht lückenlos geklärt, keine Hinweise auf NS-verfolgungsbedingten Entzug.'],
  c_indications: ['C', 'Nicht lückenlos geklärt, mit Hinweisen auf NS-verfolgungsbedingten Entzug.'],
  d_seized: ['D', 'NS-verfolgungsbedingt entzogenes Kulturgut.'],
};

// Other names (152/153): how a name relates to the main name, and what kind of name it is
const NAME_ROLES = {
  original: ['original', 'Der Name in der Originalsprache, wenn der Hauptname eine Übersetzung ist (神奈川沖浪裏).'],
  translation: ['translation', 'Übersetzung — offiziell (der Institution, eines Verlags), gebräuchlich oder eigene.'],
  romanization: ['romanization', 'Umschrift in lateinische Schrift (Kanagawa-oki nami ura).'],
  alternative: ['alternative', 'Ein weiterer Name, unter dem der Eintrag bekannt ist.'],
  former: ['former', 'Ein Name, den der Eintrag früher trug: eine umbenannte Institution, ein alter Ortsname, ein abgelegter Familienname.'],
};
const NAME_KINDS = {
  birth: ['birth name', 'Geburtsname; ein früherer Name nur, wenn sich der Familienname änderte.'],
  married: ['married name', 'Name nach einer Heirat.'],
  pseudonym: ['pseudonym', 'Selbst gewählter Name, unter dem jemand arbeitete oder veröffentlichte.'],
  art_name: ['art name', 'Künstlername, bei japanischen Künstler:innen der gō (Hokusais Shunrō).'],
  religious: ['religious name', 'Ordensname.'],
  nickname: ['nickname', 'Beiname oder Spitzname (Le Douanier).'],
  abbreviation: ['abbreviation', 'Abkürzung (SMB).'],
};
// a fixed list's values in order, each with how often entry_names uses it
async function nameCounts(db, column, texts) {
  const { rows } = await db.query(`SELECT v AS code, count(n.id)::int AS n FROM unnest($1::text[]) WITH ORDINALITY x(v, o)
    LEFT JOIN entry_names n ON n.${column} = x.v GROUP BY v, o ORDER BY o`, [Object.keys(texts)]);
  return rows.map((r) => ({ code: r.code, label: texts[r.code][0], description: texts[r.code][1], n: r.n }));
}

// an enum's values in their declared order, each with how often a column uses it — LEFT JOIN, so unused values count 0
async function enumCounts(db, type, table, column, texts) {
  const { rows } = await db.query(`SELECT v::text AS code, count(t.${column})::int AS n
    FROM unnest(enum_range(NULL::${type})) v LEFT JOIN ${table} t ON t.${column} = v GROUP BY v ORDER BY v`);
  return rows.map((r) => ({ code: r.code, label: texts[r.code]?.[0] ?? r.code, description: texts[r.code]?.[1] ?? null, n: r.n }));
}

async function vocabulary(db) {
  const { rows: relationships } = await db.query(`SELECT rt.code, rt.label, rt.inverse_label, rt.category, rt.is_symmetric AS symmetric,
      rt.is_physical_presence AS presence, rt.derived, rt.subject_types::text[] AS subject_types, rt.object_types::text[] AS object_types,
      rt.description, (SELECT count(*) FROM graph_links g WHERE g.relationship_type = rt.code)::int AS n
    FROM relationship_types rt ORDER BY rt.sort_order, rt.code`);
  const { rows: numbers } = await db.query(`SELECT k.code, k.label, k.description, k.scope,
      (SELECT count(*) FROM provenance_numbers n WHERE n.kind = k.code)::int AS n
    FROM provenance_number_kinds k ORDER BY k.position, k.code`);
  const { rows: currencies } = await db.query(`SELECT c.code, c.name, c.country, lower(c.in_use)::text AS since, upper(c.in_use)::text AS until,
      (SELECT count(*) FROM provenance p WHERE p.price_currency = c.code)::int AS n
    FROM currencies c ORDER BY c.code`);
  return {
    relationships,
    names: { roles: await nameCounts(db, 'role', NAME_ROLES), kinds: await nameCounts(db, 'kind', NAME_KINDS) },
    provenance: {
      methods: await enumCounts(db, 'acquisition_method', 'provenance', 'method', METHODS),
      roles: await enumCounts(db, 'holder_role', 'provenance', 'role', ROLES),
      certainty: await enumCounts(db, 'certainty', 'provenance', 'certainty', CERTAINTY),
      records: await enumCounts(db, 'provenance_record_kind', 'provenance_records', 'kind', RECORDS),
      status: await enumCounts(db, 'provenance_status', 'artworks', 'provenance_status', STATUS),
      numbers,
      currencies,
    },
  };
}

module.exports = { vocabulary };
