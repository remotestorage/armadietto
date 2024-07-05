const express = require('express');
const { getHost } = require('../util/getHost');
const errToMessages = require('../util/errToMessages');
const removeUserDataFromSession = require('../util/removeUserDataFromSession');

module.exports = async function (hostIdentity, jwtSecret, accountMgr) {
  const router = express.Router();

  // ----------------------- user account -------------------------------------------

  router.get('/',
    // csrfCheck,
    async (req, res) => {
      try {
        if (!req.session.user?.username) {
          res.logNotes.add('-> /account/login');
          removeUserDataFromSession(req.session);
          res.redirect(307, '/account/login');
          return;
        }
        req.session.user = await accountMgr.getUser(req.session.user.username, res.logNotes); // get latest values

        res.render('account/account.html', {
          title: 'Your Account',
          host: getHost(req),
          privileges: req.session.privileges || {},
          accountPrivileges: req.session.user?.privileges || {},
          username: req.session.user?.username,
          contactURL: req.session.user?.contactURL,
          credentials: Object.values(req.session.user?.credentials || {})
        });
        res.logNotes.add(`${req.session.user?.username} ${req.session.user?.contactURL} ${Object.keys(req.session.user?.privileges).join('&')} ${Object.keys(req.session.user?.credentials)?.length} credential(s)`);
      } catch (err) {
        errToMessages(err, res.logNotes);
        res.status(401).render('login/error.html', {
          title: 'Your Account',
          host: getHost(req),
          privileges: req.session.privileges || {},
          accountPrivileges: req.session.user?.privileges || {},
          subtitle: '',
          message: 'There was an error displaying your info'
        });
      }
    }
  );

  return router;
};
