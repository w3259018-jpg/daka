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
  app.globalData.guestMode = guestMode;
  if (guestMode) {
    wx.setStorageSync('guestMode', true);
  } else {
    wx.removeStorageSync('guestMode');
  }
};

const cacheUser = (user, app = getApp()) => {
  const mergedUser = {
    ...(app.globalData.user || {}),
    ...(user || {})
  };
  app.globalData.user = mergedUser;
  wx.setStorageSync('user', mergedUser);
  return mergedUser;
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
  requireProfile,
  profilePopupHandlers
};
