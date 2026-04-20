import UserGetter from '../User/UserGetter.mjs'
import { CacheLoader } from 'cache-flow'
import { callbackify } from 'node:util'
import Metrics from '@overleaf/metrics'

class UserAnalyticsIdCache extends CacheLoader {
  constructor() {
    super('user-analytics-id', {
      expirationTime: 60,
      maxSize: 10000,
    })
  }

  async load(userId) {
    const user = await UserGetter.promises.getUser(userId, { analyticsId: 1 })
    if (user) {
      return user.analyticsId || user._id.toString()
    }
  }

  keyToString(userId) {
    if (userId) {
      return userId.toString()
    }
  }

  get() {
    throw new Error('use UserAnalyticsIdCache.getWithMetrics')
  }

  async getWithMetrics(userId, path) {
    const { value, cached } = await this.getWithMetadata(userId)
    Metrics.inc('user_analytics_id_cache', 1, {
      status: cached ? 'hit' : 'miss',
      path,
    })
    return value
  }
}

const userAnalyticsIdCache = new UserAnalyticsIdCache()
userAnalyticsIdCache.callbacks = {
  get: callbackify(userAnalyticsIdCache.get).bind(userAnalyticsIdCache),
}
export default userAnalyticsIdCache
