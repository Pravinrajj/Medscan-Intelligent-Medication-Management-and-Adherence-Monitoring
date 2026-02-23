import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import api from '../api/client';

const QUEUE_KEY = 'offline_queue';

class OfflineSyncService {
  constructor() {
    this.isOnline = true;
    this.unsubscribe = null;
    this.listeners = new Set();
  }

  init() {
    this.unsubscribe = NetInfo.addEventListener(state => {
      const wasOffline = !this.isOnline;
      this.isOnline = state.isConnected && state.isInternetReachable !== false;
      
      // Notify listeners
      this.listeners.forEach(fn => fn(this.isOnline));
      
      // If we just came back online, flush the queue
      if (wasOffline && this.isOnline) {
        console.log('[OfflineSync] Back online — flushing queue...');
        this.flushQueue();
      }
    });
  }

  destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    // Immediately call with current status
    listener(this.isOnline);
    return () => this.listeners.delete(listener);
  }

  getOnlineStatus() {
    return this.isOnline;
  }

  async safePost(url, data) {
    if (this.isOnline) {
      try {
        const response = await api.post(url, data);
        return { queued: false, data: response.data };
      } catch (error) {
        // If it's a network error, queue it
        if (!error.response) {
          await this.queueRequest(url, data);
          return { queued: true };
        }
        throw error;
      }
    } else {
      await this.queueRequest(url, data);
      return { queued: true };
    }
  }

  async queueRequest(url, data) {
    try {
      const queueStr = await AsyncStorage.getItem(QUEUE_KEY);
      const queue = queueStr ? JSON.parse(queueStr) : [];
      queue.push({ url, data, timestamp: new Date().toISOString() });
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      console.log(`[OfflineSync] Queued request: ${url}. Queue size: ${queue.length}`);
    } catch (e) {
      console.error('[OfflineSync] Failed to queue request:', e.message);
    }
  }

  async flushQueue() {
    try {
      const queueStr = await AsyncStorage.getItem(QUEUE_KEY);
      if (!queueStr) return;

      const queue = JSON.parse(queueStr);
      if (queue.length === 0) return;

      console.log(`[OfflineSync] Flushing ${queue.length} queued requests...`);

      // Sort by timestamp ascending for deterministic conflict resolution
      queue.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      const failed = [];

      // Separate adherence logs (batchable) from other requests
      const adherenceItems = queue.filter(item => item.url === '/adherence/log');
      const otherItems = queue.filter(item => item.url !== '/adherence/log');

      // Batch-sync adherence logs via POST /sync/batch
      if (adherenceItems.length > 0) {
        try {
          const batchPayload = adherenceItems.map(item => ({
            scheduleId: item.data.scheduleId,
            userId: item.data.userId,
            status: item.data.status,
            timestamp: item.timestamp,
          }));
          const res = await api.post('/sync/batch', batchPayload);
          console.log(`[OfflineSync] Batch sync: ${res.data.success} succeeded, ${res.data.failed} failed`);
          if (res.data.failed > 0 && res.data.errors) {
            console.warn('[OfflineSync] Batch errors:', res.data.errors);
          }
        } catch (e) {
          console.error('[OfflineSync] Batch sync failed:', e.message);
          // Re-queue all adherence items only on network error
          if (!e.response) {
            failed.push(...adherenceItems);
          }
        }
      }

      // Replay other requests individually (e.g., notification token)
      for (const item of otherItems) {
        try {
          await api.post(item.url, item.data);
          console.log(`[OfflineSync] Synced: ${item.url}`);
        } catch (e) {
          console.error(`[OfflineSync] Failed to sync: ${item.url}`, e.message);
          if (!e.response) {
            failed.push(item);
          }
        }
      }

      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(failed));
      console.log(`[OfflineSync] Flush complete. Remaining: ${failed.length}`);
    } catch (e) {
      console.error('[OfflineSync] Flush error:', e.message);
    }
  }
}

const offlineSyncService = new OfflineSyncService();
export default offlineSyncService;
