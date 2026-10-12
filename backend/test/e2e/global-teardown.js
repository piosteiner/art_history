const server = require('./server');
const wikidataFixtures = require('./wikidata-fixtures');
const { shards } = require('./env');

module.exports = async () => {
  await Promise.all(shards().map((s) => server.stop(s)));
  await wikidataFixtures.stop();
};
