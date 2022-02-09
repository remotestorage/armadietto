/* Occasionally, expectations in these tests may fail, because the system was heavily loaded with other jobs.
   That's okay (except for tests marked as functional).
   If an expectation persistently fails, investigate why Armadietto is performing worse than before.
   If the tests fail to complete, fix them!
 */
require('./stress/rapid_requests_spec');
