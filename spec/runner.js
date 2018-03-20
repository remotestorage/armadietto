process.env.SILENT = '1'

var JS = require('jstest')

require('./armadietto/web_finger_spec')
require('./armadietto/oauth_spec')
require('./armadietto/storage_spec')

require('./store_spec.js')
require('./stores/file_tree_spec')
require('./stores/redis_spec')

JS.Test.autorun()
