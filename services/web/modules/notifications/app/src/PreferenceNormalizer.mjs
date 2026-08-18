function _defaultProjectPreferences() {
  return {
    commentOnOwnProject: true,
    commentOnInvitedProject: true,
    repliesOnAuthoredThread: true,
    repliesOnParticipatingThread: true,
    commentResolvedOnAuthoredThread: true,
    commentResolvedOnParticipatingThread: true,
    commentReopenedOnAuthoredThread: true,
    commentReopenedOnParticipatingThread: true,
    trackedChangesOnOwnProject: true,
    trackedChangesOnInvitedProject: true,
    trackChangesAcceptedOnAuthoredChange: true,
    trackChangesRejectedOnAuthoredChange: true,
  }
}

function normalizeProjectPreferences(preferences) {
  const defaults = _defaultProjectPreferences()
  const normalized = {}
  for (const [key, defaultValue] of Object.entries(defaults)) {
    normalized[key] = preferences[key] === undefined
      ? defaultValue
      : Boolean(preferences[key])
  }
  return normalized
}

function normalizeGlobalPreferences(preferences) {
  return {
    muteAllNotifications: Boolean(preferences?.muteAllNotifications),
  }
}

export {
  _defaultProjectPreferences,
  normalizeProjectPreferences,
  normalizeGlobalPreferences,
}
