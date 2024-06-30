module.exports = function removeUserDataFromSession (session) {
  delete session?.privileges;
  delete session?.user;
  delete session?.admin;
  delete session?.username;
  delete session?.userName;
  delete session?.regChallenge;
  delete session?.loginChallenge;
  delete session?.oauthChallenge;
};
