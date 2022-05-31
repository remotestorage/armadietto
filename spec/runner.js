process.env.SILENT = '1';

require('./armadietto/web_finger_spec');
require('./armadietto/oauth_spec');
require('./armadietto/signup_spec');
require('./armadietto/storage_spec');

require('./stores/file_tree_spec');
require('./stores/couchdb_spec');
// require('./stores/redis_spec');
