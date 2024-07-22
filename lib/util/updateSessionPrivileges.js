module.exports = async function updateSessionPrivileges (req, user, isAdminLogin) {
  const oauthParams = req.session.oauthParams;
  // removes any privileges the user no longer has
  const oldPrivileges = {};
  for (const name of Object.keys(user.privileges)) {
    if (req.session.privileges?.[name]) {
      oldPrivileges[name] = true;
    }
  }

  // Privilege level has changed, so the session must be regenerated.
  await new Promise((resolve, reject) => {
    req.session.regenerate(err => { if (err) { reject(err); } else { resolve(); } });
  });

  const newPrivileges = { ...user.privileges };
  if (!isAdminLogin) {
    delete newPrivileges.ADMIN;
    delete newPrivileges.OWNER;
  }

  req.session.privileges = { ...oldPrivileges, ...newPrivileges };
  req.session.oauthParams = oauthParams;
};
