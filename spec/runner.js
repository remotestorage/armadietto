process.env.SILENT = '1';

require('./armadietto/web_finger_spec');
require('./armadietto/oauth_spec');
require('./armadietto/signup_spec');
require('./armadietto/storage_spec');
require('./armadietto/a_root_spec');
require('./armadietto/a_not_found_spec');
require('./armadietto/a_static_spec');
require('./armadietto/a_signup_spec');
require('./armadietto/a_web_finger.spec');
require('./armadietto/a_oauth_spec');

require('./stores/file_tree_spec');
// require('./stores/redis_spec');

require('./modular/m_root.spec');
require('./modular/m_not_found.spec');
require('./modular/m_static.spec');
require('./modular/m_signup.spec');
require('./modular/m_web_finger.spec');
require('./modular/m_oauth.spec');

// require('./streaming_stores/S3.spec');
