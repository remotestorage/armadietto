process.env.SILENT = '1';

require('./armadietto/web_finger_spec');
require('./armadietto/oauth_spec');
require('./armadietto/storage_spec');

require('./stores/file_tree_spec');
// require('./stores/redis_spec');
