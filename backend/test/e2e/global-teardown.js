const server = require('./server');

module.exports = async () => { await server.stop(); };
