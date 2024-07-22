module.exports = function removeUserDataFromSession (session) {
  delete session?.privileges;
  delete session?.user;
  delete session?.regChallenge;
  delete session?.loginChallenge;
  delete session?.oauthParams;
  delete session?.isUserSynthetic;
};
