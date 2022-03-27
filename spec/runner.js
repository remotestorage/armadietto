process.env.SILENT = '1';
process.setMaxListeners(0);

require('./armadietto/web_finger_spec');
require('./armadietto/oauth_spec');
require('./armadietto/signup_spec');
require('./armadietto/storage_spec');

require('./stores/file_tree_spec');
// require('./stores/redis_spec');

require('./armadietto/middleware_spec');
require('./armadietto/rate_limiter_spec');
require('./armadietto/storage_allowance_spec');
