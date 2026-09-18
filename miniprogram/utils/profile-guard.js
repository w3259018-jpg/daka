const hasProfile = user => !!(
  user &&
  typeof user.nickname === 'string' &&
  user.nickname.trim()
);

const createFallbackNickname = (random = Math.random) => (
  `自在用户${1000 + Math.floor(random() * 9000)}`
);

const shouldPromptProfile = (user, guestMode) => !guestMode && !hasProfile(user);

const setGuestMode = (enabled, app = getApp()) => {
  const guestMode = !!enabled;
  if (guestMode) {
    wx.setStorageSync('guestMode', true);
  } else {
    wx.removeStorageSync('guestMode');
  }
  app.globalData.guestMode = guestMode;
};

const cacheUser = (user, app = getApp()) => {
  const mergedUser = {
    ...(app.globalData.user || {}),
    ...(user || {})
  };
  wx.setStorageSync('user', mergedUser);
  app.globalData.user = mergedUser;
  return mergedUser;
};

const completeProfile = (user, app = getApp()) => {
  const hadGlobalUser = Object.prototype.hasOwnProperty.call(app.globalData, 'user');
  const hadGlobalGuestMode = Object.prototype.hasOwnProperty.call(app.globalData, 'guestMode');
  const previousGlobalUser = app.globalData.user;
  const previousGlobalGuestMode = app.globalData.guestMode;
  const previousStoredUser = wx.getStorageSync('user');
  const previousStoredGuestMode = wx.getStorageSync('guestMode');

  try {
    const cached = cacheUser(user, app);
    if (hasProfile(cached)) setGuestMode(false, app);
    return cached;
  } catch (error) {
    try {
      if (previousStoredUser === undefined) wx.removeStorageSync('user');
      else wx.setStorageSync('user', previousStoredUser);
    } catch (_) {}
    try {
      if (previousStoredGuestMode === undefined) wx.removeStorageSync('guestMode');
      else wx.setStorageSync('guestMode', previousStoredGuestMode);
    } catch (_) {}

    if (hadGlobalUser) app.globalData.user = previousGlobalUser;
    else delete app.globalData.user;
    if (hadGlobalGuestMode) app.globalData.guestMode = previousGlobalGuestMode;
    else delete app.globalData.guestMode;
    throw error;
  }
};

const requireProfile = (page, options = {}) => {
  const app = typeof getApp === 'function' ? getApp() : null;
  const user = options.user ||
    (page && page.data && page.data.user) ||
    (app && app.globalData && app.globalData.user);

  if (hasProfile(user)) return true;
  if (!options.silent) {
    wx.showToast({ title: '请先完善个人资料', icon: 'none' });
    if (page && typeof page.setData === 'function') {
      page.setData({ showLoginPopup: true });
    }
  }
  return false;
};

const profilePopupHandlers = {
  onProfileSuccess(event) {
    const detail = event && event.detail;
    const user = detail && (detail.user || (detail.nickname ? detail : null));
    const update = { showLoginPopup: false };
    if (user) update.user = user;
    this.setData(update);
  },

  onProfileSkip() {
    this.setData({ showLoginPopup: false });
  }
};

module.exports = {
  hasProfile,
  createFallbackNickname,
  shouldPromptProfile,
  setGuestMode,
  cacheUser,
  completeProfile,
  requireProfile,
  profilePopupHandlers
};
