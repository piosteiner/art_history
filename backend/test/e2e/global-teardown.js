const server = require('./server');
const wikidataFixtures = require('./wikidata-fixtures');

module.exports = async () => {
  await server.stop();
  await wikidataFixtures.stop();
};
